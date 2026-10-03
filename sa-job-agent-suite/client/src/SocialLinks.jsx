import { Linkedin, Github, Award } from 'lucide-react';

/**
 * Inline South African flag (Windows can't render the 🇿🇦 emoji — it shows as
 * "ZA" text, which made the logo read "ZASA-JAS"). This renders everywhere.
 */
export function SAFlag({ size = 24 }) {
  const w = size * 1.5, h = size;
  return (
    <svg width={w} height={h} viewBox="0 0 90 60" xmlns="http://www.w3.org/2000/svg"
         role="img" aria-label="Flag of South Africa"
         style={{ borderRadius: 3, flexShrink: 0, display: 'block', boxShadow: '0 0 0 1px rgba(255,255,255,0.15)' }}>
      <rect width="90" height="60" fill="#fff" />
      <rect width="90" height="30" fill="#E03C31" />
      <rect y="30" width="90" height="30" fill="#002395" />
      <polygon points="0,2 34,30 0,58" fill="#FFB915" />
      <polygon points="0,12 21,30 0,48" fill="#000" />
      <path d="M -3,-5 L34,30 L95,30 M -3,65 L34,30" fill="none" stroke="#fff" strokeWidth="15" strokeLinejoin="round" />
      <path d="M -3,-5 L34,30 L95,30 M -3,65 L34,30" fill="none" stroke="#007A4D" strokeWidth="9" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Kone's public profiles — reused in the app header, footer and landing page.
 * Pass size="lg" for the larger landing-page variant.
 */
export const SOCIALS = [
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/kone-tshivhinda-32a760233', Icon: Linkedin },
  { label: 'GitHub',   href: 'https://github.com/konethegreat',                       Icon: Github },
  { label: 'Credly',   href: 'https://www.credly.com/users/kone-tshivhinda',          Icon: Award },
];

export default function SocialLinks({ size = 'sm', iconSize = 15 }) {
  return (
    <div className="social-row">
      {SOCIALS.map(({ label, href, Icon }) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={`social-pill${size === 'lg' ? ' lg' : ''}`}
          title={`Kone Tshivhinda on ${label}`}
        >
          <Icon size={size === 'lg' ? 17 : iconSize} />
          {label}
        </a>
      ))}
    </div>
  );
}
