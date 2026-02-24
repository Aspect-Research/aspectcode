/**
 * Ink logger adapter — implements Logger + Spinner interfaces via the
 * DashboardStore so pipeline output flows through the ink dashboard.
 *
 * Most log calls are absorbed — the dashboard shows structured phases,
 * not individual log lines. Only warnings and errors surface.
 */

import type { Logger, Spinner } from '../logger';
import { store } from './store';
import type { PipelinePhase } from './store';

/**
 * Logger that feeds the dashboard store.
 * Info/success/debug are absorbed; warnings and errors surface.
 */
export function createDashboardLogger(): Logger {
  return {
    info()               { /* absorbed — dashboard shows phases */ },
    success(_msg: string){ /* absorbed — outputs tracked by pipeline */ },
    warn(msg: string)    { store.setWarning(msg); },
    error(msg: string)   { store.setWarning(msg); },
    debug()              { /* absorbed */ },
    blank()              { /* no-op */ },
  };
}

/**
 * Spinner that sets the dashboard phase. `stop()` is a no-op since the
 * pipeline will advance to the next phase automatically.
 */
export function createDashboardSpinner(phase: PipelinePhase, _initialMsg: string): Spinner {
  store.setPhase(phase);
  return {
    update() {},
    stop()  {},
    fail(msg: string) {
      store.setPhase('error');
      store.setWarning(msg);
    },
  };
}
