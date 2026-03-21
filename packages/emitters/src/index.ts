/**
 * @aspectcode/emitters — public API surface.
 *
 * KB content builders and instruction generators.
 */

// ── Host ─────────────────────────────────────────────────────

export type { EmitterHost } from './host';
export { createNodeEmitterHost } from './host';

// ── KB helpers ───────────────────────────────────────────────

export * from './kb';

// ── Instructions ────────────────────────────────────────────

export {
  generateCanonicalContentForMode,
  generateKbCustomContent,
} from './instructions/content';
