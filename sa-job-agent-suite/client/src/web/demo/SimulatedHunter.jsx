import { useEffect, useRef, useState } from 'react';
import { Loader2, Search, Square } from 'lucide-react';
import { DEMO_HUNTER_JOBS } from './fixtures.js';

const API_BASE = import.meta.env.VITE_SAJAS_API_BASE || 'http://localhost:5000/api';

const STAGES = [
  'Checking sources',
  'Reading job pages',
  'Filtering for South Africa',
  'Scoring matches',
  'Removing duplicates'
];

export default function SimulatedHunter({ onJobsChanged, toasts }) {
  const [stage, setStage] = useState(-1);
  const [running, setRunning] = useState(false);
  const [saved, setSaved] = useState(0);
  const [duplicates, setDuplicates] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [complete, setComplete] = useState(false);
  const cancelled = useRef(false);
  const timer = useRef(null);
  const resume = useRef(null);

  useEffect(() => () => {
    cancelled.current = true;
    clearTimeout(timer.current);
    if (resume.current) resume.current();
  }, []);

  function sleep(ms) {
    return new Promise((resolve) => {
      resume.current = resolve;
      timer.current = setTimeout(resolve, ms);
    });
  }

  async function writeJobs() {
    let added = 0;
    let same = 0;
    for (const job of DEMO_HUNTER_JOBS) {
      if (cancelled.current) break;
      const response = await fetch(`${API_BASE}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job)
      });
      if (response.status === 409) same += 1;
      else if (response.ok) added += 1;
    }
    return { added, same };
  }

  async function start() {
    cancelled.current = false;
    setRunning(true);
    setStopped(false);
    setComplete(false);
    setSaved(0);
    setDuplicates(0);
    for (let index = 0; index < STAGES.length; index += 1) {
      if (cancelled.current) return;
      setStage(index);
      if (index === STAGES.length - 1) {
        const { added, same } = await writeJobs();
        if (cancelled.current) return;
        setSaved(added);
        setDuplicates(same);
      } else {
        await sleep(600);
      }
      if (cancelled.current) return;
    }
    setRunning(false);
    setStage(STAGES.length);
    setComplete(true);
    onJobsChanged?.();
    toasts?.success?.('Simulated hunt finished. Nothing was scraped.');
    window.dispatchEvent(new CustomEvent('sajas:demo-step', { detail: 'hunter' }));
  }

  function stop() {
    cancelled.current = true;
    clearTimeout(timer.current);
    if (resume.current) resume.current();
    setRunning(false);
    setStopped(true);
    setStage(-1);
  }

  return (
    <section className="panel" style={{ padding: 24 }} data-testid="simulated-hunter">
      <div className="flex-between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ fontSize: 18 }}>
            Simulated job hunt <span className="badge badge-warning">Simulated</span>
          </h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Five staged steps on fictional boards. The desktop app checks real job boards.
          </p>
        </div>
        {running ? (
          <button type="button" className="btn-secondary" onClick={stop}>
            <Square size={13} /> Stop
          </button>
        ) : (
          <button type="button" className="btn-primary" data-testid="run-demo-hunter" onClick={start}>
            <Search size={14} /> Run simulated hunt
          </button>
        )}
      </div>

      <ol style={{ marginTop: 20, display: 'grid', gap: 10, listStyle: 'none', padding: 0 }}>
        {STAGES.map((label, index) => (
          <li key={label} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {running && stage === index
              ? <Loader2 size={14} className="spin" />
              : <span className="status-dot" aria-hidden="true" />}
            <span className={stage > index || complete ? '' : 'muted'}>{label}</span>
          </li>
        ))}
      </ol>

      {stopped && <p className="tiny" style={{ marginTop: 12 }}>Stopped. Later steps were cancelled.</p>}
      {complete && (
        <p className="tiny" style={{ marginTop: 12 }} data-testid="demo-hunter-result">
          {saved} added, {duplicates} already tracked. Nothing left this page.
        </p>
      )}
    </section>
  );
}
