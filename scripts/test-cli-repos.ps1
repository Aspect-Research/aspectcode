<#
.SYNOPSIS
  Run CLI tests against real open-source repos.

.DESCRIPTION
  Clones repos from scripts/test-repos.json and exercises the
  single-command CLI pipeline against each one. Validates that
  aspectcode --once produces AGENTS.md successfully.

.PARAMETER SkipBuild
  Skip the workspace build step.

.PARAMETER SkipCleanup
  Keep cloned repos after testing.

.PARAMETER RepoFilter
  Optional: only test repos whose name matches this filter.

.EXAMPLE
  .\scripts\test-cli-repos.ps1 -SkipBuild
  .\scripts\test-cli-repos.ps1 -SkipBuild -RepoFilter flask
#>
param(
  [switch]$SkipBuild,
  [switch]$SkipCleanup,
  [string]$RepoFilter
)

$ErrorActionPreference = 'Stop'

# ── Helpers ───────────────────────────────────────────────────────────
function Write-Step {
  param([string]$Message)
  Write-Host "`n=== $Message ===" -ForegroundColor Cyan
}

function Invoke-Step {
  param(
    [string]$Name,
    [scriptblock]$Action
  )

  Write-Step $Name
  $start = Get-Date
  try {
    & $Action | Out-Null
    $elapsed = (Get-Date) - $start
    Write-Host "PASS: $Name ($([math]::Round($elapsed.TotalSeconds, 1))s)" -ForegroundColor Green
    return [pscustomobject]@{ Name = $Name; Status = 'PASS'; Seconds = [math]::Round($elapsed.TotalSeconds, 1) }
  } catch {
    $elapsed = (Get-Date) - $start
    Write-Host "FAIL: $Name ($([math]::Round($elapsed.TotalSeconds, 1))s)" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor DarkRed
    return [pscustomobject]@{ Name = $Name; Status = 'FAIL'; Seconds = [math]::Round($elapsed.TotalSeconds, 1) }
  }
}

# ── Paths ─────────────────────────────────────────────────────────────
$repoRoot   = Resolve-Path (Join-Path $PSScriptRoot '..')
$cliBin     = Join-Path $repoRoot 'packages\cli\bin\aspectcode.js'
$reposJson  = Join-Path $PSScriptRoot 'test-repos.json'
$cloneBase  = Join-Path ([System.IO.Path]::GetTempPath()) "aspectcode-repos-$([guid]::NewGuid().ToString('N').Substring(0,8))"

Write-Host "Aspect Code - Multi-Repo CLI Test" -ForegroundColor White
Write-Host "Repo:   $repoRoot" -ForegroundColor Gray
Write-Host "Clones: $cloneBase" -ForegroundColor Gray

$results = New-Object System.Collections.ArrayList

# ── Build (optional) ─────────────────────────────────────────────────
if (-not $SkipBuild) {
  [void]$results.Add((Invoke-Step -Name 'Build all workspaces' -Action {
    Push-Location $repoRoot
    try {
      & npm run build --workspaces 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
    } finally { Pop-Location }
  }))
}

# ── Load repo list ───────────────────────────────────────────────────
$repos = Get-Content $reposJson -Raw | ConvertFrom-Json
New-Item -Path $cloneBase -ItemType Directory -Force | Out-Null

foreach ($repo in $repos) {
  $name = $repo.name
  if ($RepoFilter -and $name -notlike "*${RepoFilter}*") {
    Write-Host "Skipping $name (filter: $RepoFilter)" -ForegroundColor DarkGray
    continue
  }

  $cloneDir = Join-Path $cloneBase $name

  # Clone (shallow)
  [void]$results.Add((Invoke-Step -Name "Clone $name" -Action {
    & git clone --depth 1 $repo.url $cloneDir 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "git clone failed for $name" }
  }))

  # ── Test: --help ────────────────────────────────────────────
  [void]$results.Add((Invoke-Step -Name "$name`: --help" -Action {
    & node $cliBin --help | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '--help failed' }
  }))

  # ── Test: --once (default) ─────────────────────────────────
  [void]$results.Add((Invoke-Step -Name "$name`: --once" -Action {
    & node $cliBin --once --root $cloneDir --quiet
    if ($LASTEXITCODE -ne 0) { throw '--once failed' }
    $agentsFile = Join-Path $cloneDir 'AGENTS.md'
    if (-not (Test-Path $agentsFile)) {
      throw "AGENTS.md not created for $name"
    }
  }))

  # ── Test: --once --kb ──────────────────────────────────────
  [void]$results.Add((Invoke-Step -Name "$name`: --once --kb" -Action {
    & node $cliBin --once --kb --root $cloneDir --quiet
    if ($LASTEXITCODE -ne 0) { throw '--once --kb failed' }
    $kbFile = Join-Path $cloneDir 'kb.md'
    if (-not (Test-Path $kbFile)) {
      throw "kb.md not created for $name"
    }
  }))

  # ── Test: --once --dry-run ─────────────────────────────────
  [void]$results.Add((Invoke-Step -Name "$name`: --once --dry-run" -Action {
    # Remove output first
    $agentsFile = Join-Path $cloneDir 'AGENTS.md'
    $kbFile = Join-Path $cloneDir 'kb.md'
    if (Test-Path $agentsFile) { Remove-Item $agentsFile -Force }
    if (Test-Path $kbFile) { Remove-Item $kbFile -Force }

    & node $cliBin --once --dry-run --root $cloneDir --quiet
    if ($LASTEXITCODE -ne 0) { throw '--once --dry-run failed' }

    if (Test-Path $agentsFile) {
      throw "AGENTS.md written during --dry-run for $name"
    }
  }))

  # ── Test: --no-color ───────────────────────────────────────
  [void]$results.Add((Invoke-Step -Name "$name`: --no-color" -Action {
    & node $cliBin --once --root $cloneDir --no-color --quiet 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '--no-color failed' }
  }))

  # ── Test: --verbose ────────────────────────────────────────
  [void]$results.Add((Invoke-Step -Name "$name`: --verbose" -Action {
    & node $cliBin --once --root $cloneDir --verbose 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '--verbose failed' }
  }))

  # ── Repo-root pollution check ──────────────────────────────
  [void]$results.Add((Invoke-Step -Name "$name`: repo root clean" -Action {
    $repoKb = Join-Path $repoRoot 'kb.md'
    $repoAgents = Join-Path $repoRoot 'AGENTS.md'
    if (Test-Path $repoKb) { throw "POLLUTION: kb.md at repo root after $name" }
    if (Test-Path $repoAgents) { throw "POLLUTION: AGENTS.md at repo root after $name" }
  }))
}

# ── Cleanup ───────────────────────────────────────────────────────────
if (-not $SkipCleanup) {
  Write-Step 'Cleanup cloned repos'
  if (Test-Path $cloneBase) {
    Remove-Item -Path $cloneBase -Recurse -Force
    Write-Host "  Removed $cloneBase" -ForegroundColor Gray
  }
} else {
  Write-Host "`nCloned repos kept at: $cloneBase" -ForegroundColor Yellow
}

# ── Summary ───────────────────────────────────────────────────────────
Write-Host "`n=== Summary ===" -ForegroundColor Cyan
$results | ForEach-Object {
  if ($_.Status -eq 'PASS') {
    Write-Host "PASS  $($_.Name)" -ForegroundColor Green
  } else {
    Write-Host "FAIL  $($_.Name)" -ForegroundColor Red
  }
}

$failed = @($results | Where-Object { $_.Status -eq 'FAIL' }).Count
if ($failed -gt 0) {
  Write-Host "`n$failed step(s) failed." -ForegroundColor Red
  exit 1
}

Write-Host "`nAll multi-repo CLI tests passed." -ForegroundColor Green
exit 0
