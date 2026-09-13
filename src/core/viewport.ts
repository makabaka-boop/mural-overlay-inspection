/**
 * 视口坐标核心逻辑（纯函数，不依赖 DOM / Canvas）。
 *
 * 坐标约定：
 * - 原图坐标：以图像天然像素为单位，左上角 (0,0)，范围 [0, W]×[0, H]。
 * - 视口：画布 CSS 像素宽高除以倍率，得到视口覆盖的原图像素数。
 * - 视口状态以其中心的原图坐标 (cx, cy) 表示，倍率切换时该坐标保持不变。
 */

export const ZOOM_LEVELS = [1, 2, 4] as const;
export type Zoom = (typeof ZOOM_LEVELS)[number];

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** 视口在某一轴上覆盖的原图像素数 */
export function viewportSpan(viewportCss: number, zoom: Zoom): number {
  return viewportCss / zoom;
}

/**
 * 单轴中心钳制：
 * - 图像大于视口：中心被限制在 [view/2, image - view/2]，保证不出现画布空白；
 * - 图像小于等于视口：中心固定为图像中点（图像在画布上居中）。
 */
export function clampAxisCenter(
  center: number,
  imageSize: number,
  viewportCss: number,
  zoom: Zoom,
): number {
  const view = viewportSpan(viewportCss, zoom);
  if (!(imageSize > view)) return imageSize / 2;
  const half = view / 2;
  return Math.min(Math.max(center, half), imageSize - half);
}

/** 按各轴分别钳制视口中心（原图坐标） */
export function clampCenter(center: Point, image: Size, canvas: Size, zoom: Zoom): Point {
  return {
    x: clampAxisCenter(center.x, image.width, canvas.width, zoom),
    y: clampAxisCenter(center.y, image.height, canvas.height, zoom),
  };
}

/**
 * 平移：把 CSS 像素位移换算成原图坐标位移后重新钳制。
 * dxCss/dyCss 为视口中心期望的移动量（抓取拖图时取指针位移的相反数）。
 */
export function panCenter(
  center: Point,
  dxCss: number,
  dyCss: number,
  image: Size,
  canvas: Size,
  zoom: Zoom,
): Point {
  return clampCenter(
    { x: center.x + dxCss / zoom, y: center.y + dyCss / zoom },
    image,
    canvas,
    zoom,
  );
}

/**
 * 切换倍率：视口中心对应的原图坐标保持不变，
 * 仅当旧中心在新视口尺寸下会露出空白时才被钳回。
 */
export function centerForZoom(center: Point, image: Size, canvas: Size, zoom: Zoom): Point {
  return clampCenter(center, image, canvas, zoom);
}

/** 分界像素钳制：四舍五入为整数并限制到 [0, 画布 CSS 宽度] */
export function clampDivider(divider: number, canvasCssWidth: number): number {
  const max = Math.max(0, Math.round(canvasCssWidth));
  return Math.min(Math.max(Math.round(divider), 0), max);
}

/** 由指针 clientX 求分界像素：相对画布左边缘取整后钳制 */
export function dividerFromClientX(
  clientX: number,
  canvasLeft: number,
  canvasCssWidth: number,
): number {
  return clampDivider(clientX - canvasLeft, canvasCssWidth);
}

/** 方向键步进：每次 1 像素 */
export function stepDivider(divider: number, delta: -1 | 1, canvasCssWidth: number): number {
  return clampDivider(divider + delta, canvasCssWidth);
}

export interface Blit {
  /** 源矩形（原图坐标，已限制在图像范围内） */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** 目标矩形（画布 CSS 像素） */
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * 由视口中心计算 drawImage 参数。
 * 源矩形越界部分被裁掉并同步收缩目标矩形：
 * - 图像大于视口的轴：源矩形恰好覆盖视口，目标铺满画布（无空白）；
 * - 图像小于视口的轴：源矩形为整图，目标在画布上居中。
 */
export function computeBlit(center: Point, image: Size, canvas: Size, zoom: Zoom): Blit {
  const vw = viewportSpan(canvas.width, zoom);
  const vh = viewportSpan(canvas.height, zoom);
  const left = center.x - vw / 2;
  const top = center.y - vh / 2;
  const sx = Math.min(Math.max(0, left), image.width);
  const sy = Math.min(Math.max(0, top), image.height);
  const ex = Math.min(Math.max(0, left + vw), image.width);
  const ey = Math.min(Math.max(0, top + vh), image.height);
  const sw = ex - sx;
  const sh = ey - sy;
  return {
    sx,
    sy,
    sw,
    sh,
    dx: (sx - left) * zoom,
    dy: (sy - top) * zoom,
    dw: sw * zoom,
    dh: sh * zoom,
  };
}
