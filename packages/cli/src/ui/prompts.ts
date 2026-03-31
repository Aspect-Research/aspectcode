/**
 * Simple interactive prompts — readline-based, no dependencies.
 *
 * Falls back to a default when stdin is not a TTY (CI / piped).
 */

import * as readline from 'readline';

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Ask the user to pick from a list of options using arrow keys.
 * Returns the 0-based index of the chosen option.
 *
 * Falls back to `defaultIndex` when not interactive.
 */
export async function selectPrompt(
  question: string,
  options: string[],
  defaultIndex = 0,
): Promise<number> {
  if (!isInteractive()) return defaultIndex;

  return new Promise((resolve) => {
    let selected = defaultIndex;

    const render = () => {
      // Move cursor up to re-render (skip on first paint)
      if (painted) {
        process.stdout.write(`\x1b[${options.length}A`);
      }
      for (let i = 0; i < options.length; i++) {
        const prefix = i === selected ? '\x1b[35m❯\x1b[0m' : ' ';
        const label = i === selected ? `\x1b[1m${options[i]}\x1b[0m` : options[i];
        process.stdout.write(`\x1b[2K  ${prefix} ${label}\n`);
      }
      painted = true;
    };

    let painted = false;
    process.stdout.write(`\x1b[35m?\x1b[0m ${question}\n`);
    render();

    // Raw mode for arrow key input
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');

    const onData = (key: string) => {
      if (key === '\x1b[A' || key === 'k') {
        // Up
        selected = (selected - 1 + options.length) % options.length;
        render();
      } else if (key === '\x1b[B' || key === 'j') {
        // Down
        selected = (selected + 1) % options.length;
        render();
      } else if (key === '\r' || key === '\n') {
        // Enter
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        resolve(selected);
      } else if (key === '\x03') {
        // Ctrl+C
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.exit(130);
      }
    };

    process.stdin.on('data', onData);
  });
}

/**
 * Ask the user to pick multiple items from a list using arrow keys + space.
 * Returns array of 0-based indices of selected options.
 *
 * Falls back to `preselected` when not interactive.
 */
export async function multiSelectPrompt(
  question: string,
  options: string[],
  preselected: number[] = [],
): Promise<number[]> {
  if (!isInteractive()) return preselected;

  return new Promise((resolve) => {
    let cursor = 0;
    const selected = new Set(preselected);

    const render = () => {
      if (painted) {
        process.stdout.write(`\x1b[${options.length}A`);
      }
      for (let i = 0; i < options.length; i++) {
        const check = selected.has(i) ? '\x1b[35m●\x1b[0m' : '○';
        const pointer = i === cursor ? '\x1b[35m❯\x1b[0m' : ' ';
        const label = i === cursor ? `\x1b[1m${options[i]}\x1b[0m` : options[i];
        process.stdout.write(`\x1b[2K  ${pointer} ${check} ${label}\n`);
      }
      painted = true;
    };

    let painted = false;
    process.stdout.write(`\x1b[35m?\x1b[0m ${question} \x1b[90m(space to toggle, enter to confirm)\x1b[0m\n`);
    render();

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf-8');

    const onData = (key: string) => {
      if (key === '\x1b[A' || key === 'k') {
        cursor = (cursor - 1 + options.length) % options.length;
        render();
      } else if (key === '\x1b[B' || key === 'j') {
        cursor = (cursor + 1) % options.length;
        render();
      } else if (key === ' ') {
        if (selected.has(cursor)) selected.delete(cursor);
        else selected.add(cursor);
        render();
      } else if (key === '\r' || key === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        resolve([...selected].sort());
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

/**
 * Ask a yes/no question. Returns `true` for yes.
 *
 * Falls back to `defaultValue` when not interactive.
 */
export async function confirmPrompt(
  question: string,
  defaultValue = true,
): Promise<boolean> {
  if (!isInteractive()) return defaultValue;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const hint = defaultValue ? 'Y/n' : 'y/N';

  return new Promise((resolve) => {
    rl.question(`\x1b[35m?\x1b[0m ${question} (${hint}) `, (answer) => {
      rl.close();
      if (answer.trim() === '') return resolve(defaultValue);
      resolve(answer.trim().toLowerCase().startsWith('y'));
    });
  });
}
