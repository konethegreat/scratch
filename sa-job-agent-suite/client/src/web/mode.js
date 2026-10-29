// Which parts of the desktop UI are meaningful in the hosted, server-less app.
export const SERVER_ONLY_TABS = Object.freeze(['copilot', 'referrals', 'routines', 'logs']);
export const SERVER_ONLY_SETTINGS = Object.freeze(['answers', 'data']);
// Tabs that only make sense in the hosted app, such as the guided Apply packet.
export const WEB_ONLY_TABS = Object.freeze(['apply']);
export const WEB_ONLY_SETTINGS = Object.freeze(['backup']);
// The demo keeps the simulated agents and the logs, and hides write-out surfaces.
export const DEMO_HIDDEN_TABS = Object.freeze(['referrals', 'routines']);
export const DEMO_HIDDEN_SETTINGS = Object.freeze(['backup']);

export function isTabVisible(tab, isWeb, demo = false) {
  if (WEB_ONLY_TABS.includes(tab)) return Boolean(isWeb);
  if (demo) return !DEMO_HIDDEN_TABS.includes(tab);
  return !isWeb || !SERVER_ONLY_TABS.includes(tab);
}

export function filterSettingsTabs(tabs, isWeb, demo = false) {
  const visible = isWeb
    ? tabs.filter((tab) => !SERVER_ONLY_SETTINGS.includes(tab.id))
    : tabs.filter((tab) => !WEB_ONLY_SETTINGS.includes(tab.id));
  return demo ? visible.filter((tab) => !DEMO_HIDDEN_SETTINGS.includes(tab.id)) : visible;
}
