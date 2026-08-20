@SETLOCAL
@IF NOT DEFINED NODE_PATH (
  @SET "NODE_PATH=D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\vite@7.3.6_@types+node@24.13.3_jiti@2.7.0_lightningcss@1.32.0_tsx@4.23.1\node_modules\vite\bin\node_modules;D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\vite@7.3.6_@types+node@24.13.3_jiti@2.7.0_lightningcss@1.32.0_tsx@4.23.1\node_modules\vite\node_modules;D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\vite@7.3.6_@types+node@24.13.3_jiti@2.7.0_lightningcss@1.32.0_tsx@4.23.1\node_modules;D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\node_modules"
) ELSE (
  @SET "NODE_PATH=D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\vite@7.3.6_@types+node@24.13.3_jiti@2.7.0_lightningcss@1.32.0_tsx@4.23.1\node_modules\vite\bin\node_modules;D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\vite@7.3.6_@types+node@24.13.3_jiti@2.7.0_lightningcss@1.32.0_tsx@4.23.1\node_modules\vite\node_modules;D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\vite@7.3.6_@types+node@24.13.3_jiti@2.7.0_lightningcss@1.32.0_tsx@4.23.1\node_modules;D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\node_modules;%NODE_PATH%"
)
@IF EXIST "%~dp0\node.exe" (
  "%~dp0\node.exe"  "%~dp0\..\vite\bin\vite.js" %*
) ELSE (
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node  "%~dp0\..\vite\bin\vite.js" %*
)
