# 图片详情预览分辨率验收

日期：2026-09-11

## 修改

在画布双击图片打开的详情预览中，右侧“宽高比”之后、“文件大小”之前增加“分辨率”，显示格式为 `宽 × 高 px`。

数值直接读取当前主预览图片解码后的 naturalWidth / naturalHeight。不使用画布节点宽高、CSS 显示尺寸、生成参数或者可能过期的 metadata.naturalWidth / naturalHeight。读取过程不修改节点或服务端快照。

图片尚未加载、加载失败或尺寸无效时显示“—”；缓存命中也会读取尺寸。结果同时关联节点 ID 和图片源，更换节点或替换同一节点的图片时先清除旧显示，已离开的图片加载事件不能覆盖当前结果。

## 验证

新增 5 项测试通过：

- 真实解码尺寸覆盖陈旧元数据，分辨率位于文件大小上一行。
- 切换到其他图片时不显示上一张尺寸，忽略上一张的迟到事件。
- 同一节点替换图片时重新读取，不沿用旧尺寸。
- 缓存图片无需等待另一次 load 事件即可正确显示。
- 读取失败或解码宽高为 0 时不编造分辨率。

实际浏览器验收使用无需登录的临时页面，直接加载生产组件 CanvasImagePreviewDialog 及项目样式，并使用两张本地生成的 PNG：640×960、1280×720。测试节点的画布尺寸都为 320×238，故意填写的尺寸元数据为 9999×9999。

- 竖图实际图片宽高为 640×960，侧栏显示“640 × 960 px”，位置在文件大小上一行；已检查截图。
- 点击“下一张”后，侧栏正确更新为“1280 × 720 px”。
- 临时页面与图片仅用于组件验收；未登录或访问用户受保护的项目数据。验收后已关闭页面并删除临时文件。

Studio 类型检查、全部 524 项测试、构建和 git diff --check 通过。本次仅修改 Studio，其他模块沿用本会话此前已完成的验证，见 AUTH-REGISTRATION-VALIDATION-2026-09-11.md 与 CHAT-MODEL-SELECTOR-VALIDATION-2026-09-11.md。

## 实际输出

### 分辨率定向测试

```text

 RUN  v2.1.9 D:/AImanju4.0/apps/studio/client

 ✓ src/features/canvas/ui/CanvasPreviewDialogs.test.tsx (5 tests) 167ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  14:13:30
   Duration  1.38s (transform 220ms, setup 0ms, collect 456ms, tests 167ms, environment 487ms, prepare 79ms)

```

### Studio check

```text

> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit


```

### Studio test

```text
 ✓ src/features/canvas/ui/CanvasPreviewDialogs.test.tsx (5 tests) 174ms
 ✓ src/features/chat/ChatPage.test.tsx (4 tests) 218ms

 Test Files  109 passed (109)
      Tests  524 passed (524)
   Start at  14:14:10
   Duration  4.42s (transform 10.84s, setup 0ms, collect 30.68s, tests 2.18s, environment 10.54s, prepare 11.05s)

```

### Studio build

```text
../dist/public/assets/styles-DbY4D-ol.js                          88.80 kB │ gzip:  29.58 kB
../dist/public/assets/CanvasPage-C-M4CXHK.js                     312.48 kB │ gzip:  95.00 kB
../dist/public/assets/index-WBT4dw5b.js                          355.13 kB │ gzip: 113.34 kB
✓ built in 2.69s
```
