import * as vscode from 'vscode';

export type AssistantId = 'aspectKB' | 'agentsMd';

/**
 * Detects whether Aspect Code KB (.aspect/) and AGENTS.md exist.
 * Uses parallel file stat operations for speed.
 */
export async function detectAssistants(workspaceRoot: vscode.Uri): Promise<Set<AssistantId>> {
  const detected = new Set<AssistantId>();

  const checks: Array<{ id: AssistantId; paths: string[] }> = [
    { id: 'aspectKB', paths: ['.aspect'] },
    { id: 'agentsMd', paths: ['AGENTS.md'] },
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
