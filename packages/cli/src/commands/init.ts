/**
 * `aspectcode init` — interactive project setup.
 *
 * Creates `aspectcode.json` with sensible defaults, detects AI tools,
 * and optionally chains into watch mode.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import {
  createNodeEmitterHost,
  detectAiTools,
  getFormatTarget,
} from '@aspectcode/emitters';
import type { CommandContext, CommandResult } from '../cli';
import { ExitCode } from '../cli';
import { CONFIG_FILE_NAME, defaultConfig, saveRawConfig } from '../config';
import { fmt } from '../logger';

export async function runInit(ctx: CommandContext): Promise<CommandResult> {
  const { root, flags, log } = ctx;
  const configPath = path.join(root, CONFIG_FILE_NAME);

  // ── Check if config already exists ────────────────────────
  if (fs.existsSync(configPath)) {
    log.info(`${fmt.cyan(CONFIG_FILE_NAME)} already exists.`);
    const rl = createRl();
    try {
      const answer = await ask(rl, `Overwrite? (y/N) `);
      if (!answer.toLowerCase().startsWith('y')) {
        log.info('Aborted.');
        return { exitCode: ExitCode.OK };
      }
    } finally {
      rl.close();
    }
  }

  // ── Detect AI tools ───────────────────────────────────────
  const host = createNodeEmitterHost();
  const detected = await detectAiTools(host, root);
  const outputFormats: string[] = [];

  if (detected.size > 0 && !flags.json && process.stdout.isTTY) {
    log.blank();
    log.info(fmt.bold('Detected AI coding tools:'));

    const rl = createRl();
    try {
      for (const toolId of detected) {
        // Skip codex — it maps to AGENTS.md which is always written
        if (toolId === 'codex') continue;

        const target = getFormatTarget(toolId);
        if (!target) continue;

        const answer = await ask(
          rl,
          `  ${fmt.cyan(target.displayName)} — write ${fmt.bold(target.filePath)}? (Y/n) `,
        );
        if (!answer || answer.toLowerCase().startsWith('y')) {
          outputFormats.push(toolId);
        }
      }
    } finally {
      rl.close();
    }
  }

  // ── Choose update rate ────────────────────────────────────
  let updateRate: 'onChange' | 'idle' | 'manual' = 'onChange';
  if (!flags.json && process.stdout.isTTY) {
    log.blank();
    log.info(fmt.bold('How should Aspect Code stay up to date?'));
    log.info(`  1. ${fmt.cyan('onChange')} — regenerate on file save (recommended)`);
    log.info(`  2. ${fmt.cyan('idle')}     — regenerate after 30s of inactivity`);
    log.info(`  3. ${fmt.cyan('manual')}   — only when you run generate`);

    const rl = createRl();
    try {
      const answer = await ask(rl, `  Choice (1/2/3): `);
      if (answer === '2') updateRate = 'idle';
      else if (answer === '3') updateRate = 'manual';
    } finally {
      rl.close();
    }
  }

  // ── Write config ──────────────────────────────────────────
  const config = {
    ...defaultConfig(),
    updateRate,
    ...(outputFormats.length > 0 ? { outputFormats } : {}),
  };

  saveRawConfig(root, config as Record<string, unknown>);
  log.blank();
  log.success(`Created ${fmt.cyan(CONFIG_FILE_NAME)}`);

  // ── Offer to run generate ─────────────────────────────────
  if (!flags.json && process.stdout.isTTY) {
    const rl = createRl();
    try {
      const answer = await ask(rl, `\nGenerate KB now? (Y/n) `);
      if (!answer || answer.toLowerCase().startsWith('y')) {
        rl.close();
        log.blank();
        const { runGenerate } = await import('./generate');
        return runGenerate({
          ...ctx,
          config: { ...config, instructionsMode: 'safe' },
          flags: { ...flags, detectTools: false },
        });
      }
    } finally {
      rl.close();
    }
  }

  return { exitCode: ExitCode.OK };
}

// ── Helpers ──────────────────────────────────────────────────

function createRl(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}
