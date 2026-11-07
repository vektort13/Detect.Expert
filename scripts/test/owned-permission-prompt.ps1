param([Parameter(Mandatory=$true)][string]$OwnedProfileRoot)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$resolvedRoot = [IO.Path]::GetFullPath($OwnedProfileRoot)
if ($resolvedRoot -notmatch '\\.tmp\\precursor-modes-native-[A-Za-z0-9]+$') { throw 'Unexpected owned test profile' }
$ownedProcesses = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -and $_.CommandLine.Contains($resolvedRoot) } | ForEach-Object { [int]$_.ProcessId })
if ($ownedProcesses.Count -eq 0) { throw 'Owned test browser not found' }
$deadline = [DateTime]::UtcNow.AddSeconds(25)
do {
  foreach ($ownedProcessId in $ownedProcesses) {
    $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ownedProcessId)
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
    foreach ($window in $windows) {
      $buttons = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button))
      foreach ($button in $buttons) {
        if ($button.Current.Name -match '^(Allow|Add permissions|Разрешить)$' -and $button.Current.IsEnabled) {
          $pattern = $null
          if ($button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
            $pattern.Invoke()
            '{"invoked":true}'
            exit 0
          }
        }
      }
    }
  }
  Start-Sleep -Milliseconds 150
} while ([DateTime]::UtcNow -lt $deadline)
'{"invoked":false}'
exit 1
