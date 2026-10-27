// Browser-only job feeds tab. Fetches three public feeds directly from the
// browser and lets the user add matching jobs to their tracker.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ExternalLink, Loader2, MapPin, Plus, RefreshCw, Rss } from 'lucide-react';
import {
  FEED_SOURCES, dedupeJobs, filterJobs, fingerprint, sourceLabel, splitList, trackerFingerprints
} from '@sajas/core/feeds';
import { getFeedClient } from './web/feeds.js';
import { readResponseError, recordError } from './errors.js';

const API_BASE = import.meta.env.VITE_SAJAS_API_BASE || 'http://localhost:5000/api';

const rowKey = (job) => fingerprint(job.title, job.company);

export default function JobFeeds({ profile, jobs, toasts, onJobsChanged, onProfileSaved }) {
  const [keywords, setKeywords] = useState(profile?.keywords || '');
  const [locations, setLocations] = useState(profile?.locations || '');
  const [onlyMatches, setOnlyMatches] = useState(true);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [errors, setErrors] = useState([]);
  const [meta, setMeta] = useState({});
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [tracked, setTracked] = useState(() => new Set());

  useEffect(() => {
    setTracked(trackerFingerprints(jobs));
  }, [jobs]);

  const load = useCallback(async ({ force = false } = {}) => {
    setLoading(true);
    try {
      const outcome = await getFeedClient().loadAll({ force });
      setResults(dedupeJobs(outcome.results.flatMap((entry) => entry.jobs)));
      setErrors(outcome.errors);
      setMeta(Object.fromEntries(outcome.results.map((entry) => [entry.source, entry.fetchedAt])));
    } catch (error) {
      const info = recordError(error, { where: 'load feeds' });
      setNotice(info.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => filterJobs(results, {
    keywords: splitList(keywords),
    locations: splitList(locations),
    onlyMatches
  }), [results, keywords, locations, onlyMatches]);

  async function addOne(job) {
    const key = rowKey(job);
    setBusy(key);
    try {
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
      if (response.status === 409) {
        setTracked((current) => new Set(current).add(key));
        return 'exists';
      }
      if (!response.ok) throw await readResponseError(response, 'Could not add this job to your tracker.');
      setTracked((current) => new Set(current).add(key));
      onJobsChanged?.();
      return 'added';
    } catch (error) {
      const info = recordError(error, { where: 'add feed job' });
      setNotice(`${job.title}: ${info.hint || info.message}`);
      return 'failed';
    } finally {
      setBusy('');
    }
  }

  async function addVisible() {
    const targets = visible.filter((job) => !tracked.has(rowKey(job)));
    let added = 0;
    let exists = 0;
    let failed = 0;
    for (const job of targets) {
      const outcome = await addOne(job);
      if (outcome === 'added') added += 1;
      else if (outcome === 'exists') exists += 1;
      else failed += 1;
    }
    setNotice(`${added} added, ${exists} already in your tracker, ${failed} failed.`);
    if (added) toasts.success(`${added} job${added === 1 ? '' : 's'} added to your tracker.`);
  }

  async function retryOne(id) {
    setLoading(true);
    try {
      const result = await getFeedClient().load(id, { force: true });
      setMeta((current) => ({ ...current, [id]: result.fetchedAt }));
      setErrors((current) => current.filter((entry) => entry.source !== id));
      setResults((current) => dedupeJobs([
        ...current.filter((job) => !(job.source === id || job.sources?.includes(id))),
        ...result.jobs
      ]));
    } catch (error) {
      const info = recordError(error, { where: `feed ${id}` });
      setErrors((current) => [
        ...current.filter((entry) => entry.source !== id),
        { source: id, label: sourceLabel(id), error: info }
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function saveDefaults() {
    try {
      const response = await fetch(`${API_BASE}/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords, locations })
      });
      if (!response.ok) throw await readResponseError(response, 'Could not save these filters.');
      toasts.success('Feed filters saved as your defaults.');
      onProfileSaved?.();
    } catch (error) {
      const info = recordError(error, { where: 'save feed filters' });
      setNotice(`${info.message} ${info.hint || ''}`.trim());
    }
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="panel" style={{ padding: 20 }}>
        <div className="flex-between" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h3 style={{ fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Rss size={16} /> Public job feeds
            </h3>
            <p className="tiny" style={{ marginTop: 4 }}>
              Fetched by this browser from three public feeds. No key, no profile data, and no account are sent.
            </p>
          </div>
          <div className="flex-gap">
            <button className="btn-secondary btn-sm" onClick={() => load({ force: true })} disabled={loading}>
              {loading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Refresh all
            </button>
            <button className="btn-primary btn-sm" onClick={addVisible} disabled={loading || visible.length === 0}>
              <Plus size={14} /> Add all matches
            </button>
          </div>
        </div>

        <div className="grid-2" style={{ marginTop: 16 }}>
          <div>
            <label>Keywords</label>
            <input value={keywords} onChange={(event) => setKeywords(event.target.value)} placeholder="React, Node.js, Data" />
          </div>
          <div>
            <label>Locations</label>
            <input value={locations} onChange={(event) => setLocations(event.target.value)} placeholder="Johannesburg, Remote" />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <input type="checkbox" checked={onlyMatches} onChange={(event) => setOnlyMatches(event.target.checked)} style={{ width: 16, height: 16 }} />
            <span style={{ fontSize: 13 }}>Only show matches</span>
          </label>
          <button className="btn-ghost btn-sm" onClick={saveDefaults}>Save as defaults</button>
          {notice && <span className="tiny">{notice}</span>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 14 }}>
        {FEED_SOURCES.map((source) => {
          const failure = errors.find((entry) => entry.source === source.id);
          const count = results.filter((job) => (job.sources || [job.source]).includes(source.id)).length;
          return (
            <div key={source.id} className="panel" style={{ padding: 16 }} data-testid={`feed-source-${source.id}`}>
              <div className="flex-between">
                <h4 style={{ fontSize: 14 }}>{source.label}</h4>
                <a href={source.home} target="_blank" rel="noopener noreferrer" className="tiny">Source</a>
              </div>
              {failure ? (
                <div style={{ marginTop: 8 }}>
                  <p className="tiny" style={{ color: 'var(--color-error)', display: 'flex', gap: 6 }}>
                    <AlertTriangle size={12} /> {failure.error.message}
                  </p>
                  <p className="tiny" style={{ marginTop: 4 }}>{failure.error.hint}</p>
                  <button className="btn-secondary btn-xs" style={{ marginTop: 8 }} onClick={() => retryOne(source.id)}>
                    Retry this feed
                  </button>
                </div>
              ) : (
                <p className="tiny" style={{ marginTop: 6 }}>
                  {loading ? 'Loading...' : `${count} jobs`}
                  {meta[source.id] ? `, fetched ${new Date(meta[source.id]).toLocaleTimeString()}` : ''}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="panel" style={{ padding: 20 }}>
        <h3 style={{ fontSize: 15, marginBottom: 12 }}>
          {visible.length} matching {visible.length === 1 ? 'job' : 'jobs'}
        </h3>
        {visible.length === 0 ? (
          <p className="tiny" style={{ padding: '24px 0', textAlign: 'center' }}>
            {loading ? 'Fetching feeds...' : results.length === 0
              ? 'No feeds returned jobs. Retry above, or check your connection.'
              : 'No jobs match these filters. Loosen the keywords, add a location, or turn off Only show matches.'}
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Role and company</th>
                  <th>Location</th>
                  <th>Source</th>
                  <th>Posted</th>
                  <th>Match</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, 100).map((job, index) => {
                  const key = rowKey(job);
                  const isTracked = tracked.has(key);
                  return (
                    <tr key={key} data-testid={`feed-row-${index}`}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{job.title}</div>
                        <div className="tiny">{job.company}</div>
                      </td>
                      <td>
                        <span className="tiny" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <MapPin size={12} /> {job.location || 'Not stated'}
                          {job.remote && <span className="badge badge-info">Remote</span>}
                        </span>
                      </td>
                      <td><span className="badge badge-info">{(job.sources || [job.source]).map(sourceLabel).join(', ')}</span></td>
                      <td className="tiny">{job.datePosted || 'Unknown'}</td>
                      <td style={{ color: job.matchScore >= 80 ? 'var(--color-success)' : 'var(--color-accent)', fontWeight: 700 }}>
                        {job.matchScore}%
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          {job.applyUrl && (
                            <a href={job.applyUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-xs" style={{ textDecoration: 'none' }}>
                              <ExternalLink size={12} /> Open
                            </a>
                          )}
                          <button
                            className={isTracked ? 'btn-ghost btn-xs' : 'btn-primary btn-xs'}
                            disabled={isTracked || busy === key}
                            onClick={() => addOne(job)}
                            data-testid={`add-job-${index}`}
                          >
                            {busy === key ? <Loader2 size={12} className="spin" /> : isTracked ? <Check size={12} /> : <Plus size={12} />}
                            {isTracked ? 'In tracker' : 'Add'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visible.length > 100 && (
              <p className="tiny" style={{ marginTop: 10 }}>
                Showing the top 100 of {visible.length}. Narrow the filters to see more.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
