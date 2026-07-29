// Translated label/description lookup for ACTION_REGISTRY (actionEconomy.ts)
// entries. The registry itself is shared, non-i18n infrastructure (outside
// this translation pass's scope) that only knows English label/description
// strings — this maps each registry key to its translated text instead, so
// both ActionEconomyPanel.tsx (DM turn console) and BattleModePlayerPanel.tsx
// (a player's own quick-reference actions, same registry) show localized
// labels without touching actionEconomy.ts. Pulled into its own plain
// (non-component) module — not ActionEconomyPanel.tsx — so oxlint's
// react-refresh/only-export-components rule doesn't flag a components file
// for also exporting these two functions.
import type { TranslationKey } from '../i18n/LocaleContext';

type LocaleT = (key: TranslationKey, params?: Record<string, string | number>) => string;

export function actionLabel(t: LocaleT, key: string): string {
  switch (key) {
    case 'dash':
      return t('encounters.actionEconomy.actions.dash.label');
    case 'grab':
      return t('encounters.actionEconomy.actions.grab.label');
    case 'shove':
      return t('encounters.actionEconomy.actions.shove.label');
    case 'throw':
      return t('encounters.actionEconomy.actions.throw.label');
    case 'dodge':
      return t('encounters.actionEconomy.actions.dodge.label');
    case 'help':
      return t('encounters.actionEconomy.actions.help.label');
    case 'hide':
      return t('encounters.actionEconomy.actions.hide.label');
    case 'disengage':
      return t('encounters.actionEconomy.actions.disengage.label');
    case 'search':
      return t('encounters.actionEconomy.actions.search.label');
    case 'ready':
      return t('encounters.actionEconomy.actions.ready.label');
    case 'use_object':
      return t('encounters.actionEconomy.actions.useObject.label');
    default:
      return key;
  }
}

export function actionDescription(t: LocaleT, key: string): string {
  switch (key) {
    case 'dash':
      return t('encounters.actionEconomy.actions.dash.description');
    case 'grab':
      return t('encounters.actionEconomy.actions.grab.description');
    case 'shove':
      return t('encounters.actionEconomy.actions.shove.description');
    case 'throw':
      return t('encounters.actionEconomy.actions.throw.description');
    case 'dodge':
      return t('encounters.actionEconomy.actions.dodge.description');
    case 'help':
      return t('encounters.actionEconomy.actions.help.description');
    case 'hide':
      return t('encounters.actionEconomy.actions.hide.description');
    case 'disengage':
      return t('encounters.actionEconomy.actions.disengage.description');
    case 'search':
      return t('encounters.actionEconomy.actions.search.description');
    case 'ready':
      return t('encounters.actionEconomy.actions.ready.description');
    case 'use_object':
      return t('encounters.actionEconomy.actions.useObject.description');
    default:
      return key;
  }
}
