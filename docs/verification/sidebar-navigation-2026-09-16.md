# 左侧导航显示异常修复验证（2026-09-16）

## 原因与修复

`LineNav` 原先在每次 pointermove 时取消并重新排入动画，同时使用 `performance.now()` 重置计时。RAF 回调时间可能早于该时间，产生负时间差，缓动系数和 `--effect` 随之越界；CSS 将越界值用于横线宽度、文字位移和颜色透明度，造成截图中的异常长线与文字消失。

- 保持单个 RAF 循环，统一使用 RAF 时间；限制时间步长及动画数值范围。
- CSS 再次约束效果值，保持现有导航风格。
- 使用元素视口坐标计算鼠标距离，修复滚动后坐标错位。
- 路由切换、分组展开变化、滚动、窗口失焦及页面可见性变化时清理过期动画。
- 新增回归测试覆盖负时间差、卡顿、快速鼠标事件、无效历史值、路由切换、滚动、目标分组展开和组件卸载。

## 实际验证结果

Studio 使用仓库内 pnpm 10.34.5 运行 check / test / build：

```text
> tsc --noEmit
exit_code: 0

Test Files  128 passed (128)
     Tests  700 passed (700)

✓ 2065 modules transformed.
✓ built in 2.82s
exit_code: 0
```

首次组件测试使用了距离行中心 20px 的指针坐标，却断言应接近完全悬停值。将输入修正为真实行中心后全量通过，没有放宽生产逻辑或断言。

构建首次因 pnpm 缓存目录权限失败，经授权重跑成功。导演台构建保留既有大文件体积警告。

Canvas Agent：

```text
ℹ tests 4
ℹ pass 4
ℹ fail 0
```

Director Desk：

```text
Test Files  87 passed (87)
     Tests  686 passed (686)
```

`git diff --check` 退出 0；仅提示此前其他文件的 CRLF 转换。

## 验证限制

- 浏览器已打开 `http://localhost:3100/`，页面显示“登录”“登录后查看模型”。该会话未登录，未完成登录后侧栏的视觉验收；交互回归由真实 React 组件的 jsdom 测试完成。
- 尝试后端验证，但当前环境找不到 Go 或 Docker 命令，因此未完成本轮后端 build / vet / test。
- 使用内置 Python 执行 Worker compileall 成功；unittest 输出 `Ran 20 tests`、`FAILED (errors=10, skipped=1)`。环境缺少 psycopg、billiard、httpx、celery、requests 等依赖，另有 Windows 不支持 SIGKILL 的错误。本次未修改后端或 Worker。

本次未提交或推送，保留工作区此前其他功能的改动。
