import { Monitor, Sun, Moon } from 'lucide-react';
import { THEME_CHOICES, setChoice, useThemeChoice } from './theme.js';

const ICONS = { system: Monitor, light: Sun, dark: Moon };
const LABELS = { system: 'System theme', light: 'Light theme', dark: 'Dark theme' };
const VISIBLE = { system: 'System', light: 'Light', dark: 'Dark' };

export default function ThemeToggle({ className = '' }) {
  const choice = useThemeChoice();
  return (
    <div className={`theme-toggle ${className}`.trim()} role="group" aria-label="Theme" data-testid="theme-toggle">
      {THEME_CHOICES.map((value) => {
        const Icon = ICONS[value];
        const pressed = choice === value;
        return (
          <button
            key={value}
            type="button"
            className={`theme-option${pressed ? ' is-active' : ''}`}
            aria-pressed={pressed}
            aria-label={LABELS[value]}
            title={LABELS[value]}
            data-testid={`theme-${value}`}
            onClick={() => setChoice(value)}
          >
            <Icon size={15} aria-hidden="true" />
            <span className="theme-option-label">{VISIBLE[value]}</span>
          </button>
        );
      })}
    </div>
  );
}
