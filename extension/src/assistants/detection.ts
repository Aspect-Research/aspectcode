import * as vscode from 'vscode';

export type AssistantId = 'aspectKB' | 'agents';

/**
 * Detects whether Aspect Code artifacts (kb.md, AGENTS.md) exist in the workspace.
 * Uses parallel file stat operations for speed.
 */
export async function detectAssistants(workspaceRoot: vscode.Uri): Promise<Set<AssistantId>> {
  const detected = new Set<AssistantId>();

  const checks: Array<{ id: AssistantId; paths: string[] }> = [
    { id: 'aspectKB', paths: ['kb.md'] },
    { id: 'agents', paths: ['AGENTS.md'] },
  ];

  const allPromises = checks.flatMap((check) =>
    check.paths.map(async (p) => {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.joinPath(workspaceRoot, p));
        return check.id;
      } catch {
        return null;
      }
    }),
  );

  const results = await Promise.allSettled(allPromises);

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      detected.add(result.value);
    }
  }

  return detected;
}
