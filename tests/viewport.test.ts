import { describe, expect, it } from 'vitest';
import {
  clampAxisCenter,
  clampCenter,
  clampDivider,
  computeBlit,
  dividerFromClientX,
  panCenter,
  centerForZoom,
  stepDivider,
  viewportSpan,
} from '../src/core/viewport';
import { sniffFormat } from '../src/core/loadImage';

const IMG = { width: 2000, height: 1000 };
const CANVAS = { width: 800, height: 400 };

describe('clampAxisCenter：图像大于视口', () => {
  it('中心越左界时钳到 view/2，不出现空白', () => {
    expect(clampAxisCenter(-50, 2000, 800, 1)).toBe(400);
  });
  it('中心越右界时钳到 image - view/2', () => {
    expect(clampAxisCenter(99999, 2000, 800, 1)).toBe(1600);
  });
  it('界内中心保持不变', () => {
    expect(clampAxisCenter(1000, 2000, 800, 1)).toBe(1000);
  });
  it('倍率放大后视口变窄，边界随之收紧', () => {
    expect(clampAxisCenter(0, 2000, 800, 4)).toBe(100);
    expect(clampAxisCenter(2000, 2000, 800, 4)).toBe(1900);
  });
});

describe('clampAxisCenter：图像小于等于视口的轴固定居中', () => {
  it('图像小于视口：任何输入都回到图像中点', () => {
    expect(clampAxisCenter(0, 300, 800, 1)).toBe(150);
    expect(clampAxisCenter(9999, 300, 800, 1)).toBe(150);
  });
  it('图像恰好等于视口：同样固定居中', () => {
    expect(clampAxisCenter(123, 800, 800, 1)).toBe(400);
  });
  it('高倍率使视口小于图像后恢复可平移', () => {
    // 300px 图像在 4× 下视口仅覆盖 200px 原图
    expect(clampAxisCenter(0, 300, 800, 4)).toBe(100);
    expect(clampAxisCenter(300, 300, 800, 4)).toBe(200);
  });
});

describe('clampCenter / panCenter', () => {
  it('两轴独立钳制', () => {
    const c = clampCenter({ x: -10, y: 5000 }, IMG, CANVAS, 1);
    expect(c).toEqual({ x: 400, y: 800 });
  });
  it('平移按倍率换算：2× 下 100 CSS 像素 = 50 原图像素', () => {
    const c = panCenter({ x: 1000, y: 500 }, 100, -40, IMG, CANVAS, 2);
    expect(c).toEqual({ x: 1050, y: 480 });
  });
  it('平移越界被钳制，画布不留空白', () => {
    const c = panCenter({ x: 1000, y: 500 }, -100000, 100000, IMG, CANVAS, 1);
    expect(c).toEqual({ x: 400, y: 800 });
  });
  it('图像小于视口的轴平移无效，保持居中', () => {
    const small = { width: 100, height: 50 };
    const c = panCenter({ x: 50, y: 25 }, 500, 500, small, CANVAS, 1);
    expect(c).toEqual({ x: 50, y: 25 });
  });
});

describe('centerForZoom：切换倍率保持视口中心原图坐标', () => {
  it('界内中心在 1→2→4 切换后不变', () => {
    const c0 = { x: 1000, y: 500 };
    expect(centerForZoom(c0, IMG, CANVAS, 2)).toEqual(c0);
    expect(centerForZoom(c0, IMG, CANVAS, 4)).toEqual(c0);
    expect(centerForZoom(c0, IMG, CANVAS, 1)).toEqual(c0);
  });
  it('缩小倍率导致视口变大时，边缘中心被钳回不露白', () => {
    // 4× 下合法中心 x=100，回到 1× 时视口半宽 400，必须钳到 400
    const c = centerForZoom({ x: 100, y: 500 }, IMG, CANVAS, 1);
    expect(c.x).toBe(400);
    expect(c.y).toBe(500);
  });
});

describe('divider：分界像素归一化', () => {
  it('相对画布左边缘四舍五入为整数', () => {
    expect(dividerFromClientX(120.4, 100, 800)).toBe(20);
    expect(dividerFromClientX(120.5, 100, 800)).toBe(21);
    expect(dividerFromClientX(120.6, 100, 800)).toBe(21);
  });
  it('钳制到 [0, 画布 CSS 宽度]', () => {
    expect(dividerFromClientX(-50, 100, 800)).toBe(0);
    expect(dividerFromClientX(100000, 100, 800)).toBe(800);
    expect(dividerFromClientX(900, 100, 800)).toBe(800);
  });
  it('画布宽度为小数时按四舍五入后的宽度钳制', () => {
    expect(clampDivider(799.6, 799.6)).toBe(800);
    expect(clampDivider(900, 799.4)).toBe(799);
  });
  it('方向键步进恰为 1 像素且越界钳制', () => {
    expect(stepDivider(100, 1, 800)).toBe(101);
    expect(stepDivider(100, -1, 800)).toBe(99);
    expect(stepDivider(0, -1, 800)).toBe(0);
    expect(stepDivider(800, 1, 800)).toBe(800);
  });
});

describe('computeBlit：源/目标矩形', () => {
  it('图像大于视口：源矩形覆盖视口，目标铺满画布', () => {
    const b = computeBlit({ x: 1000, y: 500 }, IMG, CANVAS, 1);
    expect(b).toEqual({ sx: 600, sy: 300, sw: 800, sh: 400, dx: 0, dy: 0, dw: 800, dh: 400 });
  });
  it('中心贴左边界时源矩形从 0 开始，无负偏移', () => {
    const b = computeBlit({ x: 400, y: 200 }, IMG, CANVAS, 1);
    expect(b.sx).toBe(0);
    expect(b.sy).toBe(0);
    expect(b.dx).toBe(0);
    expect(b.dw).toBe(800);
  });
  it('图像小于视口的轴：源为整图，目标居中', () => {
    const img = { width: 200, height: 100 };
    const b = computeBlit({ x: 100, y: 50 }, img, CANVAS, 1);
    expect(b.sx).toBe(0);
    expect(b.sw).toBe(200);
    expect(b.dx).toBe(300); // (800 - 200) / 2
    expect(b.dw).toBe(200);
    expect(b.dy).toBe(150); // (400 - 100) / 2
    expect(b.dh).toBe(100);
  });
  it('2× 倍率下视口覆盖原图减半', () => {
    const b = computeBlit({ x: 1000, y: 500 }, IMG, CANVAS, 2);
    expect(b.sw).toBe(400);
    expect(b.sh).toBe(200);
    expect(b.dw).toBe(800);
    expect(b.dh).toBe(400);
  });
});

describe('viewportSpan', () => {
  it('视口覆盖的原图像素 = CSS 宽 / 倍率', () => {
    expect(viewportSpan(800, 1)).toBe(800);
    expect(viewportSpan(800, 2)).toBe(400);
    expect(viewportSpan(800, 4)).toBe(200);
  });
});

describe('sniffFormat：魔数识别', () => {
  it('识别 PNG 签名', () => {
    expect(sniffFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
  });
  it('识别 JPEG 签名', () => {
    expect(sniffFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
  });
  it('拒绝 GIF / 文本 / 空内容', () => {
    expect(sniffFormat(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBeNull();
    expect(sniffFormat(new TextEncoder().encode('hello world'))).toBeNull();
    expect(sniffFormat(new Uint8Array([]))).toBeNull();
  });
});
