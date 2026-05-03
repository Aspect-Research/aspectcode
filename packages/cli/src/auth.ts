/**
 * aspectcode CLI — authentication (login/logout/whoami).
 *
 * Uses a browser-based OAuth flow: the CLI opens the user's browser to the
 * Aspect Code web app, which handles Google OAuth and redirects back to a
 * temporary localhost server with a CLI token.
 */

import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { fmt } from './logger';

export const WEB_APP_URL = process.env.ASPECTCODE_WEB_URL ?? 'https://aspectcode.com';
const CREDENTIALS_DIR = path.join(os.homedir(), '.aspectcode');
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, 'credentials.json');

interface Credentials {
  token: string;
  email?: string;
  createdAt: string;
  tier?: 'hosted';
  tierTokensUsed?: number;
  tierTokensCap?: number;
}

// ── Credentials helpers ─────────────────────────────────────

export function loadCredentials(): Credentials | null {
  try {
    if (!fs.existsSync(CREDENTIALS_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf-8')) as Credentials & { tier?: string };
    // Normalize legacy tier values ('free' | 'pro') from older clients.
    if (parsed.tier && parsed.tier !== 'hosted') parsed.tier = 'hosted';
    return parsed as Credentials;
  } catch {
    return null;
  }
}

function saveCredentials(creds: Credentials): void {
  if (!fs.existsSync(CREDENTIALS_DIR)) {
    fs.mkdirSync(CREDENTIALS_DIR, { recursive: true });
  }
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2) + '\n', {
    mode: 0o600,
  });
}

export function updateCredentials(update: Partial<Credentials>): void {
  const existing = loadCredentials();
  if (!existing) return;
  saveCredentials({ ...existing, ...update });
}

function clearCredentials(): void {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) fs.unlinkSync(CREDENTIALS_FILE);
  } catch {
    // ignore
  }
}

// ── Open browser (cross-platform) ──────────────────────────

async function openBrowser(url: string): Promise<void> {
  const { exec } = await import('child_process');
  const cmd =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'start ""'
        : 'xdg-open';
  exec(`${cmd} "${url}"`);
}

// ── Background login (for dashboard use) ────────────────────

/**
 * Start a browser-based login flow in the background.
 * Returns a promise that resolves with the email on success, or null on failure.
 * Does not use console.log — safe to call while ink is rendering.
 */
export async function startBackgroundLogin(): Promise<string | null> {
  const existing = loadCredentials();
  if (existing) return existing.email ?? null;

  const state = crypto.randomBytes(16).toString('hex');

  try {
    const { token, receivedState } = await new Promise<{
      token: string;
      receivedState: string;
    }>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost`);
        if (url.pathname === '/callback') {
          const tk = url.searchParams.get('token');
          const rs = url.searchParams.get('state');
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<!DOCTYPE html><html><head><style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0a;color:#fafafa}.container{text-align:center;max-width:400px;padding:2rem}h1{font-size:1.5rem;margin-bottom:.5rem}p{color:#a1a1aa}</style></head><body><div class="container"><h1>Login Successful</h1><p>You can close this tab and return to your terminal.</p></div></body></html>');
          server.close();
          if (tk && rs) resolve({ token: tk, receivedState: rs });
          else reject(new Error('Missing token or state'));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as { port: number };
        const authUrl = `${WEB_APP_URL}/api/cli/auth?port=${addr.port}&state=${encodeURIComponent(state)}`;
        openBrowser(authUrl);
      });

      setTimeout(() => { server.close(); reject(new Error('Timeout')); }, 120_000);
    });

    if (receivedState !== state) return null;

    let email: string | undefined;
    try {
      const res = await fetch(`${WEB_APP_URL}/api/cli/verify`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { user?: { email?: string } };
        email = data.user?.email ?? undefined;
      }
    } catch { /* non-fatal */ }

    saveCredentials({ token, email, createdAt: new Date().toISOString() });
    return email ?? null;
  } catch {
    return null;
  }
}

// ── Login command ───────────────────────────────────────────

export async function loginCommand(args: string[] = []): Promise<void> {
  const existing = loadCredentials();
  if (existing) {
    console.log(
      `Already logged in${existing.email ? ` as ${fmt.bold(existing.email)}` : ''}.`,
    );
    console.log(`Run ${fmt.bold('aspectcode logout')} first to switch accounts.`);
    return;
  }

  // If a login code was provided, use it directly
  const codeArg = args[0];
  if (codeArg) {
    await loginWithCode(codeArg);
    return;
  }

  const state = crypto.randomBytes(16).toString('hex');

  const { token, receivedState } = await new Promise<{
    token: string;
    receivedState: string;
  }>((resolve, reject) => {
    const sockets = new Set<import('net').Socket>();
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost`);

      if (url.pathname === '/callback') {
        const token = url.searchParams.get('token');
        const receivedState = url.searchParams.get('state');

        res.writeHead(200, {
          'Content-Type': 'text/html',
          'Connection': 'close',
        });
        res.end(
          '<!DOCTYPE html><html><head><style>body{font-family:system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0a0a0a;color:#fafafa}.container{text-align:center;max-width:400px;padding:2rem}h1{font-size:1.5rem;margin-bottom:.5rem}p{color:#a1a1aa}</style></head><body><div class="container"><h1>Login Successful</h1><p>You can close this tab and return to your terminal.</p></div></body></html>',
          () => {
            // Force-destroy all connections so server.close() completes immediately
            for (const s of sockets) s.destroy();
            server.close();

            if (token && receivedState) {
              resolve({ token, receivedState });
            } else {
              reject(new Error('Missing token or state in callback'));
            }
          },
        );
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    // Track connections so we can force-close them
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });

    // Listen on random port
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      const authUrl = `${WEB_APP_URL}/api/cli/auth?port=${addr.port}&state=${encodeURIComponent(state)}`;

      console.log(`Opening browser to log in...`);
      console.log(fmt.dim(`  ${authUrl}`));
      console.log();

      openBrowser(authUrl);
    });

    // Timeout after 2 minutes
    const timeout = setTimeout(() => {
      for (const s of sockets) s.destroy();
      server.close();
      reject(new Error('Login timed out. Please try again.'));
    }, 120_000);
    timeout.unref();
  });

  // Verify state
  if (receivedState !== state) {
    console.error('Login failed: state mismatch (possible CSRF attack).');
    process.exitCode = 1;
    return;
  }

  // Verify the token against the web app and get user info
  let email: string | undefined;
  try {
    const res = await fetch(`${WEB_APP_URL}/api/cli/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = (await res.json()) as { user?: { email?: string } };
      email = data.user?.email ?? undefined;
    }
  } catch {
    // Non-fatal — save token anyway
  }

  saveCredentials({
    token,
    email,
    createdAt: new Date().toISOString(),
  });

  console.log(
    `${fmt.bold('Logged in')}${email ? ` as ${fmt.bold(email)}` : ''}.`,
  );
}

// ── Login with code ─────────────────────────────────────────

async function loginWithCode(token: string): Promise<void> {
  console.log('Verifying login code...');

  try {
    const res = await fetch(`${WEB_APP_URL}/api/cli/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      console.error('Invalid or expired login code.');
      process.exitCode = 1;
      return;
    }

    const data = (await res.json()) as { user?: { email?: string } };
    const email = data.user?.email ?? undefined;

    saveCredentials({
      token,
      email,
      createdAt: new Date().toISOString(),
    });

    console.log(
      `${fmt.bold('Logged in')}${email ? ` as ${fmt.bold(email)}` : ''}.`,
    );
  } catch (err) {
    console.error('Failed to verify login code:', (err as Error).message);
    process.exitCode = 1;
  }
}

// ── Logout command ──────────────────────────────────────────

export async function logoutCommand(): Promise<void> {
  const existing = loadCredentials();
  if (!existing) {
    console.log('Not logged in.');
    return;
  }

  clearCredentials();
  console.log('Logged out.');
}

// ── Whoami command ──────────────────────────────────────────

export async function whoamiCommand(): Promise<void> {
  const creds = loadCredentials();
  if (!creds) {
    console.log(`Not logged in. Run ${fmt.bold('aspectcode login')} to authenticate.`);
    return;
  }

  try {
    const res = await fetch(`${WEB_APP_URL}/api/cli/verify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.token}` },
    });

    if (!res.ok) {
      console.log('Session expired or token revoked. Please log in again.');
      clearCredentials();
      return;
    }

    const data = (await res.json()) as {
      user?: { email?: string; name?: string };
    };
    const user = data.user;

    if (user?.email) {
      console.log(`Logged in as ${fmt.bold(user.email)}${user.name ? ` (${user.name})` : ''}`);
    } else {
      console.log('Logged in (could not retrieve user info).');
    }
  } catch (err) {
    console.error('Failed to verify credentials:', (err as Error).message);
  }
}

// ── Usage command ──────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export async function usageCommand(): Promise<void> {
  const creds = loadCredentials();
  if (!creds) {
    console.log(`Not logged in. Run ${fmt.bold('aspectcode login')} first.`);
    process.exitCode = 1;
    return;
  }

  try {
    const res = await fetch(`${WEB_APP_URL}/api/cli/usage`, {
      headers: { Authorization: `Bearer ${creds.token}` },
    });

    if (!res.ok) {
      console.error('Failed to fetch usage:', res.status);
      process.exitCode = 1;
      return;
    }

    const data = (await res.json()) as {
      tokensUsed: number;
      tokensCap: number;
      tokensRemaining: number;
      resetAt: string | null;
      period: string;
    };

    const pct = Math.round((data.tokensUsed / data.tokensCap) * 100);
    const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));

    console.log();
    console.log(`  ${fmt.bold('Used:')}  ${formatTokens(data.tokensUsed)} / ${formatTokens(data.tokensCap)} tokens`);
    console.log(`  ${bar} ${pct}%`);
    console.log(`  ${fmt.dim(`${formatTokens(data.tokensRemaining)} remaining`)}`);
    if (data.resetAt) {
      const d = new Date(data.resetAt);
      console.log(`  ${fmt.dim(`Resets ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`)}`);
    }
    console.log();

    if (data.tokensRemaining === 0) {
      console.log(`  Token limit reached. Add your own key to continue:`);
      console.log(`  ${fmt.dim('ASPECTCODE_LLM_KEY=sk-...  (or "apiKey" in aspectcode.json)')}`);
      console.log();
    }
  } catch (err) {
    console.error('Failed to fetch usage:', (err as Error).message);
    process.exitCode = 1;
  }
}
