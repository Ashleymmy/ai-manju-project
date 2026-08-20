@SETLOCAL
@IF NOT DEFINED NODE_PATH (
  @SET "NODE_PATH=D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\autoprefixer@10.5.4_postcss@8.5.15\node_modules\autoprefixer\bin\node_modules;D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\autoprefixer@10.5.4_postcss@8.5.15\node_modules\autoprefixer\node_modules;D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\autoprefixer@10.5.4_postcss@8.5.15\node_modules;D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\node_modules"
) ELSE (
  @SET "NODE_PATH=D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\autoprefixer@10.5.4_postcss@8.5.15\node_modules\autoprefixer\bin\node_modules;D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\autoprefixer@10.5.4_postcss@8.5.15\node_modules\autoprefixer\node_modules;D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\autoprefixer@10.5.4_postcss@8.5.15\node_modules;D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\node_modules;%NODE_PATH%"
)
@IF EXIST "%~dp0\node.exe" (
  "%~dp0\node.exe"  "%~dp0\..\autoprefixer\bin\autoprefixer" %*
) ELSE (
  @SET PATHEXT=%PATHEXT:;.JS;=;%
  node  "%~dp0\..\autoprefixer\bin\autoprefixer" %*
)
