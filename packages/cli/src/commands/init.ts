/**
 * `aspectcode init` — create an `aspectcode.json` config file.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  CONFIG_FILE_NAME,
  configPath,
  defaultConfig,
  loadConfig,
} from '../config';
import type { CliFlags, CommandResult } from '../cli';
import { ExitCode } from '../cli';
import type { Logger } from '../logger';
import { fmt } from '../logger';

export async function runInit(
  root: string,
  flags: CliFlags,
  log: Logger,
): Promise<CommandResult> {
  const dest = configPath(root);

  // Guard: config already exists
  const existing = loadConfig(root);
  if (existing && !flags.force) {
    log.warn(
      `${CONFIG_FILE_NAME} already exists. Use ${fmt.bold('--force')} to overwrite.`,
    );
    return { exitCode: ExitCode.OK };
  }

  const config = defaultConfig();
  const content = JSON.stringify(config, null, 2) + '\n';

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, content, 'utf-8');

  log.success(`Created ${fmt.cyan(CONFIG_FILE_NAME)}`);
  log.info('');
  log.info(`  Next step: run ${fmt.bold('aspectcode generate')} to build the knowledge base.`);
  log.info(`  Edit ${fmt.cyan(CONFIG_FILE_NAME)} to customise assistants, exclusions, etc.`);

  return { exitCode: ExitCode.OK };
}
