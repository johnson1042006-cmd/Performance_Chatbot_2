export interface BotSettings {
  aiEnabled: boolean;
  fallbackTimerSeconds: number;
  historyRetentionMonths: number;
  autoOpenOnFirstVisit: boolean;
  hotkeysEnabled: boolean;
}

export const DEFAULT_SETTINGS: BotSettings = {
  aiEnabled: true,
  fallbackTimerSeconds: 60,
  historyRetentionMonths: 0,
  autoOpenOnFirstVisit: true,
  hotkeysEnabled: true,
};
