/**
 * @aspectcode/cli — zero-dependency logger with optional color.
 *
 * Respects NO_COLOR / FORCE_COLOR environment variables.
 */

const supportsColor =
  process.env['FORCE_COLOR'] === '1' ||
  (!process.env['NO_COLOR'] &&
    !process.env['CI'] &&
    process.stdout.isTTY === true);

function wrap(code: string, reset: string, text: string): string {
  return supportsColor ? `\x1b[${code}m${text}\x1b[${reset}m` : text;
}

const bold = (t: string) => wrap('1', '22', t);
const dim = (t: string) => wrap('2', '22', t);
const green = (t: string) => wrap('32', '39', t);
const yellow = (t: string) => wrap('33', '39', t);
const red = (t: string) => wrap('31', '39', t);
const cyan = (t: string) => wrap('36', '39', t);

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

/** Formatting helpers (exported for use in commands). */
export const fmt = { bold, dim, green, yellow, red, cyan } as const;
