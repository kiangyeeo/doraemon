import type { MascotState, ResolvedAnimationState } from './types';

type StateMap = Map<string, ResolvedAnimationState>;

export class MascotStateMachine {
  private currentState: MascotState;

  private readonly defaultState: MascotState;

  private readonly states: StateMap;

  constructor(defaultState: MascotState, states: ResolvedAnimationState[]) {
    this.defaultState = defaultState;
    this.currentState = defaultState;
    this.states = new Map(states.map((state) => [state.name, state]));
  }

  get state(): MascotState {
    return this.currentState;
  }

  get action(): ResolvedAnimationState {
    return this.stateFor(this.currentState) ?? this.requiredState(this.defaultState);
  }

  // A state can only be entered if it exists and actually has frames to play.
  canEnter(nextState: MascotState): boolean {
    const target = this.states.get(nextState);
    return target !== undefined && target.frames.length > 0;
  }

  enter(nextState: MascotState): MascotState {
    if (this.canEnter(nextState)) {
      this.currentState = nextState;
    }

    return this.currentState;
  }

  // The states manifest has no per-state successor, so any non-looping state
  // settles back to the default state once its animation finishes.
  completeCurrentAction(): MascotState {
    return this.enter(this.defaultState);
  }

  private stateFor(state: MascotState): ResolvedAnimationState | undefined {
    return this.states.get(state);
  }

  private requiredState(state: MascotState): ResolvedAnimationState {
    const resolved = this.stateFor(state);
    if (!resolved) {
      throw new Error(`Missing animation state for required state "${state}".`);
    }
    return resolved;
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
