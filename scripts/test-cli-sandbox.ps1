<#
.SYNOPSIS
  Run CLI smoke tests inside a disposable temp sandbox.

.DESCRIPTION
  Copies extension/test/fixtures/mini-repo into a temp directory, runs
  common CLI commands with --root pointed at the copy, then verifies
  output lands ONLY inside the sandbox.  Cleans up the temp directory
  on exit.

  This is the recommended way for humans and agents to manually exercise
  the CLI during development - it prevents AGENTS.md from being written
  to the repo root.

.PARAMETER SkipCleanup
  Keep the temp sandbox after the run (useful for inspecting output).

.PARAMETER SkipBuild
  Skip the workspace build step (assume packages are already compiled).

.EXAMPLE
  # Full run (build + test + cleanup)
  .\scripts\test-cli-sandbox.ps1

  # Fast run (skip build, keep sandbox for inspection)
  .\scripts\test-cli-sandbox.ps1 -SkipBuild -SkipCleanup
#>
param(
  [switch]$SkipCleanup,
  [switch]$SkipBuild
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
$fixtureDir = Join-Path $repoRoot 'extension\test\fixtures\mini-repo'

# Create temp sandbox
$sandboxRoot = Join-Path ([System.IO.Path]::GetTempPath()) "aspectcode-sandbox-$([guid]::NewGuid().ToString('N').Substring(0,8))"

Write-Host "Aspect Code - CLI Sandbox Test" -ForegroundColor White
Write-Host "Repo:    $repoRoot" -ForegroundColor Gray
Write-Host "Sandbox: $sandboxRoot" -ForegroundColor Gray

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

# ── Prepare sandbox ──────────────────────────────────────────────────
[void]$results.Add((Invoke-Step -Name 'Create sandbox from fixture' -Action {
  Copy-Item -Path $fixtureDir -Destination $sandboxRoot -Recurse -Force
  Write-Host "  Copied fixture -> $sandboxRoot" -ForegroundColor Gray
}))

# ── CLI smoke tests (all scoped to sandbox) ──────────────────────────

[void]$results.Add((Invoke-Step -Name 'CLI --help' -Action {
  & node $cliBin --help | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '--help failed' }
}))

[void]$results.Add((Invoke-Step -Name 'CLI --version' -Action {
  $ver = & node $cliBin --version 2>&1
  if ($LASTEXITCODE -ne 0) { throw '--version failed' }
  if (-not ($ver -match '^\d+\.\d+')) { throw "Unexpected version output: $ver" }
}))

[void]$results.Add((Invoke-Step -Name 'CLI --once (sandbox)' -Action {
  & node $cliBin --once --root $sandboxRoot --quiet
  if ($LASTEXITCODE -ne 0) { throw '--once failed' }
}))

[void]$results.Add((Invoke-Step -Name 'Verify AGENTS.md in sandbox' -Action {
  $agentsFile = Join-Path $sandboxRoot 'AGENTS.md'
  if (-not (Test-Path $agentsFile)) {
    throw "AGENTS.md not found in sandbox: $agentsFile"
  }
  Write-Host "  Found AGENTS.md" -ForegroundColor Gray
}))

[void]$results.Add((Invoke-Step -Name 'Verify repo root is clean' -Action {
  $repoKb = Join-Path $repoRoot 'kb.md'
  $repoAgents = Join-Path $repoRoot 'AGENTS.md'
  if (Test-Path $repoKb) {
    throw "POLLUTION: kb.md exists at repo root: $repoKb"
  }
  if (Test-Path $repoAgents) {
    throw "POLLUTION: AGENTS.md exists at repo root: $repoAgents"
  }
  Write-Host "  Repo root is clean (no kb.md, no AGENTS.md)" -ForegroundColor Gray
}))

[void]$results.Add((Invoke-Step -Name 'CLI --once --kb (sandbox)' -Action {
  & node $cliBin --once --kb --root $sandboxRoot --quiet
  if ($LASTEXITCODE -ne 0) { throw '--once --kb failed' }
  $kbFile = Join-Path $sandboxRoot 'kb.md'
  if (-not (Test-Path $kbFile)) {
    throw "kb.md not found in sandbox after --kb: $kbFile"
  }
  Write-Host "  Found kb.md" -ForegroundColor Gray
}))

[void]$results.Add((Invoke-Step -Name 'CLI --once --dry-run (sandbox)' -Action {
  # Remove output files first
  $agentsFile = Join-Path $sandboxRoot 'AGENTS.md'
  $kbFile = Join-Path $sandboxRoot 'kb.md'
  if (Test-Path $agentsFile) { Remove-Item $agentsFile -Force }
  if (Test-Path $kbFile) { Remove-Item $kbFile -Force }

  & node $cliBin --once --dry-run --root $sandboxRoot --quiet
  if ($LASTEXITCODE -ne 0) { throw '--once --dry-run failed' }

  # Dry-run should NOT write files
  if (Test-Path $agentsFile) {
    throw "AGENTS.md was written during --dry-run"
  }
  Write-Host "  No files written (correct for dry-run)" -ForegroundColor Gray
}))

[void]$results.Add((Invoke-Step -Name 'Unknown flag warning path' -Action {
  # Temporarily allow stderr so the warning doesn't become a terminating error
  $ErrorActionPreference = 'SilentlyContinue'
  & node $cliBin --once --root $sandboxRoot --bogus-flag --quiet 2>$null
  $ErrorActionPreference = 'Stop'
  # Should still succeed (unknown flags print a warning but don't error)
  if ($LASTEXITCODE -ne 0) { throw 'unknown flag path failed' }
}))

[void]$results.Add((Invoke-Step -Name 'CLI --no-color path' -Action {
  $ErrorActionPreference = 'SilentlyContinue'
  & node $cliBin --once --root $sandboxRoot --no-color --quiet 2>$null
  $ErrorActionPreference = 'Stop'
  if ($LASTEXITCODE -ne 0) { throw '--no-color path failed' }
}))

[void]$results.Add((Invoke-Step -Name 'Final repo-root cleanliness check' -Action {
  $repoKb = Join-Path $repoRoot 'kb.md'
  $repoAgents = Join-Path $repoRoot 'AGENTS.md'
  if (Test-Path $repoKb) {
    throw "POLLUTION: kb.md exists at repo root after all tests"
  }
  if (Test-Path $repoAgents) {
    throw "POLLUTION: AGENTS.md exists at repo root after all tests"
  }
  Write-Host "  Repo root still clean after all tests" -ForegroundColor Green
}))

# ── Cleanup ───────────────────────────────────────────────────────────
if (-not $SkipCleanup) {
  Write-Step 'Cleanup sandbox'
  if (Test-Path $sandboxRoot) {
    Remove-Item -Path $sandboxRoot -Recurse -Force
    Write-Host "  Removed $sandboxRoot" -ForegroundColor Gray
  }
} else {
  Write-Host "`nSandbox kept at: $sandboxRoot" -ForegroundColor Yellow
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

Write-Host "`nAll CLI sandbox tests passed." -ForegroundColor Green
exit 0
