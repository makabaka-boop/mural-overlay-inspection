/**
 * 像素取样核心逻辑（纯函数，不依赖 DOM / Canvas）。
 *
 * 取样点以「原图整数坐标」保存，与视口/倍率无关：
 * - 画布 CSS 坐标 → 原图坐标：按当前倍率与视口中心反算后四舍五入取整；
 * - 小图居中产生的画布留白视为「无图像像素」，不产生取样点；
 * - 落在图像外的整数坐标视为越界（尺寸替换等情形下的防御判定）。
 */
import { computeBlit, type Blit } from './viewport';
import type { Point, Size, Zoom } from './viewport';

/** 原图整数坐标的取样点 */
export interface SamplePoint {
  x: number;
  y: number;
}

export type PixelRGBA = [number, number, number, number];

export interface ChannelDiff {
  dr: number;
  dg: number;
  db: number;
  da: number;
}

export type SampleStatus = 'ok' | 'blank' | 'out';

/** resolveSamplePoint 的结果：状态 + 原图坐标（blank 时为 null） */
export interface SampleResolution {
  status: SampleStatus;
  point: SamplePoint | null;
}

export interface SampleResult {
  status: SampleStatus;
  point: SamplePoint | null;
  before: PixelRGBA | null;
  after: PixelRGBA | null;
  diff: ChannelDiff | null;
  /** 非 ok 时的说明文案 */
  notice: string | null;
}

/**
 * 画布 CSS 坐标 → 视口中心对应的原图坐标（浮点）。
 * 为 computeBlit 的逆映射：css = (image - center + view/2) * zoom。
 */
export function cssToImage(
  css: Point,
  center: Point,
  canvas: Size,
  zoom: Zoom,
): Point {
  return {
    x: css.x / zoom + center.x - canvas.width / zoom / 2,
    y: css.y / zoom + center.y - canvas.height / zoom / 2,
  };
}

/** 画布 CSS 坐标 → 原图整数坐标（四舍五入） */
export function samplePointFromCss(
  css: Point,
  center: Point,
  canvas: Size,
  zoom: Zoom,
): SamplePoint {
  const p = cssToImage(css, center, canvas, zoom);
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/**
 * 原图整数坐标 → 当前视口下的画布 CSS 坐标（浮点）。
 * 缩放/平移只移动该屏幕位置，取样点原图坐标不变。
 */
export function samplePointToCss(
  point: SamplePoint,
  center: Point,
  canvas: Size,
  zoom: Zoom,
): Point {
  return {
    x: (point.x - center.x + canvas.width / zoom / 2) * zoom,
    y: (point.y - center.y + canvas.height / zoom / 2) * zoom,
  };
}

/** 浮点 CSS 点是否落在某 blit 的图像矩形内（即不是小图居中留白） */
export function isPointInBlit(css: Point, blit: Blit): boolean {
  return (
    css.x >= blit.dx &&
    css.x < blit.dx + blit.dw &&
    css.y >= blit.dy &&
    css.y < blit.dy + blit.dh
  );
}

/** 整数原图坐标是否落在图像范围内 */
export function isPointInImage(point: SamplePoint, image: Size): boolean {
  return (
    point.x >= 0 &&
    point.y >= 0 &&
    point.x < image.width &&
    point.y < image.height
  );
}

/**
 * 解析一次画布点击：
 * - 落在小图居中留白：status 'blank'，point null；
 * - 换算得到的整数坐标越过图像边界：status 'out'；
 * - 否则 status 'ok' 并返回原图整数坐标。
 */
export function resolveSamplePoint(
  css: Point,
  center: Point,
  image: Size,
  canvas: Size,
  zoom: Zoom,
): SampleResolution {
  if (!isPointInBlit(css, computeBlit(center, image, canvas, zoom))) {
    return { status: 'blank', point: null };
  }
  const point = samplePointFromCss(css, center, canvas, zoom);
  if (!isPointInImage(point, image)) {
    return { status: 'out', point };
  }
  return { status: 'ok', point };
}

/** 两像素各通道绝对差 */
export function channelDiff(a: PixelRGBA, b: PixelRGBA): ChannelDiff {
  return {
    dr: Math.abs(a[0] - b[0]),
    dg: Math.abs(a[1] - b[1]),
    db: Math.abs(a[2] - b[2]),
    da: Math.abs(a[3] - b[3]),
  };
}

/** 组装一次取样结果（不含 IO，像素由调用方在 Canvas 上读取后传入） */
export function okSampleResult(
  point: SamplePoint,
  before: PixelRGBA,
  after: PixelRGBA,
): SampleResult {
  return { status: 'ok', point, before, after, diff: channelDiff(before, after), notice: null };
}

export function blankSampleResult(): SampleResult {
  return {
    status: 'blank',
    point: null,
    before: null,
    after: null,
    diff: null,
    notice: '此处无图像像素',
  };
}

export function outOfBoundsResult(point: SamplePoint): SampleResult {
  return {
    status: 'out',
    point,
    before: null,
    after: null,
    diff: null,
    notice: `取样点 (${point.x}, ${point.y}) 超出当前图像范围，已清除上次取样结果`,
  };
}
