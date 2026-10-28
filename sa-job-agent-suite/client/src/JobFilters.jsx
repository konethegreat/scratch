import React, { useState } from 'react';
import { Filter, Search } from 'lucide-react';
import { DEFAULT_VIEW_FILTERS } from '@sajas/core/jobs';

const STATUS_OPTIONS = [
  ['all', 'All statuses'], ['found', 'Discovered'], ['tailored', 'Tailored'],
  ['applied', 'Applied'], ['interviewing', 'Interviewing'], ['offer', 'Offer'],
  ['rejected', 'Rejected']
];

const LINK_OPTIONS = [
  ['all', 'Any link'], ['live', 'Verified live'], ['no-link', 'No verified link']
];

const DATE_OPTIONS = [
  ['any', 'Any date'], ['7', 'Added this week'], ['30', 'Added this month']
];

const SCORE_STEPS = [0, 50, 60, 70, 80, 90];

function Chip({ active, onClick, children, testid }) {
  return (
    <button
      type="button"
      className={active ? 'btn-primary btn-xs' : 'btn-secondary btn-xs'}
      onClick={onClick}
      data-testid={testid}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

export default function JobFilters({
  filters, onChange, provinceOptions = [], sourceOptions = [],
  hiddenForeign = 0, activeCount = 0
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="job-filters">
      <button
        type="button"
        className="btn-secondary btn-sm job-filters-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        data-testid="job-filters-toggle"
      >
        <Filter size={14} /> Filters{activeCount > 0 ? ` (${activeCount})` : ''}
      </button>

      <div className={`job-filters-body${open ? ' open' : ''}`}>
        <div className="job-filter-field job-filter-search">
          <label htmlFor="job-filter-search">Search</label>
          <div style={{ position: 'relative' }}>
            <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              id="job-filter-search"
              data-testid="job-filter-search"
              placeholder="Title, company, place"
              value={filters.q}
              onChange={(event) => onChange({ q: event.target.value })}
              style={{ paddingLeft: 28 }}
            />
          </div>
        </div>

        <div className="job-filter-field">
          <label htmlFor="job-filter-province">Province</label>
          <select id="job-filter-province" data-testid="job-filter-province" value={filters.province} onChange={(event) => onChange({ province: event.target.value })}>
            <option value="all">All provinces</option>
            {provinceOptions.map((province) => <option key={province} value={province}>{province}</option>)}
          </select>
        </div>

        <div className="job-filter-field">
          <label htmlFor="job-filter-source">Source</label>
          <select id="job-filter-source" data-testid="job-filter-source" value={filters.source} onChange={(event) => onChange({ source: event.target.value })}>
            <option value="all">All sources</option>
            {sourceOptions.map((source) => <option key={source} value={source}>{source}</option>)}
          </select>
        </div>

        <div className="job-filter-field">
          <label htmlFor="job-filter-status">Status</label>
          <select id="job-filter-status" data-testid="job-filter-status" value={filters.status} onChange={(event) => onChange({ status: event.target.value })}>
            {STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>

        <div className="job-filter-field">
          <label htmlFor="job-filter-score">Minimum match</label>
          <select id="job-filter-score" data-testid="job-filter-score" value={String(filters.minScore)} onChange={(event) => onChange({ minScore: Number(event.target.value) })}>
            {SCORE_STEPS.map((score) => <option key={score} value={score}>{score === 0 ? 'Any match' : `${score}% and up`}</option>)}
          </select>
        </div>

        <div className="job-filter-field">
          <label htmlFor="job-filter-link">Link</label>
          <select id="job-filter-link" data-testid="job-filter-link" value={filters.link} onChange={(event) => onChange({ link: event.target.value })}>
            {LINK_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>

        <div className="job-filter-field">
          <label htmlFor="job-filter-date">Added</label>
          <select id="job-filter-date" data-testid="job-filter-date" value={filters.addedWithin} onChange={(event) => onChange({ addedWithin: event.target.value })}>
            {DATE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>

        <div className="job-filter-field job-filter-check">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
            <input
              type="checkbox"
              data-testid="job-filter-sa-only"
              checked={filters.saOnly}
              onChange={(event) => onChange({ saOnly: event.target.checked })}
              style={{ width: 16, height: 16 }}
            />
            <span>South Africa only</span>
          </label>
        </div>
      </div>

      <div className="job-filter-chips">
        <Chip testid="job-chip-remote" active={filters.remoteOnly} onClick={() => onChange({ remoteOnly: !filters.remoteOnly })}>Remote</Chip>
        <Chip testid="job-chip-live" active={filters.link === 'live'} onClick={() => onChange({ link: filters.link === 'live' ? 'all' : 'live' })}>Live link</Chip>
        <Chip testid="job-chip-strong" active={filters.minScore >= 80} onClick={() => onChange({ minScore: filters.minScore >= 80 ? 0 : 80 })}>Strong match (80+)</Chip>
        <Chip testid="job-chip-week" active={filters.addedWithin === '7'} onClick={() => onChange({ addedWithin: filters.addedWithin === '7' ? 'any' : '7' })}>Added this week</Chip>
        <button type="button" className="btn-ghost btn-xs" data-testid="job-clear-filters" onClick={() => onChange({ ...DEFAULT_VIEW_FILTERS })}>Clear filters</button>
      </div>

      {hiddenForeign > 0 && (
        <p className="tiny job-filter-hidden" data-testid="job-hidden-foreign">
          {hiddenForeign} {hiddenForeign === 1 ? 'job' : 'jobs'} outside South Africa hidden.
          <button type="button" className="btn-ghost btn-xs" data-testid="job-show-foreign" onClick={() => onChange({ saOnly: false })}>Show them</button>
        </p>
      )}
    </div>
  );
}
