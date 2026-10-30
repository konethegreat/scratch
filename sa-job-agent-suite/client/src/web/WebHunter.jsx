// One-click hunt for the hosted app. It reads the public feeds from this
// browser, keeps what matches the profile and saves the rest to the tracker.
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Search, Settings2, Square } from 'lucide-react';
import { sourceLabel, splitList } from '@sajas/core/feeds';
import { getFeedClient } from './feeds.js';
import { HUNT_SAVE_LIMIT, runHunt } from './hunter.js';

const API_BASE = import.meta.env.VITE_SAJAS_API_BASE || 'http://localhost:5000/api';
const STAGES = ['Read the public feeds', 'Filter and score matches', 'Save new matches'];

async function saveJob(job) {
  const response = await fetch(`${API_BASE}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: job.title,
      company: job.company,
      location: job.location || 'South Africa',
      description: job.description,
      applyUrl: job.applyUrl,
      source: sourceLabel(job.source),
      matchScore: job.matchScore,
      datePosted: job.datePosted
    })
  });
  if (response.status === 409) return 'exists';
  if (!response.ok) throw new Error(`The tracker refused ${job.title}.`);
  return 'added';
}

function stageIndex(stage) {
  if (stage === 'fetching') return 0;
  if (stage === 'filtering') return 1;
  if (stage === 'saving') return 2;
  return -1;
}

function listOf(value) {
  return splitList(value);
}

export default function WebHunter({ profile = {}, jobs = [], toasts, onJobsChanged, onOpenProfile }) {
  const [state, setState] = useState('idle'); // idle | running | done | error
  const [stage, setStage] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState(null);
  const [failure, setFailure] = useState('');
  const cancelled = useRef(false);

  // Leaving the tab mid-hunt cancels it, so no saves keep landing unseen.
  useEffect(() => () => { cancelled.current = true; }, []);

  const keywords = listOf(profile.keywords);
  const locations = listOf(profile.locations);
  const saOnly = profile.feedSaOnly !== false;

  async function start() {
    if (state === 'running') return;
    cancelled.current = false;
    setState('running');
    setFailure('');
    setSummary(null);
    setProgress({ done: 0, total: 0 });
    setStage('fetching');
    try {
      const feeds = await getFeedClient();
      const result = await runHunt({
        feeds,
        profile,
        jobs,
        save: saveJob,
        isCancelled: () => cancelled.current,
        onProgress: (update) => {
          setStage(update.stage);
          if (update.stage === 'saving') {
            setProgress({ done: update.done || 0, total: update.total || 0 });
          }
        }
      });
      if (result.feeds === 0) {
        throw new Error('No feed answered. Check your connection, then retry.');
      }
      setSummary(result);
      setState('done');
      onJobsChanged?.();
      if (result.stopped) {
        toasts?.info?.(`Hunt stopped. ${result.saved} new job${result.saved === 1 ? '' : 's'} saved so far.`);
      } else if (result.saved > 0 && result.failed > 0) {
        toasts?.error?.(`${result.saved} saved, ${result.failed} could not be saved. Try the hunt again.`);
      } else if (result.saved > 0) {
        toasts?.success?.(`${result.saved} new job${result.saved === 1 ? '' : 's'} saved to your tracker.`);
      } else if (result.failed > 0) {
        toasts?.error?.(`No jobs saved. ${result.failed} could not be saved. Try the hunt again.`);
      } else if (result.matches === 0) {
        toasts?.info?.('No matches. Loosen your keywords or locations in Profile & Settings.');
      } else {
        toasts?.info?.('Nothing new. Every match is already in your tracker.');
      }
    } catch (error) {
      setFailure(error?.message || 'The hunt failed.');
      setState('error');
    }
  }

  function stop() {
    cancelled.current = true;
    toasts?.info?.('Stopping after the job being saved now.');
  }

  const running = state === 'running';
  const activeStage = stageIndex(stage);

  return (
    <section className="panel" data-testid="web-hunter" style={{ padding: 24 }}>
      <div className="flex-between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h3 style={{ fontSize: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Search size={17} /> Find jobs
            <span className="badge badge-info">Public feeds, this browser</span>
          </h3>
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            Reads Remotive, Arbeitnow and Jobicy in this tab, scores every posting against your keywords,
            drops what you already track and saves the rest below. Your key is not used.
          </p>
        </div>
        {running ? (
          <button type="button" className="btn-secondary" data-testid="stop-web-hunter" onClick={stop}>
            <Square size={13} /> Stop
          </button>
        ) : (
          <button type="button" className="btn-primary" data-testid="run-web-hunter" onClick={start}>
            <Search size={14} /> {state === 'done' || state === 'error' ? 'Hunt again' : 'Run hunt'}
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 14 }}>
        {keywords.length ? keywords.map((keyword) => (
          <span key={keyword} className="badge badge-accent">{keyword}</span>
        )) : (
          <span className="badge badge-warning">No keywords: every South African job is a match</span>
        )}
        {locations.length ? locations.map((location) => (
          <span key={location} className="badge badge-info">{location}</span>
        )) : null}
        <span className="badge badge-info">{saOnly ? 'South Africa only' : 'All countries'}</span>
        {onOpenProfile && (
          <button type="button" className="btn-ghost btn-xs" onClick={onOpenProfile}>
            <Settings2 size={12} /> Edit criteria
          </button>
        )}
      </div>

      {running && (
        <ol style={{ marginTop: 18, display: 'grid', gap: 8, listStyle: 'none', padding: 0 }} aria-live="polite">
          {STAGES.map((label, index) => (
            <li key={label} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {activeStage === index
                ? <Loader2 size={14} className="spin" />
                : <span className="status-dot" aria-hidden="true" />}
              <span className={activeStage > index ? '' : 'muted'}>
                {label}{index === 2 && progress.total > 0 ? ` (${progress.done} of ${progress.total})` : ''}
              </span>
            </li>
          ))}
        </ol>
      )}

      {state === 'error' && (
        <div role="alert" data-testid="web-hunter-error" style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <AlertTriangle size={15} color="var(--color-error)" />
          <span className="tiny">{failure}</span>
        </div>
      )}

      {state === 'done' && summary && (
        <div data-testid="web-hunter-result" role="status" style={{ marginTop: 16 }}>
          <p style={{ margin: 0, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <CheckCircle2 size={15} color="var(--color-success)" />
            <span style={{ fontSize: 13 }}>
              {summary.saved} new saved, {summary.duplicates} already tracked, {summary.failed} failed.
            </span>
          </p>
          <p className="tiny" style={{ margin: '6px 0 0 23px' }}>
            {summary.read} postings read from {summary.feeds} feed{summary.feeds === 1 ? '' : 's'}
            {summary.hiddenForeign > 0 ? `, ${summary.hiddenForeign} outside South Africa skipped` : ''}
            {summary.skippedByLimit > 0 ? `, ${summary.skippedByLimit} more matches left for Job Feeds (cap ${HUNT_SAVE_LIMIT})` : ''}.
            {summary.stopped ? ' You stopped the hunt, so later saves were cancelled.' : ''}
          </p>
        </div>
      )}

      {state !== 'error' && summary?.perSource?.length > 0 && (
        <p className="tiny" style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {summary.perSource.map((source) => (
            <span key={source.id} className="badge badge-info">{source.label}: {source.count}</span>
          ))}
        </p>
      )}

      {summary?.errors?.length > 0 && (
        <ul className="tiny" style={{ margin: '10px 0 0 16px', padding: 0, display: 'grid', gap: 4 }}>
          {summary.errors.map((entry) => (
            <li key={entry.source}>
              {entry.label}: {entry.error?.message || entry.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
