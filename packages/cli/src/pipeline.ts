/**
 * aspectcode pipeline — analyze, generate, watch, evaluate.
 *
 * v2: After generating AGENTS.md, watch mode evaluates individual file
 * changes in real time. Full probe-and-refine runs on first startup
 * or when the user presses 'r'.
 */

import * as fs from 'fs';
import * as path from 'path';
import { SUPPORTED_EXTENSIONS, analyzeRepoWithDependencies } from '@aspectcode/core';
import { createNodeEmitterHost } from '@aspectcode/emitters';
import type { RunContext, RunMode } from './cli';
import { ExitCode } from './cli';
import type { ExitCodeValue } from './cli';
import { loadConfig, saveConfig, getConfigPlatforms, loadUserSettings } from './config';
import type { UserSettings } from './config';
import { fmt } from './logger';
import { loadWorkspaceFiles } from './workspace';
import { buildKbContent } from './kbBuilder';
import { readToolInstructions } from './toolIngestion';
import { writeAgentsMd, hasMarkers } from './writer';
import type { OwnershipMode } from './writer';
import { tryOptimize } from './optimize';
import { selectPrompt } from './ui/prompts';
import { store } from './ui/store';
import { summarizeContent } from './summary';
import { diffSummary } from './diffSummary';
import { updateRuntimeState, getRuntimeState } from './runtimeState';
import { loadPreferences, savePreferences, addPreference } from './preferences';
import type { PreferencesStore } from './preferences';
import { evaluateChange, trackChange, getRecentChanges } from './changeEvaluator';
import type { ChangeAssessment } from './changeEvaluator';
import {
  addCorrection,
  getCorrections,
  markProcessed,
  getUnprocessedCount,
  runDreamCycle,
  saveDreamState,
} from './dreamCycle';
import { deleteScopedRules, writeRulesForPlatforms } from './scopedRules';
import { autoResolveAssessment } from './autoResolve';
import { renderAgentsMd } from './agentsMdRenderer';
import { withUsageTracking } from './usageTracker';
import { loadCredentials, updateCredentials, startBackgroundLogin, WEB_APP_URL } from './auth';
import type { ManagedFile } from './ui/store';
import { resolveProvider, loadEnvFile } from '@aspectcode/optimizer';

// ── Constants ────────────────────────────────────────────────

const EVAL_DEBOUNCE_MS = 500;

const IGNORED_SEGMENTS = [
  '/node_modules/', '/.git/', '/dist/', '/build/', '/target/',
  '/coverage/', '/.next/', '/__pycache__/', '/.venv/', '/venv/',
  '/.pytest_cache/', '/.mypy_cache/', '/.tox/', '/htmlcov/',
  '/.aspectcode/',
];

export function isIgnoredPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  return IGNORED_SEGMENTS.some((seg) => normalized.includes(seg));
}

export function isSupportedSourceFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext);
}

// ── Managed files for memory map ─────────────────────────────

function fileMtime(filePath: string): number {
  try { return fs.statSync(filePath).mtimeMs; } catch { return 0; }
}

function buildManagedFiles(
  root: string,
  preferenceCount: number,
  platforms: string[] = [],
): ManagedFile[] {
  const files: ManagedFile[] = [];

  // ── Workspace-scope: AGENTS.md ──────────────────────────────
  const agentsAbs = path.join(root, 'AGENTS.md');
  if (fs.existsSync(agentsAbs)) {
    files.push({ path: 'AGENTS.md', annotation: '', updatedAt: fileMtime(agentsAbs), category: 'agents', scope: 'workspace', owner: 'aspectcode' });
  }

  // ── Workspace-scope: platform instruction files ─────────────
  if (platforms.includes('claude')) {
    const claudeMdAbs = path.join(root, 'CLAUDE.md');
    if (fs.existsSync(claudeMdAbs)) {
      files.push({ path: 'CLAUDE.md', annotation: '○ user', updatedAt: fileMtime(claudeMdAbs), category: 'workspace-config', scope: 'workspace', owner: 'user' });
    }
  }
  if (platforms.includes('cursor')) {
    const cursorrules = path.join(root, '.cursorrules');
    if (fs.existsSync(cursorrules)) {
      files.push({ path: '.cursorrules', annotation: '○ user', updatedAt: fileMtime(cursorrules), category: 'workspace-config', scope: 'workspace', owner: 'user' });
    }
  }

  // ── Workspace-scope: scoped rules from manifest ─────────────
  const manifestPath = path.join(root, '.aspectcode', 'scoped-rules.json');
  const manifestRulePaths = new Set<string>();
  let manifestNeedsCleanup = false;
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const validRules: any[] = [];
      for (const entry of manifest.rules ?? []) {
        if (manifestRulePaths.has(entry.path)) continue;
        const absPath = path.join(root, entry.path);
        // Skip files that no longer exist on disk
        if (!fs.existsSync(absPath)) {
          manifestNeedsCleanup = true;
          continue;
        }
        manifestRulePaths.add(entry.path);
        validRules.push(entry);
        const cat = (entry.path as string).startsWith('.claude/') ? 'claude-rule'
          : (entry.path as string).startsWith('.cursor/') ? 'cursor-rule'
          : 'agents';
        const ts = entry.updatedAt ? new Date(entry.updatedAt).getTime() : fileMtime(absPath);
        files.push({ path: entry.path, annotation: '● active', updatedAt: ts, category: cat as ManagedFile['category'], scope: 'workspace', owner: 'aspectcode' });
      }
      // Clean stale entries from manifest so they don't persist across restarts
      if (manifestNeedsCleanup) {
        try {
          fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, rules: validRules }, null, 2) + '\n');
        } catch { /* ignore write errors */ }
      }
    } catch { /* malformed manifest */ }
  }

  // ── Workspace-scope: user-created scoped rules ──────────────
  const platformRuleDirs: Array<{ dir: string; ext: string }> = [];
  if (platforms.includes('claude')) platformRuleDirs.push({ dir: '.claude/rules', ext: '.md' });
  if (platforms.includes('cursor')) platformRuleDirs.push({ dir: '.cursor/rules', ext: '.mdc' });

  for (const { dir: rulesDir, ext } of platformRuleDirs) {
    const absDir = path.join(root, rulesDir);
    try {
      if (fs.existsSync(absDir)) {
        for (const entry of fs.readdirSync(absDir)) {
          if (!entry.endsWith(ext)) continue;
          if (entry.startsWith('ac-')) continue; // aspectcode-managed
          const relPath = `${rulesDir}/${entry}`;
          if (manifestRulePaths.has(relPath)) continue; // already tracked
          files.push({ path: relPath, annotation: '○ user', updatedAt: fileMtime(path.join(absDir, entry)), category: 'user-rule', scope: 'workspace', owner: 'user' });
        }
      }
    } catch { /* unreadable dir */ }
  }

  // ── Workspace-scope: settings ───────────────────────────────
  if (platforms.includes('claude')) {
    const settingsLocal = path.join(root, '.claude', 'settings.local.json');
    if (fs.existsSync(settingsLocal)) {
      files.push({ path: '.claude/settings.local.json', annotation: '○ user', updatedAt: fileMtime(settingsLocal), category: 'workspace-config', scope: 'workspace', owner: 'user' });
    }
  }

  // ── Workspace-scope: .aspectcode files ──────────────────────
  if (preferenceCount > 0) {
    files.push({ path: '☁ preferences', annotation: `${preferenceCount} learned`, updatedAt: 0, category: 'cloud', scope: 'workspace', owner: 'aspectcode' });
  }
  const dreamStatePath = path.join(root, '.aspectcode', 'dream-state.json');
  if (fs.existsSync(dreamStatePath)) {
    try {
      const ds = JSON.parse(fs.readFileSync(dreamStatePath, 'utf-8'));
      const lastDream = ds.lastDreamAt ? new Date(ds.lastDreamAt).getTime() : 0;
      files.push({ path: '.aspectcode/dream-state.json', annotation: '', updatedAt: lastDream, category: 'aspectcode', scope: 'workspace', owner: 'aspectcode' });
    } catch {
      files.push({ path: '.aspectcode/dream-state.json', annotation: '', updatedAt: 0, category: 'aspectcode', scope: 'workspace', owner: 'aspectcode' });
    }
  }

  // ── Device-scope: ~/.claude/ memory (Claude Code only) ──────
  if (platforms.includes('claude')) {
    const home = require('os').homedir();

    // Device-root CLAUDE.md
    const deviceClaudeMd = path.join(home, '.claude', 'CLAUDE.md');
    if (fs.existsSync(deviceClaudeMd)) {
      files.push({ path: '~/.claude/CLAUDE.md', annotation: '○ device', updatedAt: fileMtime(deviceClaudeMd), category: 'device', scope: 'device', owner: 'device' });
    }

    // Project-level CLAUDE.md (~/.claude/projects/<hash>/CLAUDE.md)
    const projectClaudeMd = findDeviceProjectClaudeMd(home, root);
    if (projectClaudeMd) {
      files.push({ path: '~/.claude/projects/.../CLAUDE.md', annotation: '○ device', updatedAt: fileMtime(projectClaudeMd), category: 'device', scope: 'device', owner: 'device' });
    }
  }

  return files;
}

/** Find the project-level CLAUDE.md in ~/.claude/projects/<hash>/ for the given workspace. */
function findDeviceProjectClaudeMd(home: string, root: string): string | undefined {
  const projectsBase = path.join(home, '.claude', 'projects');
  if (!fs.existsSync(projectsBase)) return undefined;

  const normalised = root.replace(/\\/g, '/');
  const crypto = require('crypto');

  // Try common hash strategies
  const candidates = [
    crypto.createHash('md5').update(normalised).digest('hex'),
    crypto.createHash('sha256').update(normalised).digest('hex').slice(0, 32),
    Buffer.from(normalised).toString('base64url'),
    normalised.replace(/\//g, '-').replace(/^-/, ''),
  ];

  for (const candidate of candidates) {
    const claudeMd = path.join(projectsBase, candidate, 'CLAUDE.md');
    if (fs.existsSync(claudeMd)) return claudeMd;
  }

  // Fallback: scan project directories for CLAUDE.md
  try {
    for (const dir of fs.readdirSync(projectsBase)) {
      const claudeMd = path.join(projectsBase, dir, 'CLAUDE.md');
      if (fs.existsSync(claudeMd)) {
        // Verify this directory is for our workspace by checking a jsonl file
        const fullDir = path.join(projectsBase, dir);
        const jsonls = fs.readdirSync(fullDir).filter((f: string) => f.endsWith('.jsonl'));
        if (jsonls.length > 0) {
          try {
            const fd = fs.openSync(path.join(fullDir, jsonls[0]), 'r');
            const buf = Buffer.alloc(2048);
            const bytesRead = fs.readSync(fd, buf, 0, 2048, 0);
            fs.closeSync(fd);
            const sample = buf.slice(0, bytesRead).toString('utf-8');
            if (sample.includes(normalised) || sample.includes(root.replace(/\\/g, '\\\\'))) {
              return claudeMd;
            }
          } catch { /* skip */ }
        }
      }
    }
  } catch { /* scan failed */ }

  return undefined;
}

// ── File watcher ─────────────────────────────────────────────

export function createFileWatcher(
  root: string,
  onEvent: (type: 'add' | 'change' | 'unlink', relativePosixPath: string) => void,
): fs.FSWatcher {
  return fs.watch(root, { recursive: true }, (event, filename) => {
    if (!filename) return;
    const posixPath = filename.replace(/\\/g, '/');
    const abs = path.resolve(root, filename);
    if (!isSupportedSourceFile(abs) || isIgnoredPath(abs)) return;
    const type = event === 'rename'
      ? (fs.existsSync(abs) ? 'add' : 'unlink')
      : 'change';
    onEvent(type, posixPath);
  });
}

// ── File change event ────────────────────────────────────────

export interface FileChangeEvent {
  type: 'add' | 'change' | 'unlink';
  path: string;
}

// ── Single pipeline run ──────────────────────────────────────

interface RunOnceResult {
  code: ExitCodeValue;
  kbContent: string;
}

/**
 * @param probeAndRefine  Run probe-based evaluation after LLM generation.
 *                        Only on first run or when user presses 'r'.
 */
async function runOnce(
  ctx: RunContext,
  ownership: OwnershipMode,
  probeAndRefine = false,
  preferences?: PreferencesStore,
  activePlatforms: string[] = ['claude'],
  userSettings?: UserSettings,
): Promise<RunOnceResult> {
  const { root, flags, log } = ctx;
  const config = loadConfig(root);
  const startMs = Date.now();
  store.resetRun();
  store.setRunStartMs(startMs);
  if (config) store.addSetupNote('using config file');

  // Clean stale manifest entries (files deleted by user)
  const deletedSlugs = new Set<string>();
  const manifestPath = path.join(root, '.aspectcode', 'scoped-rules.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      const validRules = [];
      for (const entry of manifest.rules ?? []) {
        if (fs.existsSync(path.join(root, entry.path))) {
          validRules.push(entry);
        } else {
          deletedSlugs.add(entry.slug);
        }
      }
      if (deletedSlugs.size > 0) {
        fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, rules: validRules }, null, 2) + '\n');
        log.debug(`Cleaned ${deletedSlugs.size} stale manifest entries`);
      }
    } catch { /* ignore */ }
  }

  const agentsPath = path.join(root, 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) {
    store.setFirstRun(true);
  }

  // ── 1. Discover & read files ──────────────────────────────
  store.setPhase('discovering');
  const workspace = await loadWorkspaceFiles(root, config, log, { quiet: flags.quiet, spin: ctx.spin });
  if (workspace.discoveredPaths.length === 0) {
    log.warn('No source files found.');
    return { code: ExitCode.ERROR, kbContent: '' };
  }

  // ── 2. Analyze ────────────────────────────────────────────
  const spinAnalyze = ctx.spin('Analyzing…', 'analyzing');
  const model = await analyzeRepoWithDependencies(
    root,
    workspace.relativeFiles,
    workspace.absoluteFiles,
    workspace.host,
  );
  spinAnalyze.stop(`Analyzed ${model.files.length} files, ${model.graph.edges.length} edges`);
  store.setStats(model.files.length, model.graph.edges.length);

  // ── 3. Build KB ───────────────────────────────────────────
  const spinKb = ctx.spin('Building knowledge base…', 'building-kb');
  const kbContent = buildKbContent(model, root, workspace.relativeFiles);
  spinKb.stop('Knowledge base built');

  // ── 4. Read tool instruction files ────────────────────────
  const host = createNodeEmitterHost();
  const toolInstructions = await readToolInstructions(host, root);
  if (toolInstructions.size > 0) {
    store.addSetupNote(`context: ${[...toolInstructions.keys()].join(', ')}`);
  }

  // ── 5. Build base content (directly from model, no KB extraction) ──
  const baseContent = renderAgentsMd(model, path.basename(root));

  // ── 6. Generate or skip ───────────────────────────────────
  let finalContent = baseContent;

  if (ctx.generate) {
    if (!flags.dryRun) {
      await writeAgentsMd(host, root, baseContent, ownership);
      store.addOutput('AGENTS.md written (base)');
    }

    store.setPhase('optimizing');
    // No static scoped rules — the dream cycle is the sole author of rules
    let optimizeResult;
    try {
      optimizeResult = await tryOptimize(
        ctx, kbContent, toolInstructions, config, baseContent, probeAndRefine, preferences, userSettings, [],
      );
    } catch (err: any) {
      if (err?.tierExhausted) {
        store.setTierExhausted();
        optimizeResult = { content: baseContent, reasoning: [], scopedRules: [], deleteSlugs: [] };
      } else {
        throw err;
      }
    }
    finalContent = optimizeResult.content;

    store.setPhase('writing');
    if (flags.dryRun) {
      log.info(fmt.bold('Dry run — proposed AGENTS.md:'));
      log.blank();
      log.info(finalContent);
    } else {
      let previousContent: string | undefined;
      try {
        if (fs.existsSync(agentsPath)) {
          previousContent = fs.readFileSync(agentsPath, 'utf-8');
        }
      } catch { /* ignore */ }

      await writeAgentsMd(host, root, finalContent, ownership);
      const modeLabel = ownership === 'section' ? ' (section)' : '';
      const verb = optimizeResult.reasoning.length > 0 ? 'generated' : 'written';
      store.addOutput(`AGENTS.md ${verb}${modeLabel}`);

      if (previousContent !== undefined && previousContent !== baseContent) {
        store.setDiffSummary(diffSummary(previousContent, finalContent));
      }
      store.setSummary(summarizeContent(finalContent));
    }
  } else {
    store.setPhase('writing');
    if (flags.dryRun) {
      log.info(fmt.bold('Dry run — proposed AGENTS.md (KB-custom):'));
      log.blank();
      log.info(baseContent);
    } else {
      await writeAgentsMd(host, root, baseContent, ownership);
      store.addOutput('AGENTS.md written (KB-custom)');
      store.setSummary(summarizeContent(baseContent));
    }
    // No LLM available — use static extraction for scoped rules
    // No static rules in non-LLM path — dream cycle handles rules
  }

  // ── 7. Persist runtime state ───────────────────────────────
  updateRuntimeState({
    model,
    kbContent,
    agentsContent: finalContent,
    fileContents: workspace.relativeFiles,
  });

  // ── 8. Scoped rules are managed exclusively by the dream cycle.
  //    No static rules written during runOnce.

  // ── 9. Populate memory map ─────────────────────────────────
  const prefs = await loadPreferences(root);
  store.setManagedFiles(buildManagedFiles(root, prefs.preferences.length, activePlatforms));

  const elapsedMs = Date.now() - startMs;
  store.setElapsed(`${(elapsedMs / 1000).toFixed(1)}s`);
  store.setPhase('done');
  return { code: ExitCode.OK, kbContent };
}

// ── Resolve ownership mode ───────────────────────────────────

export async function resolveRunMode(root: string): Promise<RunMode> {
  const config = loadConfig(root);
  if (config?.ownership) {
    return { ownership: config.ownership, generate: true };
  }

  const agentsPath = path.join(root, 'AGENTS.md');
  let existingContent: string | null = null;

  try {
    if (fs.existsSync(agentsPath)) {
      existingContent = fs.readFileSync(agentsPath, 'utf-8');
      if (hasMarkers(existingContent)) return { ownership: 'section', generate: true };
    }
  } catch { /* fall through */ }

  try {
    const hasExisting = existingContent !== null;
    const options = hasExisting
      ? ['Full control (replace entire file)', 'Section control (preserve your content)', 'Preview current AGENTS.md']
      : ['Full control (replace entire file)', 'Section control (preserve your content)'];

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const idx = await selectPrompt(
        'How should AspectCode manage AGENTS.md?',
        options,
        0,
      );

      // Preview option — show content, then loop back to prompt
      if (hasExisting && idx === 2) {
        showFilePreview(existingContent!);
        continue;
      }

      const ownership = idx === 1 ? 'section' : 'full';
      // Save choice so we don't ask again
      saveConfig(root, { ownership });
      return { ownership, generate: true };
    }
  } catch {
    return { ownership: 'full', generate: true };
  }
}

/**
 * Display file content in a scrollable pager-like view.
 * Press any key to return.
 */
function showFilePreview(content: string): Promise<void> {
  return new Promise((resolve) => {
    const lines = content.split('\n');
    const termHeight = process.stdout.rows || 24;
    const visibleLines = termHeight - 4; // leave room for header/footer
    let scrollOffset = 0;

    const render = () => {
      process.stdout.write('\x1b[2J\x1b[H'); // clear screen
      process.stdout.write('\x1b[35m── AGENTS.md preview ──\x1b[0m\n\n');

      const slice = lines.slice(scrollOffset, scrollOffset + visibleLines);
      for (const line of slice) {
        process.stdout.write(`  ${line}\n`);
      }

      const pct = lines.length <= visibleLines
        ? 100
        : Math.round(((scrollOffset + visibleLines) / lines.length) * 100);
      process.stdout.write(`\n\x1b[90m  ↑/↓ scroll · q/esc to go back · ${pct}%\x1b[0m`);
    };

    render();

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');

    const onData = (key: string) => {
      if (key === '\x1b[A' || key === 'k') {
        scrollOffset = Math.max(0, scrollOffset - 1);
        render();
      } else if (key === '\x1b[B' || key === 'j') {
        scrollOffset = Math.min(Math.max(0, lines.length - visibleLines), scrollOffset + 1);
        render();
      } else if (key === '\x1b[5~') {
        // Page Up
        scrollOffset = Math.max(0, scrollOffset - visibleLines);
        render();
      } else if (key === '\x1b[6~') {
        // Page Down
        scrollOffset = Math.min(Math.max(0, lines.length - visibleLines), scrollOffset + visibleLines);
        render();
      } else if (key === 'q' || key === '\x1b' || key === '\r' || key === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stdout.write('\x1b[2J\x1b[H'); // clear screen
        resolve();
      } else if (key === '\x03') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.exit(130);
      }
    };

    process.stdin.on('data', onData);
  });
}

// ── Platform resolution ─────────────────────────────────────

const ALL_PLATFORMS = [
  { id: 'claude', label: 'Claude Code', detect: ['.claude'] },
  { id: 'cursor', label: 'Cursor', detect: ['.cursor', '.cursorrules'] },
  { id: 'copilot', label: 'GitHub Copilot', detect: ['.github'] },
  { id: 'windsurf', label: 'Windsurf', detect: ['.windsurfrules'] },
  { id: 'codex', label: 'Codex', detect: [] },
  { id: 'cline', label: 'Cline', detect: ['.clinerules'] },
  { id: 'gemini', label: 'Gemini', detect: ['GEMINI.md'] },
  { id: 'aider', label: 'Aider', detect: ['CONVENTIONS.md'] },
];

export async function resolvePlatforms(root: string): Promise<string[]> {
  const config = loadConfig(root);
  const configured = getConfigPlatforms(config);
  if (configured?.length) {
    // Check if collaborator has a platform not in config
    const declined = (config as any)?.declinedPlatforms as string[] ?? [];
    const detected = ALL_PLATFORMS
      .filter((p) => p.detect.some((d) => fs.existsSync(path.join(root, d))))
      .map((p) => p.id);
    const missing = detected.filter((d) => !configured.includes(d) && !declined.includes(d));
    if (missing.length > 0) {
      const names = missing.map((id) => ALL_PLATFORMS.find((p) => p.id === id)?.label ?? id).join(', ');
      const { confirmPrompt } = await import('./ui/prompts');
      const add = await confirmPrompt(`${names} detected but not configured. Add?`);
      if (add) {
        const updated = [...configured, ...missing];
        saveConfig(root, { platforms: updated });
        return updated;
      } else {
        // Remember declined so we don't ask again
        saveConfig(root, { declinedPlatforms: [...declined, ...missing] } as any);
      }
    }
    return configured;
  }

  // First run: auto-detect + prompt
  const detected = ALL_PLATFORMS
    .filter((p) => p.detect.some((d) => fs.existsSync(path.join(root, d))))
    .map((p) => p.id);
  const preselected = detected.map((id) => ALL_PLATFORMS.findIndex((p) => p.id === id)).filter((i) => i >= 0);

  try {
    const { multiSelectPrompt } = await import('./ui/prompts');
    const labels = ALL_PLATFORMS.map((p) => {
      const det = detected.includes(p.id) ? ' (detected)' : '';
      return `${p.label}${det}`;
    });
    const indices = await multiSelectPrompt('Which editors do you use?', labels, preselected);
    const selected = indices.map((i) => ALL_PLATFORMS[i].id);
    const platforms = selected.length > 0 ? selected : ['claude']; // default to Claude Code
    saveConfig(root, { platforms });
    return platforms;
  } catch {
    const platforms = detected.length > 0 ? detected : ['claude'];
    saveConfig(root, { platforms });
    return platforms;
  }
}

// ── Assessment action handler ────────────────────────────────

export interface AssessmentAction {
  type: 'dismiss' | 'confirm' | 'skip' | 'probe-and-refine' | 'login' | 'accept-ai' | 'apply-suggestions' | 'open-pricing';
  assessment?: ChangeAssessment;
  suggestions?: any[];
}

async function handleAssessmentAction(
  action: AssessmentAction,
  prefs: PreferencesStore,
  root: string,
  _ownership: OwnershipMode,
): Promise<PreferencesStore> {
  if (!action.assessment) return prefs;
  const a = action.assessment;
  const dir = path.dirname(a.file) + '/';

  if (action.type === 'dismiss') {
    // Dismiss → directory-scoped allow (broad: "this is fine here")
    prefs = addPreference(prefs, {
      rule: a.rule,
      pattern: a.message,
      disposition: 'allow',
      directory: dir,
      details: a.details,
      dependencyContext: a.dependencyContext,
    });
    savePreferences(root, prefs);
    store.setPreferenceCount(prefs.preferences.length);
    store.setLearnedMessage(`Suppressed: ${a.rule} in ${dir}`);
    store.resolveAssessment('dismiss');
    addCorrection('dismiss', a);
  } else if (action.type === 'confirm') {
    // Confirm → file-scoped deny (specific: "this matters for this file")
    prefs = addPreference(prefs, {
      rule: a.rule,
      pattern: a.message,
      disposition: 'deny',
      file: a.file,
      directory: dir,
      details: a.details,
      suggestion: a.suggestion,
      dependencyContext: a.dependencyContext,
    });
    savePreferences(root, prefs);
    store.setPreferenceCount(prefs.preferences.length);
    store.setLearnedMessage(`Enforced: ${a.rule} for ${a.file}`);
    store.setRecommendProbe(true);
    store.resolveAssessment('confirm');
    addCorrection('confirm', a);

    // Don't directly modify AGENTS.md — the dream cycle handles integration cleanly
  } else if (action.type === 'skip') {
    store.advanceAssessment();
  }

  store.setCorrectionCount(getUnprocessedCount());
  return prefs;
}

// ── Main pipeline ────────────────────────────────────────────

export async function runPipeline(ctx: RunContext): Promise<ExitCodeValue> {
  const { root, flags, log, ownership } = ctx;

  log.info(`${fmt.bold('aspectcode')} — ${fmt.cyan(root)}`);
  log.blank();
  store.setRootPath(root);

  // ── Set platforms from pre-resolved context ────────────────
  const activePlatforms = ctx.platforms;
  store.setPlatform(activePlatforms.join(', '));

  // ── Check login status ────────────────────────────────────
  const creds = loadCredentials();
  store.setUserEmail(creds?.email ?? '');

  // ── Detect tier ──────────────────────────────────────────
  const projectConfig = loadConfig(root);
  const hasByokKey = !!(projectConfig?.apiKey || process.env.ASPECTCODE_LLM_KEY);

  if (hasByokKey) {
    store.setTierInfo('byok', 0, 0);
  } else if (creds) {
    // Fetch tier + usage from verify endpoint
    try {
      const res = await fetch(`${WEB_APP_URL}/api/cli/verify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as {
          tier?: string;
          usage?: { tokensUsed?: number; tokensCap?: number; resetAt?: string | null };
        };
        const tier = (data.tier === 'PRO' ? 'pro' : 'free') as 'free' | 'pro';
        const used = data.usage?.tokensUsed ?? creds.tierTokensUsed ?? 0;
        const cap = data.usage?.tokensCap ?? creds.tierTokensCap ?? 100_000;
        const resetAt = data.usage?.resetAt ?? '';
        store.setTierInfo(tier, used, cap, resetAt || undefined);
        updateCredentials({ tier, tierTokensUsed: used, tierTokensCap: cap });
      } else if (creds.tier) {
        // Offline fallback — use cached tier
        store.setTierInfo(creds.tier, creds.tierTokensUsed ?? 0, creds.tierTokensCap ?? 100_000);
      }
    } catch {
      // Offline — use cached tier if available
      if (creds.tier) {
        store.setTierInfo(creds.tier, creds.tierTokensUsed ?? 0, creds.tierTokensCap ?? 100_000);
      }
    }
  }

  // ── Load user settings from cloud ─────────────────────────
  const userSettings = await loadUserSettings();
  // Stash for Dashboard settings panel access
  (store as any)._userSettings = userSettings;

  // ── Initial run — only probe-and-refine on first run (no existing AGENTS.md)
  const initialProbeAndRefine = !fs.existsSync(path.join(root, 'AGENTS.md'));
  const result = await runOnce(ctx, ownership, initialProbeAndRefine, undefined, activePlatforms, userSettings);
  ctx.generate = true;
  if (result.code !== ExitCode.OK) return result.code;

  if (flags.once) return ExitCode.OK;

  // ── Load preferences ───────────────────────────────────────
  let prefs = await loadPreferences(root);
  store.setPreferenceCount(prefs.preferences.length);

  // ── Resolve provider for auto-resolve in watch mode ────────
  let watchProvider: import('@aspectcode/optimizer').LlmProvider | undefined;
  try {
    const env = loadEnvFile(root);
    const watchCreds = loadCredentials();
    if (watchCreds) env['ASPECTCODE_CLI_TOKEN'] = watchCreds.token;
    if (projectConfig?.apiKey && !env['ASPECTCODE_LLM_KEY']) env['ASPECTCODE_LLM_KEY'] = projectConfig.apiKey;
    watchProvider = withUsageTracking(resolveProvider(env));
  } catch { /* no LLM — assessments go to user as before */ }

  // ── Watch mode with real-time evaluation ───────────────────
  log.blank();
  store.setPhase('watching');

  // Refresh memory map every 10s to catch file deletions/additions
  const memoryMapInterval = setInterval(() => {
    if (stopped) return;
    store.setManagedFiles(buildManagedFiles(root, prefs.preferences.length, activePlatforms));
  }, 10_000);

  let evalTimer: NodeJS.Timeout | undefined;
  let pipelineRunning = false;
  let stopped = false;
  let pendingEvalEvents: FileChangeEvent[] = [];

  // Fire an immediate dream at session start to review/prune existing rules
  let sessionDreamDone = false;
  let lastDreamAt = Date.now();

  const optLog = flags.quiet ? undefined : {
    info(msg: string)  { log.info(msg); },
    warn(msg: string)  { log.warn(msg); },
    error(msg: string) { log.error(msg); },
    debug(msg: string) { log.debug(msg); },
  };

  // ── Dream cycle (autonomous) ────────────────────────────────

  const doDreamCycle = async (): Promise<void> => {
    if (pipelineRunning || stopped) return;
    store.setDreamPrompt(false);

    const state = getRuntimeState();
    if (!state.agentsContent) return;

    let provider;
    try {
      const env = loadEnvFile(root);
      const creds = loadCredentials();
      if (creds && !env['ASPECTCODE_CLI_TOKEN']) env['ASPECTCODE_CLI_TOKEN'] = creds.token;
      provider = withUsageTracking(resolveProvider(env));
    } catch { return; }

    store.setDreaming(true);
    pipelineRunning = true;
    try {
      // Read current scoped rules for dream context
      let scopedRulesContext = '';
      try {
        const manifestPath = path.join(root, '.aspectcode', 'scoped-rules.json');
        if (fs.existsSync(manifestPath)) {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          const parts: string[] = [];
          for (const entry of manifest.rules ?? []) {
            try {
              const content = fs.readFileSync(path.join(root, entry.path), 'utf-8');
              parts.push(`### ${entry.slug} (${entry.path})\n${content}`);
            } catch { /* skip missing files */ }
          }
          scopedRulesContext = parts.join('\n---\n');
        }
      } catch { /* ignore */ }

      const result = await runDreamCycle({
        currentAgentsMd: state.agentsContent,
        corrections: getCorrections(),
        provider,
        log: optLog,
        scopedRulesContext,
      });
      const host = createNodeEmitterHost();
      await writeAgentsMd(host, root, result.updatedAgentsMd, ownership);
      updateRuntimeState({ agentsContent: result.updatedAgentsMd });
      // Write any scoped rules from the dream cycle
      if ((result.scopedRules.length > 0 || result.deleteSlugs.length > 0) && activePlatforms.length > 0) {
        // Delete rules the dream cycle marked for removal
        if (result.deleteSlugs.length > 0) {
          await deleteScopedRules(host, root, result.deleteSlugs);
        }
        if (result.scopedRules.length > 0) {
          await writeRulesForPlatforms(host, root, result.scopedRules, activePlatforms);
        }
      }
      markProcessed();
      store.setCorrectionCount(getUnprocessedCount());
      saveDreamState(root, { lastDreamAt: new Date().toISOString() });
      store.setLearnedMessage(`Refined: ${result.changes.join(', ')}`);
      // Refresh memory map to reflect any new files
      store.setManagedFiles(buildManagedFiles(root, (await loadPreferences(root)).preferences.length, activePlatforms));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Dream cycle failed: ${msg}`);
    } finally {
      pipelineRunning = false;
      store.setDreaming(false);
    }
  };

  // Auto-dream timer: fires every 30s, dreams if corrections exist and 2+ min since last dream
  const AUTO_DREAM_INTERVAL_MS = 2 * 60 * 1000;
  const autoDreamTimer = setInterval(() => {
    if (stopped || pipelineRunning) return;
    if (getUnprocessedCount() === 0) return;
    if (Date.now() - lastDreamAt < AUTO_DREAM_INTERVAL_MS) return;
    void doDreamCycle().then(() => { lastDreamAt = Date.now(); });
  }, 30_000);

  // ── Session-start dream: review rules immediately ───────────
  if (watchProvider) {
    // Small delay to let the dashboard render first
    setTimeout(() => {
      if (stopped || pipelineRunning || sessionDreamDone) return;
      sessionDreamDone = true;
      void doDreamCycle().then(() => { lastDreamAt = Date.now(); });
    }, 3000);
  }

  // ── Probe and refine (manual via 'r' key) ──────────────────

  const doProbeAndRefine = async (): Promise<void> => {
    if (stopped || pipelineRunning) return;
    // Run pending dream cycle before full probe-and-refine
    // Dream before re-running if corrections exist
    if (getUnprocessedCount() > 0) await doDreamCycle();
    if (pipelineRunning) return;
    pipelineRunning = true;
    if (evalTimer) { clearTimeout(evalTimer); evalTimer = undefined; }
    pendingEvalEvents.length = 0;
    store.setRecommendProbe(false);
    try {
      await runOnce(ctx, ownership, true, prefs, activePlatforms, userSettings);
      prefs = await loadPreferences(root);
      store.setPreferenceCount(prefs.preferences.length);
      store.setPhase('watching');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Probe and refine failed: ${msg}`);
    } finally {
      pipelineRunning = false;
    }
  };

  // ── Evaluate file changes (fast, no LLM) ──────────────────

  const RECOMMEND_THRESHOLD = 10;

  const evaluateEvents = async (events: FileChangeEvent[]): Promise<void> => {
    const state = getRuntimeState();
    if (!state.model || !state.agentsContent) return;

    for (const event of events) {
      trackChange(event);

      // Track add vs change counts
      if (event.type === 'add') store.incrementAddCount();
      else if (event.type === 'change') store.incrementChangeCount();

      if (event.type !== 'unlink') {
        try {
          const absPath = path.join(root, event.path);
          if (fs.existsSync(absPath)) {
            const content = fs.readFileSync(absPath, 'utf-8');
            state.fileContents?.set(event.path, content);
          }
        } catch { /* skip unreadable files */ }
      }

      const assessments = evaluateChange(event, {
        model: state.model,
        agentsContent: state.agentsContent,
        preferences: prefs,
        recentChanges: getRecentChanges(),
        fileContents: state.fileContents,
      });

      // Auto-resolve assessments with LLM when available
      const actionable = assessments.filter((a) => a.type !== 'ok');
      const threshold = flags.background ? 0.0 : (userSettings?.autoResolveThreshold ?? 0.8);

      if (watchProvider && actionable.length > 0) {
        const forwarded: ChangeAssessment[] = [];
        for (const a of actionable) {
          try {
            const result = await autoResolveAssessment(a, prefs, watchProvider, { threshold });
            if (result.autoResolved) {
              const dir = path.dirname(a.file) + '/';
              if (result.decision === 'allow') {
                prefs = addPreference(prefs, { rule: a.rule, pattern: a.message, disposition: 'allow', directory: dir, details: a.details, dependencyContext: a.dependencyContext });
              } else {
                prefs = addPreference(prefs, { rule: a.rule, pattern: a.message, disposition: 'deny', file: a.file, directory: dir, details: a.details, suggestion: a.suggestion, dependencyContext: a.dependencyContext });
              }
              savePreferences(root, prefs);
              store.setPreferenceCount(prefs.preferences.length);
              addCorrection(result.decision === 'allow' ? 'dismiss' : 'confirm', a);
              store.setLearnedMessage(`Auto: ${result.decision} ${a.rule} (${Math.round(result.confidence * 100)}%)`);
              const stats = { ...store.state.assessmentStats };
              stats.autoResolved++;
              store.state.assessmentStats = stats;
            } else {
              // Attach recommendation for display
              a.llmRecommendation = { decision: result.decision, confidence: result.confidence, reasoning: result.reasoning };
              forwarded.push(a);
            }
          } catch (err: any) {
            if (err?.tierExhausted) { store.setTierExhausted(); }
            forwarded.push(a); // LLM failed — forward to user
          }
        }
        store.pushAssessments(forwarded);
      } else {
        store.pushAssessments(assessments);
      }

      // Change flash for clean changes
      const hasNonOk = assessments.some((a) => a.type !== 'ok');
      if (!hasNonOk) {
        store.setLastChangeFlash(`${event.path} — ok`);
      }
    }

    // Auto-recommend probe-and-refine
    const stats = store.state.assessmentStats;
    if (stats.changes >= RECOMMEND_THRESHOLD && !store.state.recommendProbe) {
      store.setRecommendProbe(true);
    }
  };

  // ── File change handler ────────────────────────────────────

  const onFsEvent = (eventType: 'add' | 'change' | 'unlink', eventPath: string) => {
    if (pipelineRunning) return;
    const abs = path.resolve(root, eventPath);
    if (!isSupportedSourceFile(abs) || isIgnoredPath(abs)) return;

    const posixPath = eventPath.replace(/\\/g, '/');
    pendingEvalEvents.push({ type: eventType, path: posixPath });

    if (evalTimer) clearTimeout(evalTimer);
    evalTimer = setTimeout(() => {
      evalTimer = undefined;
      const events = pendingEvalEvents.splice(0);
      evaluateEvents(events);
    }, EVAL_DEBOUNCE_MS);
  };

  // ── Start watcher (must be after onFsEvent is defined) ─────

  const watcher = createFileWatcher(root, onFsEvent);
  watcher.on('error', (e: unknown) => log.error(`Watcher error: ${String(e)}`));

  // ── Expose action handler for keyboard input ───────────────
  const onAssessmentAction = (action: AssessmentAction): void => {
    if (action.type === 'probe-and-refine') {
      void doProbeAndRefine();
      return;
    }
    // Dream cycle is autonomous — no manual trigger
    if (action.type === 'open-pricing') {
      const { exec } = require('child_process');
      const url = 'https://aspectcode.com/pricing';
      const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
      exec(`${cmd} "${url}"`);
      store.setLearnedMessage('opened pricing page');
      return;
    }
    if (action.type === 'login') {
      store.setLearnedMessage('opening browser…');
      void startBackgroundLogin().then((email) => {
        if (email) {
          store.setUserEmail(email);
          store.setLearnedMessage(`logged in as ${email}`);
        } else {
          store.setLearnedMessage('login failed or timed out');
        }
      });
      return;
    }
    void handleAssessmentAction(action, prefs, root, ownership).then((updated) => {
      prefs = updated;
    });
  };

  (store as any)._onAssessmentAction = onAssessmentAction;

  return await new Promise<ExitCodeValue>((resolve) => {
    const shutdown = async (signal: string) => {
      if (stopped) return;
      stopped = true;
      clearInterval(memoryMapInterval);
      clearInterval(autoDreamTimer);
      if (evalTimer) { clearTimeout(evalTimer); evalTimer = undefined; }
      log.blank();
      log.info(fmt.dim(`Stopping (${signal})…`));
      await watcher.close();
      resolve(ExitCode.OK);
    };

    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
  });
}
