#!/usr/bin/env pwsh
$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent

$exe=""
$pathsep=":"
$env_node_path=$env:NODE_PATH
$new_node_path="D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\autoprefixer@10.5.4_postcss@8.5.15\node_modules\autoprefixer\bin\node_modules;D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\autoprefixer@10.5.4_postcss@8.5.15\node_modules\autoprefixer\node_modules;D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\autoprefixer@10.5.4_postcss@8.5.15\node_modules;D:\ITEM\projects_no_local_deps_2026-07-01\cavans原型\ai-manju-project\.modules-studio-isolated\.pnpm\node_modules"
if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {
  # Fix case when both the Windows and Linux builds of Node
  # are installed in the same directory
  $exe=".exe"
  $pathsep=";"
} else {
  $new_node_path="/mnt/d/ITEM/projects_no_local_deps_2026-07-01/cavans原型/ai-manju-project/.modules-studio-isolated/.pnpm/autoprefixer@10.5.4_postcss@8.5.15/node_modules/autoprefixer/bin/node_modules:/mnt/d/ITEM/projects_no_local_deps_2026-07-01/cavans原型/ai-manju-project/.modules-studio-isolated/.pnpm/autoprefixer@10.5.4_postcss@8.5.15/node_modules/autoprefixer/node_modules:/mnt/d/ITEM/projects_no_local_deps_2026-07-01/cavans原型/ai-manju-project/.modules-studio-isolated/.pnpm/autoprefixer@10.5.4_postcss@8.5.15/node_modules:/mnt/d/ITEM/projects_no_local_deps_2026-07-01/cavans原型/ai-manju-project/.modules-studio-isolated/.pnpm/node_modules"
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
    $input | & "$basedir/node$exe"  "$basedir/../autoprefixer/bin/autoprefixer" $args
  } else {
    & "$basedir/node$exe"  "$basedir/../autoprefixer/bin/autoprefixer" $args
  }
  $ret=$LASTEXITCODE
} else {
  # Support pipeline input
  if ($MyInvocation.ExpectingInput) {
    $input | & "node$exe"  "$basedir/../autoprefixer/bin/autoprefixer" $args
  } else {
    & "node$exe"  "$basedir/../autoprefixer/bin/autoprefixer" $args
  }
  $ret=$LASTEXITCODE
}
$env:NODE_PATH=$env_node_path
exit $ret
