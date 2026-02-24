/**
 * Dashboard state — shared between the ink UI and the pipeline.
 *
 * The pipeline pushes events via the DashboardStore; the ink Dashboard
 * component re-renders whenever the state changes.
 */

import { EventEmitter } from 'events';

export type PipelinePhase =
  | 'idle'
  | 'discovering'
  | 'analyzing'
  | 'building-kb'
  | 'optimizing'
  | 'writing'
  | 'watching'
  | 'done'
  | 'error';

/** A completed pipeline step shown as a checkmark line. */
export interface StepEntry {
  text: string;
  status: 'ok' | 'warn' | 'error';
}

export interface DashboardState {
  phase: PipelinePhase;
  fileCount: number;
  edgeCount: number;
  provider: string;
  lastChange: string;
  elapsed: string;
  /** Completed steps in the current run (reset per run). */
  steps: StepEntry[];
  /** Warning text (e.g. no API key). */
  warning: string;
  /** Files written this run (e.g. ["AGENTS.md (full)", "kb.md"]). */
  outputs: string[];
}

/**
 * Mutable singleton store. The ink component subscribes via onChange.
 */
class DashboardStore extends EventEmitter {
  state: DashboardState = {
    phase: 'idle',
    fileCount: 0,
    edgeCount: 0,
    provider: '',
    lastChange: '',
    elapsed: '',
    steps: [],
    warning: '',
    outputs: [],
  };

  private update(patch: Partial<DashboardState>): void {
    Object.assign(this.state, patch);
    this.emit('change');
  }

  setPhase(phase: PipelinePhase): void {
    this.update({ phase });
  }

  setStats(fileCount: number, edgeCount: number): void {
    this.update({ fileCount, edgeCount });
  }

  setProvider(provider: string): void {
    this.update({ provider });
  }

  setLastChange(change: string): void {
    this.update({ lastChange: change });
  }

  setElapsed(elapsed: string): void {
    this.update({ elapsed });
  }

  setWarning(warning: string): void {
    this.update({ warning });
  }

  addOutput(output: string): void {
    this.update({ outputs: [...this.state.outputs, output] });
  }

  /** Add a completed step (shown as ✔/⚠/✖ line). */
  pushStep(text: string, status: StepEntry['status'] = 'ok'): void {
    const steps = [...this.state.steps, { text, status }];
    this.update({ steps });
  }

  /** Reset per-run state (steps, warning, outputs) for a fresh run. */
  resetRun(): void {
    this.update({
      steps: [],
      warning: '',
      outputs: [],
      elapsed: '',
      provider: '',
    });
  }
}

/** Singleton — created once, shared across pipeline + UI. */
export const store = new DashboardStore();
