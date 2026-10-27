# UI/UX refresh design

**Status:** proposed for review
**Owner:** Kone
**Created:** 2026-10-27
**Implements:** Arc 3 of [`2026-10-27-post-m3a3-pipeline.md`](2026-10-27-post-m3a3-pipeline.md)
**Related:** [`2026-10-27-live-scale-isolation-design.md`](2026-10-27-live-scale-isolation-design.md)

## Purpose

Arc 1 and Arc 2 made the hosted app correct and safe. Arc 3 makes it look and read like deliberate work by a specific builder, and gives it a home page that presents Kone's public portfolio.

The current interface is dark only, built from a violet and cyan aurora palette, gradient text, blurred glass panels and emoji icons. It also has 99 em dashes in client source, and its home page is a generic "Hi, I'm Kone" hero rather than a portfolio. The refresh replaces those defaults with a restrained, light-first design system, a real three-state theme, plain copy, and a portfolio-led landing page.

This is a visual and copy change. It does not add product features, data sources, or key behaviour.

## Evidence from the current tree

Counts below were taken on 2026-10-27 at `8b1a76b`, before any Arc 3 edit.

| Observation | Evidence |
|---|---|
| No theme system exists | No `prefers-color-scheme`, no `data-theme`, no app `localStorage` use, no `matchMedia`; `client/src/index.css` defines one dark token set |
| Dark values are hard-coded beyond tokens | 35 colour literals in JSX, including sidebar `#0F172A`, KPI tiles `#F0F9FF`, `#FFFBEB`, `#ECFDF5`, and danger `#DC2626` |
| Glass and gradients are systemic | 38 `glass-panel` uses across six files, 8 `gradient-text` uses, an animated aurora backdrop, animated gradient buttons |
| Emoji are used as icons | Preset cards use `🪙`, `⚖️`, `🚀`; the hunter status uses `●` and `○`; a warning badge uses `⚠` |
| Copy carries em dashes | 99 U+2014 in `client/src` and `client/index.html`, including null placeholders and explanatory clauses |
| The landing page is not a portfolio | Four projects, two of them with no link, plus skill chips and a "Hi, I'm Kone" hero |
| Accessibility gaps | No skip link, no `:focus-visible`, no dialog semantics or focus trap, toasts have no live role, an icon-only close button has no name, landing heading order skips a level |
| Hosted constraints | CSP `script-src 'self'`, `font-src 'self'`, `img-src 'self' data: blob:`; the canary rejects inline script and Google Fonts; Vite uses `base: './'` for Electron |

## Goals

1. A light theme that is the default design, and a dark theme of equal quality.
2. One persisted choice with three states: system, light, dark. The first visit follows the OS. A stored choice never flashes the wrong theme.
3. A single accent colour and a calm surface system. No aurora, no gradient text, no glass blur, no emoji icons.
4. Copy with zero em dashes, no filler, and no obvious explanation.
5. A home page that presents six approved projects, a short builder statement, and links to Kone's public work.
6. WCAG AA contrast and keyboard access in both themes, at 360, 768 and 1280 pixels wide.
7. Existing web behaviour, test ids, accessible names and security properties unchanged.

## Non-goals

- New product features, tabs, data sources, or AI behaviour.
- Any change to key handling, storage, backup format, CSP, or response headers.
- A component library migration, a router, or a CSS framework.
- Removing every inline style. Arc 3 removes colour literals and gradient classes, not layout refactors.
- Publishing a CV file. See "Content decisions".
- A repo-wide rewrite of historical docs. The zero em dash rule applies to client copy, new Arc 3 documents, and new user-facing strings.

## Design direction

The reference is the K-ONE studio site: high contrast, generous whitespace, clear type, restrained borders, one accent, and no decoration that does not carry information. The product remains a professional tool, not a marketing page with a dashboard attached.

### Typography

Use the operating system stack. Hosted CSP `font-src 'self'` blocks Google Fonts, and the canary rejects any Google Fonts reference, so a web font would need to be bundled. System type avoids a new asset, a licence review, and a render-blocking request, and it matches the native feel of a desktop app.

| Role | Stack | Size and weight |
|---|---|---|
| Display | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | `clamp(40px, 6vw, 72px)`, 700, `-0.035em` |
| Heading | same | `clamp(24px, 3vw, 34px)`, 650, `-0.02em` |
| Section title | same | 20px, 650 |
| Body | same | 15px, 400, `1.6` |
| Small | same | 13px, 400 |
| Label | same | 12px, 600, `0.02em` |
| Mono | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | 12.5px |

The desktop Google Fonts injection in `client/src/main.jsx` is removed. One typography system runs in web, desktop and demo mode.

### Colour tokens

Light is the default token set. Dark is selected by `[data-theme='dark']`. The accent is indigo. Status colours are semantic only and never used for decoration.

| Token | Light | Dark |
|---|---|---|
| `--bg-app` | `#f6f6f3` | `#0b0d12` |
| `--bg-app-2` | `#ffffff` | `#11141b` |
| `--bg-surface` | `#ffffff` | `#141821` |
| `--bg-surface-2` | `#f0f0ec` | `#1a1f2a` |
| `--bg-input` | `#ffffff` | `#10131a` |
| `--bg-sidebar` | `#ffffff` | `#0e1117` |
| `--bg-topbar` | `#ffffff` | `#0e1117` |
| `--bg-code` | `#f0f0ec` | `#0f131b` |
| `--color-accent` | `#4f46e5` | `#a5b4fc` |
| `--color-accent-hover` | `#4338ca` | `#c7d2fe` |
| `--color-accent-soft` | `#eef0ff` | `#1d2340` |
| `--color-on-accent` | `#ffffff` | `#0b0d12` |
| `--color-success` | `#047857` | `#34d399` |
| `--color-info` | `#0369a1` | `#38bdf8` |
| `--color-warning` | `#b45309` | `#fbbf24` |
| `--color-error` | `#b91c1c` | `#fb7185` |
| `--text-primary` | `#16181d` | `#f3f4f6` |
| `--text-secondary` | `#3f4552` | `#c3c8d2` |
| `--text-muted` | `#5f6673` | `#929aab` |
| `--border` | `#e4e4de` | `#232936` |
| `--border-strong` | `#c9c9c2` | `#333b4c` |
| `--overlay` | `rgba(16, 18, 24, 0.35)` | `rgba(0, 0, 0, 0.60)` |

Contrast ratios, computed with the WCAG relative luminance formula:

| Pair | Ratio |
|---|---|
| Light primary on app | 16.40 |
| Light secondary on app | 8.88 |
| Light muted on app | 5.34 |
| Light accent on white | 6.29 |
| Light success on white | 5.48 |
| Light info on white | 5.93 |
| Light warning on white | 5.02 |
| Light error on white | 6.47 |
| Dark primary on app | 17.66 |
| Dark secondary on app | 11.58 |
| Dark muted on app | 6.88 |
| Dark accent on surface | 8.91 |
| Dark ink on accent | 9.75 |
| Dark success on surface | 9.24 |
| Dark info on surface | 8.29 |
| Dark warning on surface | 10.64 |
| Dark error on surface | 6.60 |

Every pair is at least 4.5:1. The design gate asserts these exact pairs so a future palette edit cannot silently fail AA.

### Surfaces and components

- Panels are solid `--bg-surface` with one `--border` and `--shadow-card`. No `backdrop-filter`, no translucent white fill, no glow.
- Buttons use the accent fill and `--color-on-accent`. Hover changes colour, not position. Disabled state keeps the existing opacity.
- Inputs use `--bg-input`, a strong border, and a visible focus ring. The current `outline: none` is removed.
- Cards lift by 2 pixels on hover only when they are interactive. Static panels do not react.
- Badges use a neutral surface with semantic text colour. No pastel gradients.
- The terminal keeps a code surface and maps agent colours to status tokens.
- The sidebar and topbar use their own surface tokens so the light theme has clear hierarchy.
- The KPI tiles drop the pastel backgrounds and use a neutral icon tile with semantic icon colour.
- Preset cards use Lucide `Coins`, `Scale` and `Rocket` icons instead of emoji.
- The hunter status dot becomes a small CSS dot plus the words "Hunter active" or "Hunter idle".
- The South African flag SVG remains as the brand mark. Its white keyline gets a token so it reads in both themes.

### Motion

Motion is limited to four jobs:

1. Page entry: one fade and 8 pixel rise per section, 60 millisecond stagger, 400 milliseconds, `cubic-bezier(0.2, 0.7, 0.2, 1)`.
2. State change: border and background colour on hover, focus and selection, 150 milliseconds.
3. The landing scroll rail: a 2 pixel accent line at the top, driven by one passive scroll listener.
4. Loading: the existing spinner and pulse indicators.

The aurora drift, gradient shift, floaty, shimmer and hover lift on buttons are removed. Under `prefers-reduced-motion: reduce`, animation and transition durations collapse to `0.01ms`, reveal elements start visible, and the scroll rail stops transitioning.

## Theme system

### States and persistence

- Choices: `system`, `light`, `dark`.
- Storage key: `sajas-theme` in `localStorage`.
- First visit: no key means `system`, which follows `prefers-color-scheme`.
- A stored choice wins over the OS.
- If `localStorage` is unavailable, the toggle still applies for the session, but the choice is not remembered. No toast is shown, because the fallback is correct and a warning would be noise.
- A `storage` event applies a change made in another tab.
- A `matchMedia` change applies immediately while the choice is `system`.

### No flash

CSP forbids inline script, so `client/public/theme-boot.js` is a tiny synchronous external script in `<head>`, before the stylesheet and module entry. It:

1. Reads and validates `sajas-theme`.
2. Resolves `system` with `matchMedia('(prefers-color-scheme: dark)')`.
3. Sets `data-theme`, `data-theme-choice`, `style.colorScheme` and the `theme-color` meta before first paint.

The script is copied verbatim by Vite from `client/public` and referenced as `./theme-boot.js`, which also works under Electron's relative base. It stays under 1 KB.

`client/src/theme.js` owns the same rules after boot. It exposes pure `normalizeChoice` and `resolveTheme`, plus `getChoice`, `setChoice`, `applyChoice`, `subscribe` and `useThemeChoice` (via `useSyncExternalStore`). The boot script and the module share one storage key and one choice list; the design gate asserts that the strings match.

### Control

`ThemeToggle` is a three-button group with `role="group"`, `aria-label="Theme"`, `aria-pressed` on each option, and Lucide `Monitor`, `Sun` and `Moon` icons. Each button has an explicit `aria-label`, so the control keeps a name when the visible label is hidden below 560 pixels.

It renders in three places, never twice on one screen:

- The landing header.
- The app topbar.
- The web onboarding gate, in a fixed top-right dock.

It is fully keyboard operable and uses the global focus ring.

## Screens

### Landing page

The landing page becomes a portfolio page with five parts:

1. **Header**: SA-JAS brand button, links to Work and Approach, a Portfolio link, the theme toggle, and a secondary "Open the app" button.
2. **Hero**: eyebrow "AI systems engineer, Johannesburg", name as the only `h1`, a two-paragraph builder statement, a primary "Enter the Suite" button, a secondary "See selected work" anchor, social links, and a location line.
3. **Selected work**: six project cards, each with status, year, name, kicker, two-sentence description, stack line, and links.
4. **Approach**: three principles with one sentence each.
5. **Footer**: credit, location, copyright and social links.

Semantics: `header`, `main#main-content`, three `section` elements (hero, work, approach) with `aria-labelledby`, `footer`, one `h1`, `h2` per section, `h3` per card. The skip link is the first focusable element. The hero and sections use the reduced-motion-aware reveal.

No image is loaded. No remote asset is requested. The page makes no call to our origin beyond its own static files.

### App shell

- Skip link, `main#main-content` with `tabIndex={-1}`.
- Sidebar: token surfaces, `nav aria-label="Primary"`, `aria-current="page"` on the active link.
- Topbar: brand, theme toggle, social links. Solid surface, no blur.
- Header: shorter subtitles with no em dashes.
- Footer: same credit in both landing and shell.

### Feedback and dialogs

- Each toast gets `role="alert"` for errors and `role="status"` for success and info, with `aria-atomic="true"`. The close button gets `aria-label="Dismiss notification"`.
- Both modals use one `Dialog` wrapper with `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, initial focus inside, Escape to close, Tab containment, and focus restoration.

## Copy rules

1. No U+2014 anywhere in client source, `client/index.html`, new Arc 3 documents, PR text, or chat.
2. Use a period for a new sentence, a comma for a parenthetical, and a colon before an explanation.
3. Null placeholders read "Not set" or "None", never a dash.
4. No emoji icons. Use Lucide.
5. No filler adjectives, no "seamlessly", no "powerful", no "unleash".
6. Do not explain the obvious. A label and a short hint are enough.
7. Keep error copy specific and actionable, as established by the error contract.
8. Project claims match public status. Alpha is alpha, public source is public source, and in development is in development.

Representative rewrites:

| Before | After |
|---|---|
| `Your evolving dossier [em dash] learned insights, employer notes and what wins.` | `Learned insights, employer notes and what wins. Read by all three agents.` |
| `AI web search (Claude) first, then the 12-source scraper registry [em dash] major boards first` | `Claude web search first, then 12 South African job boards, with link checks.` |
| A null placeholder of `[em dash]` | `Not set` |

## Content decisions

The selected work list follows the approved pipeline list exactly: SA-JAS, Vigil, MuniSolve ZA, ClearCut, TimeLex and Diary. Server Health Monitor and the earlier prototypes stay on the public portfolio rather than crowding the landing page. All Mostoeneng Bill work is excluded.

| Project | Kicker | Status | Links |
|---|---|---|---|
| SA-JAS | South African job agent suite | You are here | Source `https://github.com/konethegreat/scratch`, Open the app |
| ClearCut | Agent-native invoicing | Alpha, Apache-2.0 | Source `https://github.com/konethegreat/clearcut` |
| Vigil | Sovereign operational intelligence | In development | Source `https://github.com/konethegreat/Vigil` |
| TimeLex | Autonomous practice management | Pre-alpha, Apache-2.0 | Source `https://github.com/konethegreat/timelex` |
| Diary | Private AI life log | Public source, noncommercial | Source `https://github.com/konethegreat/Diary` |
| MuniSolve ZA | Municipal fault reporting | Live | Live `https://munisolve-za.vercel.app`, Source `https://github.com/konethegreat/munisolve-za` |

Top-level links: portfolio `https://konethegreat.github.io`, client site `https://k-one-it-solutions-website.erictshivhinda.workers.dev`, GitHub `https://github.com/konethegreat`, LinkedIn `https://www.linkedin.com/in/kone-tshivhinda-32a760233`.

**CV link ruling:** no public CV file exists on the portfolio, the GitHub profile, or the client site. Arc 3 does not publish the local PDF, because that would disclose personal details that are not already public. The landing page links to the portfolio as the public professional record. If Kone supplies a public CV URL, it is added as one link without a layout change.

## Accessibility

- Skip link on landing and in the shell, visible on focus.
- One `h1` per screen, no skipped heading levels on the landing page.
- Landmarks: `header`, `nav`, `main`, `footer`.
- `:focus-visible` outline of 2 pixels in `--color-accent` with 2 pixel offset. Inputs keep their focus ring.
- Theme group with a name, pressed state and keyboard operation.
- Dialog semantics, focus trap, Escape, restoration.
- Toast live roles and a named close action.
- Decorative Lucide icons get `aria-hidden="true"`; icon-only controls get an accessible name.
- AA contrast in both themes, asserted by the design gate.
- Reduced motion honoured.
- No page-level horizontal scroll at 360, 768 or 1280 pixels.

## Testing

### Unit

`client/src/theme.test.js` covers:

- `normalizeChoice` rejects unknown, empty and non-string values.
- `resolveTheme` maps the three choices correctly.
- `setChoice` writes `localStorage`, applies `data-theme`, `data-theme-choice` and `colorScheme`.
- A storage failure falls back to system without throwing.
- A `matchMedia` change applies while the choice is system and does not override an explicit choice.
- A `storage` event applies a change from another tab.

### Design gate

`scripts/check-ui.mjs` runs offline and fails the build on:

- Any U+2014 in `client/src/**/*.{js,jsx,css}` or `client/index.html`.
- Any emoji from the pictographic ranges in client source.
- `gradient-text`, `aurora`, `backdrop-filter`, `fonts.googleapis.com` or `fonts.gstatic.com` in client source or `index.html`.
- Any colour literal in JSX except the South African flag palette in `SocialLinks.jsx`.
- A missing or duplicated token in either theme.
- Any contrast pair below 4.5:1.
- A boot script or theme module with a different storage key or choice list.
- An `index.html` whose scripts are not exactly the boot script and the module entry, with `./theme-boot.js` first, no inline script, and no third-party source.

The gate is wired into `npm run test:web` so CI enforces it.

### Browser

`scripts/web-ui.mjs` runs the web build in Chromium and covers:

1. **Boot:** block the React bundle, seed `sajas-theme=dark`, load the page, and assert `data-theme="dark"` and `--bg-app` `#0b0d12`. This proves the boot script, not React, prevents the flash.
2. **First visit:** emulate a dark OS with no stored choice, assert dark.
3. **Toggle:** choose Light, assert `data-theme`, `colorScheme`, `localStorage`, and that the choice persists after reload while the OS stays dark.
4. **System follow:** choose System, assert dark; emulate a light OS and assert the attribute changes without a reload.
5. **Keyboard:** focus the Dark button with the keyboard, press Enter, assert the theme changes and the focus ring is visible.
6. **Landing:** one `h1`, section `h2`s before card `h3`s, all six approved project names present, no excluded project name, portfolio and studio links present, theme toggle present.
7. **Skip link:** it is the first focusable element and moves focus to `main`.
8. **Dialog:** open "Add manually", assert `role="dialog"`, `aria-modal`, a labelled title, Escape closes it and focus returns to the trigger.
9. **Toast:** add a job, assert the success toast has `role="status"` and the close button is named.
10. **Responsive:** at 360, 768 and 1280, assert no page-level horizontal overflow on landing and dashboard.
11. **Reduced motion:** with reduced motion, assert reveal elements are visible and animation duration is near zero.
12. **Console:** no unexpected console errors or CSP violations.

### Existing tests

The three current web E2Es must pass without selector changes. The contract to preserve:

- One button matching `/Enter the Suite/i` on the landing page.
- Headings `Dashboard` and `Profile & Settings`.
- Sidebar buttons `Job Feeds`, `Job Hunter`, `Document Tailor`, `Candidate Memory`, `Profile & Settings`.
- `Apply Copilot` and `Activity Logs` absent in web mode.
- Test ids `onboarding`, `key-skip`, `key-status`, `export-backup`, `feed-source-*`, `add-job-*`, `job-status`, `job-notes`, `save-notes`.
- Tracker table `table.data-table tbody`.
- Toast selector `.toast.toast-error .toast-msg`.

## Acceptance criteria

| Pipeline requirement | Evidence |
|---|---|
| Three-state theme, persisted, OS first, no flash | `theme.test.js`, `web-ui.mjs` boot and toggle phases |
| Theme applied on every screen | Tokens and shared components; `web-ui.mjs` covers onboarding, dashboard, landing and settings |
| AA contrast in both themes | `check-ui.mjs` contrast table |
| Zero em dashes in user-facing strings | `check-ui.mjs` source scan |
| Home page names only approved projects | `web-ui.mjs` content assertions |
| Home page links portfolio, client site, GitHub | `web-ui.mjs` link assertions; CV link deferred by the content ruling |
| No key or profile data on the home page | Landing is static; canary remains green |
| 360, 768 and 1280 layouts | `web-ui.mjs` overflow assertions |
| Reduced motion | `web-ui.mjs` reduced motion phase |
| Browser verification, not only unit tests | `web-ui.mjs` plus a manual pass on the deployed URL |
| Existing security and isolation unchanged | `web-canary.mjs`, `web-feeds.mjs`, `web-isolation.mjs` pass unchanged |

## Risks

| Risk | Mitigation |
|---|---|
| Flash of the wrong theme if the boot script is blocked or cached stale | Synchronous same-origin head script, static placement assertion, Playwright test with the bundle blocked |
| Hard-coded colours survive the token pass | Design gate scans every JSX file and allows only the flag palette |
| Text changes break E2E selectors | Preserve the named accessible strings listed above and run all three E2Es |
| System fonts change layout metrics | Responsive assertions at three widths plus a manual browser pass |
| A stored choice makes the OS preference appear broken | System is an explicit third state with its own label and pressed state |
| `localStorage` is unavailable | Fall back to the OS for the session |
| The boot script and module drift | Gate asserts one storage key and one choice list |
| The CV criterion cannot be met safely | Documented ruling; add one link when a public URL exists |

## Out of scope

- New product features or tabs.
- New data sources or feed changes.
- Key lifecycle, crypto, backup format, CSP or headers.
- A router, state library, CSS framework or component library.
- A full inline-style refactor.
- Publishing the local CV PDF.
- Rewriting historical docs for em dashes outside Arc 3.
