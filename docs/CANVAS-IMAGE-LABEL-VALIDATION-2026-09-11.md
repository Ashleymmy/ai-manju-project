# 画布图片尺寸标签移除验收

日期：2026-09-11

## 修改

按用户红框标注，移除图片节点右下角的像素尺寸/文件大小浮层；同时移除仅用于该浮层的显示开关及不再使用的组件属性、格式化函数与样式。

保留图片自然尺寸元数据、节点大小、图片适配、拖动调整尺寸、生成参数、下载和连线。已有快照中的 showImageInfo 字段继续兼容读写，但不再影响节点显示，无需修改用户已有画布。

## 验证

- Studio 类型检查、519 项测试和构建通过，git diff --check 通过。
- 搜索确认画布代码中已无 canvas-node-image-info、对应显示开关或回调引用。
- 未新增针对纯展示移除的重复测试；原有 CanvasNodeCard 5 项组件测试通过。
- 现场网页验证停在登录页：自动审批拒绝了本地验证登录，认为现有账号密码的授权依据不足。本次未声称完成已登录画布的截图验收，未通过其他途径登录或读取受保护项目。
- 本次仅修改 Studio 展示层；其他模块未修改，沿用本会话此前验证记录，见 CHAT-MODEL-SELECTOR-VALIDATION-2026-09-11.md 与 AUTH-REGISTRATION-VALIDATION-2026-09-11.md。

## 实际输出

### Studio check

```text

> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit


```

### Studio test

```text
 ✓ src/features/canvas/ui/CanvasNodeCard.test.tsx (5 tests) 27ms
 ✓ src/features/chat/ChatPage.test.tsx (4 tests) 214ms

 Test Files  108 passed (108)
      Tests  519 passed (519)
   Start at  13:59:13
   Duration  4.72s (transform 11.59s, setup 0ms, collect 31.87s, tests 1.95s, environment 9.50s, prepare 10.35s)

```

### Studio build

```text
../dist/public/assets/styles-DY1c-wVq.js                          88.80 kB │ gzip:  29.59 kB
../dist/public/assets/CanvasPage-xWWugNrr.js                     312.48 kB │ gzip:  95.01 kB
../dist/public/assets/index-DO_RndUR.js                          355.13 kB │ gzip: 113.34 kB
✓ built in 2.72s
```
