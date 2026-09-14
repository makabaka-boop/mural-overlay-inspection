import { test, expect, type Page, type Locator } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const FIX = (name: string) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

async function loadPair(page: Page, before: string, after: string) {
  await page.setInputFiles('[data-testid="input-before"]', FIX(before));
  await page.setInputFiles('[data-testid="input-after"]', FIX(after));
}

async function canvasBox(page: Page) {
  const box = await page.locator('[data-testid="compare-canvas"]').boundingBox();
  if (!box) throw new Error('canvas not visible');
  return box;
}

/** 1× 初始视口中心为图像中心 (800,600)：原图坐标 → 画布 CSS 坐标 */
function imageToCssAt1(ix: number, iy: number, box: { width: number; height: number }) {
  return { x: ix - 800 + box.width / 2, y: iy - 600 + box.height / 2 };
}

/**
 * 半透明洋红蒙版（255,0,128）与任意底色源覆盖：合成结果的 G 通道恒为
 * 底 G 的一半（≤128），而 R/B 均显著高于 G（≥127）；未命中区域保持原色。
 * 故以 G 低 + R、B 均高出 G 一截作为蒙版命中判据，与底色明暗无关。
 */
async function isMagenta(page: Page, x: number, y: number): Promise<boolean> {
  const d = await readPixel(page, x, y);
  return d[1] < 140 && d[0] - d[1] > 45 && d[2] - d[1] > 45 && d[3] > 200;
}

async function readPixel(page: Page, x: number, y: number): Promise<number[]> {
  return page.evaluate(
    ([px, py]) => {
      const c = document.querySelector('canvas')!;
      const ctx = c.getContext('2d')!;
      return Array.from(ctx.getImageData(Math.round(px), Math.round(py), 1, 1).data);
    },
    [x, y] as const,
  );
}

/** 以原生 setter 设置 range 值并派发 input/change，绕过键盘步进 */
async function setThreshold(page: Page, value: number) {
  await page.evaluate((v) => {
    const input = document.querySelector(
      '[data-testid="diff-threshold"]',
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, String(v));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await expect(page.locator('[data-testid="diff-threshold-label"]')).toHaveText(String(value));
}

const toggleDiff = (page: Page): Locator => page.locator('[data-testid="toggle-diff"]');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.describe('差异显影', () => {
  test('载图后可开启，命中像素以半透明洋红叠加，未命中区域保持原色，滑杆阈值默认 32', async ({
    page,
  }) => {
    await loadPair(page, 'diff-before.png', 'diff-after.png');
    const box = await canvasBox(page);
    await expect(toggleDiff(page)).toBeEnabled();
    await expect(page.locator('[data-testid="diff-threshold-label"]')).toHaveText('32');

    // 未开启：无洋红叠加，块内外均为中灰底
    const a = imageToCssAt1(800, 560, box);
    expect(await isMagenta(page, a.x, a.y)).toBe(false);

    await toggleDiff(page).click();
    await expect(toggleDiff(page)).toHaveAttribute('aria-pressed', 'true');

    // A 块（差 20 < 默认阈值 32）：不命中，块内只见底图自身的红色（R 明显大于 B）
    const aRawCss = imageToCssAt1(810, 560, box);
    expect(await isMagenta(page, aRawCss.x, aRawCss.y)).toBe(false);
    const aRaw = await readPixel(page, aRawCss.x, aRawCss.y);
    expect(aRaw[0]).toBeGreaterThan(aRaw[2] + 10);
    // B 块（差 60）内：洋红
    const b = imageToCssAt1(500, 400, box);
    expect(await isMagenta(page, b.x, b.y)).toBe(true);
    // C 单像素（R 差 128）：洋红
    const c = imageToCssAt1(1100, 700, box);
    expect(await isMagenta(page, c.x, c.y)).toBe(true);
    // 降低阈值到 10：A 块随之命中（蒙版确定性增加）
    await setThreshold(page, 10);
    expect(await isMagenta(page, a.x, a.y)).toBe(true);
    // 块外（底图无差异的中灰列 x=780）：未命中，保持中灰
    const outside = imageToCssAt1(780, 560, box);
    const d = await readPixel(page, outside.x, outside.y);
    expect(d[0]).toBe(d[1]);
    expect(d[1]).toBe(d[2]);
    expect(Math.abs(d[0] - 128)).toBeLessThan(6);
  });

  test('调节阈值蒙版确定性增减：t=100 仅剩差 128 单像素，t=128 全部消失；关闭后无叠加', async ({
    page,
  }) => {
    await loadPair(page, 'diff-before.png', 'diff-after.png');
    const box = await canvasBox(page);
    const a = imageToCssAt1(800, 560, box);
    const b = imageToCssAt1(500, 400, box);
    const c = imageToCssAt1(1100, 700, box);
    await toggleDiff(page).click();

    // t=10：A(20)/B(60)/C(128) 全部命中
    await setThreshold(page, 10);
    expect(await isMagenta(page, a.x, a.y)).toBe(true);
    expect(await isMagenta(page, b.x, b.y)).toBe(true);
    expect(await isMagenta(page, c.x, c.y)).toBe(true);

    // t=30：A(20) 不命中，B(60)/C(128) 命中
    await setThreshold(page, 30);
    expect(await isMagenta(page, a.x, a.y)).toBe(false);
    expect(await isMagenta(page, b.x, b.y)).toBe(true);
    expect(await isMagenta(page, c.x, c.y)).toBe(true);

    // t=100：仅 C(128) 命中
    await setThreshold(page, 100);
    expect(await isMagenta(page, a.x, a.y)).toBe(false);
    expect(await isMagenta(page, b.x, b.y)).toBe(false);
    expect(await isMagenta(page, c.x, c.y)).toBe(true);

    // 严格大于：t=128 时差恰为 128 也不命中，蒙版全空
    await setThreshold(page, 128);
    expect(await isMagenta(page, c.x, c.y)).toBe(false);
    const outside = imageToCssAt1(300, 300, box);
    expect(await isMagenta(page, outside.x, outside.y)).toBe(false);

    // 再降回 100：C 恢复命中（确定性增减可逆）
    await setThreshold(page, 100);
    expect(await isMagenta(page, c.x, c.y)).toBe(true);

    // 关闭显影：叠加消失，影像仍在
    await toggleDiff(page).click();
    await expect(toggleDiff(page)).toHaveAttribute('aria-pressed', 'false');
    expect(await isMagenta(page, c.x, c.y)).toBe(false);
  });

  test('阈值边界：最大差恰等于阈值不命中，差加 1 即命中（小图 8×8 差 50 块）', async ({
    page,
  }) => {
    await loadPair(page, 'diff-small-before.png', 'diff-small-after.png');
    const box = await canvasBox(page);
    // 120×90 小图居中，块覆盖原图 x∈[56,64), y∈[40,48)；中心 CSS 即图中心
    const blockCss = { x: box.width / 2, y: box.height / 2 };
    await toggleDiff(page).click();

    await setThreshold(page, 49);
    expect(await isMagenta(page, blockCss.x, blockCss.y)).toBe(true);
    await setThreshold(page, 50);
    // 差恰为 50：严格大于 50 不成立 → 不命中。小图被放大，邻近像素经平滑
    // 混入红色，故只断言蒙版消失（G 通道不再被压暗），不要求严格中灰。
    const d = await readPixel(page, blockCss.x, blockCss.y);
    expect(d[1]).toBeGreaterThan(150);
    expect(Math.abs(d[1] - d[2])).toBeLessThan(30);
  });

  test('显影不接管指针：开启状态下仍可拖动分界，底图按分界显示、蒙版跨分界连续', async ({
    page,
  }) => {
    await loadPair(page, 'diff-before.png', 'diff-after.png');
    const box = await canvasBox(page);
    await toggleDiff(page).click();
    const midY = box.y + box.height / 2;

    // 开启显影后拖动分界到 340px：左键仍归擦镜，不被蒙版拦截
    await page.mouse.move(box.x + box.width / 2, midY);
    await page.mouse.down();
    await page.mouse.move(box.x + 340, midY, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('[data-testid="divider-label"]')).toHaveText('340 px');

    // 方向键仍可调分界
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-testid="divider-label"]')).toHaveText('341 px');

    // 蒙版跨分界连续：B 块（原图 x∈[488,512) → CSS [328,352)）在分界两侧
    // 各取一点，均为洋红；底图仍按分界左右显示
    const bLeft = imageToCssAt1(492, 400, box);
    const bRight = imageToCssAt1(508, 400, box);
    expect(bLeft.x).toBeLessThan(341);
    expect(bRight.x).toBeGreaterThan(341);
    expect(await isMagenta(page, bLeft.x, bLeft.y)).toBe(true);
    expect(await isMagenta(page, bRight.x, bRight.y)).toBe(true);
  });

  test('缩放与平移后蒙版按原图位置对齐（4× 放大 + 空格平移）', async ({ page }) => {
    await loadPair(page, 'diff-before.png', 'diff-after.png');
    const box = await canvasBox(page);
    await toggleDiff(page).click();
    // A 块通道差 20：阈值降到 10 才命中
    await setThreshold(page, 10);

    // A 块中心原图 (800,560)、半径 16；1× 屏幕上对应块内点与块外右邻点
    const inside1 = imageToCssAt1(808, 560, box);
    const outside1 = imageToCssAt1(824, 560, box);
    expect(await isMagenta(page, inside1.x, inside1.y)).toBe(true);
    expect(await isMagenta(page, outside1.x, outside1.y)).toBe(false);

    // 4×：视口中心原图坐标不变；蒙版以同一 blit 放大，边缘仍精确
    await page.locator('[data-testid="zoom-4"]').click();
    // 块屏占区间 [中心−64, 中心+64)：块内点（中心−40 → 原图 790）与块外右邻（+96 → 原图 824）
    const inside4 = { x: box.width / 2 - 40, y: box.height / 2 - 160 };
    const outside4 = { x: box.width / 2 + 96, y: box.height / 2 - 160 };
    expect(await isMagenta(page, inside4.x, inside4.y)).toBe(true);
    expect(await isMagenta(page, outside4.x, outside4.y)).toBe(false);

    // 空格右拖 40 CSS（4× → 视口中心左移 10 原图）：块整体右移 40 CSS，
    // 屏占区间变为 [中心−24, 中心+104)
    await page.keyboard.down(' ');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up(' ');
    await expect(page.locator('[data-testid="center-label"]')).toHaveText('(790, 600)');
    // 原块内点（现原图 780 越出左缘）清空；原块外点（现原图 814 入块）命中
    expect(await isMagenta(page, inside4.x, inside4.y)).toBe(false);
    expect(await isMagenta(page, outside4.x, outside4.y)).toBe(true);
  });

  test('单侧同尺寸替换使缓存失效并按新影像重算', async ({ page }) => {
    await loadPair(page, 'diff-before.png', 'diff-after.png');
    const box = await canvasBox(page);
    const b = imageToCssAt1(500, 400, box);
    await toggleDiff(page).click();
    expect(await isMagenta(page, b.x, b.y)).toBe(true);

    // 用修复前图替换修复后槽位：两槽完全一致 → 全部差值归零，蒙版清空
    await page.setInputFiles('[data-testid="input-after"]', FIX('diff-before.png'));
    await expect(page.locator('[data-testid="meta-after"]')).toContainText('diff-before.png');
    await expect(page.locator('[data-testid="error-after"]')).toHaveCount(0);
    expect(await isMagenta(page, b.x, b.y)).toBe(false);
    const outside = imageToCssAt1(300, 300, box);
    expect(await isMagenta(page, outside.x, outside.y)).toBe(false);

    // 再换回差异图：缓存按新影像重建，命中恢复
    await page.setInputFiles('[data-testid="input-after"]', FIX('diff-after.png'));
    await expect(page.locator('[data-testid="meta-after"]')).toContainText('diff-after.png');
    expect(await isMagenta(page, b.x, b.y)).toBe(true);
  });

  test('无法读取像素时自动关闭显影并提示“差异显影生成失败”，影像/视口/工具保留', async ({
    page,
  }) => {
    await loadPair(page, 'diff-before.png', 'diff-after.png');
    const box = await canvasBox(page);
    // 先改变视口/分界，便于核验状态保留
    await page.locator('[data-testid="zoom-2"]').click();
    await page.mouse.move(box.x + 400, box.y + 300);
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.locator('[data-testid="divider-label"]')).toHaveText('400 px');

    // 令浏览器“无法读取像素”：getImageData 一律抛 SecurityError
    await page.evaluate(() => {
      const proto = CanvasRenderingContext2D.prototype;
      proto.getImageData = function () {
        throw new DOMException('mocked security error', 'SecurityError');
      };
    });

    await toggleDiff(page).click();
    await expect(page.locator('[data-testid="diff-error"]')).toHaveText('差异显影生成失败');
    await expect(toggleDiff(page)).toHaveAttribute('aria-pressed', 'false');
    // 影像与视口/分界保留：画布仍在绘制底图（非占位文字），分界仍是 400
    await expect(page.locator('[data-testid="zoom-label"]')).toHaveText('2×');
    await expect(page.locator('[data-testid="divider-label"]')).toHaveText('400 px');
    await expect(page.locator('[data-testid="meta-before"]')).toContainText('diff-before.png');

    // 恢复读取能力后重新开启：蒙版成功生成，失败提示清除
    await page.reload();
    await loadPair(page, 'diff-before.png', 'diff-after.png');
    await toggleDiff(page).click();
    await expect(page.locator('[data-testid="diff-error"]')).toHaveCount(0);
    const nb = await canvasBox(page);
    const p = imageToCssAt1(500, 400, nb);
    expect(await isMagenta(page, p.x, p.y)).toBe(true);
  });

  test('关闭显影后擦镜、取样与测距行为均不受影响', async ({ page }) => {
    await loadPair(page, 'diff-before.png', 'diff-after.png');
    const box = await canvasBox(page);
    const midY = box.y + box.height / 2;

    // 开启后关闭
    await toggleDiff(page).click();
    await toggleDiff(page).click();
    await expect(toggleDiff(page)).toHaveAttribute('aria-pressed', 'false');

    // 擦镜：拖分界 + 方向键
    await page.mouse.move(box.x + box.width / 2, midY);
    await page.mouse.down();
    await page.mouse.move(box.x + 320, midY, { steps: 3 });
    await page.mouse.up();
    await expect(page.locator('[data-testid="divider-label"]')).toHaveText('320 px');
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('[data-testid="divider-label"]')).toHaveText('321 px');

    // 取样：点击得到坐标与 RGBA 读数
    await page.locator('[data-testid="toggle-sampling"]').click();
    await page.mouse.click(box.x + 200, box.y + 100);
    await expect(page.locator('[data-testid="sample-coord"]')).not.toHaveText('—');
    await expect(page.locator('[data-testid="sample-before"]')).toContainText('128');
    await page.locator('[data-testid="toggle-sampling"]').click();

    // 测距：两点落尺得到欧氏长度
    await page.locator('[data-testid="toggle-ranging"]').click();
    await page.mouse.click(box.x + 300, box.y + 150);
    await page.mouse.click(box.x + 500, box.y + 250);
    await expect(page.locator('[data-testid="ruler-distance"]')).toHaveText('223.61 px');
  });

  test('显影开启时取样标记与测距尺绘制在蒙版上方', async ({ page }) => {
    await loadPair(page, 'diff-before.png', 'diff-after.png');
    const box = await canvasBox(page);
    await toggleDiff(page).click();

    // 在洋红蒙版区域取样：黄黑标记须盖在洋红之上（在点击处找到标记黄像素）
    const css = imageToCssAt1(500, 400, box);
    expect(await isMagenta(page, css.x, css.y)).toBe(true);
    await page.locator('[data-testid="toggle-sampling"]').click();
    await page.mouse.click(box.x + css.x, box.y + css.y);
    const yellow = await page.evaluate(
      ({ x0, y0 }) => {
        const c = document.querySelector('canvas')!;
        const ctx = c.getContext('2d')!;
        for (let dy = -12; dy <= 12; dy++) {
          for (let dx = -12; dx <= 12; dx++) {
            const d = Array.from(ctx.getImageData(Math.round(x0 + dx), Math.round(y0 + dy), 1, 1).data);
            if (d[0] > 230 && d[1] > 190 && d[1] < 230 && d[2] < 60) return true;
          }
        }
        return false;
      },
      { x0: css.x, y0: css.y },
    );
    expect(yellow).toBe(true);
    await page.locator('[data-testid="toggle-sampling"]').click();

    // 测距尺端点在蒙版区域内仍可辨识青色
    await page.locator('[data-testid="toggle-ranging"]').click();
    const p1 = imageToCssAt1(790, 550, box);
    const p2 = imageToCssAt1(810, 570, box);
    await page.mouse.click(box.x + p1.x, box.y + p1.y);
    await page.mouse.click(box.x + p2.x, box.y + p2.y);
    const cyan = await page.evaluate(
      ({ x0, y0 }) => {
        const c = document.querySelector('canvas')!;
        const ctx = c.getContext('2d')!;
        for (let dy = -8; dy <= 8; dy++) {
          for (let dx = -8; dx <= 8; dx++) {
            const d = Array.from(ctx.getImageData(Math.round(x0 + dx), Math.round(y0 + dy), 1, 1).data);
            if (d[1] > 200 && d[2] > 200 && d[0] < 90) return true;
          }
        }
        return false;
      },
      { x0: p1.x, y0: p1.y },
    );
    expect(cyan).toBe(true);
  });
});
