/**
 * Ink logger adapter — implements Logger + Spinner interfaces via the
 * DashboardStore, so all pipeline output flows through the ink dashboard
 * instead of raw console writes.
 */

import type { Logger, Spinner } from '../logger';
import { store } from './store';
import type { PipelinePhase } from './store';

/**
 * Create a Logger that feeds the dashboard store.
 *
 * Most messages are silently absorbed (the dashboard shows structured
 * steps, not raw text). Only warnings and errors surface.
 */
export function createDashboardLogger(): Logger {
  return {
    info()               { /* absorbed — dashboard shows structured phases */ },
    success(_msg: string) { /* step completion handled by spinner.stop()   */ },
    warn(msg: string)    { store.setWarning(msg); },
    error(msg: string)   { store.pushStep(msg, 'error'); },
    debug()              { /* absorbed */ },
    blank()              { /* no-op */ },
  };
}

/**
 * Create a Spinner that updates the dashboard phase and pushes a
 * completed step when it stops.
 */
export function createDashboardSpinner(phase: PipelinePhase, _initialMsg: string): Spinner {
  store.setPhase(phase);
  return {
    update() { /* phase label is sufficient */ },
    stop(msg: string) {
      store.pushStep(msg, 'ok');
    },
    fail(msg: string) {
      store.setPhase('error');
      store.pushStep(msg, 'error');
    },
  };
}
