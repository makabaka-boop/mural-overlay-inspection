/**
 * 生成 e2e 测试夹具：合法 PNG 对、异尺寸 PNG、损坏文件、非目标格式文件。
 * 纯 Node 实现（zlib 内置），不依赖任何第三方包。
 * 用法：node scripts/make-fixtures.mjs
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'e2e', 'fixtures');
fs.mkdirSync(OUT, { recursive: true });

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** 以最简 PNG（8bit RGBA，filter 0）编码 rgba 像素 */
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 确定性图案：hue 决定色系，叠加网格便于目视对齐核验 */
function pattern(width, height, hue) {
  const px = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const grid = x % 64 === 0 || y % 64 === 0 ? 60 : 0;
      px[i] = hue === 'r' ? 120 + ((x * 7) % 120) : 30 + grid;
      px[i + 1] = 40 + ((y * 5) % 140);
      px[i + 2] = hue === 'b' ? 120 + ((x * 7) % 120) : 30 + grid;
      px[i + 3] = 255;
    }
  }
  return px;
}

function writePng(name, width, height, hue) {
  fs.writeFileSync(path.join(OUT, name), encodePng(width, height, pattern(width, height, hue)));
}

/**
 * 差异显影夹具：中性灰底 (128,128,128) 的修复前图 + 三处已知 RGB 增量块的
 * 修复后图，供阈值边界与蒙版对齐核验。蒙版命中像素的洋红叠加会显著抬高
 * R/B 而 G 保持低水平，未命中区域则保持中灰。
 */
function writeDiffPair() {
  const W = 1600;
  const H = 1200;
  const BASE = 128;
  const before = Buffer.alloc(W * H * 4);
  const after = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      before[i] = after[i] = BASE;
      before[i + 1] = after[i + 1] = BASE;
      before[i + 2] = after[i + 2] = BASE;
      before[i + 3] = after[i + 3] = 255;
    }
  }
  /** 在 after 上叠加一个正方形 RGB 增量块（仅 RGB，alpha 不变） */
  const deltaBlock = (x0, y0, size, dr, dg, db) => {
    for (let y = y0; y < y0 + size; y++) {
      for (let x = x0; x < x0 + size; x++) {
        const i = (y * W + x) * 4;
        after[i] = BASE + dr;
        after[i + 1] = BASE + dg;
        after[i + 2] = BASE + db;
      }
    }
  };
  // A: 32×32 块，最大通道差 20（中心原图 (800,560)，4× 平移对齐测试用）
  deltaBlock(784, 544, 32, 20, 0, 0);
  // B: 24×24 块，最大通道差 60（中心原图 (500,400)，阈值 30/100 判定用）
  deltaBlock(488, 388, 24, 60, 0, 0);
  // C: 3×3 块，R 通道差 128（中心原图 (1100,700)，t<128 命中）
  for (let y = 699; y <= 701; y++) {
    for (let x = 1099; x <= 1101; x++) {
      after[(y * W + x) * 4] = 0;
    }
  }
  fs.writeFileSync(path.join(OUT, 'diff-before.png'), encodePng(W, H, before));
  fs.writeFileSync(path.join(OUT, 'diff-after.png'), encodePng(W, H, after));

  // 小图差异对：120×90，单一 8×8、差 50 的块，供阈值边界测试
  const SW = 120;
  const SH = 90;
  const sb = Buffer.alloc(SW * SH * 4);
  const sa = Buffer.alloc(SW * SH * 4);
  for (let i = 0; i < SW * SH; i++) {
    sb.set([BASE, BASE, BASE, 255], i * 4);
    sa.set([BASE, BASE, BASE, 255], i * 4);
  }
  for (let y = 40; y < 48; y++) {
    for (let x = 56; x < 64; x++) {
      sa[(y * SW + x) * 4] = BASE + 50;
    }
  }
  fs.writeFileSync(path.join(OUT, 'diff-small-before.png'), encodePng(SW, SH, sb));
  fs.writeFileSync(path.join(OUT, 'diff-small-after.png'), encodePng(SW, SH, sa));
}

// 大图像对（大于画布，可平移）
writePng('big-before.png', 1600, 1200, 'r');
writePng('big-after.png', 1600, 1200, 'b');
// 小图像对（小于视口，两轴固定居中）
writePng('small-before.png', 120, 90, 'r');
writePng('small-after.png', 120, 90, 'b');
// 异尺寸（与 big 不匹配）
writePng('mismatch.png', 1601, 1200, 'b');
// 损坏文件：PNG 头 + 垃圾数据
fs.writeFileSync(
  path.join(OUT, 'corrupt.png'),
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('this-is-not-a-real-png-payload'),
  ]),
);
// 非目标格式：文本内容
fs.writeFileSync(path.join(OUT, 'notes.txt'), Buffer.from('plain text, not an image'));
// 伪装文件：GIF 魔数、.png 扩展名
fs.writeFileSync(
  path.join(OUT, 'fake.png'),
  Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00]),
);

// 差异显影受控夹具（已知增量块/单像素）
writeDiffPair();

console.log('fixtures written to', OUT);
