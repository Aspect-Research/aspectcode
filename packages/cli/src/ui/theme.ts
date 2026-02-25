/**
 * Theme — single source of truth for all CLI colors and the banner.
 */

// ── Colors ───────────────────────────────────────────────────
export const COLORS = {
  /** Primary brand color */
  primary: '#f9731c',       // orange (brand)
  /** Dimmed brand accent */
  primaryDim: '#c85a12',    // orange (dark)
  /** Success / watching */
  green: '#22c55e',
  /** Warnings */
  yellow: '#eab308',
  /** Errors */
  red: '#ef4444',
  /** Subtle text */
  gray: '#6b7280',
  /** Bright white for emphasis */
  white: '#f9fafb',
} as const;

// ── Banner ───────────────────────────────────────────────────

const BANNER_LINES = [
  '   __ _ ___ _ __  ___ __| |_  __ ___  __| |___',
  '  / _` (_-<| \'_ \\/ -_) _|  _|/ _/ _ \\/ _` / -_)',
  '  \\__,_/__/| .__/\\___\\__|\\__|\\__\\___/\\__,_\\___|',
  '           |_|',
];

/**
 * Return the banner as a single string, coloured with ANSI orange.
 * For use in both ink and plain-text contexts.
 */
export function getBannerText(): string {
  return BANNER_LINES.join('\n');
}

/** The number of lines the banner occupies. */
export const BANNER_HEIGHT = BANNER_LINES.length;
