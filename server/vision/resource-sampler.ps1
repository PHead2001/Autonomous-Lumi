param([int]$RootProcessId, [string]$StopFile)
$ErrorActionPreference = 'Stop'
$deadline = [DateTime]::UtcNow.AddMinutes(4)
while (-not (Test-Path -LiteralPath $StopFile) -and [DateTime]::UtcNow -lt $deadline) {
  $processes = @(Get-CimInstance Win32_Process)
  $rows = @($processes | Where-Object { $null -ne $_.CreationDate } | ForEach-Object {
    @{ processId = [int]$_.ProcessId; parentProcessId = [int]$_.ParentProcessId; startedAt = $_.CreationDate.ToUniversalTime().ToString('o'); cpuMs = ([double]$_.KernelModeTime + [double]$_.UserModeTime) / 10000; rssBytes = [double]$_.WorkingSetSize }
  })
  @{ timestamp = [DateTime]::UtcNow.ToString('o'); samplerPid = $PID; processes = $rows } | ConvertTo-Json -Compress -Depth 4
  Start-Sleep -Milliseconds 200
}
