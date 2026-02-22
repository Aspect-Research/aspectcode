import * as vscode from 'vscode';

// --- EXTENSION STATE DEFINITION ---

/**
 * Lightweight in-memory extension state.
 * The panel is gone — this holds only ephemeral runtime flags.
 */
export type ExtensionState = {
  busy: boolean;
  error?: string;
};

const DEFAULT_STATE: ExtensionState = {
  busy: false,
  error: undefined,
};

// --- STATE MANAGER CLASS ---

export class AspectCodeState {
  private _state: ExtensionState = { ...DEFAULT_STATE };

  readonly _onDidChange = new vscode.EventEmitter<ExtensionState>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private ctx: vscode.ExtensionContext) {}

  get s() {
    return this._state;
  }

  /** Reset ephemeral state. */
  load() {
    this._state = { ...DEFAULT_STATE };
    this._onDidChange.fire(this._state);

    // Clean up legacy storage keys (one-time).
    void this.ctx.globalState.update('aspectcode.state.v1', undefined);
    void this.ctx.globalState.update('aspectcode.panel.v1', undefined);
  }

  update(patch: Partial<ExtensionState>) {
    this._state = { ...this._state, ...patch };
    this._onDidChange.fire(this._state);
  }
}
