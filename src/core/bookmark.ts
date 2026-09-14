/**
 * 视图书签核心逻辑（纯函数，不依赖 DOM / Canvas / localStorage）。
 *
 * 书签只记录视图几何，不记录任何影像内容或工具结果：
 * - 归一化视口中心：中心原图坐标 / 图像天然宽高，落入 [0,1]；
 * - 倍率：1 / 2 / 4；
 * - 分界比例：分界像素 / 画布 CSS 宽度，落入 [0,1]。
 *
 * 记录以固定字段 JSON（cx / cy / zoom / divider）经固定键存入浏览器本地
 * 存储；存储读写是 App 的职责，本模块只负责校验、归一化、反算与钳制：
 * - parseBookmark 校验固定字段：缺字段、数值非有限、倍率非法一律拒绝；
 * - bookmarkFromView 把当前视图归一化为记录；
 * - resolveBookmarkView 按当前影像天然尺寸与画布尺寸反算中心与分界，
 *   并复用 viewport 的钳制规则得到无留白的合法视口。
 */
import {
  ZOOM_LEVELS,
  clampCenter,
  clampDivider,
  type Point,
  type Size,
  type Zoom,
} from './viewport';

/** 浏览器本地存储的固定键 */
export const BOOKMARK_STORAGE_KEY = 'mural-wipe-verify:view-bookmark';

/** 视图书签记录（固定字段，全部为非负有限数值） */
export interface ViewBookmark {
  /** 归一化视口中心 x = 中心原图 x / 图像天然宽度 */
  cx: number;
  /** 归一化视口中心 y = 中心原图 y / 图像天然高度 */
  cy: number;
  /** 倍率 */
  zoom: Zoom;
  /** 分界占画布 CSS 宽度的比例 */
  divider: number;
}

/** 反算得到的合法视图状态（已按当前影像/画布钳制） */
export interface ResolvedView {
  center: Point;
  zoom: Zoom;
  divider: number;
}

/** 比例钳制到 [0,1]；非有限输入（如除零）回落为 0，保证记录始终可序列化 */
export function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

function isZoomLevel(value: number): value is Zoom {
  return (ZOOM_LEVELS as readonly number[]).includes(value);
}

/** 把当前视图归一化为书签记录（不含图像字节与取样/测距/显影结果） */
export function bookmarkFromView(
  center: Point,
  image: Size,
  canvas: Size,
  zoom: Zoom,
  divider: number,
): ViewBookmark {
  return {
    cx: clampRatio(center.x / image.width),
    cy: clampRatio(center.y / image.height),
    zoom,
    divider: clampRatio(divider / canvas.width),
  };
}

/** 序列化为固定字段 JSON（键序固定：cx / cy / zoom / divider） */
export function serializeBookmark(bookmark: ViewBookmark): string {
  return JSON.stringify({
    cx: bookmark.cx,
    cy: bookmark.cy,
    zoom: bookmark.zoom,
    divider: bookmark.divider,
  });
}

/**
 * 校验并解析固定字段 JSON：
 * - 非 JSON、非对象、缺字段、字段非有限数值、倍率非 1/2/4 一律返回 null；
 * - 比例字段越出 [0,1] 不视为损坏，交由 resolveBookmarkView 的钳制规则处理；
 * - 固定字段之外的多余字段被忽略（向后兼容）。
 */
export function parseBookmark(json: string): ViewBookmark | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const { cx, cy, zoom, divider } = rec;
  if (typeof cx !== 'number' || !Number.isFinite(cx)) return null;
  if (typeof cy !== 'number' || !Number.isFinite(cy)) return null;
  if (typeof divider !== 'number' || !Number.isFinite(divider)) return null;
  if (typeof zoom !== 'number' || !isZoomLevel(zoom)) return null;
  return { cx, cy, zoom, divider };
}

/**
 * 按当前影像天然尺寸与画布尺寸反算视图：
 * 中心 = 归一化坐标 × 图像宽高，分界 = 比例 × 画布宽度，
 * 再复用 viewport 的钳制规则，得到无留白的合法视口。
 */
export function resolveBookmarkView(
  bookmark: ViewBookmark,
  image: Size,
  canvas: Size,
): ResolvedView {
  const zoom = bookmark.zoom;
  return {
    zoom,
    center: clampCenter(
      { x: bookmark.cx * image.width, y: bookmark.cy * image.height },
      image,
      canvas,
      zoom,
    ),
    divider: clampDivider(bookmark.divider * canvas.width, canvas.width),
  };
}
