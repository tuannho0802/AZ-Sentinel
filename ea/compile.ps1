<#
  Compile an MQL5 file with the MetaEditor command line and print the log.
  Used by the VS Code tasks in .vscode/tasks.json (Ctrl+Shift+B).

  powershell -NoProfile -File ea/compile.ps1 -Source ea/AZ_Spike.mq5 [-MetaEditor <exe>] [-Include <MQL5 dir>] [-Syntax]

  MetaEditor path is looked up in this order:
    1. -MetaEditor parameter
    2. env MT5_METAEDITOR
    3. VS Code user setting mql_tools.Metaeditor.Metaeditor5Dir
    4. metaeditor64.exe in C:\Program Files\*\ (and Program Files (x86))
#>
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [string]$MetaEditor = '',
  [string]$Include = '',
  [switch]$Syntax
)
$ErrorActionPreference = 'Stop'

function Resolve-Exe([string]$p) {
  if (-not $p) { return $null }
  if (Test-Path -LiteralPath $p -PathType Container) { $p = Join-Path $p 'metaeditor64.exe' }
  if (Test-Path -LiteralPath $p -PathType Leaf) { return $p }
  return $null
}

function Read-VsCodeSetting([string]$name) {
  foreach ($dir in @('Code', 'Code - Insiders', 'VSCodium')) {
    $f = Join-Path $env:APPDATA "$dir\User\settings.json"
    if (Test-Path -LiteralPath $f) {
      $txt = Get-Content -LiteralPath $f -Raw
      $m = [regex]::Match($txt, '"' + [regex]::Escape($name) + '"\s*:\s*"((?:[^"\\]|\\.)*)"')
      if ($m.Success) { return ($m.Groups[1].Value -replace '\\\\', '\') }
    }
  }
  return $null
}

function Find-MetaEditor([string]$hint) {
  $found = Resolve-Exe $hint
  if ($found) { return $found }
  $found = Resolve-Exe $env:MT5_METAEDITOR
  if ($found) { return $found }
  $found = Resolve-Exe (Read-VsCodeSetting 'mql_tools.Metaeditor.Metaeditor5Dir')
  if ($found) { return $found }
  foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if (-not $root) { continue }
    foreach ($d in (Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue)) {
      $found = Resolve-Exe (Join-Path $d.FullName 'metaeditor64.exe')
      if ($found) { return $found }
    }
  }
  return $null
}

if (-not $Include) { $Include = Read-VsCodeSetting 'mql_tools.Metaeditor.Include5Dir' }

$src = (Resolve-Path -LiteralPath $Source).Path
$me = Find-MetaEditor $MetaEditor
if (-not $me) {
  Write-Host 'ERROR: MetaEditor not found. Set env MT5_METAEDITOR or VS Code setting mql_tools.Metaeditor.Metaeditor5Dir.'
  exit 2
}

$log = [System.IO.Path]::ChangeExtension($src, '.compile.log')
Remove-Item -LiteralPath $log -ErrorAction SilentlyContinue

# Start-Process keeps the embedded quotes, so paths with spaces ("D:\Du An Az") are safe.
$meArgs = @("/compile:`"$src`"", "/log:`"$log`"")
if ($Include) { $meArgs += "/include:`"$Include`"" }
if ($Syntax) { $meArgs += '/s' }

Write-Host "MetaEditor: $me"
Write-Host "Source:     $src"
$proc = Start-Process -FilePath $me -ArgumentList $meArgs -Wait -PassThru -NoNewWindow

if (-not (Test-Path -LiteralPath $log)) {
  Write-Host "ERROR: MetaEditor produced no log (exit code $($proc.ExitCode))."
  exit 3
}

$lines = Get-Content -LiteralPath $log -Encoding Unicode
$lines | ForEach-Object { Write-Host $_ }

$m = [regex]::Match(($lines -join "`n"), 'Result:\s*(\d+)\s+errors?,\s*(\d+)\s+warnings?')
if (-not $m.Success) {
  Write-Host 'ERROR: no "Result:" line in the log.'
  exit 4
}
if ([int]$m.Groups[1].Value -gt 0) { exit 1 }
exit 0
