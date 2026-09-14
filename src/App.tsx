import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ZOOM_LEVELS,
  clampCenter,
  clampDivider,
  type Point,
  type Size,
  type Zoom,
} from './core/viewport';
import { decodeImageFile, ImageLoadError, type LoadedImage } from './core/loadImage';
import type { SamplePoint, SampleResult } from './core/sample';
import { CompareCanvas } from './components/CompareCanvas';

type Slot = 'before' | 'after';

const SLOT_LABEL: Record<Slot, string> = { before: '修复前', after: '修复后' };

function fmt(n: number): string {
  return String(Number(n.toFixed(2)));
}

function rgbaText(p: [number, number, number, number] | null): string {
  return p ? `(${p[0]}, ${p[1]}, ${p[2]}, ${p[3]})` : '—';
}

function diffText(result: SampleResult): string {
  if (result.status !== 'ok' || !result.diff) return '—';
  const d = result.diff;
  return `Δ(${d.dr}, ${d.dg}, ${d.db}, ${d.da})`;
}

type Images = Record<Slot, LoadedImage | null>;

function pairOf(images: Images): Size | null {
  const a = images.before;
  const b = images.after;
  return a && b ? { width: a.width, height: a.height } : null;
}

export function App() {
  // 影像/倍率/画布尺寸的同步真源：文件回调可能连续触发，
  // 渲染期闭包会读到过期状态，故共享数据一律走 ref。
  const imagesRef = useRef<Images>({ before: null, after: null });
  const canvasSizeRef = useRef<Size>({ width: 0, height: 0 });
  const zoomRef = useRef<Zoom>(1);

  const [images, setImages] = useState<Images>(imagesRef.current);
  const [errors, setErrors] = useState<Record<Slot, string | null>>({
    before: null,
    after: null,
  });
  const [zoom, setZoom] = useState<Zoom>(1);
  const [center, setCenter] = useState<Point>({ x: 0, y: 0 });
  const [divider, setDivider] = useState(0);

  // 取样状态由 App 统一持有：模式开关、原图整数坐标取样点、最近结果与反馈
  const [sampling, setSampling] = useState(false);
  const [samplePoint, setSamplePoint] = useState<SamplePoint | null>(null);
  const [sampleResult, setSampleResult] = useState<SampleResult | null>(null);

  const pairSize = useMemo(() => pairOf(images), [images]);

  const handleSample = useCallback((result: SampleResult) => {
    // 留白点击保留上一次有效结果：仅更新反馈，不覆盖有效结果与取样点
    if (result.status === 'blank') {
      setSampleResult((prev) =>
        prev && prev.status === 'ok' ? { ...prev, notice: result.notice } : result,
      );
      return;
    }
    if (result.status === 'out') {
      // 越界：清除取样点与结果并说明原因
      setSamplePoint(null);
      setSampleResult(result);
      return;
    }
    setSamplePoint(result.point);
    setSampleResult(result);
  }, []);

  const handleFile = useCallback(async (slot: Slot, file: File) => {
    let img: LoadedImage;
    try {
      img = await decodeImageFile(file);
    } catch (err) {
      // 校验失败：定位原因，保留上一组有效影像与视口
      const reason = err instanceof ImageLoadError ? err.message : '读取失败';
      setErrors((e) => ({ ...e, [slot]: `${SLOT_LABEL[slot]}：${reason}（${file.name}）` }));
      return;
    }
    // await 之后重新读取最新影像状态，避免并发回调的过期快照
    const cur = imagesRef.current;
    const other = slot === 'before' ? cur.after : cur.before;
    const hadPair = Boolean(cur.before && cur.after);
    if (other && (img.width !== other.width || img.height !== other.height)) {
      img.bitmap.close();
      setErrors((e) => ({
        ...e,
        [slot]:
          `${SLOT_LABEL[slot]}：尺寸不一致，应为 ${other.width}×${other.height}，` +
          `实为 ${img.width}×${img.height}（${file.name}）`,
      }));
      return;
    }
    cur[slot]?.bitmap.close();
    imagesRef.current = { ...cur, [slot]: img };
    setImages(imagesRef.current);
    setErrors((e) => ({ ...e, [slot]: null }));
    if (other && !hadPair) {
      // 首次成对：以天然像素尺寸初始化视口
      zoomRef.current = 1;
      setZoom(1);
      setCenter({ x: img.width / 2, y: img.height / 2 });
      setDivider(Math.round(canvasSizeRef.current.width / 2));
    } else if (other && hadPair) {
      // 替换单侧：保留视口（尺寸相同，钳制为恒等）
      setCenter((c) => clampCenter(c, img, canvasSizeRef.current, zoomRef.current));
    }
  }, []);

  const handleCanvasSize = useCallback((size: Size) => {
    canvasSizeRef.current = size;
    const pair = pairOf(imagesRef.current);
    if (pair) setCenter((c) => clampCenter(c, pair, size, zoomRef.current));
    setDivider((d) => clampDivider(d, size.width));
  }, []);

  const handleZoom = useCallback((z: Zoom) => {
    zoomRef.current = z;
    setZoom(z);
    // 视口中心原图坐标不变，仅在新视口尺寸下重新钳制
    const pair = pairOf(imagesRef.current);
    if (pair) setCenter((c) => clampCenter(c, pair, canvasSizeRef.current, z));
  }, []);

  return (
    <div className="app">
      <header className="toolbar">
        <h1>壁画擦镜核验台</h1>
        <div className="loaders">
          {(['before', 'after'] as const).map((slot) => (
            <div className="loader" key={slot}>
              <label className="file-button">
                {SLOT_LABEL[slot]}
                <input
                  data-testid={`input-${slot}`}
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFile(slot, f);
                    e.target.value = '';
                  }}
                />
              </label>
              <span className="file-meta" data-testid={`meta-${slot}`}>
                {images[slot]
                  ? `${images[slot]!.name}（${images[slot]!.width}×${images[slot]!.height}）`
                  : '未载入'}
              </span>
              {errors[slot] && (
                <span className="error" role="alert" data-testid={`error-${slot}`}>
                  {errors[slot]}
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="sample-group">
          <button
            type="button"
            data-testid="toggle-sampling"
            aria-pressed={sampling}
            disabled={!pairSize}
            onClick={() => setSampling((v) => !v)}
          >
            像素取样
          </button>
        </div>
        <div className="zoom-group" role="group" aria-label="倍率">
          {ZOOM_LEVELS.map((z) => (
            <button
              key={z}
              type="button"
              data-testid={`zoom-${z}`}
              aria-pressed={zoom === z}
              disabled={!pairSize}
              onClick={() => handleZoom(z)}
            >
              {z}×
            </button>
          ))}
        </div>
      </header>

      <main className="stage">
        <CompareCanvas
          before={images.before}
          after={images.after}
          zoom={zoom}
          center={center}
          divider={divider}
          imageSize={pairSize}
          sampling={sampling}
          samplePoint={samplePoint}
          onCenterChange={setCenter}
          onDividerChange={setDivider}
          onCanvasSize={handleCanvasSize}
          onSample={handleSample}
        />
      </main>

      <footer className="statusbar" data-testid="statusbar">
        <span>
          倍率 <strong data-testid="zoom-label">{zoom}×</strong>
        </span>
        <span>
          分界 <strong data-testid="divider-label">{divider} px</strong>
        </span>
        <span>
          中心{' '}
          <strong data-testid="center-label">
            ({fmt(center.x)}, {fmt(center.y)})
          </strong>
        </span>
        {sampling && (
          <span className="sample-readout" data-testid="sample-readout">
            取样{' '}
            <strong data-testid="sample-coord">
              {sampleResult?.point
                ? `(${sampleResult.point.x}, ${sampleResult.point.y})`
                : '—'}
            </strong>
            {sampleResult?.status === 'ok' && (
              <>
                {' '}前 <strong data-testid="sample-before">{rgbaText(sampleResult.before)}</strong>{' '}
                后 <strong data-testid="sample-after">{rgbaText(sampleResult.after)}</strong>{' '}
                <strong data-testid="sample-diff">{diffText(sampleResult)}</strong>
              </>
            )}
          </span>
        )}
        {sampling && sampleResult?.notice && (
          <span
            className={sampleResult.status === 'out' ? 'error' : 'sample-notice'}
            role="status"
            data-testid="sample-notice"
          >
            {sampleResult.notice}
          </span>
        )}
        <span className="hint">
          {sampling
            ? '取样模式：点击画布取该原图坐标像素 · 空格或中键仍可平移 · 左键不移动分界'
            : '拖动移动分界 · 按住空格拖动或滚轮平移 · ←/→ 微调分界'}
        </span>
      </footer>
    </div>
  );
}
