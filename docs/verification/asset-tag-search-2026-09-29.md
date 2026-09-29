# 资产库分类标签搜索框修复

日期：2026-09-29。未提交、未部署。

## 问题与修改

浏览器复现了用户截图：200px 的搜索容器中，输入区域只有 128 × 19.5px；`input:focus-visible` 单独绘制了 2px 青色描边，看起来像外框中嵌了一个小框。

本次仅修改 AssetTagFilter.css 和 AssetTagFilter.tsx：

- 内部输入框不再绘制边框、阴影或聚焦轮廓，统一由外部搜索容器的 `:focus-within` 显示聚焦反馈。
- 搜索框宽度调整为 240px，保持 34px 控件高度和既有轻微圆角；窄屏仍按原规则占满可用宽度。
- 输入区填满容器内高并自动占据剩余宽度。
- 清空按钮预留固定空间，空文本时隐藏并禁用，不进入键盘导航；输入文字后显示，避免文字区域宽度跳动。
- 清空搜索后焦点返回输入框，便于继续输入。
- 保留上一轮组件四边框与 15px 标题，未改动筛选逻辑或其他页面。

## 实际页面验证

页面：`http://localhost:3100/assets`，使用已有登录会话。

输入 `1` 后，结果正确显示“测试1”；内部输入区实测为 168 × 32px，outline 样式为 none，box-shadow 为 none，240 × 34px 外框统一高亮。

点击清空后：

- 输入值为空，恢复 7 个一级标签；
- 输入区仍为 168 × 32px，外框仍为 240 × 34px，位置和尺寸均不跳动；
- 清空按钮隐藏且禁用，焦点仍在输入框。

证据：`output/asset-tag-search/focused.png`、`output/asset-tag-search/verification.json`。浏览器验证结束后清空了临时搜索词。

## 检查与实际输出

日志目录：`.tmp/asset-tag-search-20260929/`。局部样式调整未增加测试，执行现有完整检查。

Studio check / test / build 全部退出 0：

```text
> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit

Test Files  262 passed (262)
     Tests  2070 passed (2070)
  Duration  21.48s

✓ built in 10.73s
```

构建保留已有大于 500kB 的 chunk 提示。

API build / vet / test 退出 0，build/vet 无输出，测试输出节选：

```text
go-build=0 go-vet=0 go-test=0
ok  github.com/ai-manju/api/internal/sdvideo (cached)
ok  github.com/ai-manju/api/internal/service (cached)
ok  github.com/ai-manju/api/internal/storage (cached)
ok  github.com/ai-manju/api/internal/tagmigration (cached)
```

Canvas Agent 测试通过：

```text
ℹ tests 5
ℹ pass 5
ℹ fail 0
ℹ duration_ms 172.9223
```

Director Desk 测试退出 0：

```text
Test Files  87 passed (87)
     Tests  689 passed (689)
  Duration  115.99s
```

Worker 使用已有镜像，只读挂载当前源码、关闭网络，compileall 和 unittest 退出 0：

```text
Ran 275 tests in 5.828s
OK (skipped=27)
```

`git diff --check` 通过，无输出。
