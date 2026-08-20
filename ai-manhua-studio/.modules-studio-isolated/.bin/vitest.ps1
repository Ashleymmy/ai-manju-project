#!/usr/bin/env pwsh
$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent

$exe=""
$pathsep=":"
$env_node_path=$env:NODE_PATH
$new_node_path="D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\vitest@2.1.9_@types+node@24.13.3_jsdom@29.1.1_lightningcss@1.32.0\node_modules\vitest\node_modules;D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\vitest@2.1.9_@types+node@24.13.3_jsdom@29.1.1_lightningcss@1.32.0\node_modules;D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\node_modules"
if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {
  # Fix case when both the Windows and Linux builds of Node
  # are installed in the same directory
  $exe=".exe"
  $pathsep=";"
} else {
  $new_node_path="/mnt/d/ITEM/projects_no_local_deps_2026-07-01/cavans原型/ai-manju-project/.modules-studio-isolated/.pnpm/vitest@2.1.9_@types+node@24.13.3_jsdom@29.1.1_lightningcss@1.32.0/node_modules/vitest/node_modules:/mnt/d/ITEM/projects_no_local_deps_2026-07-01/cavans原型/ai-manju-project/.modules-studio-isolated/.pnpm/vitest@2.1.9_@types+node@24.13.3_jsdom@29.1.1_lightningcss@1.32.0/node_modules:/mnt/d/ITEM/projects_no_local_deps_2026-07-01/cavans原型/ai-manju-project/.modules-studio-isolated/.pnpm/node_modules"
}
if ([string]::IsNullOrEmpty($env_node_path)) {
  $env:NODE_PATH=$new_node_path
} else {
  $env:NODE_PATH="$new_node_path$pathsep$env_node_path"
}

$ret=0
if (Test-Path "$basedir/node$exe") {
  # Support pipeline input
  if ($MyInvocation.ExpectingInput) {
    $input | & "$basedir/node$exe"  "$basedir/../vitest/vitest.mjs" $args
  } else {
    & "$basedir/node$exe"  "$basedir/../vitest/vitest.mjs" $args
  }
  $ret=$LASTEXITCODE
} else {
  # Support pipeline input
  if ($MyInvocation.ExpectingInput) {
    $input | & "node$exe"  "$basedir/../vitest/vitest.mjs" $args
  } else {
    & "node$exe"  "$basedir/../vitest/vitest.mjs" $args
  }
  $ret=$LASTEXITCODE
}
$env:NODE_PATH=$env_node_path
exit $ret
