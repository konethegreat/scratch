// Which parts of the desktop UI are meaningful in the hosted, server-less app.
export const SERVER_ONLY_TABS = Object.freeze(['copilot', 'referrals', 'routines', 'logs']);
export const SERVER_ONLY_SETTINGS = Object.freeze(['answers', 'data']);
// Tabs that only make sense in the hosted app, such as the guided Apply packet.
export const WEB_ONLY_TABS = Object.freeze(['apply']);
export const WEB_ONLY_SETTINGS = Object.freeze(['backup']);

export function isTabVisible(tab, isWeb) {
  if (WEB_ONLY_TABS.includes(tab)) return Boolean(isWeb);
  return !isWeb || !SERVER_ONLY_TABS.includes(tab);
}

export function filterSettingsTabs(tabs, isWeb) {
  if (isWeb) return tabs.filter((tab) => !SERVER_ONLY_SETTINGS.includes(tab.id));
  return tabs.filter((tab) => !WEB_ONLY_SETTINGS.includes(tab.id));
}
