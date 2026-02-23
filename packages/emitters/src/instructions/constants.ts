export const ASPECT_CODE_START = '<!-- ASPECT_CODE_START -->';
export const ASPECT_CODE_END = '<!-- ASPECT_CODE_END -->';

export type AssistantId = 'aspectKB' | 'agentsMd';

export const ASSISTANT_DETECTION_PATHS: Array<{ id: AssistantId; paths: string[] }> = [
  { id: 'aspectKB', paths: ['.aspect'] },
  { id: 'agentsMd', paths: ['AGENTS.md'] },
];
