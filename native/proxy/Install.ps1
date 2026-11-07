param(
  [ValidatePattern('^[a-p]{32}$')][string]$ChromeExtensionId = '',
  [ValidatePattern('^[A-Za-z0-9@._{}-]{1,128}$')][string]$FirefoxExtensionId = 'detect.expert@detect.expert',
  [string]$Destination = ''
)
$ErrorActionPreference = 'Stop'
$sourcePath = [IO.Path]::GetFullPath($PSScriptRoot)
$manifestFile = Join-Path $sourcePath 'companion.json'
if ($Destination -eq '') {
  $packageStamp = (Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash.Substring(0,12).ToLowerInvariant()
  $callerHasher = [Security.Cryptography.SHA256]::Create()
  try { $callerStamp = [BitConverter]::ToString($callerHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($ChromeExtensionId + '|' + $FirefoxExtensionId))).Replace('-','').Substring(0,12).ToLowerInvariant() }
  finally { $callerHasher.Dispose() }
  $Destination = Join-Path $env:LOCALAPPDATA ('Detect.Expert\ProxyCompanion\1.1.0-' + $packageStamp + '-' + $callerStamp)
}
$targetPath = [IO.Path]::GetFullPath($Destination)
$allowedRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Detect.Expert\ProxyCompanion'))
if (-not $targetPath.StartsWith($allowedRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Destination must be inside the current user ProxyCompanion directory.' }
if ($sourcePath -eq $targetPath) { throw 'Extract the package outside the installation directory first.' }
$package = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
foreach ($file in $package.files) {
  $sourceFile = [IO.Path]::GetFullPath((Join-Path $sourcePath $file.path))
  if (-not $sourceFile.StartsWith($sourcePath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid package file path.' }
  if ((Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw ('Package checksum mismatch: ' + $file.path) }
}
New-Item -ItemType Directory -Path $targetPath -Force | Out-Null
foreach ($file in $package.files) {
  $targetFile = [IO.Path]::GetFullPath((Join-Path $targetPath $file.path))
  if (-not $targetFile.StartsWith($targetPath + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid target file path.' }
  New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($targetFile)) -Force | Out-Null
  if (-not (Test-Path -LiteralPath $targetFile) -or (Get-FileHash -LiteralPath $targetFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) {
    Copy-Item -LiteralPath (Join-Path $sourcePath $file.path) -Destination $targetFile -Force
  }
}
Copy-Item -LiteralPath (Join-Path $sourcePath 'companion.json') -Destination (Join-Path $targetPath 'companion.json') -Force
$utf8 = New-Object Text.UTF8Encoding($false)
$callers = @($FirefoxExtensionId)
if ($ChromeExtensionId -ne '') { $callers = @(('chrome-extension://' + $ChromeExtensionId + '/'), $FirefoxExtensionId) }
[IO.File]::WriteAllText((Join-Path $targetPath 'allowed-callers.json'), (ConvertTo-Json -InputObject $callers), $utf8)
$executable = Join-Path $targetPath 'detect-expert-proxy.exe'
$chrome = @{ name='com.detect_expert.proxy'; description='Detect Expert Proxy Companion'; path=$executable; type='stdio'; allowed_origins=@('chrome-extension://' + $ChromeExtensionId + '/') }
$firefox = @{ name='com.detect_expert.proxy'; description='Detect Expert Proxy Companion'; path=$executable; type='stdio'; allowed_extensions=@($FirefoxExtensionId) }
$chromeManifest = Join-Path $targetPath 'native-host.chrome.json'
$firefoxManifest = Join-Path $targetPath 'native-host.firefox.json'
if ($ChromeExtensionId -ne '') { [IO.File]::WriteAllText($chromeManifest, ($chrome | ConvertTo-Json -Depth 6), $utf8) }
[IO.File]::WriteAllText($firefoxManifest, ($firefox | ConvertTo-Json -Depth 6), $utf8)
if ($ChromeExtensionId -ne '') {
  foreach ($product in @('Google\Chrome','Chromium','Microsoft\Edge')) {
    $key = 'HKCU:\Software\' + $product + '\NativeMessagingHosts\com.detect_expert.proxy'
    New-Item -Path $key -Force | Out-Null
    Set-Item -LiteralPath $key -Value $chromeManifest
  }
}
$gecko = 'HKCU:\Software\Mozilla\NativeMessagingHosts\com.detect_expert.proxy'
New-Item -Path $gecko -Force | Out-Null
Set-Item -LiteralPath $gecko -Value $firefoxManifest
Write-Output ('Installed Detect Expert Proxy Companion: ' + $targetPath)
Write-Output 'Browser proxy settings, system routes and services were not changed.'
