export const ExhibitionState = {
  WELCOME: 'WELCOME',
  CALIBRATION: 'CALIBRATION',
  INSTRUCTIONS: 'INSTRUCTIONS',
  COUNTDOWN: 'COUNTDOWN',
  FIGHT: 'FIGHT',
  PROCESSING: 'PROCESSING',
  REVIEW: 'REVIEW',
  FIGHTER_REVEAL: 'FIGHTER_REVEAL',
} as const;

export type ExhibitionState = (typeof ExhibitionState)[keyof typeof ExhibitionState];

/**
 * Ordered sequence of the frozen exhibition flow
 */
export const EXHIBITION_FLOW_SEQUENCE: readonly ExhibitionState[] = [
  ExhibitionState.WELCOME,
  ExhibitionState.CALIBRATION,
  ExhibitionState.INSTRUCTIONS,
  ExhibitionState.COUNTDOWN,
  ExhibitionState.FIGHT,
  ExhibitionState.PROCESSING,
  ExhibitionState.REVIEW,
  ExhibitionState.FIGHTER_REVEAL,
] as const;

export interface StateCoordinator {
  currentState: ExhibitionState;
  goToState: (state: ExhibitionState) => void;
  nextState: () => void;
  resetToWelcome: () => void;
}
