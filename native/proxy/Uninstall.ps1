param([string]$Installation = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$targetPath = [IO.Path]::GetFullPath($Installation)
$allowedRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Detect.Expert\ProxyCompanion'))
if (-not $targetPath.StartsWith($allowedRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Installation must be inside the current user ProxyCompanion directory.' }
foreach ($product in @('Google\Chrome','Chromium','Microsoft\Edge','Mozilla')) {
  $key = 'HKCU:\Software\' + $product + '\NativeMessagingHosts\com.detect_expert.proxy'
  if (Test-Path -LiteralPath $key) {
    $registered = (Get-Item -LiteralPath $key).GetValue('')
    if ($registered -in @((Join-Path $targetPath 'native-host.chrome.json'), (Join-Path $targetPath 'native-host.firefox.json'))) { Remove-Item -LiteralPath $key }
  }
}
Write-Output 'Native host registrations belonging to this installation were removed. Encrypted profiles were retained.'
