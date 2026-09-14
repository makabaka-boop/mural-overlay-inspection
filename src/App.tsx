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
import {
  formatDistance,
  initialRulerState,
  type RulerState,
} from './core/ruler';
import {
  DIFF_THRESHOLD_DEFAULT,
  DIFF_THRESHOLD_MAX,
  DIFF_THRESHOLD_MIN,
  clampThreshold,
} from './core/diff';
import {
  BOOKMARK_STORAGE_KEY,
  bookmarkFromView,
  parseBookmark,
  resolveBookmarkView,
  serializeBookmark,
} from './core/bookmark';
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

  // 测距状态由 App 统一持有：模式开关与尺的生命周期（等待起点/终点/已完成）。
  // 端点与读数均为原图坐标，缩放/平移只改变屏幕位置；退出模式只隐藏、不清除。
  const [ranging, setRanging] = useState(false);
  const [ruler, setRuler] = useState<RulerState>(initialRulerState);

  // 差异显影：App 持有启用状态与 0–255 灵敏度阈值；纯视觉叠加，不与
  // 取样/测距互斥，也不接管指针。蒙版生成失败由 CompareCanvas 回调上报。
  const [diffEnabled, setDiffEnabled] = useState(false);
  const [diffThreshold, setDiffThreshold] = useState(DIFF_THRESHOLD_DEFAULT);
  const [diffError, setDiffError] = useState<string | null>(null);

  // 视图书签：App 负责可用性与操作反馈，记录本身只含归一化中心/倍率/分界
  // 比例（固定字段 JSON，固定键存储）。可用性 = 本地存储中已存在记录，
  // 挂载时探测一次（旧用户无记录则恢复按钮保持禁用，流程与之前完全一致）。
  const [bookmarkAvailable, setBookmarkAvailable] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(BOOKMARK_STORAGE_KEY) !== null;
    } catch {
      return false;
    }
  });
  const [bookmarkNotice, setBookmarkNotice] = useState<{
    kind: 'ok' | 'error';
    text: string;
  } | null>(null);

  const pairSize = useMemo(() => pairOf(images), [images]);

  // 取样与测距为两种互斥的左键工具
  const toggleSampling = useCallback(() => {
    setSampling((v) => !v);
    setRanging(false);
  }, []);
  const toggleRanging = useCallback(() => {
    setRanging((v) => !v);
    setSampling(false);
  }, []);

  const toggleDiff = useCallback(() => {
    // 手动开关：清除上次生成失败提示，启用状态由 App 持有
    setDiffError(null);
    setDiffEnabled((v) => !v);
  }, []);

  const handleDiffThreshold = useCallback((value: number) => {
    setDiffThreshold(clampThreshold(value));
    // 生成失败后显影已自动关闭，调阈值不会触发重算：失败提示必须保留，
    // 直至重新开启并成功生成（见 toggleDiff / handleDiffError）
  }, []);

  // 蒙版无法读取像素或分配：自动关闭显影并提示，影像/视口/工具状态一律保留
  const handleDiffError = useCallback(() => {
    setDiffEnabled(false);
    setDiffError('差异显影生成失败');
  }, []);

  // 保存视图书签：仅归一化中心/倍率/分界比例入记录。
  // 存储不可写时保存失败并提示，当前画面与已有记录均不受影响。
  const handleSaveBookmark = useCallback(() => {
    const pair = pairOf(imagesRef.current);
    const canvas = canvasSizeRef.current;
    if (!pair || canvas.width <= 0) return;
    const record = bookmarkFromView(center, pair, canvas, zoomRef.current, divider);
    try {
      window.localStorage.setItem(BOOKMARK_STORAGE_KEY, serializeBookmark(record));
    } catch {
      setBookmarkNotice({ kind: 'error', text: '视图书签保存失败' });
      return;
    }
    setBookmarkAvailable(true);
    setBookmarkNotice({ kind: 'ok', text: '视图书签已保存' });
  }, [center, divider]);

  // 恢复视图：按当前影像天然尺寸与画布尺寸反算中心与分界，再经现有钳制
  // 规则得到合法视口。记录缺字段/数值非有限/倍率非法时提示损坏，
  // 影像、视口与各工具状态一律不变。
  const handleRestoreBookmark = useCallback(() => {
    const pair = pairOf(imagesRef.current);
    if (!pair) return;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(BOOKMARK_STORAGE_KEY);
    } catch {
      raw = null;
    }
    if (raw === null) {
      // 无记录时按钮本不可点；此处仅同步可用性，不产生反馈
      setBookmarkAvailable(false);
      return;
    }
    const record = parseBookmark(raw);
    if (!record) {
      setBookmarkNotice({ kind: 'error', text: '视图书签已损坏' });
      return;
    }
    const view = resolveBookmarkView(record, pair, canvasSizeRef.current);
    zoomRef.current = view.zoom;
    setZoom(view.zoom);
    setCenter(view.center);
    setDivider(view.divider);
    setBookmarkNotice({ kind: 'ok', text: '视图已恢复' });
  }, []);

  // 测距尺点击由 CompareCanvas 通过专用回调提交：
  // 已解析为原图坐标的有效点击推进生命周期；留白点击仅置提示、阶段不变
  const handleRuler = useCallback((next: RulerState) => {
    setRuler(next);
  }, []);

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
            </div>
          ))}
        </div>
        <div className="tool-group">
          <button
            type="button"
            data-testid="toggle-sampling"
            aria-pressed={sampling}
            disabled={!pairSize}
            onClick={toggleSampling}
          >
            像素取样
          </button>
          <button
            type="button"
            data-testid="toggle-ranging"
            aria-pressed={ranging}
            disabled={!pairSize}
            onClick={toggleRanging}
          >
            裂隙测距
          </button>
        </div>
        <div className="diff-group" role="group" aria-label="差异显影">
          <button
            type="button"
            data-testid="toggle-diff"
            aria-pressed={diffEnabled}
            disabled={!pairSize}
            onClick={toggleDiff}
          >
            差异显影
          </button>
          <label className="diff-slider">
            灵敏度
            <input
              type="range"
              min={DIFF_THRESHOLD_MIN}
              max={DIFF_THRESHOLD_MAX}
              step={1}
              value={diffThreshold}
              disabled={!pairSize}
              aria-label="差异显影灵敏度阈值（0–255）"
              data-testid="diff-threshold"
              onChange={(e) => handleDiffThreshold(Number(e.target.value))}
            />
            <strong data-testid="diff-threshold-label">{diffThreshold}</strong>
          </label>
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
        <div className="bookmark-group" role="group" aria-label="视图书签">
          <button
            type="button"
            data-testid="save-bookmark"
            disabled={!pairSize}
            onClick={handleSaveBookmark}
          >
            保存视图
          </button>
          <button
            type="button"
            data-testid="restore-bookmark"
            disabled={!pairSize || !bookmarkAvailable}
            onClick={handleRestoreBookmark}
          >
            恢复视图
          </button>
        </div>
      </header>

      <main className="stage">
        {/* 错误提示以覆盖层形式浮于画布顶部，不进入布局流，
            长文案也不会挤压工具栏 / 改变画布尺寸与原图坐标映射 */}
        {(errors.before || errors.after || diffError) && (
          <div className="alerts" role="alert" aria-live="assertive">
            {errors.before && (
              <span className="alert error" data-testid="error-before">
                {errors.before}
              </span>
            )}
            {errors.after && (
              <span className="alert error" data-testid="error-after">
                {errors.after}
              </span>
            )}
            {diffError && (
              <span className="alert diff-alert" data-testid="diff-error">
                {diffError}
              </span>
            )}
          </div>
        )}
        <CompareCanvas
          before={images.before}
          after={images.after}
          zoom={zoom}
          center={center}
          divider={divider}
          imageSize={pairSize}
          sampling={sampling}
          samplePoint={samplePoint}
          ranging={ranging}
          ruler={ruler}
          diffEnabled={diffEnabled}
          diffThreshold={diffThreshold}
          onCenterChange={setCenter}
          onDividerChange={setDivider}
          onCanvasSize={handleCanvasSize}
          onSample={handleSample}
          onRuler={handleRuler}
          onDiffError={handleDiffError}
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
        {ranging && (
          <span className="ruler-readout" data-testid="ruler-readout">
            测距
            {ruler.measurement && (
              <>
                {' '}
                水平 <strong data-testid="ruler-horizontal">{ruler.measurement.horizontal} px</strong>{' '}
                垂直 <strong data-testid="ruler-vertical">{ruler.measurement.vertical} px</strong>{' '}
                长度{' '}
                <strong data-testid="ruler-distance">
                  {formatDistance(ruler.measurement.distance)} px
                </strong>
                <span className="ruler-coords" data-testid="ruler-coords">
                  {` (${ruler.measurement.start.x}, ${ruler.measurement.start.y}) → (${ruler.measurement.end.x}, ${ruler.measurement.end.y})`}
                </span>
              </>
            )}
            {!ruler.measurement &&
              (ruler.phase === 'await-end' ? (
                <span className="ruler-phase">起点已记录，请点击终点</span>
              ) : (
                <span className="ruler-phase">请点击裂隙起点</span>
              ))}
          </span>
        )}
        {ranging && ruler.notice && (
          <span className="ruler-notice" role="status" data-testid="ruler-notice">
            {ruler.notice}
          </span>
        )}
        {bookmarkNotice && (
          <span
            className={
              bookmarkNotice.kind === 'error' ? 'bookmark-notice error' : 'bookmark-notice'
            }
            role="status"
            data-testid="bookmark-notice"
          >
            {bookmarkNotice.text}
          </span>
        )}
        <span className="hint">
          {sampling
            ? '取样模式：点击画布取该原图坐标像素 · 空格或中键仍可平移 · 左键不移动分界'
            : ranging
              ? '测距模式：第一次点击定起点，第二次定终点，第三次开始新一轮 · 空格或中键仍可平移 · 左键不移动分界'
              : '拖动移动分界 · 按住空格拖动或滚轮平移 · ←/→ 微调分界'}
        </span>
      </footer>
    </div>
  );
}
