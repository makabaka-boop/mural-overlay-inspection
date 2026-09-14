import { describe, expect, it } from 'vitest';
import {
  BOOKMARK_STORAGE_KEY,
  bookmarkFromView,
  clampRatio,
  parseBookmark,
  resolveBookmarkView,
  serializeBookmark,
  type ViewBookmark,
} from '../src/core/bookmark';
import { computeBlit, type Size, type Zoom } from '../src/core/viewport';

const IMG = { width: 1600, height: 1200 };
const CANVAS = { width: 800, height: 400 };

/** 保存 → 序列化 → 解析 → 反算 的完整往返 */
function roundTrip(
  center: { x: number; y: number },
  image: Size,
  canvas: Size,
  zoom: Zoom,
  divider: number,
) {
  const record = bookmarkFromView(center, image, canvas, zoom, divider);
  const parsed = parseBookmark(serializeBookmark(record));
  expect(parsed).not.toBeNull();
  return resolveBookmarkView(parsed!, image, canvas);
}

describe('clampRatio：比例归一化', () => {
  it('界内比例保持不变，越界钳到 [0,1]', () => {
    expect(clampRatio(0.25)).toBe(0.25);
    expect(clampRatio(-0.5)).toBe(0);
    expect(clampRatio(1.5)).toBe(1);
  });
  it('非有限输入回落为 0（保证记录可序列化）', () => {
    expect(clampRatio(Number.NaN)).toBe(0);
    expect(clampRatio(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('bookmarkFromView：归一化为固定字段记录', () => {
  it('中心与分界换算为相对天然尺寸/画布宽度的比例', () => {
    const b = bookmarkFromView({ x: 400, y: 300 }, IMG, CANVAS, 2, 200);
    expect(b).toEqual({ cx: 0.25, cy: 0.25, zoom: 2, divider: 0.25 });
  });
  it('只含视图几何字段：不含图像字节与取样/测距/显影结果', () => {
    const b = bookmarkFromView({ x: 800, y: 600 }, IMG, CANVAS, 1, 400);
    expect(Object.keys(b).sort()).toEqual(['cx', 'cy', 'divider', 'zoom']);
  });
  it('越界输入被钳到 [0,1]，非有限输入回落为 0', () => {
    const b = bookmarkFromView({ x: 99999, y: -50 }, IMG, CANVAS, 1, 12345);
    expect(b).toEqual({ cx: 1, cy: 0, zoom: 1, divider: 1 });
    const degenerate = bookmarkFromView({ x: 0, y: 0 }, IMG, { width: 0, height: 0 }, 1, 0);
    expect(Number.isFinite(degenerate.cx)).toBe(true);
    expect(Number.isFinite(degenerate.divider)).toBe(true);
  });
});

describe('serialize/parse：固定字段 JSON 往返', () => {
  it('序列化键序固定为 cx/cy/zoom/divider，解析后逐字段相等', () => {
    const b: ViewBookmark = { cx: 0.4375, cy: 0.25, zoom: 4, divider: 0.5 };
    const json = serializeBookmark(b);
    expect(json).toBe('{"cx":0.4375,"cy":0.25,"zoom":4,"divider":0.5}');
    expect(parseBookmark(json)).toEqual(b);
  });
  it('存储键为固定字符串', () => {
    expect(BOOKMARK_STORAGE_KEY).toBe('mural-wipe-verify:view-bookmark');
  });
});

describe('归一化往返：同尺寸恢复视图不变', () => {
  it('1×/2×/4× 下合法视图保存后恢复为中心/分界/倍率原值', () => {
    const cases: Array<[{ x: number; y: number }, Zoom, number]> = [
      [{ x: 800, y: 500 }, 1, 320],
      [{ x: 500, y: 300 }, 2, 0],
      [{ x: 150, y: 120 }, 4, 800],
    ];
    for (const [center, zoom, divider] of cases) {
      const view = roundTrip(center, IMG, CANVAS, zoom, divider);
      expect(view.zoom).toBe(zoom);
      expect(view.center.x).toBeCloseTo(center.x, 10);
      expect(view.center.y).toBeCloseTo(center.y, 10);
      expect(view.divider).toBe(divider);
    }
  });
  it('小图两轴固定居中：任何中心比例恢复后仍为图像中点', () => {
    const view = roundTrip({ x: 60, y: 45 }, { width: 120, height: 90 }, CANVAS, 1, 400);
    expect(view.center).toEqual({ x: 60, y: 45 });
  });
});

describe('跨尺寸恢复：按当前影像天然尺寸与画布尺寸反算', () => {
  it('中心与分界按比例映射到新尺寸', () => {
    // 在 1600×1200 / 800×400 画布上保存：中心 (800,600)、分界 320
    const record = bookmarkFromView({ x: 800, y: 600 }, IMG, CANVAS, 2, 320);
    // 换到 800×600 影像 / 400×200 画布：中心 (400,300)、分界 160、倍率保持 2×
    const view = resolveBookmarkView(record, { width: 800, height: 600 }, { width: 400, height: 200 });
    expect(view.zoom).toBe(2);
    expect(view.center.x).toBeCloseTo(400, 10);
    expect(view.center.y).toBeCloseTo(300, 10);
    expect(view.divider).toBe(160);
  });
  it('比例反算后复用钳制规则：边缘中心被钳回，画布不露空白', () => {
    // 4× 下贴左上角的合法中心 (100,60)，归一化后以 1× 恢复会越界
    const record = bookmarkFromView({ x: 100, y: 60 }, IMG, CANVAS, 4, 0);
    const view = resolveBookmarkView({ ...record, zoom: 1 }, IMG, CANVAS);
    expect(view.center).toEqual({ x: 400, y: 200 });
    // blit 目标铺满画布：无留白
    const blit = computeBlit(view.center, IMG, CANVAS, view.zoom);
    expect(blit.dx).toBe(0);
    expect(blit.dy).toBe(0);
    expect(blit.dw).toBe(CANVAS.width);
    expect(blit.dh).toBe(CANVAS.height);
  });
  it('小图轴固定居中：恢复比例被居中规则覆盖', () => {
    const record: ViewBookmark = { cx: 0.1, cy: 0.9, zoom: 4, divider: 0.5 };
    const view = resolveBookmarkView(record, { width: 120, height: 90 }, CANVAS);
    expect(view.center).toEqual({ x: 60, y: 45 });
  });
  it('越界比例不视为损坏：分界钳到 [0, 画布宽度]', () => {
    const wide = resolveBookmarkView({ cx: 0.5, cy: 0.5, zoom: 1, divider: 1.5 }, IMG, CANVAS);
    expect(wide.divider).toBe(800);
    const negative = resolveBookmarkView({ cx: 0.5, cy: 0.5, zoom: 1, divider: -0.2 }, IMG, CANVAS);
    expect(negative.divider).toBe(0);
  });
});

describe('非法记录拒绝：缺字段 / 非有限 / 倍率非法', () => {
  const invalid: Array<[string, string]> = [
    ['非 JSON 文本', 'not-a-bookmark'],
    ['JSON null', 'null'],
    ['数组而非对象', '[0.5,0.5,2,0.4]'],
    ['空对象', '{}'],
    ['缺 divider 字段', '{"cx":0.5,"cy":0.5,"zoom":2}'],
    ['缺 zoom 字段', '{"cx":0.5,"cy":0.5,"divider":0.4}'],
    ['cx 为字符串', '{"cx":"0.5","cy":0.5,"zoom":2,"divider":0.4}'],
    ['divider 为 null', '{"cx":0.5,"cy":0.5,"zoom":2,"divider":null}'],
    ['cx 非有限（1e999 → Infinity）', '{"cx":1e999,"cy":0.5,"zoom":2,"divider":0.4}'],
    ['cy 非有限（-1e999）', '{"cx":0.5,"cy":-1e999,"zoom":2,"divider":0.4}'],
    ['倍率 3 非法', '{"cx":0.5,"cy":0.5,"zoom":3,"divider":0.4}'],
    ['倍率 1.5 非法', '{"cx":0.5,"cy":0.5,"zoom":1.5,"divider":0.4}'],
    ['倍率为字符串', '{"cx":0.5,"cy":0.5,"zoom":"2","divider":0.4}'],
  ];
  it.each(invalid)('%s → null', (_label, json) => {
    expect(parseBookmark(json)).toBeNull();
  });
  it('固定字段之外的多余字段被忽略，不影响校验', () => {
    const json = '{"cx":0.5,"cy":0.25,"zoom":2,"divider":0.4,"note":"ignored"}';
    expect(parseBookmark(json)).toEqual({ cx: 0.5, cy: 0.25, zoom: 2, divider: 0.4 });
  });
});
