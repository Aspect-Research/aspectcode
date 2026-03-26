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
  generateKbSeedContent,
} from './instructions/content';

// ── Formats ─────────────────────────────────────────────────

export type { AiToolId } from './instructions/formats';
export { AI_TOOL_DETECTION_PATHS } from './instructions/formats';
