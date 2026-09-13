# 登录与普通成员注册验收

日期：2026-09-11

## 最终范围

按用户最新截图纠正范围：保留原来的全屏左右分栏、左侧品牌、标题、文案、背景、底部公告和几何装饰。已将左侧与外层样式逐项恢复为修改前版本；忽略空白后与 Git HEAD 一致。登录和注册共用相同的左侧内容，仅右侧呈现各自表单。

右侧参考图二、图三：图标和圆角输入框、独立密码显隐、记住登录和账号、浅色主按钮、注册入口或返回登录。注册提供选填用户名（显示名称）、账号、密码和确认密码。保留图一深色底和浅色按钮配色。

## 功能与配置

- 现有 /login、/register、/v2-login 路由继续可用；登录、注册之间保留安全的 next 地址。
- 注册客户端按实际接口发送 account、password、display_name、remember，接收 token 和 user 并建立会话；成功后自动进入工作台。
- 校验账号格式、密码长度和确认密码；提供中文重复账号提示、加载状态与重复提交保护。
- 注册默认不勾选记住登录。勾选时持久保存令牌与账号；不勾选时清理记忆账号，令牌使用会话存储。
- 注册关闭或健康检查失败时保留页面、说明原因并允许重新检查。
- 用户已授权普通成员自助注册。本地根目录 .env 和 apps/api/.env 的 ALLOW_PUBLIC_SIGNUP 已设为 true。
- 仅重建当前 ai-manju-40 的 API 容器使开关生效，未改动数据库容器。健康检查返回 success=true、db=ok、storage=postgres、public_signup=true。
- 后端源码、响应信封、路由和仓库实现未改动；现有注册处理程序固定创建 active/member，普通成员不能访问管理员接口。

## 实际网页验收

- 在本地浏览器打开登录页，通过“注册账号”进入注册页，再通过“返回登录”返回；next=%2Fchat 保持，密码重置为空。
- 按用户原图内容区 1920×945 核对截图，左侧宽度 1104px，右侧表单 x=1332px、宽 360px。登录、注册保持同一对齐位置，页面 scrollWidth=1920，无横向溢出。验收后恢复默认浏览器尺寸。
- 登录表单高度 452.75px；注册表单高度 632.25px，完整显示四个字段和底部返回入口。
- 实际操作确认：两次密码不同时显示字段提示；显示密码按钮只改变对应密码框类型。
- 使用已经存在的 admin 账号和测试字符串从注册表单按 Enter 提交，真实后端返回账号已被使用，页面显示中文错误并保留表单。没有创建新数据库账号。
- 注册成功建会话、自动跳转及普通成员角色由前端和后端自动测试验证；本次没有在实际数据库新增账号来执行成功注册的端到端验收。
- 此次截图验收覆盖桌面尺寸；移动端沿用原有上下布局规则，未另行进行手机截图验收。

## 实际验证输出

本阶段重新运行 Studio 类型检查、全部测试和构建，以及后端 build/vet/test。均退出 0。日志位于 .codex-logs/register-*.log。

Canvas Agent、Director Desk 和 Worker 未修改，沿用本会话已经完成的验证；原始输出见 [模型选择器验收](CHAT-MODEL-SELECTOR-VALIDATION-2026-09-11.md)：Canvas Agent 1 项通过，Director Desk 686 项通过，Worker 50 项完成（1 项跳过）。

### Studio check

```text

> ai-manhua-studio@1.0.0 check D:\AImanju4.0\apps\studio
> tsc --noEmit


```

### Studio test

```text
 ✓ src/features/auth/AuthPage.test.tsx (5 tests) 101ms
 ✓ src/components/AgentPanel.test.tsx (3 tests) 93ms
 ✓ src/features/canvas/ui/CanvasNodeCard.test.tsx (5 tests) 27ms
 ✓ src/features/chat/ChatPage.test.tsx (4 tests) 196ms

 Test Files  107 passed (107)
      Tests  515 passed (515)
   Start at  11:46:12
   Duration  4.72s (transform 11.71s, setup 0ms, collect 32.18s, tests 1.83s, environment 8.52s, prepare 10.51s)

```

### Studio build

```text
../dist/public/assets/index-DSiG_aCQ.js                           42.14 kB │ gzip:  14.27 kB
../dist/public/assets/index-VVx_ahhb.js                           46.83 kB │ gzip:  15.48 kB
../dist/public/assets/index-BFB3eBBO.js                           47.43 kB │ gzip:  13.62 kB
../dist/public/assets/index-B-hK7V51.js                           77.97 kB │ gzip:  21.57 kB
../dist/public/assets/styles-3mD3gtMb.js                          89.38 kB │ gzip:  29.77 kB
../dist/public/assets/CanvasPage-Zi3jZN-N.js                     312.76 kB │ gzip:  95.09 kB
../dist/public/assets/index-DT_2cwiy.js                          355.13 kB │ gzip: 113.36 kB
✓ built in 2.63s
```

### 后端 go build ./... && go vet ./... && go test ./...

```text
?   	github.com/ai-manju/api/cmd/asset-export-worker	[no test files]
?   	github.com/ai-manju/api/cmd/migrate-asset-library	[no test files]
?   	github.com/ai-manju/api/cmd/migrate-asset-tags	[no test files]
?   	github.com/ai-manju/api/cmd/migrate-provider-presets	[no test files]
?   	github.com/ai-manju/api/cmd/reconcile-asset-usage	[no test files]
?   	github.com/ai-manju/api/cmd/server	[no test files]
?   	github.com/ai-manju/api/internal/auth	[no test files]
?   	github.com/ai-manju/api/internal/database	[no test files]
ok  	github.com/ai-manju/api/internal/assetmigration	0.003s
ok  	github.com/ai-manju/api/internal/config	0.002s
?   	github.com/ai-manju/api/internal/model	[no test files]
?   	github.com/ai-manju/api/internal/response	[no test files]
?   	github.com/ai-manju/api/internal/storage	[no test files]
ok  	github.com/ai-manju/api/internal/handler	10.461s
ok  	github.com/ai-manju/api/internal/middleware	0.008s
ok  	github.com/ai-manju/api/internal/provider	0.009s
ok  	github.com/ai-manju/api/internal/providerpresetmigration	0.004s
ok  	github.com/ai-manju/api/internal/queue	0.003s
ok  	github.com/ai-manju/api/internal/repository	0.006s
ok  	github.com/ai-manju/api/internal/router	0.211s
ok  	github.com/ai-manju/api/internal/service	0.111s
ok  	github.com/ai-manju/api/internal/tagmigration	0.004s
```
