import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { DEMO_STEPS, dismissDemoStrip, loadDemoProgress, markStepDone } from './progress.js';

export default function DemoTrialStrip({ activeTab, onGo }) {
  const [progress, setProgress] = useState(() => loadDemoProgress());

  useEffect(() => {
    const step = DEMO_STEPS.find((entry) => entry.tab === activeTab);
    if (step) setProgress(markStepDone(step.id));
  }, [activeTab]);

  useEffect(() => {
    const onStep = (event) => setProgress(markStepDone(event.detail));
    window.addEventListener('sajas:demo-step', onStep);
    return () => window.removeEventListener('sajas:demo-step', onStep);
  }, []);

  if (progress.dismissed) return null;

  return (
    <section className="panel" data-testid="demo-trial-strip" aria-label="Demo suggestions" style={{ padding: 14, marginBottom: 20 }}>
      <div className="flex-between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <p className="tiny" style={{ margin: 0 }}>Try the surfaces. Steps tick off as you go.</p>
        <button
          type="button"
          className="btn-ghost btn-xs"
          aria-label="Dismiss demo suggestions"
          onClick={() => setProgress(dismissDemoStrip())}
        >
          <X size={12} />
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        {DEMO_STEPS.map((step) => {
          const done = progress.done.includes(step.id);
          return (
            <button
              key={step.id}
              type="button"
              className={`btn-sm ${done ? 'btn-ghost' : 'btn-secondary'}`}
              onClick={() => onGo(step.tab)}
            >
              {done && <Check size={12} />} {step.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
