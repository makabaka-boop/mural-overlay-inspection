# 壁画擦镜核验台（mural-wipe-verify）

纯浏览器端的修复前后壁画对照核验工具：左「修复前」、右「修复后」，竖直分界擦镜比对。
**不上传任何文件、不访问任何在线服务**——图像仅通过 `File` + `createImageBitmap` 在本地解码，
经 Canvas 2D 渲染。

## 功能要点

- **本地文件**：仅接受 PNG / JPEG（按文件头魔数嗅探，伪装扩展名也会被拒）。
- **尺寸强约束**：两图以天然像素宽高为准，必须完全相同，否则拒绝并提示期望/实际尺寸。
- **共享视口**：两图共用同一原图坐标视口（中心 + 倍率），逐点对齐。
- **倍率 1× / 2× / 4×**：切换时视口中心对应的原图坐标保持不变。
- **平移钳制**：按住空格拖动或滚轮平移；各轴独立钳制，画布不露空白；
  图像小于视口的轴固定居中。
- **分界**：指针拖动，位置取相对画布左边缘的 CSS 像素四舍五入为整数，
  钳制到 `[0, 画布CSS宽度]`；`←`/`→` 每次移动 1 px；拖到边缘即只剩对应单图。
- **像素取样**：发现疑似补色时开启「像素取样」，点击画布即在该 CSS 位置
  按当前倍率与视口反算为**同一原图整数坐标**，读取修复前后两组 RGBA、各通道绝对差
  及坐标，并在画布标出取样点（黄黑十字圆环）。取样状态（模式/取样点/结果）由
  App 统一持有；坐标换算、留白判定与差值均为纯函数。取样模式下普通左键不移动分界，
  空格或中键平移仍可用；退出模式后原有拖动、方向键、缩放与文件替换行为不变。
  缩放/平移只移动标记的屏幕位置，不改变其原图坐标。
  - 点击落在小图居中产生的画布留白：提示「此处无图像像素」并保留上一次有效结果；
  - 点击落在图像矩形右/下边缘内侧：取整越出边界的坐标钳回末列/末行像素；
  - 退出取样模式即隐藏画布标记与状态栏取样反馈，取样点状态保留；
  - 载入新的有效同尺寸单侧图后按原坐标重新取样；坐标越界则清除结果并说明原因；
  - 文件校验失败仍保留影像、视口与取样。
- **状态栏**：实时显示倍率、分界像素、视口中心原图坐标；取样模式下承接取样
  坐标、两组 RGBA、通道差与留白/越界反馈。
- **错误隔离**：损坏 / 非目标格式 / 异尺寸的新文件会指明原因，
  上一组有效影像与视口完整保留。

## 技术栈

TypeScript · React 18 · Vite · Canvas 2D · Vitest · Playwright · Docker Compose

## 本地开发

```bash
npm install
npm run dev        # http://localhost:5173
```

## 测试与验收

```bash
npm run test:unit  # Vitest：视口坐标/分界、取样取整/留白/通道差
npm run test:e2e   # Playwright：载入与交互、取样显示与标记（自动生成 PNG 夹具）
npm run verify     # 一次性验收：单测 + 构建 + e2e
```

## Docker

```bash
# 启动 Web（默认宿主端口 8080，WEB_PORT 可覆盖）
WEB_PORT=9000 docker compose up --build web

# 一次性验收服务：构建 web + verify，跑完单测/构建/e2e 即退出并回传退出码
docker compose up --build --exit-code-from verify verify
# 或分步：docker compose run --rm verify
```

`verify` 服务在容器内执行 `npm run verify`，e2e 通过 `PLAYWRIGHT_BASE_URL=http://web:80`
打向 `web` 服务（nginx 托管的静态产物）。

## 坐标模型（src/core/viewport.ts）

- 视口状态 = 中心的**原图坐标** `(cx, cy)` + 倍率 `z ∈ {1,2,4}`；
  视口覆盖 `canvasCss / z` 原图像素。
- 单轴钳制：图像大于视口时 `c ∈ [view/2, image − view/2]`；否则固定为 `image/2`（居中）。
- 平移把 CSS 像素位移除以倍率换算为原图坐标位移后再钳制。
- 分界像素：`round(pointerX − canvasLeft)` 钳到 `[0, round(canvasCssWidth)]`。
- `computeBlit` 输出 `drawImage` 的源/目标矩形：源越界部分裁掉并同步收缩目标，
  保证大图像轴无空白、小图像轴居中。

以上全部为纯函数，由 Vitest 单测覆盖边界。

## 像素取样（src/core/sample.ts）

- CSS → 原图：`image = css/z + center − canvas/(2z)`，`Math.round` 取整为整数坐标；
  其逆映射 `samplePointToCss` 用于标记屏幕定位，故缩放/平移只移动标记、不改坐标。
- 留白判定复用 `computeBlit`：CSS 点不在 blit 目标矩形内即为小图居中留白，
  返回 `blank`（无坐标）；矩形内取整越出右/下边缘的坐标钳回末列/末行；
  整数点越过 `[0,W)×[0,H)` 的 `out` 仅作影像替换等情形的防御判定。
- 通道差 = 修复前后 RGBA 各分量绝对差。
- App 持有模式开关 / 取样点 / 结果；`CompareCanvas` 只负责模式化指针交互、
  从 ImageBitmap 读像素与标记绘制；载入同尺寸单侧图后按原坐标自动重新取样。

全部换算/判定/差值均为纯函数，由 `tests/sample.test.ts` 覆盖边界。

## 目录结构

```
src/core/viewport.ts      视口/分界坐标纯函数
src/core/sample.ts        取样坐标换算、留白/越界判定、通道差纯函数
src/core/loadImage.ts     魔数嗅探 + 解码校验
src/components/CompareCanvas.tsx  Canvas 渲染、模式化指针交互、像素读取与标记
src/App.tsx               影像状态机、视口/取样状态、状态栏
tests/viewport.test.ts    视口 Vitest 单测
tests/sample.test.ts      取样 Vitest 单测
e2e/compare.spec.ts       Playwright 端到端
scripts/make-fixtures.mjs 纯 Node PNG 夹具生成器
Dockerfile                deps → build → web(nginx) / verify
docker-compose.yml        web（WEB_PORT 可覆盖）+ verify（一次性验收）
```
