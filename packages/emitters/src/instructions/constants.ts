export const ASPECT_CODE_START = '<!-- ASPECT_CODE_START -->';
export const ASPECT_CODE_END = '<!-- ASPECT_CODE_END -->';

export type AssistantId = 'copilot' | 'cursor' | 'claude' | 'other' | 'aspectKB';

export const ASSISTANT_DETECTION_PATHS: Array<{ id: AssistantId; paths: string[] }> = [
  { id: 'aspectKB', paths: ['.aspect'] },
  { id: 'copilot', paths: ['.github/copilot-instructions.md'] },
  { id: 'cursor', paths: ['.cursor', '.cursorrules'] },
  { id: 'claude', paths: ['CLAUDE.md'] },
  { id: 'other', paths: ['AGENTS.md'] },
];
