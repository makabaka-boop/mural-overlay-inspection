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
