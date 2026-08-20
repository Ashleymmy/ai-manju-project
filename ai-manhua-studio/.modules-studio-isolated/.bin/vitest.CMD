@SETLOCAL
@IF NOT DEFINED NODE_PATH (
  @SET "NODE_PATH=D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\vitest@2.1.9_@types+node@24.13.3_jsdom@29.1.1_lightningcss@1.32.0\node_modules\vitest\node_modules;D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\vitest@2.1.9_@types+node@24.13.3_jsdom@29.1.1_lightningcss@1.32.0\node_modules;D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\node_modules"
) ELSE (
  @SET "NODE_PATH=D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\vitest@2.1.9_@types+node@24.13.3_jsdom@29.1.1_lightningcss@1.32.0\node_modules\vitest\node_modules;D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\vitest@2.1.9_@types+node@24.13.3_jsdom@29.1.1_lightningcss@1.32.0\node_modules;D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\node_modules;%NODE_PATH%"
)
@IF EXIST "%~dp0\node.exe" (
  "%~dp0\node.exe"  "%~dp0\..\vitest\vitest.mjs" %*
) ELSE (
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node  "%~dp0\..\vitest\vitest.mjs" %*
)
