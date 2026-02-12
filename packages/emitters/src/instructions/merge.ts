import { ASPECT_CODE_END, ASPECT_CODE_START } from './constants';

export function removeAspectCodeSection(existingContent: string): string {
  const startIndex = existingContent.indexOf(ASPECT_CODE_START);
  if (startIndex === -1) return existingContent;

  const endIndex = existingContent.indexOf(ASPECT_CODE_END, startIndex);
  if (endIndex === -1) return existingContent;

  let deleteFrom = startIndex;
  let deleteTo = endIndex + ASPECT_CODE_END.length;

  // Remove trailing newline(s) right after the end marker
  while (
    deleteTo < existingContent.length &&
    (existingContent[deleteTo] === '\n' || existingContent[deleteTo] === '\r')
  ) {
    deleteTo++;
  }

  // Remove at most one preceding newline before the start marker to avoid leaving a blank gap.
  if (
    deleteFrom > 0 &&
    (existingContent[deleteFrom - 1] === '\n' || existingContent[deleteFrom - 1] === '\r')
  ) {
    deleteFrom--;
  }

  return existingContent.substring(0, deleteFrom) + existingContent.substring(deleteTo);
}

/**
 * Merges Aspect Code content into existing file using markers.
 * If markers exist, replaces content between them.
 * If not, appends new section with markers.
 */
export function mergeAspectCodeSection(existingContent: string, aspectCodeContent: string): string {
  const startIndex = existingContent.indexOf(ASPECT_CODE_START);
  const endIndex = existingContent.indexOf(ASPECT_CODE_END);

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    // Markers exist, replace content between them
    const before = existingContent.substring(0, startIndex + ASPECT_CODE_START.length);
    const after = existingContent.substring(endIndex);
    return `${before}\n${aspectCodeContent}\n${after}`;
  } else {
    // No markers, append new section
    const separator = existingContent.trim().length > 0 ? '\n\n' : '';
    return `${existingContent}${separator}${ASPECT_CODE_START}\n${aspectCodeContent}\n${ASPECT_CODE_END}\n`;
  }
}
