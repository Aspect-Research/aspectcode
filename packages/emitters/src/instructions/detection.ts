import type { EmitterHost } from '../host';
import type { AssistantId } from './constants';
import { ASSISTANT_DETECTION_PATHS } from './constants';
import type { AiToolId } from './formats';
import { AI_TOOL_DETECTION_PATHS } from './formats';

/**
 * Detects which Aspect Code artifacts exist (KB, instructions).
 */
export async function detectAssistants(
  host: EmitterHost,
  workspaceRoot: string,
): Promise<Set<AssistantId>> {
  const detected = new Set<AssistantId>();

  const allPromises = ASSISTANT_DETECTION_PATHS.flatMap((check) =>
    check.paths.map(async (p) => {
      const abs = host.join(workspaceRoot, p);
      try {
        return (await host.exists(abs)) ? check.id : null;
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

/**
 * Detects which AI coding tools are present in the workspace by checking
 * for their config/instruction files on disk.
 */
export async function detectAiTools(
  host: EmitterHost,
  workspaceRoot: string,
): Promise<Set<AiToolId>> {
  const detected = new Set<AiToolId>();

  const allPromises = AI_TOOL_DETECTION_PATHS.flatMap((check) =>
    check.paths.map(async (p) => {
      const abs = host.join(workspaceRoot, p);
      try {
        return (await host.exists(abs)) ? check.id : null;
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
