/**
 * @aspectcode/emitters — public API surface.
 *
 * KB content builders, AI platform formats, and host abstraction.
 */

// ── Host ─────────────────────────────────────────────────────

export type { EmitterHost } from './host';
export { createNodeEmitterHost } from './host';

// ── KB helpers ───────────────────────────────────────────────

export * from './kb';

// ── Formats ─────────────────────────────────────────────────

export type { AiToolId } from './instructions/formats';
export { AI_TOOL_DETECTION_PATHS } from './instructions/formats';
