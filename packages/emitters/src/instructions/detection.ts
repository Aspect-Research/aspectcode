import type { EmitterHost } from '../host';
import type { AssistantId } from './constants';
import { ASSISTANT_DETECTION_PATHS } from './constants';

/**
 * Detects which AI assistants are likely in use by checking for their config files.
 * Also detects if Aspect Code KB (kb.md) exists, indicating prior configuration.
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
