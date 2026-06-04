import type { MascotState, ResolvedAnimationState } from './types';

export type TransitionOptions = {
  // Bypass the debounce window. Use for direct user actions (drag, double-click)
  // and for waking from sleep, which must feel immediate.
  force?: boolean;
  // Human-readable reason, printed in the debug log.
  reason?: string;
};

export type MascotStateMachineOptions = {
  // Minimum time between committed transitions unless `force` is set (rule 8).
  debounceMs?: number;
  // Injectable clock and logger, mostly for testing.
  now?: () => number;
  log?: (message: string) => void;
};

const DEFAULT_DEBOUNCE_MS = 350;
const DEFAULT_STATE: MascotState = 'idle';

// Pure, framework-agnostic transition core for the mascot. It owns the current
// state and enforces three rules: debounced transitions (8), fallback to idle
// when a state has no frames (9), and a debug log on every change (10).
export class MascotStateMachine {
  private currentState: MascotState = DEFAULT_STATE;

  private readonly states: Map<string, ResolvedAnimationState>;

  private readonly debounceMs: number;

  private readonly now: () => number;

  private readonly log: (message: string) => void;

  private lastTransitionAt = Number.NEGATIVE_INFINITY;

  constructor(states: ResolvedAnimationState[], options: MascotStateMachineOptions = {}) {
    this.states = new Map(states.map((state) => [state.name, state]));
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.now = options.now ?? (() => performance.now());
    this.log = options.log ?? ((message) => console.log(`[mascot] ${message}`));

    if (!this.hasFrames(DEFAULT_STATE)) {
      throw new Error('Character manifest is missing a non-empty "idle" state.');
    }
  }

  get state(): MascotState {
    return this.currentState;
  }

  // The resolved animation for the current state (guaranteed to have frames,
  // since request() only ever commits states that pass the fallback check).
  get action(): ResolvedAnimationState {
    const resolved = this.states.get(this.currentState);
    if (!resolved) {
      // Should be unreachable, but keep the renderer alive if it ever happens.
      return this.states.get(DEFAULT_STATE)!;
    }
    return resolved;
  }

  hasFrames(state: string): boolean {
    return (this.states.get(state)?.frames.length ?? 0) > 0;
  }

  // Request a transition. Returns the resulting state (which may be unchanged if
  // the request was a no-op, debounced, or fell back). Every outcome is logged.
  request(next: MascotState, options: TransitionOptions = {}): MascotState {
    const reason = options.reason ?? 'request';

    // Rule 9: a state with no frames falls back to idle.
    let target: MascotState = next;
    if (!this.hasFrames(target)) {
      this.log(`fallback: "${next}" has no frames -> "${DEFAULT_STATE}" (${reason})`);
      target = DEFAULT_STATE;
    }

    if (target === this.currentState) {
      return this.currentState;
    }

    // Rule 8: debounce non-forced transitions.
    const timestamp = this.now();
    const sinceLast = timestamp - this.lastTransitionAt;
    if (!options.force && sinceLast < this.debounceMs) {
      const remaining = Math.ceil(this.debounceMs - sinceLast);
      this.log(`debounced: "${this.currentState}" -x-> "${target}" (${reason}); ${remaining}ms left`);
      return this.currentState;
    }

    // Rule 10: log every committed change.
    this.log(`"${this.currentState}" -> "${target}" (${reason})`);
    this.currentState = target;
    this.lastTransitionAt = timestamp;
    return this.currentState;
  }
}

// 'idle' is the default/fallback state, so it is the one hard requirement.
// Other states may legitimately be empty (recorded in manifest-warnings.md);
// they are simply not enterable until they gain frames.
export function assertRequiredStates(states: ResolvedAnimationState[]): void {
  const idle = states.find((state) => state.name === 'idle');

  if (!idle || idle.frames.length === 0) {
    throw new Error('Character manifest is missing a non-empty "idle" state.');
  }
}
