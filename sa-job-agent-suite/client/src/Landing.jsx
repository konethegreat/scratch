import { useEffect, useRef } from 'react';
import { ArrowRight, ArrowUpRight, MapPin } from 'lucide-react';
import SocialLinks, { SAFlag } from './SocialLinks.jsx';
import ThemeToggle from './ThemeToggle.jsx';
import Legal from './Legal.jsx';
import { LEGAL_UPDATED } from './legal.js';
import { SUPPORT, FAQ } from './support.js';

const WORK = [
  {
    name: 'SA-JAS',
    kicker: 'South African job agent suite',
    status: 'You are here',
    period: 'May to Jun 2026',
    summary: 'Three AI agents find South African vacancies, tailor an ATS-ready CV and cover letter, and walk a visible browser copilot through each application. The final Submit always stays with you.',
    stack: 'Electron, React, Express, Playwright, Claude',
    links: [{ label: 'Source', href: 'https://github.com/konethegreat/scratch' }],
    app: true
  },
  {
    name: 'ClearCut',
    kicker: 'Agent-native invoicing',
    status: 'Alpha, Apache-2.0',
    period: 'Oct 2026',
    summary: 'An agent-native invoicing core for South Africa, exposed as a REST API, an MCP server and a Claude plugin. Policy and people approve the work while the VAT rules stay tested code.',
    stack: 'Rust, PostgreSQL, MCP, TypeScript',
    links: [{ label: 'Source', href: 'https://github.com/konethegreat/clearcut' }]
  },
  {
    name: 'Vigil',
    kicker: 'Sovereign operational intelligence',
    status: 'In development',
    period: 'Sep 2026',
    summary: 'A sovereign operational-intelligence platform that models evidence, investigations and missions as a governed ontology. It is designed so no prompt leaves South Africa.',
    stack: 'Java, Python, Next.js, PostgreSQL, Ollama',
    links: [{ label: 'Source', href: 'https://github.com/konethegreat/Vigil' }]
  },
  {
    name: 'TimeLex',
    kicker: 'Autonomous practice management',
    status: 'Pre-alpha, Apache-2.0',
    period: 'Oct 2026',
    summary: 'An open, API-first practice management system that captures work signals and attributes them to the right matter with cited evidence. Small services sit behind REST, MCP and a Claude plugin.',
    stack: 'Rust, Python, TypeScript, PostgreSQL, MCP',
    links: [{ label: 'Source', href: 'https://github.com/konethegreat/timelex' }]
  },
  {
    name: 'Diary',
    kicker: 'Private AI life log',
    status: 'Public source, noncommercial',
    period: 'Jun 2026',
    summary: 'A private PWA that turns daily entries into an AI-coached life log. Ask it questions over local embeddings, with a runtime toggle between the Claude API and Ollama.',
    stack: 'Python, FastAPI, SQLite, Ollama',
    links: [{ label: 'Source', href: 'https://github.com/konethegreat/Diary' }]
  },
  {
    name: 'MuniSolve ZA',
    kicker: 'Municipal fault reporting',
    status: 'Live',
    period: 'Feb to Jun 2026',
    summary: 'Citizens report municipal faults and administrators triage them on a live heat map. A Claude-powered assistant answers citizen questions within a rate limit.',
    stack: 'React, Node.js, PostgreSQL, Prisma',
    links: [
      { label: 'Live', href: 'https://munisolve-za.vercel.app' },
      { label: 'Source', href: 'https://github.com/konethegreat/munisolve-za' }
    ]
  }
];

const PRINCIPLES = [
  {
    title: 'Evidence before confidence',
    body: 'Every agent claim should point at the source behind it. If the system cannot show its work, it says so.'
  },
  {
    title: 'Local first where it matters',
    body: 'Your key, your data and your machine are the boundary. Nothing leaves them without a reason you can see.'
  },
  {
    title: 'People make the final call',
    body: 'Agents can search, draft, check and prepare. A person decides what is sent and what is submitted.'
  }
];

export default function Landing({ onEnter, onTryDemo }) {
  const railRef = useRef(null);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return undefined;
    const update = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      rail.style.transform = `scaleX(${max > 0 ? Math.min(1, doc.scrollTop / max) : 0})`;
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  return (
    <div className="landing">
      <div className="scroll-rail" aria-hidden="true"><span ref={railRef} /></div>
      <a className="skip-link" href="#main-content">Skip to main content</a>

      <header className="landing-header">
        <button type="button" className="brand-chip" onClick={() => window.scrollTo(0, 0)} title="Back to top">
          <SAFlag size={26} />
          <span className="brand-name">SA-JAS</span>
        </button>
        <nav className="landing-nav" aria-label="Sections">
          <a href="#work">Work</a>
          <a href="#approach">Approach</a>
          <a href="#support">Support</a>
          <a href="https://konethegreat.github.io" target="_blank" rel="noopener noreferrer">Portfolio</a>
          <a href="https://k-one-it-solutions-website.erictshivhinda.workers.dev" target="_blank" rel="noopener noreferrer">Client site</a>
        </nav>
        <div className="landing-actions">
          <ThemeToggle />
          {onTryDemo && (
            <button type="button" className="btn-ghost btn-sm" data-testid="try-demo-landing" onClick={onTryDemo}>
              Try the live demo
            </button>
          )}
          <button type="button" className="btn-secondary" onClick={onEnter}>Open the app</button>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="landing-main">
        <section className="landing-hero reveal" aria-labelledby="hero-title">
          <span className="eyebrow">AI systems engineer, Johannesburg</span>
          <h1 id="hero-title">Kone Tshivhinda</h1>
          <p className="hero-lede">
            I build AI systems that do real work: job agents, invoicing cores, legal practice tools and civic platforms.
            Most of it is shaped by South African constraints, with evidence checks and human approval built in.
          </p>
          <p className="hero-lede">
            I work solo across the stack, from Rust and Python services to React interfaces, and I publish the source
            and the tradeoffs.
          </p>
          <div className="hero-actions">
            <button type="button" className="btn-primary btn-lg" onClick={onEnter}>
              Enter the Suite <ArrowRight size={16} aria-hidden="true" />
            </button>
            {onTryDemo && (
              <button type="button" className="btn-secondary btn-lg" onClick={onTryDemo}>
                Try the live demo
              </button>
            )}
            <a className="btn-secondary btn-lg" href="#work">See selected work</a>
          </div>
          <div className="hero-meta">
            <span className="inline-meta"><MapPin size={14} aria-hidden="true" /> Johannesburg, South Africa</span>
            <SocialLinks size="sm" />
          </div>
        </section>

        <section className="landing-section reveal" id="work" aria-labelledby="work-title">
          <div className="landing-section-head">
            <h2 id="work-title">Selected work</h2>
            <p className="landing-section-sub">Six projects, public where possible.</p>
          </div>
          <div className="work-grid">
            {WORK.map((project) => (
              <article key={project.name} className="panel work-card">
                <div className="work-card-top">
                  <span className="work-meta">{project.period}</span>
                  <span className="badge badge-accent">{project.status}</span>
                </div>
                <div>
                  <h3>{project.name}</h3>
                  <p className="work-kicker">{project.kicker}</p>
                </div>
                <p>{project.summary}</p>
                <p className="work-stack">{project.stack}</p>
                <div className="work-links">
                  {project.app && (
                    <button type="button" className="work-link" onClick={onEnter}>
                      Open the app <ArrowRight size={12} aria-hidden="true" />
                    </button>
                  )}
                  {project.links.map((link) => (
                    <a key={link.href} className="work-link" href={link.href} target="_blank" rel="noopener noreferrer">
                      {link.label} <ArrowUpRight size={12} aria-hidden="true" />
                    </a>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section reveal" id="approach" aria-labelledby="approach-title">
          <div className="landing-section-head">
            <h2 id="approach-title">Approach</h2>
            <p className="landing-section-sub">How I build.</p>
          </div>
          <div className="principles">
            {PRINCIPLES.map((principle) => (
              <div key={principle.title} className="panel principle">
                <h3>{principle.title}</h3>
                <p>{principle.body}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="landing-section reveal" id="support" aria-labelledby="support-title">
          <div className="landing-section-head">
            <h2 id="support-title">Support</h2>
            <p className="landing-section-sub">Reach the person who built it.</p>
          </div>
          <div className="grid-2">
            <div className="panel support-card">
              <h3>Contact</h3>
              <p><a href={`mailto:${SUPPORT.email}`}>{SUPPORT.email}</a></p>
              <p><a href={SUPPORT.phoneHref}>{SUPPORT.phone}</a></p>
              <p>{SUPPORT.location}</p>
              <div style={{ marginTop: 12 }}><SocialLinks /></div>
            </div>
            <div className="panel support-card">
              <h3>Common questions</h3>
              {FAQ.slice(0, 3).map((item) => (
                <details key={item.q}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-section reveal" id="legal" aria-labelledby="legal-title">
          <div className="landing-section-head">
            <h2 id="legal-title">Terms, privacy and ownership</h2>
            <p className="landing-section-sub">Updated {LEGAL_UPDATED}.</p>
          </div>
          <Legal />
        </section>
      </main>

      <footer className="landing-footer">
        <span>Designed and built by Kone Tshivhinda. Johannesburg, South Africa. © {new Date().getFullYear()}.</span>
        <nav className="landing-footer-links" aria-label="Legal notices">
          <a href="#terms">Terms</a>
          <a href="#privacy">Privacy and POPIA</a>
          <a href="#ai">AI disclaimer</a>
          <a href="#ownership">Ownership</a>
        </nav>
        <SocialLinks size="sm" />
      </footer>
    </div>
  );
}
