export type { AssistantId } from './constants';
export { ASPECT_CODE_START, ASPECT_CODE_END } from './constants';

export { detectAssistants } from './detection';

export { mergeAspectCodeSection, removeAspectCodeSection } from './merge';

export {
  generateCanonicalContentForMode,
  generateCanonicalContentSafe,
  generateCanonicalContentPermissive,
  generateCanonicalContentSafeKB,
  generateCanonicalContentPermissiveKB,
} from './content';

export { createInstructionsEmitter } from './instructionsEmitter';
