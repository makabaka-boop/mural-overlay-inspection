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
- **状态栏**：实时显示倍率、分界像素、视口中心原图坐标。
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
npm run test:unit  # Vitest：坐标归一化与边界（tests/viewport.test.ts）
npm run test:e2e   # Playwright：载入与交互（e2e/compare.spec.ts，自动生成 PNG 夹具）
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

## 目录结构

```
src/core/viewport.ts      视口/分界坐标纯函数
src/core/loadImage.ts     魔数嗅探 + 解码校验
src/components/CompareCanvas.tsx  Canvas 渲染与指针/键盘交互
src/App.tsx               影像状态机、视口状态、状态栏
tests/viewport.test.ts    Vitest 单测
e2e/compare.spec.ts       Playwright 端到端
scripts/make-fixtures.mjs 纯 Node PNG 夹具生成器
Dockerfile                deps → build → web(nginx) / verify
docker-compose.yml        web（WEB_PORT 可覆盖）+ verify（一次性验收）
```
