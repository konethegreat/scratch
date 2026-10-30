import { useEffect, useRef, useState } from 'react';
import { Loader2, Search, Square } from 'lucide-react';
import { fingerprint } from '@sajas/core/feeds';
import { isSouthAfrican } from '@sajas/core/jobs';
import { DEMO_HUNTER_JOBS } from './fixtures.js';

const API_BASE = import.meta.env.VITE_SAJAS_API_BASE || 'http://localhost:5000/api';

const STAGES = [
  'Reading the simulated boards',
  'Keeping South African roles',
  'Scoring matches against your keywords',
  'Checking your tracker for duplicates',
  'Saving new matches'
];

const SOURCE_LABELS = { remotive: 'Remotive (simulated)', arbeitnow: 'Arbeitnow (simulated)', jobicy: 'Jobicy (simulated)' };

export default function SimulatedHunter({ onJobsChanged, toasts }) {
  const [stage, setStage] = useState(-1);
  const [running, setRunning] = useState(false);
  const [read, setRead] = useState(0);
  const [foreign, setForeign] = useState([]);
  const [saved, setSaved] = useState([]);
  const [duplicates, setDuplicates] = useState(0);
  const [total, setTotal] = useState(0);
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

  async function trackedFingerprints() {
    const response = await fetch(`${API_BASE}/jobs`, { cache: 'no-store' });
    if (!response.ok) return new Set();
    const jobs = await response.json();
    return new Set((Array.isArray(jobs) ? jobs : []).map((job) => fingerprint(job.title, job.company)));
  }

  async function saveJob(job) {
    const response = await fetch(`${API_BASE}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job)
    });
    if (response.status === 409) return 'exists';
    return response.ok ? 'added' : 'failed';
  }

  async function start() {
    cancelled.current = false;
    setRunning(true);
    setStopped(false);
    setComplete(false);
    setRead(0);
    setForeign([]);
    setSaved([]);
    setDuplicates(0);
    setTotal(0);

    setStage(0);
    const postings = DEMO_HUNTER_JOBS.map((job) => ({ ...job }));
    setRead(postings.length);
    await sleep(700);
    if (cancelled.current) return;

    setStage(1);
    const inCountry = postings.filter((job) => isSouthAfrican(job.location));
    const outside = postings.filter((job) => !isSouthAfrican(job.location));
    setForeign(outside);
    await sleep(650);
    if (cancelled.current) return;

    setStage(2);
    inCountry.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
    await sleep(650);
    if (cancelled.current) return;

    setStage(3);
    let tracked = new Set();
    try {
      tracked = await trackedFingerprints();
    } catch {
      tracked = new Set();
    }
    if (cancelled.current) return;
    const fresh = inCountry.filter((job) => !tracked.has(fingerprint(job.title, job.company)));
    const seen = inCountry.length - fresh.length;
    setDuplicates(seen);
    setTotal(fresh.length);
    await sleep(550);
    if (cancelled.current) return;

    setStage(4);
    let added = [];
    let same = seen;
    for (const job of fresh) {
      if (cancelled.current) break;
      const result = await saveJob(job);
      if (result === 'added') {
        added = [...added, job];
        setSaved(added);
      } else if (result === 'exists') {
        same += 1;
        setDuplicates(same);
      }
      await sleep(140);
    }
    if (cancelled.current) {
      onJobsChanged?.();
      return;
    }
    setRunning(false);
    setStage(STAGES.length);
    setComplete(true);
    onJobsChanged?.();
    toasts?.success?.(added.length
      ? `Simulated hunt added ${added.length} fictional ${added.length === 1 ? 'role' : 'roles'} to your tracker.`
      : 'Simulated hunt finished. Those roles were already tracked.');
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

  const perSource = DEMO_HUNTER_JOBS.reduce((counts, job) => {
    counts[job.feed] = (counts[job.feed] || 0) + 1;
    return counts;
  }, {});

  return (
    <section className="panel" style={{ padding: 24 }} data-testid="simulated-hunter">
      <div className="flex-between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ fontSize: 18 }}>
            Simulated job hunt <span className="badge badge-warning">Simulated</span>
          </h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            The same five stages as the real hunt, run against three fictional boards with your demo profile.
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

      <div className="tiny" style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {Object.entries(perSource).map(([source, count]) => (
          <span key={source} className="badge">
            {SOURCE_LABELS[source] || source}: {count} postings
          </span>
        ))}
      </div>

      <ol style={{ marginTop: 16, display: 'grid', gap: 10, listStyle: 'none', padding: 0 }}>
        {STAGES.map((label, index) => {
          const done = stage > index || complete;
          const active = running && stage === index;
          return (
            <li key={label} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {active
                ? <Loader2 size={14} className="spin" />
                : <span className="status-dot" aria-hidden="true" />}
              <span className={done || active ? '' : 'muted'}>{label}</span>
              {index === 0 && read > 0 && <span className="tiny muted">({read} postings)</span>}
              {index === 1 && (stage > 1 || complete) && (
                <span className="tiny muted">({read - foreign.length} kept, {foreign.length} skipped)</span>
              )}
              {index === 3 && (stage > 3 || complete) && (
                <span className="tiny muted">({duplicates} already tracked)</span>
              )}
              {index === 4 && total > 0 && (
                <span className="tiny muted">({saved.length} of {total})</span>
              )}
            </li>
          );
        })}
      </ol>

      {saved.length > 0 && (
        <ul className="tiny" style={{ marginTop: 14, display: 'grid', gap: 4, listStyle: 'none', padding: 0 }}>
          {saved.map((job) => (
            <li key={`${job.title}-${job.company}`}>
              <span className="badge badge-success" style={{ marginRight: 8 }}>Saved</span>
              {job.title} at {job.company} <span className="muted">({job.matchScore}% match)</span>
            </li>
          ))}
        </ul>
      )}

      {foreign.length > 0 && (stage > 1 || complete) && (
        <p className="tiny muted" style={{ marginTop: 12 }}>
          Skipped {foreign.length} outside South Africa ({foreign.map((job) => `${job.title}, ${job.location}`).join('; ')}).
        </p>
      )}
      {stopped && <p className="tiny" style={{ marginTop: 12 }}>Stopped. Later steps were cancelled.</p>}
      {complete && (
        <p className="tiny" style={{ marginTop: 12 }} data-testid="demo-hunter-result">
          {saved.length} added, {duplicates} already tracked, {foreign.length} outside South Africa skipped. Nothing left this page.
        </p>
      )}
    </section>
  );
}
