import { test, expect, type Page } from '@playwright/test';
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

/** 读取画布 CSS 坐标处像素（无头环境 dpr=1） */
async function readPixel(page: Page, x: number, y: number): Promise<number[]> {
  return page.evaluate(
    ([px, py]) => {
      const c = document.querySelector('canvas')!;
      const ctx = c.getContext('2d')!;
      return Array.from(ctx.getImageData(px, py, 1, 1).data);
    },
    [x, y] as const,
  );
}

const labels = {
  zoom: '[data-testid="zoom-label"]',
  divider: '[data-testid="divider-label"]',
  center: '[data-testid="center-label"]',
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('载入同尺寸图像对：共享视口初始化并显示状态', async ({ page }) => {
  await loadPair(page, 'big-before.png', 'big-after.png');
  await expect(page.locator('[data-testid="meta-before"]')).toContainText('1600×1200');
  await expect(page.locator('[data-testid="meta-after"]')).toContainText('1600×1200');
  await expect(page.locator(labels.zoom)).toHaveText('1×');
  // 视口中心 = 图像中心（天然像素）
  await expect(page.locator(labels.center)).toHaveText('(800, 600)');
  // 分界初始化为画布中点
  const box = await canvasBox(page);
  await expect(page.locator(labels.divider)).toHaveText(`${Math.round(box.width / 2)} px`);
  // 分界左侧为修复前（偏红），右侧为修复后（偏蓝）
  const mid = Math.round(box.height / 2);
  const left = await readPixel(page, Math.round(box.width / 2) - 3, mid);
  const right = await readPixel(page, Math.round(box.width / 2) + 3, mid);
  expect(left[0]).toBeGreaterThan(left[2]);
  expect(right[2]).toBeGreaterThan(right[0]);
});

test('拖动与方向键移动分界：按 CSS 像素取整并钳制在画布内', async ({ page }) => {
  await loadPair(page, 'big-before.png', 'big-after.png');
  const box = await canvasBox(page);
  const midY = box.y + box.height / 2;

  // 拖动到距左边缘 200px 处
  await page.mouse.move(box.x + 200, midY);
  await page.mouse.down();
  await page.mouse.move(box.x + 320, midY, { steps: 4 });
  await expect(page.locator(labels.divider)).toHaveText('320 px');
  await page.mouse.up();

  // 方向键每次恰移动 1 像素
  await page.keyboard.press('ArrowRight');
  await expect(page.locator(labels.divider)).toHaveText('321 px');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator(labels.divider)).toHaveText('319 px');

  // 拖出左边缘 → 钳到 0，画布只剩修复后
  await page.mouse.move(box.x + 319, midY);
  await page.mouse.down();
  await page.mouse.move(box.x - 60, midY, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator(labels.divider)).toHaveText('0 px');
  const onlyAfter = await readPixel(page, Math.round(box.width / 2), Math.round(box.height / 2));
  expect(onlyAfter[2]).toBeGreaterThan(onlyAfter[0]);

  // 拖出右边缘 → 钳到画布宽度，画布只剩修复前
  await page.mouse.move(box.x + 10, midY);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width + 60, midY, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator(labels.divider)).toHaveText(`${Math.round(box.width)} px`);
  const onlyBefore = await readPixel(page, Math.round(box.width / 2), Math.round(box.height / 2));
  expect(onlyBefore[0]).toBeGreaterThan(onlyBefore[2]);

  // 回到中部仍逐点对齐：左红右蓝
  await page.mouse.move(box.x + box.width - 5, midY);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, midY, { steps: 4 });
  await page.mouse.up();
  const l = await readPixel(page, Math.round(box.width / 2) - 3, Math.round(box.height / 2));
  const r = await readPixel(page, Math.round(box.width / 2) + 3, Math.round(box.height / 2));
  expect(l[0]).toBeGreaterThan(l[2]);
  expect(r[2]).toBeGreaterThan(r[0]);
});

test('倍率仅 1/2/4，切换保持视口中心原图坐标', async ({ page }) => {
  await loadPair(page, 'big-before.png', 'big-after.png');
  await expect(page.locator(labels.center)).toHaveText('(800, 600)');

  await page.locator('[data-testid="zoom-2"]').click();
  await expect(page.locator(labels.zoom)).toHaveText('2×');
  await expect(page.locator(labels.center)).toHaveText('(800, 600)');

  await page.locator('[data-testid="zoom-4"]').click();
  await expect(page.locator(labels.zoom)).toHaveText('4×');
  await expect(page.locator(labels.center)).toHaveText('(800, 600)');

  await page.locator('[data-testid="zoom-1"]').click();
  await expect(page.locator(labels.center)).toHaveText('(800, 600)');
});

test('平移按轴钳制不露白，图像小于视口的轴固定居中', async ({ page }) => {
  await loadPair(page, 'big-before.png', 'big-after.png');
  const box = await canvasBox(page);
  const midX = box.x + box.width / 2;
  const midY = box.y + box.height / 2;

  // 空格 + 拖拽平移：向右拖 100px，视口中心左移 100 原图像素
  await page.keyboard.down(' ');
  await page.mouse.move(midX, midY);
  await page.mouse.down();
  await page.mouse.move(midX + 100, midY + 40, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up(' ');
  await expect(page.locator(labels.center)).toHaveText('(700, 560)');

  // 滚轮平移
  await page.mouse.move(midX, midY);
  await page.mouse.wheel(0, 120);
  await expect(page.locator(labels.center)).toHaveText('(700, 680)');

  // 向左上猛拖：钳到视口半宽/半高，不出现空白
  await page.keyboard.down(' ');
  await page.mouse.move(midX, midY);
  await page.mouse.down();
  await page.mouse.move(midX + 5000, midY + 5000, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up(' ');
  const minX = box.width / 2;
  const minY = box.height / 2;
  await expect(page.locator(labels.center)).toHaveText(`(${minX}, ${minY})`);

  // 反向猛拖：钳到 image - 半宽/半高
  await page.keyboard.down(' ');
  await page.mouse.move(midX, midY);
  await page.mouse.down();
  await page.mouse.move(midX - 5000, midY - 5000, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up(' ');
  await expect(page.locator(labels.center)).toHaveText(`(${1600 - minX}, ${1200 - minY})`);
});

test('小图像两轴固定居中，平移无效', async ({ page }) => {
  await loadPair(page, 'small-before.png', 'small-after.png');
  await expect(page.locator(labels.center)).toHaveText('(60, 45)');
  const box = await canvasBox(page);
  await page.keyboard.down(' ');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 300, box.y + box.height / 2 + 200, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up(' ');
  await expect(page.locator(labels.center)).toHaveText('(60, 45)');
});

test('坏文件定位原因并保留上一组有效影像与视口', async ({ page }) => {
  await loadPair(page, 'big-before.png', 'big-after.png');
  // 改变视口状态以便核验“保留”
  await page.locator('[data-testid="zoom-2"]').click();
  const box = await canvasBox(page);
  await page.mouse.move(box.x + 400, box.y + 300);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator(labels.divider)).toHaveText('400 px');
  await expect(page.locator(labels.center)).toHaveText('(800, 600)');

  // 1) 损坏文件
  await page.setInputFiles('[data-testid="input-before"]', FIX('corrupt.png'));
  await expect(page.locator('[data-testid="error-before"]')).toContainText('损坏');
  // 2) 非目标格式
  await page.setInputFiles('[data-testid="input-before"]', FIX('notes.txt'));
  await expect(page.locator('[data-testid="error-before"]')).toContainText('非 PNG/JPEG');
  // 3) 伪装扩展名（GIF 内容命名 .png）
  await page.setInputFiles('[data-testid="input-after"]', FIX('fake.png'));
  await expect(page.locator('[data-testid="error-after"]')).toContainText('非 PNG/JPEG');
  // 4) 异尺寸
  await page.setInputFiles('[data-testid="input-after"]', FIX('mismatch.png'));
  await expect(page.locator('[data-testid="error-after"]')).toContainText('尺寸不一致');
  await expect(page.locator('[data-testid="error-after"]')).toContainText('1600×1200');
  await expect(page.locator('[data-testid="error-after"]')).toContainText('1601×1200');

  // 上一组有效影像与视口全部保留
  await expect(page.locator('[data-testid="meta-before"]')).toContainText('big-before.png');
  await expect(page.locator('[data-testid="meta-after"]')).toContainText('big-after.png');
  await expect(page.locator(labels.zoom)).toHaveText('2×');
  await expect(page.locator(labels.divider)).toHaveText('400 px');
  await expect(page.locator(labels.center)).toHaveText('(800, 600)');
  // 画布仍在渲染有效影像
  const px = await readPixel(page, 10, Math.round(box.height / 2));
  expect(px[3]).toBe(255);
});

test('合法替换单侧后视口保留，错误随后可恢复', async ({ page }) => {
  await loadPair(page, 'big-before.png', 'big-after.png');
  await page.setInputFiles('[data-testid="input-before"]', FIX('corrupt.png'));
  await expect(page.locator('[data-testid="error-before"]')).toContainText('损坏');
  // 重新载入合法文件，错误清除，视口保留
  await page.setInputFiles('[data-testid="input-before"]', FIX('big-before.png'));
  await expect(page.locator('[data-testid="error-before"]')).toHaveCount(0);
  await expect(page.locator(labels.center)).toHaveText('(800, 600)');
  await expect(page.locator(labels.zoom)).toHaveText('1×');
});

// ── 像素取样 ─────────────────────────────────────────────────────────────

/** big 夹具在原图坐标 (x,y) 的像素（见 scripts/make-fixtures.mjs pattern） */
function bigPixel(kind: 'r' | 'b', x: number, y: number): number[] {
  const grid = x % 64 === 0 || y % 64 === 0 ? 60 : 0;
  const r = kind === 'r' ? 120 + ((x * 7) % 120) : 30 + grid;
  const g = 40 + ((y * 5) % 140);
  const b = kind === 'b' ? 120 + ((x * 7) % 120) : 30 + grid;
  return [r, g, b, 255];
}

/** 在标记周围搜索黄色取样标记像素（无头 dpr=1，按 CSS 坐标读） */
async function findMarker(page: Page, cx: number, cy: number, radius = 14) {
  return page.evaluate(
    ({ x0, y0, r }) => {
      const c = document.querySelector('canvas')!;
      const ctx = c.getContext('2d')!;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = Math.round(x0 + dx);
          const y = Math.round(y0 + dy);
          if (x < 0 || y < 0 || x >= c.width || y >= c.height) continue;
          const d = Array.from(ctx.getImageData(x, y, 1, 1).data);
          // 标记黄 #ffd400（容差）
          if (d[0] > 230 && d[1] > 190 && d[1] < 230 && d[2] < 60 && d[3] > 200) {
            return { x, y };
          }
        }
      }
      return null;
    },
    { x0: cx, y0: cy, r: radius },
  );
}

test('像素取样：开启后点击画布显示两组 RGBA、通道差、坐标并标出取样点', async ({ page }) => {
  await loadPair(page, 'big-before.png', 'big-after.png');
  const box = await canvasBox(page);
  // 1× 初始视口中心为图像中心 (800,600)，原图坐标 = 中心 + (CSS − 画布中心)
  const css = { x: 200, y: 100 };
  const ix = 800 + Math.round(css.x - box.width / 2);
  const iy = 600 + Math.round(css.y - box.height / 2);

  // 未开启取样时不存在结果区
  await expect(page.locator('[data-testid="sample-readout"]')).toHaveCount(0);

  await page.locator('[data-testid="toggle-sampling"]').click();
  await page.mouse.click(box.x + css.x, box.y + css.y);

  await expect(page.locator('[data-testid="sample-coord"]')).toHaveText(`(${ix}, ${iy})`);
  await expect(page.locator('[data-testid="sample-before"]')).toHaveText(
    `(${bigPixel('r', ix, iy).join(', ')})`,
  );
  await expect(page.locator('[data-testid="sample-after"]')).toHaveText(
    `(${bigPixel('b', ix, iy).join(', ')})`,
  );
  const pb = bigPixel('r', ix, iy);
  const pa = bigPixel('b', ix, iy);
  const diff = pb.map((v, i) => Math.abs(v - pa[i]));
  await expect(page.locator('[data-testid="sample-diff"]')).toHaveText(
    `Δ(${diff[0]}, ${diff[1]}, ${diff[2]}, ${diff[3]})`,
  );
  await expect(page.locator('[data-testid="sample-notice"]')).toHaveCount(0);

  // 画布上在点击处标出取样点
  const marker = await findMarker(page, css.x, css.y);
  expect(marker).not.toBeNull();

  // 取样模式下普通左键不移动分界
  await expect(page.locator(labels.divider)).toHaveText(`${Math.round(box.width / 2)} px`);
});

test('像素取样：缩放与平移后原图坐标不变，标记只移动屏幕位置', async ({ page }) => {
  await loadPair(page, 'big-before.png', 'big-after.png');
  const box = await canvasBox(page);
  await page.locator('[data-testid="toggle-sampling"]').click();
  // 取一个在 4× 下仍会落在画布内的原图点：点击画布中心（1× → 图像中心）
  const cx = Math.round(box.width / 2);
  const cy = Math.round(box.height / 2);
  const [ix, iy] = [800, 600];
  await page.mouse.click(box.x + cx, box.y + cy);
  await expect(page.locator('[data-testid="sample-coord"]')).toHaveText(`(${ix}, ${iy})`);
  expect(await findMarker(page, cx, cy)).not.toBeNull();

  // 4×：视口仍以图像中心为中心，该原图点仍在画布中心；坐标不变
  await page.locator('[data-testid="zoom-4"]').click();
  await expect(page.locator('[data-testid="sample-coord"]')).toHaveText(`(${ix}, ${iy})`);
  expect(await findMarker(page, cx, cy)).not.toBeNull();

  // 空格平移 100 CSS（4× → 25 原图）：标记屏幕位置随之移动 100px，坐标读数仍不变
  await page.keyboard.down(' ');
  await page.mouse.move(box.x + cx, box.y + cy);
  await page.mouse.down();
  await page.mouse.move(box.x + cx + 100, box.y + cy, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up(' ');
  await expect(page.locator('[data-testid="sample-coord"]')).toHaveText(`(${ix}, ${iy})`);
  // 视口中心左移 25 原图 → 标记（原图点固定）在屏幕上右移 100 CSS
  expect(await findMarker(page, cx, cy)).toBeNull();
  expect(await findMarker(page, cx + 100, cy)).not.toBeNull();
  // 像素读数与该原图坐标一致（未重新取样也保持）
  await expect(page.locator('[data-testid="sample-before"]')).toHaveText(
    `(${bigPixel('r', ix, iy).join(', ')})`,
  );
});

test('像素取样：退出模式后原有拖分界/方向键行为保持不变', async ({ page }) => {
  await loadPair(page, 'big-before.png', 'big-after.png');
  const box = await canvasBox(page);
  const midY = box.y + box.height / 2;

  await page.locator('[data-testid="toggle-sampling"]').click();
  await page.mouse.click(box.x + 250, midY);
  await expect(page.locator(labels.divider)).toHaveText(`${Math.round(box.width / 2)} px`);

  // 退出取样模式
  await page.locator('[data-testid="toggle-sampling"]').click();
  await expect(page.locator('[data-testid="sample-readout"]')).toHaveCount(0);

  // 拖动恢复移动分界
  await page.mouse.move(box.x + 300, midY);
  await page.mouse.down();
  await page.mouse.move(box.x + 320, midY, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator(labels.divider)).toHaveText('320 px');

  // 方向键仍可用
  await page.keyboard.press('ArrowRight');
  await expect(page.locator(labels.divider)).toHaveText('321 px');
});

test('像素取样：小图留白点击提示无像素并保留上一次有效结果', async ({ page }) => {
  await loadPair(page, 'small-before.png', 'small-after.png');
  const box = await canvasBox(page);
  await page.locator('[data-testid="toggle-sampling"]').click();

  // 小图 120×90 居中：1× 下图矩形 x∈[box.w/2-60, +120)，点击图像内部
  const imgCssX = Math.round(box.width / 2);
  const imgCssY = Math.round(box.height / 2);
  await page.mouse.click(box.x + imgCssX, box.y + imgCssY);
  await expect(page.locator('[data-testid="sample-coord"]')).toHaveText('(60, 45)');
  const validBefore = await page.locator('[data-testid="sample-before"]').textContent();
  expect(validBefore).toBeTruthy();

  // 点击左上角留白
  await page.mouse.click(box.x + 5, box.y + 5);
  await expect(page.locator('[data-testid="sample-notice"]')).toHaveText('此处无图像像素');
  // 上一次有效结果保留
  await expect(page.locator('[data-testid="sample-coord"]')).toHaveText('(60, 45)');
  await expect(page.locator('[data-testid="sample-before"]')).toHaveText(validBefore);
});

test('像素取样：小图右/下边缘内侧点击读取末列/末行像素', async ({ page }) => {
  await loadPair(page, 'small-before.png', 'small-after.png');
  const box = await canvasBox(page);
  await page.locator('[data-testid="toggle-sampling"]').click();

  // 120×90 居中：图矩形右边缘 CSS x = box.width/2 + 60，点击边缘内侧 0.2px 处
  // → 原图浮点 119.8 → 取整 120 越出边界 → 应钳回末列 119 而非报越界
  const midX = box.width / 2;
  const midY = box.height / 2;
  await page.mouse.click(box.x + midX + 59.8, box.y + midY);
  await expect(page.locator('[data-testid="sample-coord"]')).toHaveText('(119, 45)');
  await expect(page.locator('[data-testid="sample-before"]')).toHaveText(
    `(${bigPixel('r', 119, 45).join(', ')})`,
  );
  await expect(page.locator('[data-testid="sample-after"]')).toHaveText(
    `(${bigPixel('b', 119, 45).join(', ')})`,
  );
  await expect(page.locator('[data-testid="sample-notice"]')).toHaveCount(0);

  // 下边缘内侧同理：原图浮点 89.8 → 钳回末行 89
  await page.mouse.click(box.x + midX, box.y + midY + 44.8);
  await expect(page.locator('[data-testid="sample-coord"]')).toHaveText('(60, 89)');
  await expect(page.locator('[data-testid="sample-before"]')).toHaveText(
    `(${bigPixel('r', 60, 89).join(', ')})`,
  );
  await expect(page.locator('[data-testid="sample-notice"]')).toHaveCount(0);
});

test('像素取样：退出模式后取样标记隐藏，重新进入恢复显示', async ({ page }) => {
  await loadPair(page, 'big-before.png', 'big-after.png');
  const box = await canvasBox(page);
  const css = { x: 200, y: 100 };

  await page.locator('[data-testid="toggle-sampling"]').click();
  await page.mouse.click(box.x + css.x, box.y + css.y);
  expect(await findMarker(page, css.x, css.y)).not.toBeNull();

  // 退出取样模式：标记隐藏，取样点状态保留
  await page.locator('[data-testid="toggle-sampling"]').click();
  expect(await findMarker(page, css.x, css.y)).toBeNull();

  // 重新进入：标记按原图坐标恢复显示
  await page.locator('[data-testid="toggle-sampling"]').click();
  expect(await findMarker(page, css.x, css.y)).not.toBeNull();
});

test('像素取样：退出模式后留白提示随状态栏取样区一并隐藏', async ({ page }) => {
  await loadPair(page, 'small-before.png', 'small-after.png');
  const box = await canvasBox(page);
  await page.locator('[data-testid="toggle-sampling"]').click();

  // 点击居中留白外的区域（左上角）触发无像素提示
  await page.mouse.click(box.x + 5, box.y + 5);
  await expect(page.locator('[data-testid="sample-notice"]')).toHaveText('此处无图像像素');

  // 退出取样模式：提示隐藏
  await page.locator('[data-testid="toggle-sampling"]').click();
  await expect(page.locator('[data-testid="sample-notice"]')).toHaveCount(0);
});

test('像素取样：载入新的有效同尺寸单侧图后按原坐标重新取样', async ({ page }) => {
  await loadPair(page, 'big-before.png', 'big-after.png');
  const box = await canvasBox(page);
  await page.locator('[data-testid="toggle-sampling"]').click();
  const css = { x: 200, y: 100 };
  const ix = 800 + Math.round(css.x - box.width / 2);
  const iy = 600 + Math.round(css.y - box.height / 2);
  await page.mouse.click(box.x + css.x, box.y + css.y);
  await expect(page.locator('[data-testid="sample-coord"]')).toHaveText(`(${ix}, ${iy})`);

  // 用同尺寸的修复后图替换修复前槽位：两槽同为 blue 图案，差值应全部归零
  await page.setInputFiles('[data-testid="input-before"]', FIX('big-after.png'));
  await expect(page.locator('[data-testid="sample-coord"]')).toHaveText(`(${ix}, ${iy})`);
  await expect(page.locator('[data-testid="sample-before"]')).toHaveText(
    `(${bigPixel('b', ix, iy).join(', ')})`,
  );
  await expect(page.locator('[data-testid="sample-diff"]')).toHaveText('Δ(0, 0, 0, 0)');
});

test('像素取样：文件校验失败仍保留影像、视口与取样', async ({ page }) => {
  await loadPair(page, 'big-before.png', 'big-after.png');
  const box = await canvasBox(page);
  await page.locator('[data-testid="zoom-2"]').click();
  await page.locator('[data-testid="toggle-sampling"]').click();
  await page.mouse.click(box.x + 200, box.y + 100);
  await expect(page.locator('[data-testid="sample-coord"]')).not.toHaveText('—');

  // 载入损坏文件：错误隔离，取样结果与视口不动
  await page.setInputFiles('[data-testid="input-before"]', FIX('corrupt.png'));
  await expect(page.locator('[data-testid="error-before"]')).toContainText('损坏');
  await expect(page.locator('[data-testid="sample-coord"]')).not.toHaveText('—');
  await expect(page.locator(labels.zoom)).toHaveText('2×');
  const px = await readPixel(page, 10, Math.round(box.height / 2));
  expect(px[3]).toBe(255);
});

// ── 裂隙测距 ─────────────────────────────────────────────────────────────

/** 在 (x0,y0) 周围搜索青色测距像素（端点/实线/标签，#27e6e6） */
async function findCyan(
  page: Page,
  cx: number,
  cy: number,
  radius = 8,
): Promise<{ x: number; y: number } | null> {
  return page.evaluate(
    ({ x0, y0, r }) => {
      const c = document.querySelector('canvas')!;
      const ctx = c.getContext('2d')!;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = Math.round(x0 + dx);
          const y = Math.round(y0 + dy);
          if (x < 0 || y < 0 || x >= c.width || y >= c.height) continue;
          const d = Array.from(ctx.getImageData(x, y, 1, 1).data);
          // 青色 #27e6e6：绿/蓝高且接近，红通道明显更低
          if (d[1] > 200 && d[2] > 200 && d[0] < 90 && Math.abs(d[1] - d[2]) < 30) {
            return { x, y };
          }
        }
      }
      return null;
    },
    { x0: cx, y0: cy, r: radius },
  );
}

test('裂隙测距：载图后两点落尺，读取水平差/垂直差/欧氏长度并显示青色端点实线标签', async ({
  page,
}) => {
  await loadPair(page, 'big-before.png', 'big-after.png');
  const box = await canvasBox(page);
  const p1 = { x: 300, y: 150 };
  const p2 = { x: 500, y: 250 };
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  // 1× 初始视口中心为图像中心 (800,600)：原图坐标 = 中心 + (CSS − 画布中心)
  const toImage = (p: { x: number; y: number }) => ({
    x: 800 + Math.round(p.x - box.width / 2),
    y: 600 + Math.round(p.y - box.height / 2),
  });
  const i1 = toImage(p1);
  const i2 = toImage(p2);

  await expect(page.locator('[data-testid="ruler-readout"]')).toHaveCount(0);
  await page.locator('[data-testid="toggle-ranging"]').click();
  await expect(page.locator('[data-testid="ruler-readout"]')).toBeVisible();

  // 第一次点击：起点
  await page.mouse.click(box.x + p1.x, box.y + p1.y);
  await expect(page.locator('[data-testid="ruler-distance"]')).toHaveCount(0);
  expect(await findCyan(page, p1.x, p1.y)).not.toBeNull();
  expect(await findCyan(page, p2.x, p2.y)).toBeNull();
  // 测距模式下左键不移动分界
  await expect(page.locator(labels.divider)).toHaveText(`${Math.round(box.width / 2)} px`);

  // 第二次点击：终点并完成
  await page.mouse.click(box.x + p2.x, box.y + p2.y);
  await expect(page.locator('[data-testid="ruler-horizontal"]')).toHaveText('200 px');
  await expect(page.locator('[data-testid="ruler-vertical"]')).toHaveText('100 px');
  await expect(page.locator('[data-testid="ruler-distance"]')).toHaveText('223.61 px');
  // 两端点与实线（取线段上三个点）均为青色
  expect(await findCyan(page, p1.x, p1.y)).not.toBeNull();
  expect(await findCyan(page, p2.x, p2.y)).not.toBeNull();
  for (const t of [0.25, 0.5, 0.75]) {
    expect(
      await findCyan(
        page,
        Math.round(p1.x + (p2.x - p1.x) * t),
        Math.round(p1.y + (p2.y - p1.y) * t),
        3,
      ),
    ).not.toBeNull();
  }
  // 长度标签在中点附近
  expect(await findCyan(page, mid.x + 7, mid.y - 15, 30)).not.toBeNull();
  // 原图坐标读数（整数端点）
  await expect(page.locator('[data-testid="ruler-coords"]')).toContainText(`(${i1.x}, ${i1.y})`);
  await expect(page.locator('[data-testid="ruler-coords"]')).toContainText(`(${i2.x}, ${i2.y})`);

  // 分界仍未被左键移动
  await expect(page.locator(labels.divider)).toHaveText(`${Math.round(box.width / 2)} px`);
});

test('裂隙测距：缩放和平移只改变尺线屏幕位置，读数不变', async ({ page }) => {
  await loadPair(page, 'big-before.png', 'big-after.png');
  const box = await canvasBox(page);
  // 两点相对画布中心对称：中点恒为画布中心，缩放后中点屏幕位置不变。
  // 原图差 (200,80) → √(200²+80²)=215.41；偏移取 100，4× 下端点仍在画布内（240/1040）。
  const p1 = { x: Math.round(box.width / 2) - 100, y: Math.round(box.height / 2) - 40 };
  const p2 = { x: Math.round(box.width / 2) + 100, y: Math.round(box.height / 2) + 40 };
  const mid = { x: Math.round(box.width / 2), y: Math.round(box.height / 2) };
  await page.locator('[data-testid="toggle-ranging"]').click();
  await page.mouse.click(box.x + p1.x, box.y + p1.y);
  await page.mouse.click(box.x + p2.x, box.y + p2.y);
  await expect(page.locator('[data-testid="ruler-distance"]')).toHaveText('215.41 px');
  expect(await findCyan(page, mid.x, mid.y, 6)).not.toBeNull();

  // 4×：视口仍以图像中心为中心，中点（在画布中心）不动；端点屏幕位置随倍率移动。
  const z4 = (p: { x: number; y: number }) => ({
    x: Math.round(mid.x + 4 * (p.x - mid.x)),
    y: Math.round(mid.y + 4 * (p.y - mid.y)),
  });
  await page.locator('[data-testid="zoom-4"]').click();
  await expect(page.locator('[data-testid="ruler-distance"]')).toHaveText('215.41 px');
  await expect(page.locator('[data-testid="ruler-horizontal"]')).toHaveText('200 px');
  await expect(page.locator('[data-testid="ruler-vertical"]')).toHaveText('80 px');
  expect(await findCyan(page, mid.x, mid.y, 6)).not.toBeNull();
  const p1z4 = z4(p1);
  const p2z4 = z4(p2);
  expect(p1z4.x).toBeGreaterThan(0);
  expect(p2z4.x).toBeLessThanOrEqual(box.width);
  // 两个端点 4× 屏幕位置（1× 时该处无线，确为缩放后移动而来）
  expect(await findCyan(page, p1z4.x, p1z4.y)).not.toBeNull();
  expect(await findCyan(page, p2z4.x, p2z4.y)).not.toBeNull();

  // 空格平移 80 CSS（4× → 20 原图）：尺线整体右移 80px，读数仍不变
  await page.keyboard.down(' ');
  await page.mouse.move(box.x + mid.x, box.y + mid.y);
  await page.mouse.down();
  await page.mouse.move(box.x + mid.x + 80, box.y + mid.y, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up(' ');
  await expect(page.locator('[data-testid="ruler-distance"]')).toHaveText('215.41 px');
  expect(await findCyan(page, mid.x, mid.y, 6)).toBeNull();
  expect(await findCyan(page, mid.x + 80, mid.y, 6)).not.toBeNull();
});

test('裂隙测距：中键仍可平移且不产生点击，左键全程不移动分界', async ({ page }) => {
  await loadPair(page, 'big-before.png', 'big-after.png');
  const box = await canvasBox(page);
  await page.locator('[data-testid="toggle-ranging"]').click();

  // 中键拖拽平移（button=1）：不推进尺生命周期
  await page.mouse.move(box.x + 400, box.y + 200);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(box.x + 300, box.y + 200, { steps: 4 });
  await page.mouse.up({ button: 'middle' });
  await expect(page.locator(labels.center)).toHaveText('(900, 600)');
  await expect(page.locator('[data-testid="ruler-distance"]')).toHaveCount(0);

  // 随后左键两点仍可正常完成测量
  await page.mouse.click(box.x + 300, box.y + 150);
  await page.mouse.click(box.x + 360, box.y + 230);
  await expect(page.locator('[data-testid="ruler-distance"]')).toHaveText('100.00 px');
  await expect(page.locator(labels.divider)).toHaveText(`${Math.round(box.width / 2)} px`);
});

test('裂隙测距：第三次点击开始新一轮并保留最近一次完成读数', async ({ page }) => {
  await loadPair(page, 'big-before.png', 'big-after.png');
  const box = await canvasBox(page);
  await page.locator('[data-testid="toggle-ranging"]').click();
  await page.mouse.click(box.x + 300, box.y + 150);
  await page.mouse.click(box.x + 500, box.y + 250);
  await expect(page.locator('[data-testid="ruler-distance"]')).toHaveText('223.61 px');

  // 第三次点击：开始新一轮（该点为新起点），旧完成读数暂留
  await page.mouse.click(box.x + 100, box.y + 100);
  await expect(page.locator('[data-testid="ruler-distance"]')).toHaveText('223.61 px');
  expect(await findCyan(page, 100, 100)).not.toBeNull();

  // 第四次点击完成新一轮：读数更新为 0 与新长度
  await page.mouse.click(box.x + 160, box.y + 180);
  await expect(page.locator('[data-testid="ruler-horizontal"]')).toHaveText('60 px');
  await expect(page.locator('[data-testid="ruler-vertical"]')).toHaveText('80 px');
  await expect(page.locator('[data-testid="ruler-distance"]')).toHaveText('100.00 px');
});

test('裂隙测距：点击居中留白提示无法测距并保持当前阶段', async ({ page }) => {
  await loadPair(page, 'small-before.png', 'small-after.png');
  const box = await canvasBox(page);
  await page.locator('[data-testid="toggle-ranging"]').click();

  // 小图 120×90 居中：先在图像内部完成一次测量
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width / 2 + 30, box.y + box.height / 2 + 40);
  await expect(page.locator('[data-testid="ruler-distance"]')).toHaveText('50.00 px');

  // 点击左上角留白：提示无法测距，阶段与读数都保持
  await page.mouse.click(box.x + 5, box.y + 5);
  await expect(page.locator('[data-testid="ruler-notice"]')).toHaveText('此处无法测距');
  await expect(page.locator('[data-testid="ruler-distance"]')).toHaveText('50.00 px');
  // 留白处不画青色端点
  expect(await findCyan(page, 5, 5)).toBeNull();

  // 再点图像内部：作为“第三击”开始新一轮，提示清除
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('[data-testid="ruler-notice"]')).toHaveCount(0);
  expect(await findCyan(page, box.width / 2, box.height / 2)).not.toBeNull();
});

test('裂隙测距：同尺寸单侧替换后继续使用原测量坐标，读数不变', async ({ page }) => {
  await loadPair(page, 'big-before.png', 'big-after.png');
  const box = await canvasBox(page);
  await page.locator('[data-testid="toggle-ranging"]').click();
  await page.mouse.click(box.x + 300, box.y + 150);
  await page.mouse.click(box.x + 500, box.y + 250);
  await expect(page.locator('[data-testid="ruler-distance"]')).toHaveText('223.61 px');
  const endpoints = await page.locator('[data-testid="ruler-coords"]').textContent();

  // 用同尺寸图替换修复前槽位：测量基于原图坐标，端点与读数不受影响
  await page.setInputFiles('[data-testid="input-before"]', FIX('big-after.png'));
  await expect(page.locator('[data-testid="error-before"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="ruler-distance"]')).toHaveText('223.61 px');
  await expect(page.locator('[data-testid="ruler-coords"]')).toHaveText(endpoints!);
  // 尺线仍在
  expect(await findCyan(page, 400, 200, 6)).not.toBeNull();
});

test('裂隙测距：退出只隐藏尺线读数，重进恢复，且擦镜/取样/文件校验仍可用', async ({
  page,
}) => {
  await loadPair(page, 'big-before.png', 'big-after.png');
  const box = await canvasBox(page);
  const midY = box.y + box.height / 2;
  await page.locator('[data-testid="toggle-ranging"]').click();
  await page.mouse.click(box.x + 300, box.y + 150);
  await page.mouse.click(box.x + 500, box.y + 250);
  await expect(page.locator('[data-testid="ruler-distance"]')).toHaveText('223.61 px');

  // 退出测距：尺线/读数隐藏，最近一次完成结果保留
  await page.locator('[data-testid="toggle-ranging"]').click();
  await expect(page.locator('[data-testid="ruler-readout"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="ruler-notice"]')).toHaveCount(0);
  expect(await findCyan(page, 400, 200, 12)).toBeNull();

  // 原有擦镜：左键拖动恢复移动分界、方向键微调
  await page.mouse.move(box.x + 300, midY);
  await page.mouse.down();
  await page.mouse.move(box.x + 320, midY, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator(labels.divider)).toHaveText('320 px');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator(labels.divider)).toHaveText('321 px');

  // 像素取样仍可用（与测距互斥：开取样时测距保持关闭）
  await page.locator('[data-testid="toggle-sampling"]').click();
  await expect(page.locator('[data-testid="toggle-ranging"]')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await page.mouse.click(box.x + 200, box.y + 100);
  await expect(page.locator('[data-testid="sample-coord"]')).not.toHaveText('—');

  // 文件校验仍可用：损坏文件被拒并提示原因
  await page.setInputFiles('[data-testid="input-before"]', FIX('corrupt.png'));
  await expect(page.locator('[data-testid="error-before"]')).toContainText('损坏');

  // 重新进入测距：最近一次完成结果按原图坐标恢复显示
  await page.locator('[data-testid="toggle-ranging"]').click();
  await expect(page.locator('[data-testid="toggle-sampling"]')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.locator('[data-testid="ruler-distance"]')).toHaveText('223.61 px');
  expect(await findCyan(page, 400, 200, 12)).not.toBeNull();
});
