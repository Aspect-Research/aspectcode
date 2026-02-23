<#
.SYNOPSIS
  Run CLI smoke tests inside a disposable temp sandbox.

.DESCRIPTION
  Copies extension/test/fixtures/mini-repo into a temp directory, runs
  common CLI commands with --root pointed at the copy, then verifies
  output lands ONLY inside the sandbox.  Cleans up the temp directory
  on exit.

  This is the recommended way for humans and agents to manually exercise
  the CLI during development - it prevents kb.md and AGENTS.md from
  being written to the repo root.

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
$sandboxOut  = Join-Path $sandboxRoot '_out'

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
  New-Item -Path $sandboxOut -ItemType Directory -Force | Out-Null
  Write-Host "  Copied fixture -> $sandboxRoot" -ForegroundColor Gray
}))

# ── CLI smoke tests (all scoped to sandbox) ──────────────────────────

[void]$results.Add((Invoke-Step -Name 'CLI help (sanity)' -Action {
  & node $cliBin --help | Out-Null
  if ($LASTEXITCODE -ne 0) { throw '--help failed' }
}))

[void]$results.Add((Invoke-Step -Name 'CLI generate (--root sandbox --out _out)' -Action {
  & node $cliBin generate --kb --root $sandboxRoot --out $sandboxOut --quiet
  if ($LASTEXITCODE -ne 0) { throw 'generate failed' }
}))

[void]$results.Add((Invoke-Step -Name 'Verify kb.md in sandbox output' -Action {
  $kbFile = Join-Path $sandboxOut 'kb.md'
  if (-not (Test-Path $kbFile)) {
    throw "kb.md not found in sandbox output: $kbFile"
  }
  Write-Host "  Found kb.md" -ForegroundColor Gray
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

[void]$results.Add((Invoke-Step -Name 'CLI generate --json (--root sandbox --out _out)' -Action {
  $tmpJson = Join-Path $env:TEMP 'aspectcode-sandbox-smoke.json'
  $tmpErr  = Join-Path $env:TEMP 'aspectcode-sandbox-smoke.err.log'
  if (Test-Path $tmpJson) { Remove-Item $tmpJson -Force }
  if (Test-Path $tmpErr)  { Remove-Item $tmpErr -Force }
  cmd.exe /d /s /c "node `"$cliBin`" g --root `"$sandboxRoot`" --out `"$sandboxOut`" --json 1>`"$tmpJson`" 2>`"$tmpErr`""
  $raw = Get-Content $tmpJson -Raw
  $null = $raw | ConvertFrom-Json
  if (-not $raw.TrimStart().StartsWith('{')) {
    throw 'JSON output file does not look like a JSON object.'
  }
  Write-Host "  JSON parsed OK" -ForegroundColor Gray
}))

[void]$results.Add((Invoke-Step -Name 'CLI deps impact (--root sandbox)' -Action {
  $targetFile = 'src\app.ts'
  & node $cliBin deps impact --root $sandboxRoot --file $targetFile --quiet 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "deps impact --file $targetFile failed" }
}))

[void]$results.Add((Invoke-Step -Name 'CLI deps list (--root sandbox)' -Action {
  $targetFile = 'src\app.ts'
  & node $cliBin deps list --root $sandboxRoot --file $targetFile --quiet 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "deps list --file $targetFile failed" }
}))

[void]$results.Add((Invoke-Step -Name 'Unknown flag warning path' -Action {
  cmd.exe /d /s /c "node `"$cliBin`" gen --root `"$sandboxRoot`" --out `"$sandboxOut`" --bogus-flag --quiet 2>nul"
  if ($LASTEXITCODE -ne 0) { throw 'unknown flag path failed' }
}))

[void]$results.Add((Invoke-Step -Name 'No-color path' -Action {
  & node $cliBin gen --root $sandboxRoot --out $sandboxOut --no-color --quiet 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'no-color path failed' }
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
