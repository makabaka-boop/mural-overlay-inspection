import { test, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { BOOKMARK_STORAGE_KEY } from '../src/core/bookmark';

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

const labels = {
  zoom: '[data-testid="zoom-label"]',
  divider: '[data-testid="divider-label"]',
  center: '[data-testid="center-label"]',
  notice: '[data-testid="bookmark-notice"]',
  save: '[data-testid="save-bookmark"]',
  restore: '[data-testid="restore-bookmark"]',
};

/** 1× 下空格拖拽 (+100,+40) CSS：视口中心 (800,600) → (700,560) */
async function panToKnownCenter(page: Page, box: { x: number; y: number; width: number; height: number }) {
  const midX = box.x + box.width / 2;
  const midY = box.y + box.height / 2;
  await page.keyboard.down(' ');
  await page.mouse.move(midX, midY);
  await page.mouse.down();
  await page.mouse.move(midX + 100, midY + 40, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up(' ');
  await expect(page.locator(labels.center)).toHaveText('(700, 560)');
}

/** 左键点按画布 x=320 处：分界设为 320 px */
async function setDivider320(page: Page, box: { x: number; y: number; height: number }) {
  const midY = box.y + box.height / 2;
  await page.mouse.move(box.x + 320, midY);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator(labels.divider)).toHaveText('320 px');
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('保存视图 → 刷新 → 重新载图 → 恢复视图：中心/倍率/分界完整还原', async ({ page }) => {
  await loadPair(page, 'big-before.png', 'big-after.png');
  // 无记录时恢复按钮禁用
  await expect(page.locator(labels.restore)).toBeDisabled();
  const box = await canvasBox(page);

  // 布置视图：1× 平移到 (700,560)，切 2×（中心不变），分界 320
  await panToKnownCenter(page, box);
  await page.locator('[data-testid="zoom-2"]').click();
  await expect(page.locator(labels.center)).toHaveText('(700, 560)');
  await setDivider320(page, box);

  // 保存书签
  await page.locator(labels.save).click();
  await expect(page.locator(labels.notice)).toHaveText('视图书签已保存');
  await expect(page.locator(labels.restore)).toBeEnabled();

  // 刷新页面：视口状态丢失，书签仍在本地存储；未载图前恢复按钮禁用
  await page.reload();
  await expect(page.locator(labels.restore)).toBeDisabled();
  await loadPair(page, 'big-before.png', 'big-after.png');
  await expect(page.locator(labels.zoom)).toHaveText('1×');
  await expect(page.locator(labels.center)).toHaveText('(800, 600)');
  const box2 = await canvasBox(page);
  await expect(page.locator(labels.divider)).toHaveText(`${Math.round(box2.width / 2)} px`);

  // 恢复视图：中心/倍率/分界回到保存时状态
  await page.locator(labels.restore).click();
  await expect(page.locator(labels.notice)).toHaveText('视图已恢复');
  await expect(page.locator(labels.zoom)).toHaveText('2×');
  await expect(page.locator(labels.center)).toHaveText('(700, 560)');
  await expect(page.locator(labels.divider)).toHaveText('320 px');
});

test('跨尺寸恢复：按当前影像天然尺寸反算中心，分界按画布宽度还原', async ({ page }) => {
  await loadPair(page, 'big-before.png', 'big-after.png');
  const box = await canvasBox(page);
  await panToKnownCenter(page, box);
  await page.locator('[data-testid="zoom-2"]').click();
  await setDivider320(page, box);
  await page.locator(labels.save).click();
  await expect(page.locator(labels.notice)).toHaveText('视图书签已保存');

  // 刷新后载入另一对同尺寸影像（800×600）：恢复按新天然尺寸反算
  await page.reload();
  await loadPair(page, 'mid-before.png', 'mid-after.png');
  await expect(page.locator(labels.center)).toHaveText('(400, 300)');
  await page.locator(labels.restore).click();
  await expect(page.locator(labels.notice)).toHaveText('视图已恢复');
  // 归一化中心 (0.4375, 0.4666…) × 800×600 → (350, 280)，2× 下两轴均合法
  await expect(page.locator(labels.zoom)).toHaveText('2×');
  await expect(page.locator(labels.center)).toHaveText('(350, 280)');
  // 画布尺寸未变：分界比例还原为同一像素
  await expect(page.locator(labels.divider)).toHaveText('320 px');
});

test('损坏记录恢复失败：提示“视图书签已损坏”，影像/视口/工具状态不变', async ({ page }) => {
  // 预置倍率非法的损坏记录，刷新让 App 重新探测可用性
  await page.evaluate(
    (key) => window.localStorage.setItem(key, '{"cx":0.5,"cy":0.5,"zoom":3,"divider":0.4}'),
    BOOKMARK_STORAGE_KEY,
  );
  await page.reload();
  await loadPair(page, 'big-before.png', 'big-after.png');
  const box = await canvasBox(page);

  // 布置现场：2×、分界 400、取样模式并取到一个有效坐标
  await page.locator('[data-testid="zoom-2"]').click();
  const midY = box.y + box.height / 2;
  await page.mouse.move(box.x + 400, midY);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator(labels.divider)).toHaveText('400 px');
  await page.locator('[data-testid="toggle-sampling"]').click();
  await page.mouse.click(box.x + 200, box.y + 100);
  await expect(page.locator('[data-testid="sample-coord"]')).not.toHaveText('—');
  const coord = await page.locator('[data-testid="sample-coord"]').textContent();

  // 记录存在但损坏：恢复按钮可点，点击后提示损坏
  await expect(page.locator(labels.restore)).toBeEnabled();
  await page.locator(labels.restore).click();
  await expect(page.locator(labels.notice)).toHaveText('视图书签已损坏');

  // 影像、视口与取样状态全部不变
  await expect(page.locator(labels.zoom)).toHaveText('2×');
  await expect(page.locator(labels.center)).toHaveText('(800, 600)');
  await expect(page.locator(labels.divider)).toHaveText('400 px');
  await expect(page.locator('[data-testid="sample-coord"]')).toHaveText(coord!);
  await expect(page.locator('[data-testid="meta-before"]')).toContainText('big-before.png');
  await expect(page.locator('[data-testid="meta-after"]')).toContainText('big-after.png');
});

test('存储不可写时保存失败并提示，当前画面保留', async ({ page }) => {
  await loadPair(page, 'big-before.png', 'big-after.png');
  const box = await canvasBox(page);
  await page.locator('[data-testid="zoom-2"]').click();
  const midY = box.y + box.height / 2;
  await page.mouse.move(box.x + 400, midY);
  await page.mouse.down();
  await page.mouse.up();
  await expect(page.locator(labels.divider)).toHaveText('400 px');

  // 令本地存储不可写
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('storage denied', 'SecurityError');
    };
  });
  await page.locator(labels.save).click();
  await expect(page.locator(labels.notice)).toHaveText('视图书签保存失败');

  // 当前画面不变，且未写入记录（恢复按钮仍禁用）
  await expect(page.locator(labels.zoom)).toHaveText('2×');
  await expect(page.locator(labels.center)).toHaveText('(800, 600)');
  await expect(page.locator(labels.divider)).toHaveText('400 px');
  await expect(page.locator(labels.restore)).toBeDisabled();
});

test('单侧文件校验失败不触碰书签：恢复仍回到已保存视图', async ({ page }) => {
  await loadPair(page, 'big-before.png', 'big-after.png');
  const box = await canvasBox(page);
  await panToKnownCenter(page, box);
  await setDivider320(page, box);
  await page.locator(labels.save).click();
  await expect(page.locator(labels.notice)).toHaveText('视图书签已保存');

  // 改变视口后载入损坏文件：校验失败被隔离
  await page.locator('[data-testid="zoom-4"]').click();
  await page.setInputFiles('[data-testid="input-before"]', FIX('corrupt.png'));
  await expect(page.locator('[data-testid="error-before"]')).toContainText('损坏');

  // 书签不受影响：恢复仍回到保存时的 1× / (700,560) / 320
  await page.locator(labels.restore).click();
  await expect(page.locator(labels.notice)).toHaveText('视图已恢复');
  await expect(page.locator(labels.zoom)).toHaveText('1×');
  await expect(page.locator(labels.center)).toHaveText('(700, 560)');
  await expect(page.locator(labels.divider)).toHaveText('320 px');
  await expect(page.locator('[data-testid="meta-before"]')).toContainText('big-before.png');
});

test('无书签旧用户：恢复按钮保持禁用，现有流程完全一致', async ({ page }) => {
  await expect(page.locator(labels.save)).toBeDisabled();
  await expect(page.locator(labels.restore)).toBeDisabled();
  await expect(page.locator(labels.notice)).toHaveCount(0);

  await loadPair(page, 'big-before.png', 'big-after.png');
  // 载图后可保存，但无记录仍不可恢复
  await expect(page.locator(labels.save)).toBeEnabled();
  await expect(page.locator(labels.restore)).toBeDisabled();

  // 现有交互不受影响：倍率切换与分界拖动如常
  await page.locator('[data-testid="zoom-4"]').click();
  await expect(page.locator(labels.zoom)).toHaveText('4×');
  await expect(page.locator(labels.center)).toHaveText('(800, 600)');
  const box = await canvasBox(page);
  await setDivider320(page, box);
});
