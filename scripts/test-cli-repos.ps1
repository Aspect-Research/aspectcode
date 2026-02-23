<#
.SYNOPSIS
  Clone external repos and run exhaustive CLI tests against each one.

.DESCRIPTION
  Reads repo URLs from scripts/test-repos.json, clones each into a temp
  directory, then exercises every CLI command and flag combination against
  it.  Output always goes to a separate temp directory so the repo root
  of this project is never polluted.

  Each repo is deleted after testing (unless -SkipCleanup is set).

.PARAMETER SkipBuild
  Skip the workspace build step (assume packages are already compiled).

.PARAMETER SkipCleanup
  Keep cloned repos and output dirs after the run (for inspection).

.PARAMETER RepoFilter
  Only test repos whose name matches this substring (case-insensitive).
  Example: -RepoFilter flask

.EXAMPLE
  # Full run
  .\scripts\test-cli-repos.ps1

  # Fast run, only test flask
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

function Write-SubStep {
  param([string]$Message)
  Write-Host "  --- $Message ---" -ForegroundColor DarkCyan
}

function Invoke-Step {
  param(
    [string]$Name,
    [scriptblock]$Action
  )

  Write-SubStep $Name
  $start = Get-Date
  try {
    & $Action | Out-Null
    $elapsed = (Get-Date) - $start
    Write-Host "  PASS: $Name ($([math]::Round($elapsed.TotalSeconds, 1))s)" -ForegroundColor Green
    return [pscustomobject]@{ Name = $Name; Status = 'PASS'; Seconds = [math]::Round($elapsed.TotalSeconds, 1) }
  } catch {
    $elapsed = (Get-Date) - $start
    Write-Host "  FAIL: $Name ($([math]::Round($elapsed.TotalSeconds, 1))s)" -ForegroundColor Red
    Write-Host "  $($_.Exception.Message)" -ForegroundColor DarkRed
    return [pscustomobject]@{ Name = $Name; Status = 'FAIL'; Seconds = [math]::Round($elapsed.TotalSeconds, 1) }
  }
}

function Invoke-Cli {
  <#
  .SYNOPSIS
    Run the CLI via cmd.exe, suppressing stderr as needed.
    Returns $true when the process exit code matches $ExpectedExit (default 0).
  #>
  param(
    [string]$Arguments,
    [int]$ExpectedExit = 0
  )
  cmd.exe /d /s /c "node `"$cliBin`" $Arguments 2>nul"
  if ($LASTEXITCODE -ne $ExpectedExit) {
    throw "CLI exited $LASTEXITCODE (expected $ExpectedExit): $Arguments"
  }
}

# ── Paths ─────────────────────────────────────────────────────────────

$repoRoot   = Resolve-Path (Join-Path $PSScriptRoot '..')
$cliBin     = Join-Path $repoRoot 'packages\cli\bin\aspectcode.js'
$configFile = Join-Path $PSScriptRoot 'test-repos.json'

if (-not (Test-Path $configFile)) {
  Write-Host "ERROR: $configFile not found" -ForegroundColor Red
  exit 1
}

$config = Get-Content $configFile -Raw | ConvertFrom-Json
$repos  = $config.repos

if ($RepoFilter) {
  $repos = @($repos | Where-Object { $_.name -like "*$RepoFilter*" })
  if ($repos.Count -eq 0) {
    Write-Host "No repos match filter '$RepoFilter'" -ForegroundColor Yellow
    exit 0
  }
}

Write-Host "Aspect Code - Multi-Repo CLI Test" -ForegroundColor White
Write-Host "Repo root: $repoRoot" -ForegroundColor Gray
Write-Host "Repos to test: $($repos.Count)" -ForegroundColor Gray
Write-Host ""

$allResults = New-Object System.Collections.ArrayList

# ── Build (optional) ─────────────────────────────────────────────────

if (-not $SkipBuild) {
  Write-Step 'Build all workspaces'
  Push-Location $repoRoot
  try {
    & npm run build --workspaces 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
    Write-Host "  Build OK" -ForegroundColor Green
  } finally { Pop-Location }
}

# ── Per-repo testing ─────────────────────────────────────────────────

function Find-FirstSourceFile {
  <#
  .SYNOPSIS
    Find the first source file in a directory to use for --file tests.
    Returns a workspace-relative path or $null.
  #>
  param([string]$Dir)
  $extensions = @('*.ts', '*.js', '*.py', '*.cs', '*.java', '*.tsx', '*.jsx')
  foreach ($ext in $extensions) {
    $match = Get-ChildItem -Path $Dir -Filter $ext -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($match) {
      $rel = $match.FullName.Substring($Dir.Length + 1).Replace('\', '/')
      return $rel
    }
  }
  return $null
}

function Test-RepoExhaustive {
  <#
  .SYNOPSIS
    Run the full CLI test matrix against a single cloned repo.
    Returns an ArrayList of result objects.
  #>
  param(
    [string]$CloneDir,
    [string]$OutDir,
    [string]$RepoName,
    [int]$MinFiles  = 1,
    [int]$MinEdges  = 0
  )

  $results = New-Object System.Collections.ArrayList

  # Find a source file for --file-scoped commands
  $sourceFile = Find-FirstSourceFile -Dir $CloneDir
  if (-not $sourceFile) {
    Write-Host "  WARNING: No source file found in $RepoName, --file tests will be skipped" -ForegroundColor Yellow
  }

  # ────────────────────────────────────────────────────────────
  # 1. help / version / show-config (read-only, always safe)
  # ────────────────────────────────────────────────────────────

  [void]$results.Add((Invoke-Step -Name "[$RepoName] --help" -Action {
    Invoke-Cli "--help"
  }))

  [void]$results.Add((Invoke-Step -Name "[$RepoName] --version" -Action {
    Invoke-Cli "--version"
  }))

  [void]$results.Add((Invoke-Step -Name "[$RepoName] show-config" -Action {
    Invoke-Cli "show-config --root `"$CloneDir`" --quiet"
  }))

  [void]$results.Add((Invoke-Step -Name "[$RepoName] show-config --json" -Action {
    Invoke-Cli "show-config --root `"$CloneDir`" --json"
  }))

  # ────────────────────────────────────────────────────────────
  # 2. settings commands (operate on aspectcode.json in clone)
  # ────────────────────────────────────────────────────────────

  [void]$results.Add((Invoke-Step -Name "[$RepoName] set-update-rate onChange" -Action {
    Invoke-Cli "set-update-rate onChange --root `"$CloneDir`" --quiet"
  }))

  [void]$results.Add((Invoke-Step -Name "[$RepoName] set-update-rate manual" -Action {
    Invoke-Cli "set-update-rate manual --root `"$CloneDir`" --quiet"
  }))

  [void]$results.Add((Invoke-Step -Name "[$RepoName] set-update-rate idle" -Action {
    Invoke-Cli "set-update-rate idle --root `"$CloneDir`" --quiet"
  }))

  [void]$results.Add((Invoke-Step -Name "[$RepoName] add-exclude" -Action {
    Invoke-Cli "add-exclude vendor --root `"$CloneDir`" --quiet"
  }))

  [void]$results.Add((Invoke-Step -Name "[$RepoName] remove-exclude" -Action {
    Invoke-Cli "remove-exclude vendor --root `"$CloneDir`" --quiet"
  }))

  # ────────────────────────────────────────────────────────────
  # 3. generate — default (AGENTS.md)
  # ────────────────────────────────────────────────────────────

  [void]$results.Add((Invoke-Step -Name "[$RepoName] generate (default, --out)" -Action {
    Invoke-Cli "generate --kb --root `"$CloneDir`" --out `"$OutDir`" --quiet"
  }))

  [void]$results.Add((Invoke-Step -Name "[$RepoName] verify kb.md output" -Action {
    $kbFile = Join-Path $OutDir 'kb.md'
    if (-not (Test-Path $kbFile)) { throw "kb.md not created in output dir" }
    $size = (Get-Item $kbFile).Length
    Write-Host "    kb.md: ${size}B" -ForegroundColor Gray
  }))

  [void]$results.Add((Invoke-Step -Name "[$RepoName] verify kb.md has manifest comment" -Action {
    $kbPath = Join-Path $OutDir 'kb.md'
    $kbText = Get-Content $kbPath -Raw
    if ($kbText -notmatch 'aspectcode:') { throw "kb.md missing manifest comment" }
    Write-Host "    kb.md has manifest comment" -ForegroundColor Gray
  }))

  # ────────────────────────────────────────────────────────────
  # 4b. Graph reasonableness — verify the analysis found real data
  # ────────────────────────────────────────────────────────────

  # Clean output between runs (used here and in section 5 flag matrix)
  $cleanOut = {
    if (Test-Path $OutDir) {
      Remove-Item -Path $OutDir -Recurse -Force
      New-Item -Path $OutDir -ItemType Directory -Force | Out-Null
    }
  }

  [void]$results.Add((Invoke-Step -Name "[$RepoName] kb.md stats are plausible" -Action {
    $kbPath = Join-Path $OutDir 'kb.md'
    $kbText = Get-Content $kbPath -Raw
    $size = $kbText.Length
    Write-Host "    kb.md size=$size chars" -ForegroundColor Gray
    if ($size -lt 200) { throw "kb.md is too small ($size chars)" }
  }))

  [void]$results.Add((Invoke-Step -Name "[$RepoName] KB has substance" -Action {
    $kbPath = Join-Path $OutDir 'kb.md'
    $kbText = Get-Content $kbPath -Raw
    if ($kbText.Length -lt 200) { throw "kb.md is only $($kbText.Length) chars (expected >= 200)" }
    if ($kbText -notmatch '# Architecture') { throw "kb.md missing Architecture section" }
    if ($kbText -notmatch '# Map') { throw "kb.md missing Map section" }
    if ($kbText -notmatch '# Context') { throw "kb.md missing Context section" }
  }))

  [void]$results.Add((Invoke-Step -Name "[$RepoName] JSON stats show detected edges" -Action {
    & $cleanOut
    $tmpJson = Join-Path $env:TEMP "aspectcode-stats-$RepoName.json"
    if (Test-Path $tmpJson) { Remove-Item $tmpJson -Force }
    cmd.exe /d /s /c "node `"$cliBin`" g --root `"$CloneDir`" --out `"$OutDir`" --json 1>`"$tmpJson`" 2>nul"
    $parsed = Get-Content $tmpJson -Raw | ConvertFrom-Json
    $files = [int]$parsed.stats.files
    $edges = [int]$parsed.stats.edges
    Write-Host "    JSON stats: files=$files  edges=$edges" -ForegroundColor Gray
    if ($files -lt $MinFiles) { throw "JSON stats.files $files < expected minimum $MinFiles" }
    if ($edges -lt $MinEdges) { throw "JSON stats.edges $edges < expected minimum $MinEdges" }
  }))

  [void]$results.Add((Invoke-Step -Name "[$RepoName] connections have valid structure" -Action {
    $tmpJson = Join-Path $env:TEMP "aspectcode-conn-struct-$RepoName.json"
    if (Test-Path $tmpJson) { Remove-Item $tmpJson -Force }
    cmd.exe /d /s /c "node `"$cliBin`" g --root `"$CloneDir`" --out `"$OutDir`" --json --list-connections 1>`"$tmpJson`" 2>nul"
    $parsed = Get-Content $tmpJson -Raw | ConvertFrom-Json
    $conns = $parsed.connections
    if ($MinEdges -gt 0 -and $conns.Count -eq 0) { throw "Expected connections but got 0" }
    if ($conns.Count -gt 0) {
      $first = $conns[0]
      if (-not $first.source) { throw "Connection missing 'source' field" }
      if (-not $first.target) { throw "Connection missing 'target' field" }
      if (-not $first.type)   { throw "Connection missing 'type' field" }
      # Verify paths use forward slashes (POSIX-normalized)
      if ($first.source -match '\\') { throw "Connection source uses backslashes: $($first.source)" }
      if ($first.target -match '\\') { throw "Connection target uses backslashes: $($first.target)" }
      Write-Host "    Sample: $($first.source) -> $($first.target) ($($first.type))" -ForegroundColor Gray
    }
    Write-Host "    $($conns.Count) connections validated" -ForegroundColor Gray
  }))

  # ────────────────────────────────────────────────────────────
  # 5. generate — flag matrix
  # ────────────────────────────────────────────────────────────

  [void]$results.Add((Invoke-Step -Name "[$RepoName] generate --kb-only" -Action {
    & $cleanOut
    Invoke-Cli "generate --root `"$CloneDir`" --out `"$OutDir`" --kb-only --quiet"
    # Verify only KB file, no AGENTS.md
    $agentsMd = Join-Path $OutDir 'AGENTS.md'
    if (Test-Path $agentsMd) { throw "AGENTS.md should NOT exist with --kb-only" }
    if (-not (Test-Path (Join-Path $OutDir 'kb.md'))) { throw "kb.md missing" }
  }))

  [void]$results.Add((Invoke-Step -Name "[$RepoName] generate (default AGENTS.md)" -Action {
    & $cleanOut
    Invoke-Cli "generate --root `"$CloneDir`" --out `"$OutDir`" --quiet"
    $agentsMd = Join-Path $OutDir 'AGENTS.md'
    if (-not (Test-Path $agentsMd)) { throw "AGENTS.md not generated" }
  }))

  [void]$results.Add((Invoke-Step -Name "[$RepoName] generate --instructions-mode safe" -Action {
    & $cleanOut
    Invoke-Cli "generate --root `"$CloneDir`" --out `"$OutDir`" --instructions-mode safe --quiet"
  }))

  [void]$results.Add((Invoke-Step -Name "[$RepoName] generate --instructions-mode permissive" -Action {
    & $cleanOut
    Invoke-Cli "generate --root `"$CloneDir`" --out `"$OutDir`" --instructions-mode permissive --quiet"
  }))

  [void]$results.Add((Invoke-Step -Name "[$RepoName] generate --instructions-mode off" -Action {
    & $cleanOut
    Invoke-Cli "generate --root `"$CloneDir`" --out `"$OutDir`" --instructions-mode off --quiet"
    $agentsMd = Join-Path $OutDir 'AGENTS.md'
    if (Test-Path $agentsMd) { throw "AGENTS.md should NOT exist with --instructions-mode off" }
  }))

  [void]$results.Add((Invoke-Step -Name "[$RepoName] generate --no-color" -Action {
    & $cleanOut
    Invoke-Cli "generate --root `"$CloneDir`" --out `"$OutDir`" --no-color --quiet"
  }))

  [void]$results.Add((Invoke-Step -Name "[$RepoName] generate --verbose" -Action {
    & $cleanOut
    Invoke-Cli "generate --root `"$CloneDir`" --out `"$OutDir`" --verbose"
  }))

  [void]$results.Add((Invoke-Step -Name "[$RepoName] generate alias: gen" -Action {
    & $cleanOut
    Invoke-Cli "gen --root `"$CloneDir`" --out `"$OutDir`" --quiet"
  }))

  [void]$results.Add((Invoke-Step -Name "[$RepoName] generate alias: g" -Action {
    & $cleanOut
    Invoke-Cli "g --root `"$CloneDir`" --out `"$OutDir`" --quiet"
  }))

  # ────────────────────────────────────────────────────────────
  # 6. generate — JSON output
  # ────────────────────────────────────────────────────────────

  [void]$results.Add((Invoke-Step -Name "[$RepoName] generate --json" -Action {
    & $cleanOut
    $tmpJson = Join-Path $env:TEMP "aspectcode-repo-$RepoName.json"
    if (Test-Path $tmpJson) { Remove-Item $tmpJson -Force }
    cmd.exe /d /s /c "node `"$cliBin`" g --root `"$CloneDir`" --out `"$OutDir`" --json 1>`"$tmpJson`" 2>nul"
    $raw = Get-Content $tmpJson -Raw
    $parsed = $raw | ConvertFrom-Json
    if (-not $raw.TrimStart().StartsWith('{')) { throw 'JSON stdout is not a JSON object' }
    if (-not $parsed.schemaVersion) { throw 'JSON missing schemaVersion field' }
    Write-Host "    JSON: $($parsed.wrote.Count) files written" -ForegroundColor Gray
  }))

  [void]$results.Add((Invoke-Step -Name "[$RepoName] generate --json --list-connections" -Action {
    & $cleanOut
    $tmpJson = Join-Path $env:TEMP "aspectcode-repo-conn-$RepoName.json"
    if (Test-Path $tmpJson) { Remove-Item $tmpJson -Force }
    cmd.exe /d /s /c "node `"$cliBin`" g --root `"$CloneDir`" --out `"$OutDir`" --json --list-connections 1>`"$tmpJson`" 2>nul"
    $raw = Get-Content $tmpJson -Raw
    $parsed = $raw | ConvertFrom-Json
    if ($null -eq $parsed.connections) { throw 'JSON missing connections field' }
    Write-Host "    JSON: $($parsed.connections.Count) connections" -ForegroundColor Gray
  }))

  # ────────────────────────────────────────────────────────────
  # 7. generate --list-connections (text)
  # ────────────────────────────────────────────────────────────

  [void]$results.Add((Invoke-Step -Name "[$RepoName] generate --list-connections (text)" -Action {
    & $cleanOut
    Invoke-Cli "generate --root `"$CloneDir`" --out `"$OutDir`" --list-connections --quiet"
  }))

  # ────────────────────────────────────────────────────────────
  # 8. deps impact
  # ────────────────────────────────────────────────────────────

  if ($sourceFile) {
    [void]$results.Add((Invoke-Step -Name "[$RepoName] deps impact --file $sourceFile" -Action {
      Invoke-Cli "deps impact --root `"$CloneDir`" --file `"$sourceFile`" --quiet"
    }))

    [void]$results.Add((Invoke-Step -Name "[$RepoName] deps impact --file $sourceFile --json" -Action {
      $tmpJson = Join-Path $env:TEMP "aspectcode-impact-$RepoName.json"
      if (Test-Path $tmpJson) { Remove-Item $tmpJson -Force }
      cmd.exe /d /s /c "node `"$cliBin`" deps impact --root `"$CloneDir`" --file `"$sourceFile`" --json 1>`"$tmpJson`" 2>nul"
      $raw = Get-Content $tmpJson -Raw
      $null = $raw | ConvertFrom-Json
      if (-not $raw.TrimStart().StartsWith('{')) { throw 'JSON output is not a JSON object' }
    }))

    [void]$results.Add((Invoke-Step -Name "[$RepoName] deps impact --file $sourceFile --verbose" -Action {
      Invoke-Cli "deps impact --root `"$CloneDir`" --file `"$sourceFile`" --verbose"
    }))
  }

  # ────────────────────────────────────────────────────────────
  # 9. deps list
  # ────────────────────────────────────────────────────────────

  [void]$results.Add((Invoke-Step -Name "[$RepoName] deps list" -Action {
    Invoke-Cli "deps list --root `"$CloneDir`" --quiet"
  }))

  if ($sourceFile) {
    [void]$results.Add((Invoke-Step -Name "[$RepoName] deps list --file $sourceFile" -Action {
      Invoke-Cli "deps list --root `"$CloneDir`" --file `"$sourceFile`" --quiet"
    }))

    [void]$results.Add((Invoke-Step -Name "[$RepoName] deps list --file --quiet" -Action {
      # Note: deps list does not currently support --json, so we just verify it exits 0
      Invoke-Cli "deps list --root `"$CloneDir`" --file `"$sourceFile`" --quiet"
    }))

    [void]$results.Add((Invoke-Step -Name "[$RepoName] deps list --list-connections" -Action {
      Invoke-Cli "deps list --root `"$CloneDir`" --file `"$sourceFile`" --list-connections --quiet"
    }))
  }

  # ────────────────────────────────────────────────────────────
  # 10. Error / edge-case paths
  # ────────────────────────────────────────────────────────────

  [void]$results.Add((Invoke-Step -Name "[$RepoName] unknown command exits 2" -Action {
    Invoke-Cli "xyzzy --root `"$CloneDir`" --quiet" -ExpectedExit 2
  }))

  [void]$results.Add((Invoke-Step -Name "[$RepoName] unknown flag still succeeds" -Action {
    & $cleanOut
    Invoke-Cli "gen --root `"$CloneDir`" --out `"$OutDir`" --bogus-flag --quiet"
  }))

  [void]$results.Add((Invoke-Step -Name "[$RepoName] set-update-rate invalid exits 2" -Action {
    cmd.exe /d /s /c "node `"$cliBin`" set-update-rate bogus --root `"$CloneDir`" --quiet 2>nul"
    if ($LASTEXITCODE -ne 2) { throw "Expected exit 2, got $LASTEXITCODE" }
  }))

  # ────────────────────────────────────────────────────────────
  # 11. Pollution check
  # ────────────────────────────────────────────────────────────

  [void]$results.Add((Invoke-Step -Name "[$RepoName] repo root clean (no pollution)" -Action {
    $repoKb = Join-Path $repoRoot 'kb.md'
    $repoAgents = Join-Path $repoRoot 'AGENTS.md'
    if (Test-Path $repoKb) { throw "POLLUTION: kb.md at repo root" }
    if (Test-Path $repoAgents) { throw "POLLUTION: AGENTS.md at repo root" }
  }))

  return $results
}

# ── Main loop ─────────────────────────────────────────────────────────

$repoIndex = 0
foreach ($repo in $repos) {
  $repoIndex++
  $name = $repo.name
  $url  = $repo.url
  $desc = if ($repo.description) { " ($($repo.description))" } else { '' }

  Write-Host ""
  Write-Host ("=" * 70) -ForegroundColor White
  Write-Host "  [$repoIndex/$($repos.Count)] $name$desc" -ForegroundColor White
  Write-Host "  $url" -ForegroundColor Gray
  Write-Host ("=" * 70) -ForegroundColor White

  $cloneDir = Join-Path ([System.IO.Path]::GetTempPath()) "aspectcode-test-$name-$([guid]::NewGuid().ToString('N').Substring(0,8))"
  $outDir   = Join-Path ([System.IO.Path]::GetTempPath()) "aspectcode-out-$name-$([guid]::NewGuid().ToString('N').Substring(0,8))"

  try {
    # Clone
    Write-Step "Clone $name"
    $cloneArgs = if ($repo.shallow -ne $false) { '--depth 1' } else { '' }
    cmd.exe /d /s /c "git clone $cloneArgs `"$url`" `"$cloneDir`" 2>&1"
    if ($LASTEXITCODE -ne 0) { throw "git clone failed for $url" }
    Write-Host "  Cloned to $cloneDir" -ForegroundColor Gray

    # Create output dir
    New-Item -Path $outDir -ItemType Directory -Force | Out-Null

    # Run exhaustive tests
    Write-Step "Testing $name"
    $minFiles = if ($repo.minFiles) { [int]$repo.minFiles } else { 1 }
    $minEdges = if ($repo.minEdges) { [int]$repo.minEdges } else { 0 }
    $repoResults = Test-RepoExhaustive -CloneDir $cloneDir -OutDir $outDir -RepoName $name -MinFiles $minFiles -MinEdges $minEdges
    foreach ($r in $repoResults) { [void]$allResults.Add($r) }

  } catch {
    Write-Host "  ERROR during $name : $($_.Exception.Message)" -ForegroundColor Red
    [void]$allResults.Add(([pscustomobject]@{ Name = "[$name] setup/clone"; Status = 'FAIL'; Seconds = 0 }))
  } finally {
    # Cleanup
    if (-not $SkipCleanup) {
      if (Test-Path $cloneDir) { Remove-Item -Path $cloneDir -Recurse -Force -ErrorAction SilentlyContinue }
      if (Test-Path $outDir)   { Remove-Item -Path $outDir   -Recurse -Force -ErrorAction SilentlyContinue }
      Write-Host "  Cleaned up $name" -ForegroundColor Gray
    } else {
      Write-Host "  Clone kept at: $cloneDir" -ForegroundColor Yellow
      Write-Host "  Output kept at: $outDir" -ForegroundColor Yellow
    }
  }
}

# ── Final pollution check ─────────────────────────────────────────────

Write-Step "Final repo-root cleanliness check"
$repoKb = Join-Path $repoRoot 'kb.md'
$repoAgents = Join-Path $repoRoot 'AGENTS.md'
$polluted = $false
if (Test-Path $repoKb) {
  Write-Host "  POLLUTION: kb.md found at repo root" -ForegroundColor Red
  $polluted = $true
}
if (Test-Path $repoAgents) {
  Write-Host "  POLLUTION: AGENTS.md found at repo root" -ForegroundColor Red
  $polluted = $true
}
if (-not $polluted) {
  Write-Host "  Repo root is clean" -ForegroundColor Green
}

# ── Grand summary ─────────────────────────────────────────────────────

$passed = @($allResults | Where-Object { $_.Status -eq 'PASS' }).Count
$failed = @($allResults | Where-Object { $_.Status -eq 'FAIL' }).Count
$total  = $allResults.Count

Write-Host ""
Write-Host ("=" * 70) -ForegroundColor White
Write-Host "  GRAND SUMMARY: $passed/$total passed, $failed failed" -ForegroundColor $(if ($failed -gt 0) { 'Red' } else { 'Green' })
Write-Host ("=" * 70) -ForegroundColor White
Write-Host ""

if ($failed -gt 0) {
  Write-Host "Failed tests:" -ForegroundColor Red
  $allResults | Where-Object { $_.Status -eq 'FAIL' } | ForEach-Object {
    Write-Host "  FAIL  $($_.Name)" -ForegroundColor Red
  }
  Write-Host ""
  exit 1
}

Write-Host "All multi-repo CLI tests passed." -ForegroundColor Green
exit 0
