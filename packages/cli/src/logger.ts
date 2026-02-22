/**
 * aspectcode CLI — zero-dependency logger with optional color.
 *
 * Respects NO_COLOR / FORCE_COLOR environment variables and --no-color flag.
 */

let _colorDisabled = false;

/** Call before creating a logger to force color off (e.g. --no-color flag). */
export function disableColor(): void {
  _colorDisabled = true;
}

function colorEnabled(): boolean {
  if (_colorDisabled) return false;
  return (
    process.env['FORCE_COLOR'] === '1' ||
    (!process.env['NO_COLOR'] &&
      !process.env['CI'] &&
      process.stdout.isTTY === true)
  );
}

function wrap(code: string, reset: string, text: string): string {
  return colorEnabled() ? `\x1b[${code}m${text}\x1b[${reset}m` : text;
}

const bold = (t: string) => wrap('1', '22', t);
const dim = (t: string) => wrap('2', '22', t);
const green = (t: string) => wrap('32', '39', t);
const yellow = (t: string) => wrap('33', '39', t);
const red = (t: string) => wrap('31', '39', t);
const cyan = (t: string) => wrap('36', '39', t);
const blue = (t: string) => wrap('34', '39', t);

export interface Logger {
  info(msg: string): void;
  success(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  debug(msg: string): void;
  blank(): void;
}

export function createLogger(opts: { verbose?: boolean; quiet?: boolean } = {}): Logger {
  const isQuiet = opts.quiet ?? false;
  const isVerbose = opts.verbose ?? false;

  return {
    info(msg: string) {
      if (!isQuiet) console.log(msg);
    },
    success(msg: string) {
      if (!isQuiet) console.log(green(bold('✔')) + ' ' + msg);
    },
    warn(msg: string) {
      console.warn(yellow(bold('⚠')) + ' ' + msg);
    },
    error(msg: string) {
      console.error(red(bold('✖')) + ' ' + msg);
    },
    debug(msg: string) {
      if (isVerbose && !isQuiet) console.log(dim(msg));
    },
    blank() {
      if (!isQuiet) console.log();
    },
  };
}

// ── Spinner ─────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface Spinner {
  /** Update the spinner text (same line). */
  update(msg: string): void;
  /** Stop the spinner with a success checkmark. */
  stop(msg: string): void;
  /** Stop the spinner with a failure mark. */
  fail(msg: string): void;
}

/**
 * Create a stderr-based spinner that doesn't pollute stdout.
 * Falls back to static lines on non-TTY or when quiet.
 */
export function createSpinner(initialMsg: string, opts?: { quiet?: boolean }): Spinner {
  const isQuiet = opts?.quiet ?? false;
  const isTTY = process.stderr.isTTY === true;

  if (isQuiet) {
    // Silent — no output at all.
    return {
      update() {},
      stop() {},
      fail(msg: string) { process.stderr.write(red(bold('✖')) + ' ' + msg + '\n'); },
    };
  }

  if (!isTTY) {
    // Non-TTY — static lines, no animation.
    process.stderr.write(initialMsg + '\n');
    return {
      update(msg: string) { process.stderr.write(msg + '\n'); },
      stop(msg: string) { process.stderr.write(green(bold('✔')) + ' ' + msg + '\n'); },
      fail(msg: string) { process.stderr.write(red(bold('✖')) + ' ' + msg + '\n'); },
    };
  }

  // TTY — animated spinner on stderr.
  let frame = 0;
  let currentMsg = initialMsg;
  const interval = setInterval(() => {
    const indicator = cyan(SPINNER_FRAMES[frame % SPINNER_FRAMES.length]);
    process.stderr.write(`\r\x1b[K${indicator} ${currentMsg}`);
    frame++;
  }, 80);

  // Show initial frame immediately.
  const indicator = cyan(SPINNER_FRAMES[0]);
  process.stderr.write(`${indicator} ${currentMsg}`);

  return {
    update(msg: string) {
      currentMsg = msg;
    },
    stop(msg: string) {
      clearInterval(interval);
      process.stderr.write(`\r\x1b[K${green(bold('✔'))} ${msg}\n`);
    },
    fail(msg: string) {
      clearInterval(interval);
      process.stderr.write(`\r\x1b[K${red(bold('✖'))} ${msg}\n`);
    },
  };
}

/** Formatting helpers (exported for use in commands). */
export const fmt = { bold, dim, green, yellow, red, cyan, blue } as const;
