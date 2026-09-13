import { useEffect, useRef, useState } from 'react';
import {
  computeBlit,
  dividerFromClientX,
  panCenter,
  stepDivider,
  type Point,
  type Size,
  type Zoom,
} from '../core/viewport';
import type { LoadedImage } from '../core/loadImage';

interface Props {
  before: LoadedImage | null;
  after: LoadedImage | null;
  zoom: Zoom;
  center: Point;
  divider: number;
  imageSize: Size | null;
  onCenterChange: (center: Point) => void;
  onDividerChange: (divider: number) => void;
  onCanvasSize: (size: Size) => void;
}

export function CompareCanvas(props: Props) {
  const {
    before,
    after,
    zoom,
    center,
    divider,
    imageSize,
    onCenterChange,
    onDividerChange,
    onCanvasSize,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cssSize, setCssSize] = useState<Size>({ width: 0, height: 0 });

  // 交互会话状态（不触发渲染，用 ref）
  const dragMode = useRef<'divider' | 'pan' | null>(null);
  const lastPos = useRef<Point>({ x: 0, y: 0 });
  const spaceHeld = useRef(false);

  // 最新 props 的镜像，供原生事件回调读取
  const latest = useRef({ zoom, center, divider, imageSize, cssSize });
  latest.current = { zoom, center, divider, imageSize, cssSize };

  // 画布尺寸跟踪（CSS 像素）
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      const size = { width: Math.round(rect.width), height: Math.round(rect.height) };
      setCssSize(size);
      onCanvasSize(size);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [onCanvasSize]);

  // 空格按住 = 平移模式
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeld.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceHeld.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // 滚轮平移（需要非 passive 才能阻止页面滚动）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      const s = latest.current;
      if (!s.imageSize) return;
      e.preventDefault();
      onCenterChange(
        panCenter(s.center, e.deltaX, e.deltaY, s.imageSize, s.cssSize, s.zoom),
      );
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [onCenterChange]);

  // 渲染
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cssSize.width === 0 || cssSize.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(cssSize.width * dpr));
    canvas.height = Math.max(1, Math.round(cssSize.height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // 背景（图像小于视口时的留白区域）
    ctx.fillStyle = '#17181c';
    ctx.fillRect(0, 0, cssSize.width, cssSize.height);

    if (!before || !after || !imageSize) {
      ctx.fillStyle = '#8a8f98';
      ctx.font = '14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        '请分别载入修复前与修复后图像（PNG / JPEG，尺寸须一致）',
        cssSize.width / 2,
        cssSize.height / 2,
      );
      return;
    }

    const blit = computeBlit(center, imageSize, cssSize, zoom);
    const draw = (img: LoadedImage) => {
      ctx.drawImage(
        img.bitmap,
        blit.sx,
        blit.sy,
        blit.sw,
        blit.sh,
        blit.dx,
        blit.dy,
        blit.dw,
        blit.dh,
      );
    };

    // 左：修复前；右：修复后。分界严格限定在画布内。
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, divider, cssSize.height);
    ctx.clip();
    draw(before);
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(divider, 0, cssSize.width - divider, cssSize.height);
    ctx.clip();
    draw(after);
    ctx.restore();

    // 分界线
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fillRect(divider - 0.5, 0, 1, cssSize.height);
  }, [before, after, zoom, center, divider, imageSize, cssSize]);

  const setDividerFromPointer = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    onDividerChange(dividerFromClientX(clientX, rect.left, latest.current.cssSize.width));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!imageSize) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    lastPos.current = { x: e.clientX, y: e.clientY };
    if (e.button === 1 || spaceHeld.current) {
      dragMode.current = 'pan';
    } else if (e.button === 0) {
      dragMode.current = 'divider';
      setDividerFromPointer(e.clientX);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const mode = dragMode.current;
    if (!mode) return;
    const s = latest.current;
    if (mode === 'divider') {
      setDividerFromPointer(e.clientX);
    } else if (s.imageSize) {
      // 抓取式平移：指针位移的相反数即视口中心位移
      const dx = e.clientX - lastPos.current.x;
      const dy = e.clientY - lastPos.current.y;
      lastPos.current = { x: e.clientX, y: e.clientY };
      onCenterChange(panCenter(s.center, -dx, -dy, s.imageSize, s.cssSize, s.zoom));
    }
  };

  const endDrag = () => {
    dragMode.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const delta = e.key === 'ArrowLeft' ? -1 : 1;
      onDividerChange(stepDivider(latest.current.divider, delta, latest.current.cssSize.width));
    }
  };

  return (
    <div className="canvas-container" ref={containerRef}>
      <canvas
        ref={canvasRef}
        data-testid="compare-canvas"
        tabIndex={0}
        style={{ width: cssSize.width, height: cssSize.height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
