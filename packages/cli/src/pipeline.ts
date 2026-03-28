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
import { createNodeEmitterHost, generateCanonicalContentForMode, generateKbCustomContent } from '@aspectcode/emitters';
import type { RunContext, RunMode } from './cli';
import { ExitCode } from './cli';
import type { ExitCodeValue } from './cli';
import { loadConfig, loadUserSettings } from './config';
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
  shouldDream,
  getCorrections,
  markProcessed,
  getUnprocessedCount,
  deriveLearnedRule,
  appendLearnedRule,
  runDreamCycle,
  saveDreamState,
} from './dreamCycle';
import { extractScopedRules, writeScopedRules } from './scopedRules';
import { loadCredentials, startBackgroundLogin } from './auth';
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
  platform: 'claude' | 'cursor' | '' = '',
): ManagedFile[] {
  const files: ManagedFile[] = [];

  // ── Workspace-scope: AGENTS.md ──────────────────────────────
  const agentsAbs = path.join(root, 'AGENTS.md');
  if (fs.existsSync(agentsAbs)) {
    files.push({ path: 'AGENTS.md', annotation: '', updatedAt: fileMtime(agentsAbs), category: 'agents', scope: 'workspace', owner: 'aspectcode' });
  }

  // ── Workspace-scope: platform instruction files ─────────────
  if (platform === 'claude') {
    const claudeMdAbs = path.join(root, 'CLAUDE.md');
    if (fs.existsSync(claudeMdAbs)) {
      files.push({ path: 'CLAUDE.md', annotation: '○ user', updatedAt: fileMtime(claudeMdAbs), category: 'workspace-config', scope: 'workspace', owner: 'user' });
    }
  } else if (platform === 'cursor') {
    const cursorrules = path.join(root, '.cursorrules');
    if (fs.existsSync(cursorrules)) {
      files.push({ path: '.cursorrules', annotation: '○ user', updatedAt: fileMtime(cursorrules), category: 'workspace-config', scope: 'workspace', owner: 'user' });
    }
  }

  // ── Workspace-scope: scoped rules from manifest ─────────────
  const manifestPath = path.join(root, '.aspectcode', 'scoped-rules.json');
  const manifestRulePaths = new Set<string>();
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      for (const entry of manifest.rules ?? []) {
        if (manifestRulePaths.has(entry.path)) continue;
        manifestRulePaths.add(entry.path);
        const cat = (entry.path as string).startsWith('.claude/') ? 'claude-rule'
          : (entry.path as string).startsWith('.cursor/') ? 'cursor-rule'
          : 'agents';
        const abs = path.join(root, entry.path);
        files.push({ path: entry.path, annotation: '● active', updatedAt: fileMtime(abs), category: cat as ManagedFile['category'], scope: 'workspace', owner: 'aspectcode' });
      }
    } catch { /* malformed manifest */ }
  }

  // ── Workspace-scope: user-created scoped rules ──────────────
  if (platform === 'claude' || platform === 'cursor') {
    const rulesDir = platform === 'claude' ? '.claude/rules' : '.cursor/rules';
    const ext = platform === 'claude' ? '.md' : '.mdc';
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
  if (platform === 'claude') {
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
  if (platform === 'claude') {
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
  activePlatform?: string,
  userSettings?: UserSettings,
): Promise<RunOnceResult> {
  const { root, flags, log } = ctx;
  const config = loadConfig(root);
  const startMs = Date.now();
  store.resetRun();
  store.setRunStartMs(startMs);
  if (config) store.addSetupNote('using config file');

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

  // ── 5. Build base content ─────────────────────────────────
  const baseContent = kbContent.length > 0
    ? generateKbCustomContent(kbContent, 'safe')
    : generateCanonicalContentForMode('safe', false);

  // ── 6. Generate or skip ───────────────────────────────────
  let finalContent = baseContent;

  if (ctx.generate) {
    if (!flags.dryRun) {
      await writeAgentsMd(host, root, baseContent, ownership);
      store.addOutput('AGENTS.md written (base)');
    }

    store.setPhase('optimizing');
    const optimizeResult = await tryOptimize(
      ctx, kbContent, toolInstructions, config, baseContent, probeAndRefine, preferences, userSettings,
    );
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
  }

  // ── 7. Persist runtime state ───────────────────────────────
  updateRuntimeState({
    model,
    kbContent,
    agentsContent: finalContent,
    fileContents: workspace.relativeFiles,
  });

  // ── 8. Write scoped rules for active platform ──────────────
  if (!flags.dryRun) {
    const platform = activePlatform === 'claude' ? 'claudeCode' as const : 'cursor' as const;
    const scopedRules = extractScopedRules(model);
    const written = await writeScopedRules(host, root, scopedRules, platform);
    if (written.length > 0) {
      store.addOutput(`${written.length} scoped rule${written.length === 1 ? '' : 's'}`);
    }
  }

  // ── 9. Populate memory map ─────────────────────────────────
  const prefs = await loadPreferences(root);
  store.setManagedFiles(buildManagedFiles(root, prefs.preferences.length, (activePlatform as 'claude' | 'cursor') || ''));

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

  try {
    const agentsPath = path.join(root, 'AGENTS.md');
    if (fs.existsSync(agentsPath)) {
      const existing = fs.readFileSync(agentsPath, 'utf-8');
      if (hasMarkers(existing)) return { ownership: 'section', generate: true };
      return { ownership: 'full', generate: false };
    }
  } catch { /* fall through */ }

  try {
    const idx = await selectPrompt(
      'How should AspectCode manage AGENTS.md?',
      ['Full control (replace entire file)', 'Section control (preserve your content)'],
      0,
    );
    return { ownership: idx === 1 ? 'section' : 'full', generate: true };
  } catch {
    return { ownership: 'full', generate: true };
  }
}

// ── Assessment action handler ────────────────────────────────

export interface AssessmentAction {
  type: 'dismiss' | 'confirm' | 'skip' | 'probe-and-refine' | 'dream' | 'login';
  assessment?: ChangeAssessment;
}

async function handleAssessmentAction(
  action: AssessmentAction,
  prefs: PreferencesStore,
  root: string,
  ownership: OwnershipMode,
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

    // Append immediate learned rule to AGENTS.md
    const rule = deriveLearnedRule(a);
    const state = getRuntimeState();
    if (state.agentsContent) {
      const updated = appendLearnedRule(state.agentsContent, rule);
      updateRuntimeState({ agentsContent: updated });
      const host = createNodeEmitterHost();
      await writeAgentsMd(host, root, updated, ownership);
    }
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

  // ── Resolve platform (Claude Code default, --cursor overrides) ──
  const activePlatform = flags.cursor ? 'cursor' : 'claude';
  store.setPlatform(activePlatform);

  // ── Check login status ────────────────────────────────────
  const creds = loadCredentials();
  store.setUserEmail(creds?.email ?? '');

  // ── Load user settings from cloud ─────────────────────────
  const userSettings = await loadUserSettings();

  // ── Initial run (with probe and refine) ────────────────────
  const result = await runOnce(ctx, ownership, true, undefined, activePlatform, userSettings);
  ctx.generate = true;
  if (result.code !== ExitCode.OK) return result.code;

  if (flags.once) return ExitCode.OK;

  // ── Load preferences ───────────────────────────────────────
  let prefs = await loadPreferences(root);
  store.setPreferenceCount(prefs.preferences.length);

  // ── Watch mode with real-time evaluation ───────────────────
  log.blank();
  store.setPhase('watching');

  let evalTimer: NodeJS.Timeout | undefined;
  let pipelineRunning = false;
  let stopped = false;
  let pendingEvalEvents: FileChangeEvent[] = [];
  let dreamTimer: NodeJS.Timeout | undefined;
  let dreamPromptShown = false;

  const optLog = flags.quiet ? undefined : {
    info(msg: string)  { log.info(msg); },
    warn(msg: string)  { log.warn(msg); },
    error(msg: string) { log.error(msg); },
    debug(msg: string) { log.debug(msg); },
  };

  // ── Dream cycle (d key or auto after 2 min) ────────────────

  const doDreamCycle = async (): Promise<void> => {
    if (pipelineRunning) return;
    if (dreamTimer) { clearTimeout(dreamTimer); dreamTimer = undefined; }
    dreamPromptShown = false;
    store.setDreamPrompt(false);

    const state = getRuntimeState();
    if (!state.agentsContent) return;

    let provider;
    try {
      const env = loadEnvFile(root);
      provider = resolveProvider(env);
    } catch { return; }

    store.setDreaming(true);
    pipelineRunning = true;
    try {
      const result = await runDreamCycle({
        currentAgentsMd: state.agentsContent,
        corrections: getCorrections(),
        provider,
        log: optLog,
      });
      const host = createNodeEmitterHost();
      await writeAgentsMd(host, root, result.updatedAgentsMd, ownership);
      updateRuntimeState({ agentsContent: result.updatedAgentsMd });
      // Write any scoped rules from the dream cycle
      if (result.scopedRules.length > 0 && activePlatform) {
        const plat = activePlatform === 'claude' ? 'claudeCode' as const : 'cursor' as const;
        await writeScopedRules(host, root, result.scopedRules, plat);
      }
      markProcessed();
      store.setCorrectionCount(getUnprocessedCount());
      saveDreamState(root, { lastDreamAt: new Date().toISOString() });
      store.setLearnedMessage(`Refined: ${result.changes.join(', ')}`);
      // Refresh memory map to reflect any new files
      store.setManagedFiles(buildManagedFiles(root, (await loadPreferences(root)).preferences.length, activePlatform as 'claude' | 'cursor'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Dream cycle failed: ${msg}`);
    } finally {
      pipelineRunning = false;
      store.setDreaming(false);
    }
  };

  const checkDreamThreshold = (): void => {
    if (shouldDream() && !dreamPromptShown) {
      store.setDreamPrompt(true);
      dreamPromptShown = true;
      dreamTimer = setTimeout(() => void doDreamCycle(), 2 * 60 * 1000);
    }
  };

  // ── Probe and refine (manual via 'r' key) ──────────────────

  const doProbeAndRefine = async (): Promise<void> => {
    if (stopped || pipelineRunning) return;
    // Run pending dream cycle before full probe-and-refine
    if (shouldDream()) await doDreamCycle();
    if (pipelineRunning) return; // doDreamCycle may have set this
    pipelineRunning = true;
    if (evalTimer) { clearTimeout(evalTimer); evalTimer = undefined; }
    pendingEvalEvents.length = 0;
    store.setRecommendProbe(false);
    try {
      await runOnce(ctx, ownership, true, prefs, activePlatform, userSettings);
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

  const evaluateEvents = (events: FileChangeEvent[]): void => {
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

      store.pushAssessments(assessments);

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
    if (action.type === 'dream') {
      void doDreamCycle();
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
      checkDreamThreshold();
    });
  };

  (store as any)._onAssessmentAction = onAssessmentAction;

  return await new Promise<ExitCodeValue>((resolve) => {
    const shutdown = async (signal: string) => {
      if (stopped) return;
      stopped = true;
      if (evalTimer) { clearTimeout(evalTimer); evalTimer = undefined; }
      if (dreamTimer) { clearTimeout(dreamTimer); dreamTimer = undefined; }
      log.blank();
      log.info(fmt.dim(`Stopping (${signal})…`));
      await watcher.close();
      resolve(ExitCode.OK);
    };

    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
  });
}
