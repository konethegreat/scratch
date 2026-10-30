import React from 'react';
import { Mail, Phone, MapPin, Send } from 'lucide-react';
import SocialLinks from './SocialLinks.jsx';
import Legal from './Legal.jsx';
import { SUPPORT, FAQ, supportMailto } from './support.js';

export default function Help({ lastError = null }) {
  return (
    <div className="panel fade-in" style={{ padding: 24 }}>
      <h3 style={{ fontSize: 18, marginBottom: 8 }}>Help and support</h3>
      <p className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
        Every feature runs with your own Anthropic key. If something does not work, send the diagnostics below and Kone will look at it.
      </p>

      <div className="grid-2">
        <div className="panel" style={{ padding: 18, background: 'var(--bg-surface-2)' }}>
          <h4 style={{ fontSize: 15, marginBottom: 12 }}>Contact</h4>
          <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <Mail size={14} aria-hidden="true" />
            <a href={`mailto:${SUPPORT.email}`}>{SUPPORT.email}</a>
          </p>
          <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 8 }}>
            <Phone size={14} aria-hidden="true" />
            <a href={SUPPORT.phoneHref}>{SUPPORT.phone}</a>
          </p>
          <p style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 8 }}>
            <MapPin size={14} aria-hidden="true" />
            {SUPPORT.location}
          </p>
          <div style={{ marginTop: 12 }}><SocialLinks /></div>
        </div>

        <div className="panel" style={{ padding: 18, background: 'var(--bg-surface-2)' }}>
          <h4 style={{ fontSize: 15, marginBottom: 12 }}>Report a problem</h4>
          <p className="hint" style={{ marginBottom: 12 }}>
            The report includes the error code, a request ID, the page, and your browser. It never includes your key, profile, jobs, or documents.
          </p>
          <a className="btn-primary btn-sm" href={supportMailto(lastError)} data-testid="support-report">
            <Send size={12} /> Email a report
          </a>
        </div>
      </div>

      <h4 style={{ fontSize: 15, marginTop: 24, marginBottom: 8 }}>Common questions</h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {FAQ.map((item) => (
          <details key={item.q} className="panel" style={{ padding: 12, background: 'var(--bg-surface-2)' }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{item.q}</summary>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 8, lineHeight: 1.6 }}>{item.a}</p>
          </details>
        ))}
      </div>

      <h4 style={{ fontSize: 15, marginTop: 24, marginBottom: 8 }}>Terms, privacy and disclaimer</h4>
      <p className="hint" style={{ marginBottom: 10 }}>
        SA-JAS is in open beta. These notices explain what you agree to, what stays in this browser, and what the AI output can and cannot be trusted to do.
      </p>
      <Legal compact />
    </div>
  );
}
