import { describe, expect, it } from 'vitest';
import {
  DIFF_MASK_A,
  DIFF_MASK_B,
  DIFF_MASK_G,
  DIFF_MASK_R,
  DIFF_THRESHOLD_DEFAULT,
  DIFF_THRESHOLD_MAX,
  DIFF_THRESHOLD_MIN,
  buildDiffMask,
  clampThreshold,
  isDiffPixel,
} from '../src/core/diff';

describe('clampThreshold：0–255 阈值边界', () => {
  it('合法值四舍五入为整数', () => {
    expect(clampThreshold(0)).toBe(0);
    expect(clampThreshold(255)).toBe(255);
    expect(clampThreshold(32.4)).toBe(32);
    expect(clampThreshold(63.5)).toBe(64);
  });

  it('越界钳到 [0, 255]', () => {
    expect(clampThreshold(-1)).toBe(DIFF_THRESHOLD_MIN);
    expect(clampThreshold(-100)).toBe(0);
    expect(clampThreshold(256)).toBe(DIFF_THRESHOLD_MAX);
    expect(clampThreshold(9999)).toBe(255);
  });

  it('NaN / Infinity 回落到默认阈值 32', () => {
    expect(clampThreshold(NaN)).toBe(DIFF_THRESHOLD_DEFAULT);
    expect(clampThreshold(Number.NaN)).toBe(32);
    expect(clampThreshold(Number.POSITIVE_INFINITY)).toBe(32);
    expect(clampThreshold(Number.NEGATIVE_INFINITY)).toBe(32);
  });
});

describe('isDiffPixel：同坐标 RGB 最大绝对差判定', () => {
  it('任一 RGB 通道绝对差严格大于阈值即命中', () => {
    expect(isDiffPixel([10, 10, 10, 255], [41, 10, 10, 255], 30)).toBe(true);
    expect(isDiffPixel([10, 10, 10, 255], [10, 41, 10, 255], 30)).toBe(true);
    expect(isDiffPixel([10, 10, 10, 255], [10, 10, 41, 255], 30)).toBe(true);
  });

  it('最大差恰等于阈值不命中（严格大于，边界两侧）', () => {
    expect(isDiffPixel([10, 10, 10, 255], [40, 10, 10, 255], 30)).toBe(false);
    expect(isDiffPixel([40, 40, 40, 255], [10, 10, 10, 255], 30)).toBe(false);
  });

  it('阈值 0：完全相同不命中，任何 RGB 差异都命中', () => {
    expect(isDiffPixel([5, 6, 7, 255], [5, 6, 7, 255], 0)).toBe(false);
    expect(isDiffPixel([5, 6, 7, 255], [6, 6, 7, 255], 0)).toBe(true);
  });

  it('阈值 255：RGB 通道差最大为 255，永不命中（严格大于）', () => {
    expect(isDiffPixel([0, 0, 0, 255], [255, 255, 255, 255], 255)).toBe(false);
  });

  it('alpha 通道不参与判定', () => {
    // 仅 alpha 从 255 变为 0：任意阈值下都不命中
    expect(isDiffPixel([100, 100, 100, 255], [100, 100, 100, 0], 0)).toBe(false);
    // alpha 差异再大也不会单独触发
    expect(isDiffPixel([100, 100, 100, 255], [100, 100, 100, 128], 0)).toBe(false);
  });

  it('判定与前后顺序无关（绝对差对称）', () => {
    const a = [200, 10, 30, 255] as const;
    const b = [10, 180, 90, 255] as const;
    expect(isDiffPixel([...a], [...b], 50)).toBe(isDiffPixel([...b], [...a], 50));
  });
});

describe('buildDiffMask：蒙版字节输出', () => {
  /** 把若干 [r,g,b,a] 像素拼成 RGBA 字节数组 */
  function rgba(...pixels: Array<[number, number, number, number]>): Uint8ClampedArray {
    const out = new Uint8ClampedArray(pixels.length * 4);
    pixels.forEach((p, i) => out.set(p, i * 4));
    return out;
  }

  it('命中像素写入半透明洋红，未命中像素全 0（透明）', () => {
    const before = rgba(
      [0, 0, 0, 255],
      [0, 0, 0, 255],
      [0, 0, 0, 255],
      [0, 0, 0, 255],
    );
    const after = rgba(
      [0, 0, 0, 255], // 同：不命中
      [100, 0, 0, 255], // R 差 100
      [0, 100, 0, 255], // G 差 100
      [0, 0, 100, 255], // B 差 100
    );
    const mask = buildDiffMask(before, after, 4, 1, 50);
    expect(mask).toHaveLength(16);
    expect(Array.from(mask.subarray(0, 4))).toEqual([0, 0, 0, 0]);
    for (const i of [1, 2, 3]) {
      expect(Array.from(mask.subarray(i * 4, i * 4 + 4))).toEqual([
        DIFF_MASK_R,
        DIFF_MASK_G,
        DIFF_MASK_B,
        DIFF_MASK_A,
      ]);
    }
    expect(DIFF_MASK_R).toBe(255);
    expect(DIFF_MASK_G).toBe(0);
    expect(DIFF_MASK_B).toBe(255);
    expect(DIFF_MASK_A).toBe(128);
  });

  it('二维尺寸下仅命中对应 (x,y) 字节，蒙版大小 = W*H*4', () => {
    const w = 3;
    const h = 2;
    const before = new Uint8ClampedArray(w * h * 4);
    const after = new Uint8ClampedArray(w * h * 4);
    // 仅 (2,1) 处 R 差 200
    const o = (1 * w + 2) * 4;
    after[o] = 200;
    const mask = buildDiffMask(before, after, w, h, 100);
    expect(mask).toHaveLength(w * h * 4);
    expect(Array.from(mask.subarray(o, o + 4))).toEqual([
      DIFF_MASK_R,
      DIFF_MASK_G,
      DIFF_MASK_B,
      DIFF_MASK_A,
    ]);
    // 其余像素透明
    for (let i = 0; i < w * h; i++) {
      if (i === 1 * w + 2) continue;
      expect(mask[i * 4 + 3]).toBe(0);
    }
  });

  it('阈值在差值边界：t=99 命中差 100，t=100 不命中', () => {
    const before = rgba([0, 0, 0, 255]);
    const after = rgba([100, 0, 0, 255]);
    expect(buildDiffMask(before, after, 1, 1, 99)[3]).toBe(DIFF_MASK_A);
    expect(buildDiffMask(before, after, 1, 1, 100)[3]).toBe(0);
  });

  it('阈值 255：全透明蒙版；阈值 0：任意差异全部命中', () => {
    const before = rgba([0, 0, 0, 255], [10, 10, 10, 255]);
    const after = rgba([255, 255, 255, 255], [10, 10, 10, 255]);
    const mask255 = buildDiffMask(before, after, 2, 1, 255);
    expect(Array.from(mask255)).toEqual(new Array(8).fill(0));
    const mask0 = buildDiffMask(before, after, 2, 1, 0);
    expect(mask0[3]).toBe(DIFF_MASK_A);
    expect(mask0[7]).toBe(0);
  });

  it('输出确定性：同输入同阈值两次构建逐字节一致', () => {
    const before = rgba(
      [12, 200, 30, 255],
      [40, 180, 250, 0],
      [99, 99, 99, 255],
      [0, 0, 0, 255],
    );
    const after = rgba(
      [200, 10, 90, 255],
      [40, 181, 250, 200],
      [99, 99, 99, 255],
      [1, 2, 3, 255],
    );
    const m1 = buildDiffMask(before, after, 4, 1, 40);
    const m2 = buildDiffMask(before, after, 4, 1, 40);
    expect(Array.from(m1)).toEqual(Array.from(m2));
  });

  it('阈值单调：阈值升高命中集合只减不增（蒙版确定性增减）', () => {
    const before = rgba([0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255]);
    const after = rgba([10, 0, 0, 255], [60, 0, 0, 255], [200, 0, 0, 255]);
    const hitCount = (t: number) => {
      const m = buildDiffMask(before, after, 3, 1, t);
      let n = 0;
      for (let i = 0; i < 3; i++) if (m[i * 4 + 3] !== 0) n++;
      return n;
    };
    // 差 10 / 60 / 200：t=0 全中 3，t=30 中 2，t=100 中 1，t=255 中 0
    expect(hitCount(0)).toBe(3);
    expect(hitCount(30)).toBe(2);
    expect(hitCount(100)).toBe(1);
    expect(hitCount(255)).toBe(0);
  });

  it('仅 alpha 差异的像素不产生蒙版字节', () => {
    const before = rgba([123, 45, 67, 255]);
    const after = rgba([123, 45, 67, 0]);
    expect(Array.from(buildDiffMask(before, after, 1, 1, 0))).toEqual([0, 0, 0, 0]);
  });
});
