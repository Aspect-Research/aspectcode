export const ASPECT_CODE_START = '<!-- ASPECT_CODE_START -->';
export const ASPECT_CODE_END = '<!-- ASPECT_CODE_END -->';

export type AssistantId = 'aspectKB' | 'agents';

export const ASSISTANT_DETECTION_PATHS: Array<{ id: AssistantId; paths: string[] }> = [
  { id: 'aspectKB', paths: ['kb.md'] },
  { id: 'agents', paths: ['AGENTS.md'] },
];
