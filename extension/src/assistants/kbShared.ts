import * as path from 'path';
import { toPosix } from '@aspectcode/core';

export function buildRelativeFileContentMap(
  files: string[],
  workspaceRoot: string,
  fileContentCache: Map<string, string>,
): Map<string, string> {
  const relativeFileContents = new Map<string, string>();
  for (const absPath of files) {
    const content = fileContentCache.get(absPath);
    if (content === undefined) continue;
    const rel = toPosix(path.relative(workspaceRoot, absPath));
    relativeFileContents.set(rel, content);
  }
  return relativeFileContents;
}
