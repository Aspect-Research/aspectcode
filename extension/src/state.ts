import * as vscode from 'vscode';

// --- INFERRED TYPES ---
// (Based on your extension.ts file)

type SnapshotStats = {
  snapshotId: string;
  fileCount: number;
  bytes: number;
  tookMs: number;
};

type HistoryItem = {
  ts: number;
  kind: 'index' | 'reindex' | 'validate';
  meta: Record<string, any>;
};

type ExtensionUIState = {
  activeTab: string;
  lastValidationFiles?: string[]; // Track files validated in last smart validation
  autoValidationEnabled?: boolean; // Track if auto-validation is enabled
};

// --- EXTENSION STATE DEFINITION ---

/**
 * Defines the complete in-memory extension state.
 */
export type ExtensionState = {
  // --- Ephemeral State ---
  // (Reset on every load)
  busy: boolean;
  error?: string;
  dependencyGraphCache?: Map<string, any>; // Cache for dependency graph data

  // --- Persistent State ---
  // (Saved and reloaded)
  snapshot?: SnapshotStats;
  history: HistoryItem[];
  ui: ExtensionUIState;
};

/**
 * The default state for a new session.
 */
const DEFAULT_STATE: ExtensionState = {
  // Ephemeral fields are reset
  busy: false,
  error: undefined,
  dependencyGraphCache: new Map<string, any>(),

  // Persistent fields have defaults
  snapshot: undefined,
  history: [],
  ui: {
    activeTab: 'overview',
    lastValidationFiles: [],
    autoValidationEnabled: true,
  },
};

/**
 * Keys from ExtensionState that we want to save to globalState.
 * EVERYTHING ELSE will be reset on load.
 */
const PERSISTENT_KEYS: (keyof ExtensionState)[] = ['snapshot', 'history', 'ui'];

// --- STATE MANAGER CLASS ---

export class AspectCodeState {
  private _state: ExtensionState;
  private readonly storageKey = 'aspectcode.state.v1';
  private readonly legacyStorageKey = 'aspectcode.panel.v1';

  readonly _onDidChange = new vscode.EventEmitter<ExtensionState>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private ctx: vscode.ExtensionContext) {
    // Initialize with default state. load() will be called by activate()
    this._state = DEFAULT_STATE;
  }

  /**
   * Returns the current in-memory state.
   */
  get s() {
    return this._state;
  }

  /**
   * Loads the persistent state from storage and merges it with the
   * default state to ensure all ephemeral fields are reset.
   */
  load() {
    // 1. Load the *saved* (and incomplete) state from storage
    const persistentState =
      this.ctx.globalState.get<Partial<ExtensionState>>(this.storageKey) ??
      this.ctx.globalState.get<Partial<ExtensionState>>(this.legacyStorageKey, {});

    // 2. Create the new in-memory state
    this._state = {
      ...DEFAULT_STATE, // Start with defaults (busy: false, findings: [], etc.)
      ...persistentState, // Merge in saved data (history, snapshot, ui)
    };

    // 3. (Optional) Force-clear ephemeral fields just in case
    this._state.busy = false;
    this._state.error = undefined;

    // 4. Notify listeners of the clean state
    this._onDidChange.fire(this._state);
  }

  /**
   * Updates the in-memory state, saves the persistent parts,
   * and notifies listeners.
   */
  update(patch: Partial<ExtensionState>) {
    // 1. Update the in-memory state
    this._state = { ...this._state, ...patch };

    // 2. Save the persistent parts to storage
    this.savePersistentState();

    // 3. Notify listeners
    this._onDidChange.fire(this._state);
  }

  /**
   * (Internal) Creates an object with *only* the persistent keys
   * and saves it to globalState.
   */
  private savePersistentState() {
    const stateToPersist: Partial<ExtensionState> = {};

    for (const key of PERSISTENT_KEYS) {
      if (this._state[key] !== undefined) {
        (stateToPersist as any)[key] = this._state[key];
      }
    }

    // This now only saves { snapshot, history, ui }
    this.ctx.globalState.update(this.storageKey, stateToPersist);
  }
}
