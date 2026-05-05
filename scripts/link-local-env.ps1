param(
  [string]$TargetRoot = (Get-Location).Path,
  [string]$Source = "",
  [switch]$Force,
  [switch]$CopyFallback
)

$ErrorActionPreference = "Stop"

function Resolve-DefaultSource {
  $candidates = @(
    "C:\Users\Gzw19\onegent-integrated-20260504\.env.local",
    "C:\Users\Gzw19\onegent\.env.local"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }
  throw "No default .env.local source found. Pass -Source <path>."
}

if ([string]::IsNullOrWhiteSpace($Source)) {
  $Source = Resolve-DefaultSource
} else {
  $Source = (Resolve-Path -LiteralPath $Source).Path
}

$TargetRoot = (Resolve-Path -LiteralPath $TargetRoot).Path
$target = Join-Path $TargetRoot ".env.local"

if (!(Test-Path -LiteralPath $Source)) {
  throw "Source .env.local does not exist."
}

if (Test-Path -LiteralPath $target) {
  if (!$Force) {
    Write-Output "target_exists=true"
    Write-Output "target=$target"
    Write-Output "action=noop"
    exit 0
  }
  Remove-Item -LiteralPath $target -Force
}

try {
  New-Item -ItemType HardLink -Path $target -Target $Source | Out-Null
  Write-Output "action=hardlink"
} catch {
  if (!$CopyFallback) {
    throw
  }
  Copy-Item -LiteralPath $Source -Destination $target
  Write-Output "action=copy"
}

Write-Output "source=$Source"
Write-Output "target=$target"

$requiredNames = @(
  "POSTGRES_URL",
  "OPENAI_API_KEY",
  "OPENAI_COMPUTER_USE_MODEL",
  "OPENAI_CHAT_MODEL"
)

$names = @{}
Get-Content -LiteralPath $target | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') {
    $names[$matches[1]] = $true
  }
}

foreach ($name in $requiredNames) {
  Write-Output ("{0}=present:{1}" -f $name, [bool]$names[$name])
}
