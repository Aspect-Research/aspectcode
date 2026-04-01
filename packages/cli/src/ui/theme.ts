/**
 * Theme — single source of truth for all CLI colors.
 */

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
