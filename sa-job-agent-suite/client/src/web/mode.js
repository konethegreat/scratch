// Which parts of the desktop UI are meaningful in the hosted, server-less app.
export const SERVER_ONLY_TABS = Object.freeze(['copilot', 'referrals', 'routines', 'logs']);
export const SERVER_ONLY_SETTINGS = Object.freeze(['answers', 'data']);

export function isTabVisible(tab, isWeb) {
  return !isWeb || !SERVER_ONLY_TABS.includes(tab);
}

export function filterSettingsTabs(tabs, isWeb) {
  if (!isWeb) return tabs;
  return tabs.filter((tab) => !SERVER_ONLY_SETTINGS.includes(tab.id));
}
