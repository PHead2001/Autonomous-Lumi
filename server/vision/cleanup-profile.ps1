param([Parameter(Mandatory=$true)][string]$Profile)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
# WQL LIKE metacharacters are bracket-escaped before WQL string escaping.
# Keep the local exact-argument check: this is only a candidate reduction.
$pattern = $Profile.Replace('[', '[[]').Replace('%', '[%]').Replace('_', '[_]')
$pattern = $pattern.Replace('\', '\\').Replace("'", "\'")
$rows = @(Get-CimInstance Win32_Process -Property ProcessId, CommandLine -Filter "CommandLine LIKE '%$pattern%'" | Where-Object {
  $null -ne $_.CommandLine -and $_.CommandLine.IndexOf($Profile, [StringComparison]::OrdinalIgnoreCase) -ge 0
} | ForEach-Object {
  @{ processId = [int]$_.ProcessId; commandLine = [string]$_.CommandLine }
})
ConvertTo-Json -InputObject $rows -Compress -Depth 3
