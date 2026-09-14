/**
 * 差异显影核心逻辑（纯函数，不依赖 DOM / Canvas）。
 *
 * 命中判定：修复前后同坐标像素的 RGB 三通道绝对差之最大值超过阈值即命中
 * （仅 RGB，不参与 alpha 通道）。阈值取值 0–255，判定为严格大于。
 *
 * 蒙版为与原图同尺寸的 RGBA 字节序列：命中像素为不透明半透明洋红
 * （alpha 固定 128，直接作为 ImageData 上屏，与底图做源覆盖混合），
 * 未命中像素 alpha 为 0。蒙版按原图坐标缓存，视口变换后只需以与
 * 底图相同的 blit 参数重绘，缩放/平移不改变命中集合。
 */

export const DIFF_THRESHOLD_MIN = 0;
export const DIFF_THRESHOLD_MAX = 255;
/** 工具栏滑杆默认灵敏度 */
export const DIFF_THRESHOLD_DEFAULT = 32;

/** 命中蒙版颜色：半透明洋红（作为 ImageData 字节直接上屏） */
export const DIFF_MASK_R = 255;
export const DIFF_MASK_G = 0;
export const DIFF_MASK_B = 255;
export const DIFF_MASK_A = 128;

/** 把任意输入钳制为 0–255 的整数阈值（NaN / 非有限值回落到默认值 32） */
export function clampThreshold(value: number): number {
  if (!Number.isFinite(value)) return DIFF_THRESHOLD_DEFAULT;
  return Math.min(Math.max(Math.round(value), DIFF_THRESHOLD_MIN), DIFF_THRESHOLD_MAX);
}

/**
 * 单像素命中判定：同坐标两像素的 R/G/B 通道最大绝对差 > 阈值即命中。
 * 严格大于：最大差恰等于阈值时不命中；alpha 通道不参与。
 */
export function isDiffPixel(
  before: ArrayLike<number>,
  after: ArrayLike<number>,
  threshold: number,
): boolean {
  const dr = Math.abs(before[0] - after[0]);
  const dg = Math.abs(before[1] - after[1]);
  const db = Math.abs(before[2] - after[2]);
  return dr > threshold || dg > threshold || db > threshold;
}

/**
 * 由修复前后两段等长 RGBA 字节序列构建差异蒙版：命中像素写入半透明洋红，
 * 未命中像素全 0（透明）。输出长度恒为 width*height*4，结果确定
 * （同输入同阈值逐字节一致）。
 */
export function buildDiffMask(
  before: ArrayLike<number>,
  after: ArrayLike<number>,
  width: number,
  height: number,
  threshold: number,
): Uint8ClampedArray {
  const count = width * height;
  const mask = new Uint8ClampedArray(count * 4);
  for (let i = 0; i < count; i++) {
    const o = i * 4;
    const dr = Math.abs(before[o] - after[o]);
    const dg = Math.abs(before[o + 1] - after[o + 1]);
    const db = Math.abs(before[o + 2] - after[o + 2]);
    if (dr > threshold || dg > threshold || db > threshold) {
      mask[o] = DIFF_MASK_R;
      mask[o + 1] = DIFF_MASK_G;
      mask[o + 2] = DIFF_MASK_B;
      mask[o + 3] = DIFF_MASK_A;
    }
  }
  return mask;
}
