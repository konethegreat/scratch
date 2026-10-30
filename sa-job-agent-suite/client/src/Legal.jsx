import { LEGAL_SECTIONS, LEGAL_UPDATED } from './legal.js';

function Clauses({ section }) {
  return (
    <div className="legal-clauses">
      {section.clauses.map((clause) => (
        <div key={clause.heading} className="legal-clause">
          <h4>{clause.heading}</h4>
          <p>{clause.body}</p>
        </div>
      ))}
    </div>
  );
}

// `compact` renders each notice as a collapsed <details> for tight spaces such
// as Help; the landing page uses the full layout.
export default function Legal({ headingLevel = 3, compact = false }) {
  const Heading = `h${headingLevel}`;

  if (compact) {
    return (
      <div className="legal-compact">
        {LEGAL_SECTIONS.map((section) => (
          <details key={section.id} id={section.id} className="legal-details" data-testid={`legal-${section.id}`}>
            <summary>
              <span>{section.title}</span>
              <span className="legal-summary">{section.summary}</span>
            </summary>
            <Clauses section={section} />
          </details>
        ))}
        <p className="tiny legal-updated">Last updated {LEGAL_UPDATED}.</p>
      </div>
    );
  }

  return (
    <div className="legal-full">
      {LEGAL_SECTIONS.map((section) => (
        <article key={section.id} id={section.id} className="panel legal-section" data-testid={`legal-${section.id}`}>
          <Heading>{section.title}</Heading>
          <p className="legal-summary">{section.summary}</p>
          <Clauses section={section} />
        </article>
      ))}
      <p className="tiny legal-updated">Last updated {LEGAL_UPDATED}. The code is MIT licensed; the name and branding are reserved.</p>
    </div>
  );
}
