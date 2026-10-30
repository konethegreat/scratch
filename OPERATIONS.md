# Operations: hosting, scaling and bot protection

This note records how the hosted app is deployed, what actually scales, what protects it, and which protections are deliberately not in place. It is written for the person maintaining the deployment, not for the visitor.

Last reviewed: 30 October 2026.

---

## 1. Deployment shape

| Item | Value |
|---|---|
| Host | Cloudflare Pages, direct upload (the project is not GitHub-connected) |
| Build | `npm run build:web` in `sa-job-agent-suite`, output `client/dist` |
| Server code | None. No Pages Functions, no Workers, no database |
| Accounts | None |
| Secrets on the host | None. The Anthropic key belongs to the visitor and never reaches the host |
| Headers | `client/public/_headers` (CSP, HSTS, COOP, CORP, nosniff, no-referrer, Permissions Policy) |
| Routing | `client/public/_redirects` sends unknown paths to `index.html` with status 200 |
| Trust surface | `client/public/.well-known/security.txt` |

Because it is a direct upload, a deployment is whatever was built on the machine that uploaded it. Deploy only from a clean `main` after `npm test`, `npm run test:demo`, `npm run build:web` and `npm run test:web` pass, and keep the upload source in the repository so the deployed bundle can be rebuilt.

## 2. What scales, and what does not need to

- **Traffic.** Static assets are served from Cloudflare's edge cache on every plan. There is no application server to saturate, no connection pool, no queue, and no database. Hosting capacity is Cloudflare's problem, not the application's.
- **Work per request.** The origin does not compute anything per visitor. AI work happens in the visitor's browser against `api.anthropic.com` with the visitor's key, so the cost of a heavy user is paid by that user's Anthropic account.
- **Data volume.** Every visitor's data lives in their own browser. Nothing accumulates on the host, so there is no growing table, index, backup or retention job.
- **Free-plan limits worth knowing.** Cloudflare Pages free plan, checked 2026-10-27: 500 builds per month, 20,000 files per deployment, 25 MiB per file, and unmetered requests for static assets. A deployment here is far below the file and size limits.
- **The real limits.** The free plan caps builds, not traffic. The practical ceilings are the Anthropic account behind each key and the browser's storage quota, both of which surface as clear in-app errors rather than host failures.

If this ever needs a server (accounts, shared storage, server-held keys), the shape changes: a Worker or a small service, a database, rate limits, abuse handling and a cost model. None of that exists today, and none of it should be added without a business reason.

## 3. Bot protection, honestly

What exists:

- **No targets.** There is no login form, no comment form, no search endpoint, no upload endpoint and no API on the origin. A bot can only request static files that any visitor requests.
- **No shared secret to drain.** AI calls use the visitor's own key. A bot that hammers AI features pays Anthropic from its own account.
- **Platform DDoS protection.** Cloudflare applies its network-level protection to `*.pages.dev`.
- **WAF-style defences in code.** The strict CSP, the absence of third-party scripts, and the HTML sanitising of feed text remove the common injection paths a bot would probe.

What does not exist, and why:

- **No zone WAF, Bot Fight Mode, Turnstile or rate-limiting rules on the `pages.dev` hostname.** Those controls attach to a Cloudflare zone (a custom domain), not to the platform subdomain. As of this note, enabling them means adding a domain to the account, pointing it at the Pages project, and configuring the rules there.
- **No application rate limiting.** There is no application layer to rate limit. Blocking static requests would only degrade the site for real visitors.
- **No CAPTCHA.** There is nothing to protect with one yet. Add Turnstile only if a future feature accepts writes on the origin.

If the site moves to a custom domain, the checklist is:

1. Add the domain as a zone in Cloudflare and attach it to the Pages project.
2. Review the zone's SSL/TLS mode and enable Always Use HTTPS.
3. Enable Bot Fight Mode (free) and observe false positives for a week.
4. Add rate-limiting rules only for paths that actually accept writes, if such paths ever exist.
5. Keep the CSP in `_headers` as the primary control; do not loosen it to accommodate a new script.

## 4. Monitoring

- No analytics, no telemetry, no third-party monitoring script. This is a privacy choice, and it means there is no traffic dashboard beyond Cloudflare's own.
- Errors are visible to the visitor in the Error Card and can be sent by the visitor with the diagnostics email.
- Deployment health is checked after each upload: load the site, run a demo walk, check the console is clean and no request leaves the origin. `scripts/web-demo-live.mjs` does exactly that against a URL.

## 5. Rollback and recovery

- Cloudflare Pages keeps deployment history. Roll back by promoting the previous deployment in the dashboard; keep the matching commit so the source is never ambiguous.
- There is no server-side data to restore. A lost browser loses local data unless the user kept a backup.
- If the build itself is broken, fix forward on a branch, run the gates, and redeploy rather than editing the uploaded files.

## 6. Cost

- Cloudflare free plan: no charge for static hosting or bandwidth at this scale.
- Anthropic: billed to each visitor's own key, under their own spend limit. The app shows an estimate and enforces a daily cap locally, but the cap is a courtesy, not a billing control. Anthropic's workspace limits are the real control.
- Domain, if one is added: the only recurring cost.
