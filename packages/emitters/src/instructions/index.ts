export type { AssistantId } from './constants';
export { ASPECT_CODE_START, ASPECT_CODE_END } from './constants';

export { detectAssistants, detectAiTools } from './detection';

export { mergeAspectCodeSection, removeAspectCodeSection } from './merge';

export {
  generateCanonicalContentForMode,
  generateCanonicalContentSafe,
  generateCanonicalContentPermissive,
} from './content';

export { createInstructionsEmitter } from './instructionsEmitter';

export type { AiToolId, FormatTarget } from './formats';
export {
  AI_TOOL_DETECTION_PATHS,
  FORMAT_TARGETS,
  getFormatTarget,
  resolveFormatTargets,
} from './formats';
