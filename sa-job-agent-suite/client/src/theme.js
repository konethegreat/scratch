import { useSyncExternalStore } from 'react';

export const THEME_KEY = 'sajas-theme';
export const THEME_CHOICES = ['system', 'light', 'dark'];
export const THEME_COLORS = { light: '#f6f6f3', dark: '#0b0d12' };

const MEDIA_QUERY = '(prefers-color-scheme: dark)';
const listeners = new Set();
let memoryChoice = 'system';
let started = false;

export function normalizeChoice(value) {
  return THEME_CHOICES.includes(value) ? value : 'system';
}

export function resolveTheme(choice, prefersDark) {
  if (choice === 'light' || choice === 'dark') return choice;
  return prefersDark ? 'dark' : 'light';
}

function osPrefersDark() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(MEDIA_QUERY).matches;
}

export function getChoice() {
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    return saved === null ? 'system' : normalizeChoice(saved);
  } catch {
    return memoryChoice;
  }
}

export function applyChoice(choice) {
  const normalized = normalizeChoice(choice);
  const theme = resolveTheme(normalized, osPrefersDark());
  if (typeof document === 'undefined') return theme;
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.themeChoice = normalized;
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[theme]);
  return theme;
}

function emit() {
  for (const listener of listeners) listener();
}

export function setChoice(choice) {
  const normalized = normalizeChoice(choice);
  memoryChoice = normalized;
  try {
    window.localStorage.setItem(THEME_KEY, normalized);
  } catch {
    // The choice still applies for this session.
  }
  applyChoice(normalized);
  emit();
  return normalized;
}

function start() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const media = window.matchMedia?.(MEDIA_QUERY);
  media?.addEventListener?.('change', () => {
    if (getChoice() === 'system') {
      applyChoice('system');
      emit();
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key !== THEME_KEY && event.key !== null) return;
    applyChoice(getChoice());
    emit();
  });
}

export function subscribe(listener) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useThemeChoice() {
  return useSyncExternalStore(subscribe, getChoice, () => 'system');
}

if (typeof document !== 'undefined') applyChoice(getChoice());
start();
