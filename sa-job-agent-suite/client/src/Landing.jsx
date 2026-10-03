import { ArrowRight, Sparkles, MapPin, ExternalLink, Rocket } from 'lucide-react';
import SocialLinks, { SAFlag } from './SocialLinks.jsx';

/**
 * Immersive personal landing / about page — the app's entry screen.
 * Content is drawn from Kone's CV so it's authentic, not placeholder.
 */

const SKILLS = [
  'React.js', 'Node.js', 'Express', 'Python', 'Java', 'C#',
  'TypeScript', 'PostgreSQL', 'MongoDB', 'AWS', 'Azure', 'Docker',
  'REST & GraphQL', 'Git', 'Tailwind CSS',
];

const STATS = [
  { num: 'Full-Stack', lbl: 'Engineer' },
  { num: 'IBM', lbl: 'Certified Dev' },
  { num: '4+', lbl: 'Shipped Projects' },
  { num: 'SA', lbl: 'South Africa' },
];

const PROJECTS = [
  { name: 'SA Job Agent Suite', desc: 'AI agents that find jobs, tailor CVs & cover letters, and auto-apply — the app you’re in.', tag: 'AI · Automation', href: null },
  { name: 'MuniSolve ZA', desc: 'Municipal reporting web app that streamlines community issue management.', tag: 'Web App', href: 'https://munisolve-za.vercel.app/' },
  { name: 'Timelex', desc: 'Automated legal time-capture and tracking system.', tag: 'SaaS', href: 'https://timelex-automated-time-tracking.netlify.app/' },
  { name: 'Server Health Automation', desc: 'Scripts that automate repetitive ops and run system health diagnostics.', tag: 'DevOps', href: 'https://github.com/konethegreat' },
];

export default function Landing({ onEnter }) {
  return (
    <div className="landing">
      {/* Top nav */}
      <div className="landing-nav reveal">
        <button className="brand-chip" onClick={onEnter} title="Enter the suite">
          <SAFlag size={26} />
          <span className="brand-name gradient-text">SA-JAS</span>
        </button>
        <SocialLinks size="sm" />
      </div>

      {/* Hero */}
      <div className="landing-hero">
        <div className="hero-content">
          <div className="hero-eyebrow reveal d1">
            <Sparkles size={13} /> Built &amp; designed by Kone Tshivhinda
          </div>
          <h1 className="hero-title reveal d1">
            Hi, I’m Kone.<br />
            I build <span className="gradient-text">intelligent</span> software.
          </h1>
          <p className="hero-sub reveal d2">
            Software Engineer &amp; full-stack developer from South Africa, focused on AI-driven
            automation, scalable web apps, and clean, dependable systems.
          </p>
          <p className="hero-summary reveal d2">
            This suite is one of my builds: three cooperating AI agents that hunt real SA vacancies,
            rewrite your CV and cover letter for each role, and walk you through applying — with an
            evolving memory of you that gets sharper every application.
          </p>

          <div className="hero-cta-row reveal d3">
            <button className="btn-primary btn-lg" onClick={onEnter}>
              <Rocket size={17} /> Enter the Suite <ArrowRight size={16} />
            </button>
            <span className="chip"><MapPin size={13} /> Based in South Africa</span>
          </div>

          <div className="reveal d3" style={{ marginBottom: 26 }}>
            <SocialLinks size="lg" />
          </div>

          <div className="stat-row reveal d4">
            {STATS.map((s) => (
              <div key={s.lbl}>
                <div className="stat-num gradient-text">{s.num}</div>
                <div className="stat-lbl">{s.lbl}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Skills */}
      <section className="landing-section reveal d5">
        <h3>The <span className="gradient-text">toolkit</span></h3>
        <p className="muted" style={{ fontSize: 13, marginBottom: 4 }}>Languages, frameworks and platforms I build with.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 18 }}>
          {SKILLS.map((s) => <span key={s} className="chip">{s}</span>)}
        </div>
      </section>

      {/* Projects */}
      <section className="landing-section reveal d6">
        <h3>Selected <span className="gradient-text">work</span></h3>
        <p className="muted" style={{ fontSize: 13 }}>A few things I’ve shipped.</p>
        <div className="proj-grid">
          {PROJECTS.map((p) => (
            <div key={p.name} className="proj-card">
              <div className="badge badge-accent" style={{ marginBottom: 10 }}>{p.tag}</div>
              <h4>{p.name}</h4>
              <p className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>{p.desc}</p>
              {p.href && (
                <a href={p.href} target="_blank" rel="noopener noreferrer"
                   className="social-pill" style={{ marginTop: 14 }}>
                  <ExternalLink size={14} /> View
                </a>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="app-footer" style={{ marginTop: 28 }}>
        <div className="foot-credit">
          Designed &amp; built by <b>Kone Tshivhinda</b> · Software Engineer · © {new Date().getFullYear()}
        </div>
        <SocialLinks size="sm" />
      </footer>
    </div>
  );
}
