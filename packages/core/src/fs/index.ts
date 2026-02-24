/**
 * File system utilities — discovery, exclusions, and supported extensions.
 */

export {
  DEFAULT_EXCLUSIONS,
  SUPPORTED_EXTENSIONS,
  PACKAGE_MANAGER_DIRS,
  BUILD_OUTPUT_DIRS,
  VENV_DIRS,
  CACHE_DIRS,
  VCS_IDE_DIRS,
  TEST_OUTPUT_DIRS,
  GENERATED_DIRS,
  VENV_MARKERS,
  BUILD_OUTPUT_MARKERS,
} from './exclusions';

export { discoverFiles } from './walker';
export type { DiscoverOptions } from './walker';

export {
  computeFingerprint,
  readFingerprint,
  writeFingerprint,
  isKbStale,
} from './fingerprint';
export type { FingerprintData } from './fingerprint';
