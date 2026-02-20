/**
 * Shared types for assistant instruction configuration.
 *
 * Instructionfile generation logic now lives in @aspectcode/emitters
 * (instructionsEmitter). This module retains only the override type
 * consumed by commandHandlers.ts.
 */

/**
 * Optional override for assistant selection when called from configureAssistants.
 * This allows generating instruction files BEFORE settings are written to disk,
 * ensuring KB files are created first and .settings.json is only added after.
 */
export interface AssistantsOverride {
  copilot?: boolean;
  cursor?: boolean;
  claude?: boolean;
  other?: boolean;
}