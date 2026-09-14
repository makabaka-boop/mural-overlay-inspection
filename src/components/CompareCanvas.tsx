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
import {
  isPointInImage,
  resolveSamplePoint,
  samplePointToCss,
  blankSampleResult,
  okSampleResult,
  outOfBoundsResult,
  type PixelRGBA,
  type SamplePoint,
  type SampleResult,
} from '../core/sample';

interface Props {
  before: LoadedImage | null;
  after: LoadedImage | null;
  zoom: Zoom;
  center: Point;
  divider: number;
  imageSize: Size | null;
  /** 像素取样模式（状态由 App 统一持有） */
  sampling: boolean;
  /** 当前取样点（原图整数坐标）；缩放/平移只移动其屏幕位置 */
  samplePoint: SamplePoint | null;
  onCenterChange: (center: Point) => void;
  onDividerChange: (divider: number) => void;
  onCanvasSize: (size: Size) => void;
  onSample: (result: SampleResult) => void;
}

export function CompareCanvas(props: Props) {
  const {
    before,
    after,
    zoom,
    center,
    divider,
    imageSize,
    sampling,
    samplePoint,
    onCenterChange,
    onDividerChange,
    onCanvasSize,
    onSample,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cssSize, setCssSize] = useState<Size>({ width: 0, height: 0 });

  // 交互会话状态（不触发渲染，用 ref）
  const dragMode = useRef<'divider' | 'pan' | null>(null);
  const lastPos = useRef<Point>({ x: 0, y: 0 });
  const spaceHeld = useRef(false);

  // 最新 props 的镜像，供原生事件回调读取
  const latest = useRef({
    zoom,
    center,
    divider,
    imageSize,
    cssSize,
    sampling,
    before,
    after,
  });
  latest.current = { zoom, center, divider, imageSize, cssSize, sampling, before, after };

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

  // 载入新的有效同尺寸单侧图后，按原坐标重新取样
  const prevBitmaps = useRef<{ before: ImageBitmap | null; after: ImageBitmap | null }>({
    before: null,
    after: null,
  });

  // 在原图整数坐标处读取单像素 RGBA（离屏 1×1 画布，受 imageSmoothing 影响为否）
  const readPixel = (img: LoadedImage, point: SamplePoint): PixelRGBA | null => {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img.bitmap, point.x, point.y, 1, 1, 0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data) as PixelRGBA;
  };

  useEffect(() => {
    const prev = prevBitmaps.current;
    const replaced =
      (before && prev.before && before.bitmap !== prev.before) ||
      (after && prev.after && after.bitmap !== prev.after);
    prevBitmaps.current = {
      before: before ? before.bitmap : null,
      after: after ? after.bitmap : null,
    };
    if (!replaced || !samplePoint || !before || !after || !imageSize) return;
    if (!isPointInImage(samplePoint, imageSize)) {
      onSample(outOfBoundsResult(samplePoint));
      return;
    }
    const pBefore = readPixel(before, samplePoint);
    const pAfter = readPixel(after, samplePoint);
    if (pBefore && pAfter) onSample(okSampleResult(samplePoint, pBefore, pAfter));
    // 仅在影像替换时触发，center/zoom 变化不重新取样
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [before, after]);

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

    // 取样点标记：缩放/平移只移动其屏幕位置，原图坐标不变；退出取样模式即隐藏
    if (sampling && samplePoint) {
      const pos = samplePointToCss(samplePoint, center, cssSize, zoom);
      // 黄底 + 深色描边的十字圆环，叠在任意底色上都可辨识
      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(20, 20, 20, 0.9)';
      ctx.fillStyle = '#ffd400';
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pos.x - 11, pos.y);
      ctx.lineTo(pos.x + 11, pos.y);
      ctx.moveTo(pos.x, pos.y - 11);
      ctx.lineTo(pos.x, pos.y + 11);
      ctx.strokeStyle = '#ffd400';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(20, 20, 20, 0.9)';
      ctx.fill();
      ctx.restore();
    }
  }, [before, after, zoom, center, divider, imageSize, cssSize, sampling, samplePoint]);

  const setDividerFromPointer = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    onDividerChange(dividerFromClientX(clientX, rect.left, latest.current.cssSize.width));
  };

  // 模式化指针交互：取样点击 → 换算坐标 + 读像素；不移动分界
  const takeSampleFromPointer = (clientX: number, clientY: number) => {
    const s = latest.current;
    const canvas = canvasRef.current;
    if (!canvas || !s.imageSize || !s.before || !s.after) return;
    const rect = canvas.getBoundingClientRect();
    const css = { x: clientX - rect.left, y: clientY - rect.top };
    const resolution = resolveSamplePoint(
      css,
      s.center,
      s.imageSize,
      s.cssSize,
      s.zoom,
    );
    if (resolution.status === 'blank') {
      onSample(blankSampleResult());
      return;
    }
    if (resolution.status === 'out' || !resolution.point) {
      onSample(outOfBoundsResult(resolution.point ?? { x: 0, y: 0 }));
      return;
    }
    const point = resolution.point;
    const pBefore = readPixel(s.before, point);
    const pAfter = readPixel(s.after, point);
    if (pBefore && pAfter) onSample(okSampleResult(point, pBefore, pAfter));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!imageSize) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    lastPos.current = { x: e.clientX, y: e.clientY };
    if (e.button === 1 || spaceHeld.current) {
      // 空格或中键平移：取样模式下仍可用
      dragMode.current = 'pan';
      e.preventDefault();
    } else if (e.button === 0) {
      if (sampling) {
        // 取样模式：普通左键不移动分界
        takeSampleFromPointer(e.clientX, e.clientY);
      } else {
        dragMode.current = 'divider';
        setDividerFromPointer(e.clientX);
      }
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
        style={{
          width: cssSize.width,
          height: cssSize.height,
          cursor: sampling ? 'crosshair' : 'ew-resize',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
