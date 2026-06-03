import { MASCOT_STATES, type MascotState, type ResolvedAnimationAction } from './types';

type StateMap = Map<string, ResolvedAnimationAction>;

export class MascotStateMachine {
  private currentState: MascotState;

  private readonly defaultState: MascotState;

  private readonly actions: StateMap;

  constructor(defaultState: MascotState, actions: ResolvedAnimationAction[]) {
    this.defaultState = defaultState;
    this.currentState = defaultState;
    this.actions = new Map(actions.map((action) => [action.name, action]));
  }

  get state(): MascotState {
    return this.currentState;
  }

  get action(): ResolvedAnimationAction {
    return this.actionFor(this.currentState) ?? this.requiredAction(this.defaultState);
  }

  canEnter(nextState: MascotState): boolean {
    return MASCOT_STATES.includes(nextState) && this.actions.has(nextState);
  }

  enter(nextState: MascotState): MascotState {
    if (this.canEnter(nextState)) {
      this.currentState = nextState;
    }

    return this.currentState;
  }

  completeCurrentAction(): MascotState {
    const currentAction = this.action;
    const nextState = currentAction.nextState ?? this.defaultState;
    return this.enter(nextState);
  }

  private actionFor(state: MascotState): ResolvedAnimationAction | undefined {
    return this.actions.get(state);
  }

  private requiredAction(state: MascotState): ResolvedAnimationAction {
    const action = this.actionFor(state);
    if (!action) {
      throw new Error(`Missing animation action for required state "${state}".`);
    }
    return action;
  }
}

export function assertRequiredActions(actions: ResolvedAnimationAction[]): void {
  const available = new Set(actions.map((action) => action.name));
  const missing = MASCOT_STATES.filter((state) => !available.has(state));

  if (missing.length > 0) {
    throw new Error(`Character manifest is missing actions: ${missing.join(', ')}`);
  }
}
