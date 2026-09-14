import { describe, expect, it } from 'vitest';
import {
  blankSampleResult,
  channelDiff,
  clampPointToImage,
  cssToImage,
  isPointInBlit,
  isPointInImage,
  okSampleResult,
  outOfBoundsResult,
  resolveSamplePoint,
  samplePointFromCss,
  samplePointToCss,
} from '../src/core/sample';
import { computeBlit } from '../src/core/viewport';

const CANVAS = { width: 800, height: 400 };

describe('samplePointFromCss：屏幕到原图坐标的取整', () => {
  it('1× 视口居中：画布中心即原图中心', () => {
    const p = samplePointFromCss({ x: 400, y: 200 }, { x: 1000, y: 500 }, CANVAS, 1);
    expect(p).toEqual({ x: 1000, y: 500 });
  });

  it('换算结果四舍五入为整数（含 .5 与负数边界）', () => {
    // 2× 下 css.x=523.4 → 原图 1061.7；523.6 → 1061.8，均取整 1062
    expect(samplePointFromCss({ x: 523.4, y: 200 }, { x: 1000, y: 500 }, CANVAS, 2)).toEqual({
      x: 1062,
      y: 500,
    });
    expect(samplePointFromCss({ x: 523.6, y: 200 }, { x: 1000, y: 500 }, CANVAS, 2)).toEqual({
      x: 1062,
      y: 500,
    });
    // 4× 下 css (100,100) → 原图 (925,475)
    expect(samplePointFromCss({ x: 100, y: 100 }, { x: 1000, y: 500 }, CANVAS, 4)).toEqual({
      x: 925,
      y: 475,
    });
    // 负数四舍五入：Math.round(-0.5) === -0（向 +∞ 进位，符号保留）
    expect(Object.is(Math.round(-0.5), -0)).toBe(true);
    expect(Math.round(-0.6)).toBe(-1);
    // 原点附近：画布左上角对齐图像左上角时取到 (0,0)
    expect(samplePointFromCss({ x: 0, y: 0 }, { x: 400, y: 200 }, CANVAS, 1)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('两轴独立按倍率换算', () => {
    const p = samplePointFromCss({ x: 0, y: 0 }, { x: 1000, y: 500 }, CANVAS, 2);
    expect(p).toEqual({ x: 800, y: 400 });
  });
});

describe('cssToImage / samplePointToCss：坐标互逆与缩放稳定', () => {
  it('原图整数坐标 → CSS → 原图，取整后回到同一点', () => {
    const center = { x: 1000, y: 500 };
    const point = { x: 733, y: 417 };
    for (const z of [1, 2, 4] as const) {
      const css = samplePointToCss(point, center, CANVAS, z);
      const back = samplePointFromCss(css, center, CANVAS, z);
      expect(back).toEqual(point);
    }
  });

  it('缩放/平移只改 CSS 屏幕位置，不改原图坐标', () => {
    const point = { x: 1000, y: 500 };
    expect(samplePointToCss(point, { x: 1000, y: 500 }, CANVAS, 1)).toEqual({ x: 400, y: 200 });
    // 4× 且视口中心移到 (900,600)：同一点屏幕位置随之移动，原图坐标不变
    expect(samplePointToCss(point, { x: 900, y: 600 }, CANVAS, 4)).toEqual({
      x: 800,
      y: -200,
    });
  });

  it('cssToImage 为 samplePointToCss 的浮点逆映射', () => {
    const center = { x: 800, y: 600 };
    const f = cssToImage({ x: 123.4, y: 56.7 }, center, CANVAS, 2);
    expect(f.x).toBeCloseTo(661.7);
    expect(f.y).toBeCloseTo(528.35);
  });
});

describe('留白判定：小图居中产生的画布留白', () => {
  const small = { width: 200, height: 100 };
  const center = { x: 100, y: 50 }; // 钳制后固定居中

  it('图像矩形内为有效点，矩形外留白（含半宽外沿）', () => {
    const blit = computeBlit(center, small, CANVAS, 1);
    expect(blit.dx).toBe(300);
    expect(blit.dy).toBe(150);
    expect(isPointInBlit({ x: 300, y: 150 }, blit)).toBe(true);
    expect(isPointInBlit({ x: 499.9, y: 249.9 }, blit)).toBe(true);
    // 左/上留白
    expect(isPointInBlit({ x: 299.9, y: 200 }, blit)).toBe(false);
    expect(isPointInBlit({ x: 400, y: 149.9 }, blit)).toBe(false);
    // 右/下留白
    expect(isPointInBlit({ x: 500, y: 200 }, blit)).toBe(false);
    expect(isPointInBlit({ x: 400, y: 250 }, blit)).toBe(false);
  });

  it('resolveSamplePoint：点留白返回 blank 且无坐标', () => {
    const r = resolveSamplePoint({ x: 10, y: 10 }, center, small, CANVAS, 1);
    expect(r.status).toBe('blank');
    expect(r.point).toBeNull();
    expect(blankSampleResult().notice).toBe('此处无图像像素');
  });

  it('resolveSamplePoint：点在图像矩形内返回 ok 与整数坐标', () => {
    const r = resolveSamplePoint({ x: 300, y: 150 }, center, small, CANVAS, 1);
    expect(r.status).toBe('ok');
    expect(r.point).toEqual({ x: 0, y: 0 });
    const r2 = resolveSamplePoint({ x: 499, y: 249 }, center, small, CANVAS, 1);
    expect(r2.status).toBe('ok');
    expect(r2.point).toEqual({ x: 199, y: 99 });
  });

  it('高倍率下小图被放大铺满，原留白区域变为有效点', () => {
    // 200×100 图在 4× 下显示 800×400，恰好铺满画布
    const edge = resolveSamplePoint({ x: 0, y: 0 }, center, small, CANVAS, 4);
    expect(edge.status).toBe('ok');
    expect(edge.point).toEqual({ x: 0, y: 0 });
    const inner = resolveSamplePoint({ x: 10, y: 10 }, center, small, CANVAS, 4);
    expect(inner.status).toBe('ok');
    expect(inner.point).toEqual({ x: 3, y: 3 });
  });

  it('单轴小图：居中段有效、垂直带留白', () => {
    const img = { width: 2000, height: 100 };
    const c = { x: 1000, y: 50 };
    expect(resolveSamplePoint({ x: 400, y: 10 }, c, img, CANVAS, 1).status).toBe('blank');
    expect(resolveSamplePoint({ x: 400, y: 150 }, c, img, CANVAS, 1).status).toBe('ok');
  });
});

describe('越界判定', () => {
  it('isPointInImage 按半开区间 [0,W)×[0,H)', () => {
    const img = { width: 10, height: 8 };
    expect(isPointInImage({ x: 0, y: 0 }, img)).toBe(true);
    expect(isPointInImage({ x: 9, y: 7 }, img)).toBe(true);
    expect(isPointInImage({ x: 10, y: 4 }, img)).toBe(false);
    expect(isPointInImage({ x: 4, y: 8 }, img)).toBe(false);
    expect(isPointInImage({ x: -1, y: 0 }, img)).toBe(false);
  });

  it('resolveSamplePoint：右/下边缘内侧取整越界时钳回末列/末行', () => {
    // 构造恰好落在 blit 内、四舍五入后等于图像边界的点击
    const img = { width: 200, height: 100 };
    const center = { x: 100, y: 50 };
    // 图像右边缘 CSS x = 500；点击 499.8 → 原图 199.8 → 取整 200 → 钳回末列 199
    const r = resolveSamplePoint({ x: 499.8, y: 200 }, center, img, CANVAS, 1);
    expect(r.status).toBe('ok');
    expect(r.point).toEqual({ x: 199, y: 50 });
    // 下边缘同理：CSS y = 250；点击 249.8 → 原图 99.8 → 取整 100 → 钳回末行 99
    const r2 = resolveSamplePoint({ x: 400, y: 249.8 }, center, img, CANVAS, 1);
    expect(r2.status).toBe('ok');
    expect(r2.point).toEqual({ x: 100, y: 99 });
  });

  it('clampPointToImage：各轴独立钳到 [0, W-1]×[0, H-1]', () => {
    const img = { width: 10, height: 8 };
    expect(clampPointToImage({ x: 10, y: 8 }, img)).toEqual({ x: 9, y: 7 });
    expect(clampPointToImage({ x: -1, y: 4 }, img)).toEqual({ x: 0, y: 4 });
    expect(clampPointToImage({ x: 3, y: 5 }, img)).toEqual({ x: 3, y: 5 });
  });

  it('outOfBoundsResult 携带坐标与原因并清空像素', () => {
    const r = outOfBoundsResult({ x: 200, y: 50 });
    expect(r.status).toBe('out');
    expect(r.point).toEqual({ x: 200, y: 50 });
    expect(r.before).toBeNull();
    expect(r.after).toBeNull();
    expect(r.notice).toContain('(200, 50)');
  });
});

describe('channelDiff：各通道绝对差', () => {
  it('逐通道绝对差，与顺序无关', () => {
    const a = [10, 200, 30, 255] as const;
    const b = [40, 180, 250, 0] as const;
    expect(channelDiff([...a], [...b])).toEqual({ dr: 30, dg: 20, db: 220, da: 255 });
    expect(channelDiff([...b], [...a])).toEqual({ dr: 30, dg: 20, db: 220, da: 255 });
  });

  it('相同像素差值全 0', () => {
    const p = [123, 45, 67, 255] as const;
    expect(channelDiff([...p], [...p])).toEqual({ dr: 0, dg: 0, db: 0, da: 0 });
  });

  it('okSampleResult 组装两组 RGBA、差值与坐标', () => {
    const r = okSampleResult({ x: 7, y: 9 }, [1, 2, 3, 255], [4, 2, 0, 255]);
    expect(r.status).toBe('ok');
    expect(r.point).toEqual({ x: 7, y: 9 });
    expect(r.before).toEqual([1, 2, 3, 255]);
    expect(r.after).toEqual([4, 2, 0, 255]);
    expect(r.diff).toEqual({ dr: 3, dg: 0, db: 3, da: 0 });
    expect(r.notice).toBeNull();
  });
});
