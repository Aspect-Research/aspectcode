/**
 * Shared KB output policy.
 *
 * Centralizes:
 * - newline normalization
 * - line counting
 * - truncation footer wording
 */

export function normalizeNewlines(text: string): string {
  // Normalize CRLF and CR-only to LF for stable line counting.
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function splitLines(text: string): string[] {
  return normalizeNewlines(text).split('\n');
}

export function truncationFooter(maxLines: number, omittedLines: number, generatedAt: string): string[] {
  return [
    '',
    `_[Content truncated at ${maxLines} lines. ${omittedLines} lines omitted.]_`,
    '',
    `_Generated: ${generatedAt}_`,
  ];
}
