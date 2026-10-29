param([Parameter(Mandatory=$true)][string]$Profile)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$rows = @(Get-CimInstance Win32_Process | Where-Object {
  $null -ne $_.CommandLine -and $_.CommandLine.IndexOf($Profile, [StringComparison]::OrdinalIgnoreCase) -ge 0
} | ForEach-Object {
  @{ processId = [int]$_.ProcessId; commandLine = [string]$_.CommandLine }
})
ConvertTo-Json -InputObject $rows -Compress -Depth 3
