/**
 * SQLite-based prompt harvester for VS Code forks (Copilot Chat, Cursor, Windsurf).
 *
 * All three store conversations in `state.vscdb` — a SQLite database with an
 * `ItemTable(key TEXT, value TEXT)` key-value schema. The difference is which
 * keys hold the conversation data and the JSON shape within.
 *
 * `better-sqlite3` is an optional dependency. If unavailable, these
 * harvesters gracefully return empty arrays.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { HarvestedPrompt } from '../types';
import {
  extractFilePaths,
  filterRecent,
  vscodeForkStoragePaths,
  vscodeWorkspaceStoragePath,
  DEFAULT_MAX_PER_SOURCE,
  noopLogger,
} from './common';
import type { OptLogger } from '../types';

// ── SQLite availability check ───────────────────────────────

let Database: any;

function loadSqlite(): boolean {
  if (Database !== undefined) return Database !== null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Database = require('better-sqlite3');
    return true;
  } catch {
    Database = null;
    return false;
  }
}

/**
 * Read a key from a state.vscdb file. Returns undefined if the key
 * doesn't exist or the DB can't be opened.
 */
function readVscdbKey(dbPath: string, key: string): string | undefined {
  if (!loadSqlite() || !fs.existsSync(dbPath)) return undefined;
  let db: any;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get(key);
    return row?.value ?? undefined;
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

/**
 * Read ALL keys matching a pattern from a state.vscdb file.
 */
function readVscdbKeysLike(dbPath: string, pattern: string): Array<{ key: string; value: string }> {
  if (!loadSqlite() || !fs.existsSync(dbPath)) return [];
  let db: any;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    return db.prepare('SELECT key, value FROM ItemTable WHERE key LIKE ?').all(pattern);
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

// ── Copilot Chat ────────────────────────────────────────────

/**
 * Harvest prompts from GitHub Copilot Chat conversations.
 */
export async function harvestCopilotChat(
  root: string,
  options?: { max?: number; since?: Date; log?: OptLogger },
): Promise<HarvestedPrompt[]> {
  const log = options?.log ?? noopLogger;
  const max = options?.max ?? DEFAULT_MAX_PER_SOURCE;

  if (!loadSqlite()) {
    log.debug('copilot-chat: better-sqlite3 not available, skipping');
    return [];
  }

  const prompts: HarvestedPrompt[] = [];

  // Strategy 1: Check workspace storage state.vscdb files
  const wsStorageBase = vscodeWorkspaceStoragePath();
  if (fs.existsSync(wsStorageBase)) {
    try {
      const workspaces = fs.readdirSync(wsStorageBase);
      for (const ws of workspaces) {
        const dbPath = path.join(wsStorageBase, ws, 'state.vscdb');
        const parsed = parseCopilotFromVscdb(dbPath, root, log);
        prompts.push(...parsed);
      }
    } catch (err) {
      log.debug(`copilot-chat: failed scanning workspace storage: ${err}`);
    }
  }

  // Strategy 2: Check older extension-based storage
  const globalStorageDir = path.join(
    getVscodeDataDir(),
    'User', 'globalStorage', 'github.copilot-chat',
  );
  const conversationsFile = path.join(globalStorageDir, 'conversations.json');
  if (fs.existsSync(conversationsFile)) {
    try {
      const content = fs.readFileSync(conversationsFile, 'utf-8');
      const data = JSON.parse(content);
      const parsed = parseCopilotConversationsJson(data, root);
      prompts.push(...parsed);
    } catch (err) {
      log.debug(`copilot-chat: failed parsing conversations.json: ${err}`);
    }
  }

  log.debug(`copilot-chat: parsed ${prompts.length} conversation turns`);
  return filterRecent(prompts, options?.since, max);
}

function parseCopilotFromVscdb(dbPath: string, root: string, _log: OptLogger): HarvestedPrompt[] {
  // Try known keys for chat sessions
  const keyPatterns = ['interactive.sessions', 'chat.workspaceState', '%chat%'];
  const prompts: HarvestedPrompt[] = [];

  for (const pattern of keyPatterns) {
    let rows: Array<{ key: string; value: string }>;
    if (pattern.includes('%')) {
      rows = readVscdbKeysLike(dbPath, pattern);
    } else {
      const value = readVscdbKey(dbPath, pattern);
      rows = value ? [{ key: pattern, value }] : [];
    }

    for (const row of rows) {
      try {
        const data = JSON.parse(row.value);
        const parsed = parseCopilotSessionData(data, root);
        prompts.push(...parsed);
      } catch {
        // Unparseable value, skip
      }
    }
  }

  return prompts;
}

function parseCopilotSessionData(data: any, root: string): HarvestedPrompt[] {
  const prompts: HarvestedPrompt[] = [];

  // Handle array of sessions or single session
  const sessions = Array.isArray(data) ? data : [data];

  for (const session of sessions) {
    const requests = session.requests || session.entries || [];
    for (const req of requests) {
      const userText = req.message || req.text || req.prompt || '';
      const assistantText = req.response?.value || req.response?.text || req.result?.text || '';

      if (!userText || !assistantText) continue;

      const fileRefs: string[] = [];
      if (Array.isArray(req.references)) {
        for (const ref of req.references) {
          if (ref.uri && typeof ref.uri === 'string') {
            // Extract path from file:// URI
            const filePath = ref.uri.replace(/^file:\/\/\//, '').replace(/\\/g, '/');
            fileRefs.push(filePath);
          }
        }
      }

      const allText = userText + '\n' + assistantText;
      prompts.push({
        source: 'copilot-chat',
        timestamp: req.timestamp ? new Date(req.timestamp).toISOString() : undefined,
        userPrompt: userText,
        assistantResponse: assistantText,
        filesReferenced: [...new Set([...extractFilePaths(allText, root), ...fileRefs])],
      });
    }
  }

  return prompts;
}

function parseCopilotConversationsJson(data: any, root: string): HarvestedPrompt[] {
  // Older format: { sessions: [{ requests: [...] }] } or just an array
  if (data.sessions) return parseCopilotSessionData(data.sessions, root);
  if (Array.isArray(data)) return parseCopilotSessionData(data, root);
  return [];
}

// ── Cursor ──────────────────────────────────────────────────

/**
 * Harvest prompts from Cursor's conversation history.
 */
export async function harvestCursor(
  root: string,
  options?: { max?: number; since?: Date; log?: OptLogger },
): Promise<HarvestedPrompt[]> {
  const log = options?.log ?? noopLogger;
  const max = options?.max ?? DEFAULT_MAX_PER_SOURCE;

  if (!loadSqlite()) {
    log.debug('cursor: better-sqlite3 not available, skipping');
    return [];
  }

  const [globalDb, wsStorageBase] = vscodeForkStoragePaths('Cursor');
  const prompts: HarvestedPrompt[] = [];

  // Check global state.vscdb
  const globalParsed = parseCursorDb(globalDb, root, log);
  prompts.push(...globalParsed);

  // Check workspace storage state.vscdb files
  if (fs.existsSync(wsStorageBase)) {
    try {
      const workspaces = fs.readdirSync(wsStorageBase);
      for (const ws of workspaces) {
        const dbPath = path.join(wsStorageBase, ws, 'state.vscdb');
        const parsed = parseCursorDb(dbPath, root, log);
        prompts.push(...parsed);
      }
    } catch (err) {
      log.debug(`cursor: failed scanning workspace storage: ${err}`);
    }
  }

  log.debug(`cursor: parsed ${prompts.length} conversation turns`);
  return filterRecent(prompts, options?.since, max);
}

function parseCursorDb(dbPath: string, root: string, log: OptLogger): HarvestedPrompt[] {
  const prompts: HarvestedPrompt[] = [];

  // Try known keys for Cursor chat data
  const chatKeys = ['composerData', 'aiChat.panelChats', 'workbench.panel.chat'];
  for (const key of chatKeys) {
    const value = readVscdbKey(dbPath, key);
    if (!value) continue;

    try {
      const data = JSON.parse(value);
      if (key === 'composerData') {
        prompts.push(...parseCursorComposer(data, root));
      } else {
        prompts.push(...parseCursorPanelChats(data, root));
      }
    } catch (err) {
      log.debug(`cursor: failed parsing key ${key}: ${err}`);
    }
  }

  return prompts;
}

function parseCursorComposer(data: any, root: string): HarvestedPrompt[] {
  const prompts: HarvestedPrompt[] = [];
  const composers = data.allComposers || data.composers || [];

  for (const composer of composers) {
    const conversation = composer.conversation || [];
    for (let i = 0; i < conversation.length; i++) {
      const msg = conversation[i];
      // type 1 = user, type 2 = assistant
      if (msg.type !== 1) continue;

      const next = conversation[i + 1];
      if (!next || next.type !== 2) continue;

      const userText = msg.text || '';
      const assistantText = next.text || '';
      if (!userText || !assistantText) continue;

      const fileRefs = extractCursorContextFiles(msg.context);
      const allText = userText + '\n' + assistantText;

      prompts.push({
        source: 'cursor',
        userPrompt: userText,
        assistantResponse: assistantText,
        filesReferenced: [...new Set([...extractFilePaths(allText, root), ...fileRefs])],
      });

      i++; // Skip the assistant message
    }
  }

  return prompts;
}

function parseCursorPanelChats(data: any, root: string): HarvestedPrompt[] {
  const prompts: HarvestedPrompt[] = [];
  const panels = data.panelChats || data.chats || [];

  for (const panel of panels) {
    if (panel.isDeleted) continue;
    const messages = panel.messages || [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== 'user') continue;

      const next = messages[i + 1];
      if (!next || next.role !== 'assistant') continue;

      const userText = msg.content || '';
      const assistantText = next.content || '';
      if (!userText || !assistantText) continue;

      const fileRefs = extractCursorContextFiles(next.context);
      const timestamp = msg.timestamp
        ? new Date(msg.timestamp).toISOString()
        : undefined;
      const allText = userText + '\n' + assistantText;

      prompts.push({
        source: 'cursor',
        timestamp,
        userPrompt: userText,
        assistantResponse: assistantText,
        filesReferenced: [...new Set([...extractFilePaths(allText, root), ...fileRefs])],
      });

      i++; // Skip the assistant message
    }
  }

  return prompts;
}

function extractCursorContextFiles(context: any): string[] {
  if (!context) return [];
  const files: string[] = [];
  if (Array.isArray(context.files)) {
    for (const f of context.files) {
      if (typeof f === 'string') files.push(f.replace(/\\/g, '/'));
    }
  }
  if (Array.isArray(context.selections)) {
    for (const s of context.selections) {
      if (s.uri && typeof s.uri === 'string') {
        files.push(s.uri.replace(/^file:\/\/\//, '').replace(/\\/g, '/'));
      }
    }
  }
  return files;
}

// ── Windsurf ────────────────────────────────────────────────

/**
 * Harvest prompts from Windsurf's conversation history.
 */
export async function harvestWindsurf(
  root: string,
  options?: { max?: number; since?: Date; log?: OptLogger },
): Promise<HarvestedPrompt[]> {
  const log = options?.log ?? noopLogger;
  const max = options?.max ?? DEFAULT_MAX_PER_SOURCE;

  if (!loadSqlite()) {
    log.debug('windsurf: better-sqlite3 not available, skipping');
    return [];
  }

  const prompts: HarvestedPrompt[] = [];

  // Try both "Windsurf" and "Codeium" (legacy name)
  for (const appName of ['Windsurf', 'Codeium']) {
    const [globalDb, wsStorageBase] = vscodeForkStoragePaths(appName);

    // Check global state.vscdb
    const globalParsed = parseWindsurfDb(globalDb, root, log);
    prompts.push(...globalParsed);

    // Check workspace storage
    if (fs.existsSync(wsStorageBase)) {
      try {
        const workspaces = fs.readdirSync(wsStorageBase);
        for (const ws of workspaces) {
          const dbPath = path.join(wsStorageBase, ws, 'state.vscdb');
          const parsed = parseWindsurfDb(dbPath, root, log);
          prompts.push(...parsed);
        }
      } catch (err) {
        log.debug(`windsurf: failed scanning ${appName} workspace storage: ${err}`);
      }
    }
  }

  log.debug(`windsurf: parsed ${prompts.length} conversation turns`);
  return filterRecent(prompts, options?.since, max);
}

function parseWindsurfDb(dbPath: string, root: string, log: OptLogger): HarvestedPrompt[] {
  const prompts: HarvestedPrompt[] = [];

  // Try known keys for Windsurf/Cascade conversations
  const candidates = ['cascadeHistory', 'cascade.conversations'];
  for (const key of candidates) {
    const value = readVscdbKey(dbPath, key);
    if (!value) continue;

    try {
      const data = JSON.parse(value);
      prompts.push(...parseWindsurfConversations(data, root));
    } catch (err) {
      log.debug(`windsurf: failed parsing key ${key}: ${err}`);
    }
  }

  // Also try LIKE query for cascade-related keys
  const likeRows = readVscdbKeysLike(dbPath, '%cascade%');
  for (const row of likeRows) {
    if (candidates.includes(row.key)) continue; // Already tried
    try {
      const data = JSON.parse(row.value);
      prompts.push(...parseWindsurfConversations(data, root));
    } catch {
      // Skip unparseable
    }
  }

  return prompts;
}

function parseWindsurfConversations(data: any, root: string): HarvestedPrompt[] {
  const prompts: HarvestedPrompt[] = [];

  // Try multiple possible structures
  const conversations = data.conversations || data.chats || (Array.isArray(data) ? data : [data]);

  for (const conv of conversations) {
    const messages = conv.messages || conv.turns || [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role !== 'user') continue;

      const next = messages[i + 1];
      if (!next || next.role !== 'assistant') continue;

      const userText = msg.content || msg.text || '';
      const assistantText = next.content || next.text || '';
      if (!userText || !assistantText) continue;

      const allText = userText + '\n' + assistantText;
      const timestamp = msg.timestamp
        ? (typeof msg.timestamp === 'number'
          ? new Date(msg.timestamp).toISOString()
          : msg.timestamp)
        : undefined;

      prompts.push({
        source: 'windsurf',
        timestamp,
        userPrompt: userText,
        assistantResponse: assistantText,
        filesReferenced: extractFilePaths(allText, root),
      });

      i++; // Skip the assistant message
    }
  }

  return prompts;
}

// ── Helpers ─────────────────────────────────────────────────

function getVscodeDataDir(): string {
  const platform = os.platform();
  const home = os.homedir();
  if (platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Code');
  } else if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Code');
  } else {
    return path.join(home, '.config', 'Code');
  }
}
