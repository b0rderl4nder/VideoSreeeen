param([string]$SdkRoot=$env:ANDROID_SDK_ROOT,[string]$Gradle='gradle.bat')
$ErrorActionPreference='Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $workspace
$stage = $null
$lock = $null
try {
  New-Item -ItemType Directory -Path '.local' -Force | Out-Null
  $lock = [IO.File]::Open((Join-Path $workspace '.local/release.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
  $commit = & node.exe scripts/prepare-release.mjs --preflight
  if ($LASTEXITCODE -ne 0) { throw 'Release preflight failed' }
  $stage = Join-Path $workspace ('.local/release-build-' + [guid]::NewGuid())
  New-Item -ItemType Directory -Path $stage | Out-Null
  $windows = Join-Path $stage 'windows'
  $controlled = Join-Path $PSScriptRoot 'controlled.ps1'
  & $controlled -File npm.cmd -Arguments @('run','build') -MinFreeMiB 0
  Copy-Item -LiteralPath 'artifacts/VideoSreeeen-SourceHelper.zip' -Destination $stage
  & $controlled -File npm.cmd -Arguments @('run','package:windows','--',"--config.directories.output=$windows") -MinFreeMiB 0
  & (Join-Path $PSScriptRoot 'build-android.ps1') -SdkRoot $SdkRoot -Gradle $Gradle -Release -RerunChecks -OutputDirectory $stage
  & $controlled -File node.exe -Arguments @('scripts/prepare-release.mjs',$commit,$stage) -MinFreeMiB 0
} finally {
  try {
  if ($stage -and (Test-Path -LiteralPath $stage)) {
    $expectedParent = Join-Path $workspace '.local'
    if ((Split-Path -Parent (Resolve-Path -LiteralPath $stage).Path) -ne $expectedParent) {
      throw 'Release staging directory escaped the workspace'
    }
    Remove-Item -LiteralPath $stage -Recurse -Force
  }
  } finally {
    if ($lock) { $lock.Dispose() }
    Pop-Location
  }
}
