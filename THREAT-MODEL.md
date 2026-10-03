# SA-JAS — Security Threat Model (Hybrid Web Build)

**Owner:** Kone · **Date:** 7 June 2026
**Architecture under review:** Hybrid — a hosted **web app** (accounts, Hunter, Tailor, candidate memory, dashboard, payments, managed AI key) plus a **local applier companion** that keeps browser automation and login sessions on the user's own machine.

**Method:** for each part of the system, this asks *what could attack it* and lists *the safety features to put in place*. Controls are tagged **P0** (must exist before the first paying user), **P1** (before public launch / scale), **P2** (hardening over time).

> **Why hybrid is the safer base.** Because scraping and the apply browser stay on the user's device, your cloud never fetches arbitrary employer URLs and never holds LinkedIn/Indeed sessions. That removes server-side SSRF, credential custody, and datacenter-IP bot-bans from your risk surface before you write a line of backend code. Protect that boundary — every feature you pull into the cloud "for convenience" should be weighed against re-introducing those risks.

---

## 0. Trust boundaries

```
┌─────────────────────────── USER'S MACHINE ───────────────────────────┐
│  Local applier companion                                              │
│   • Playwright apply browser (visible, human-on-the-loop)            │
│   • Browser-profile cookies (LinkedIn/Indeed) — DPAPI-encrypted      │
│   • Local API on 127.0.0.1 only (no LAN exposure)                   │
│   • Pulls tailored package from the web account over TLS            │
└───────────────────────────────▲──────────────────────────────────────┘
                                 │  authenticated pull (short-lived token)
┌────────────────────────────── YOUR CLOUD ─────────────────────────────┐
│  Web app (TLS/HSTS)                                                    │
│   • Accounts / sessions / payments                                    │
│   • Hunter + Tailor (your MANAGED Anthropic key, server-side only)   │
│   • Candidate memory, CVs, contact data  ← POPIA-regulated store     │
│   • Metering + credit caps                                            │
└───────────────────────────────▲──────────────────────────────────────┘
                                 │  outbound only
                         AI provider (Anthropic) · Payments (Stripe/Paddle)
```

The two boundaries that matter most: **(a)** the cloud data store (it now holds personal data you didn't hold before → POPIA), and **(b)** the web↔local handshake (a new authenticated channel).

---

## 1. Accounts & authentication — *cloud*

**Threats:** credential stuffing with leaked passwords; weak/reused passwords; account takeover → drains your managed-key credits and exfiltrates a CV; session hijacking; signup abuse / fake accounts farming free credits.

**Controls to put in place:**
- **P0** Hash passwords with **Argon2id** (or bcrypt cost ≥ 12). Never store plaintext or reversible.
- **P0** Offer **"Sign in with Google"** — for non-technical SA users it's lower-friction *and* removes password risk for those accounts.
- **P0** Session cookies: `HttpOnly`, `Secure`, `SameSite=Lax`, short idle timeout, server-side revocation on logout/password-change.
- **P0** **Email verification** before any managed-key spend (kills throwaway-account credit farming).
- **P0** **Rate-limit + lockout** on login/signup/reset (e.g. `express-rate-limit` + per-account backoff).
- **P1** Check new passwords against a breached-password set (HaveIBeenPwned k-anonymity API).
- **P1** Optional **TOTP MFA** for users who want it; require it for any admin account.
- **P2** Bot defence on signup (hCaptcha/Turnstile) if abuse appears.

---

## 2. Personal data & POPIA — *cloud* (highest-stakes)

You'll hold CVs, names, emails, phones, and *optionally* EE race/gender/disability and salary. **South Africa's POPIA applies the moment you store this server-side.**

**Threats:** database breach exposing CVs + sensitive demographics; over-collection; indefinite retention; no deletion path (POPIA violation); subprocessor sprawl; insider access.

**Controls to put in place:**
- **P0 Data minimisation.** Do **not** store SA ID/passport numbers server-side — keep the desktop app's "paste per application" rule. Make EE demographics and salary **optional and off by default**.
- **P0 Encryption in transit:** TLS everywhere + **HSTS**. No plaintext endpoints.
- **P0 Encryption at rest:** full-disk/DB encryption, **plus column/field-level encryption** for the sensitive subset (EE attributes, salary) using a key from a secrets manager (envelope encryption), so a raw DB dump doesn't reveal them.
- **P0 Data-subject rights:** self-serve **export** and **delete-my-account-and-data** (POPIA gives users this right; build it in, don't bolt it on).
- **P0 Consent at signup:** plain-language notice that CVs/answers are stored to provide the service, sent to Anthropic for generation, and that auto-apply acts on their behalf. Record consent + timestamp.
- **P1 Retention limits:** auto-purge inactive accounts' data after a stated window; let users set shorter retention.
- **P1 Appoint an Information Officer** (POPIA requires this for a responsible party) and register if/when required.
- **P1 Sign DPAs / review data terms** with every subprocessor: Anthropic, your host, your payment provider.
- **P1 Breach-response runbook:** detection → contain → notify the Information Regulator and affected users (POPIA requires notification of breaches).
- **P2** Least-privilege access to the prod DB; audit-log admin reads of user data.

---

## 3. Secret management — *cloud*

Your **managed Anthropic key** is the crown jewel: if it leaks, anyone can spend your money.

**Threats:** key shipped in the client bundle; key committed to git; key printed in logs/error traces; (if you offer BYO-key on web) users' keys stored in plaintext.

**Controls to put in place:**
- **P0** Managed key lives **server-side only** — never in the frontend, never returned by any endpoint, never in the repo. Inject via environment/secrets manager.
- **P0** **Secret scanning** in CI (gitleaks/trufflehog) + a pre-commit hook so a key can't be pushed.
- **P0** **Never log secrets;** redact keys/tokens in any error reporting (Sentry scrubbing).
- **P1** **Key rotation** procedure + the ability to rotate fast if leaked.
- **P1** Set an **Anthropic-side spend cap / budget alert** as a hard backstop independent of your app logic.
- **P1** If you ever store users' BYO keys: **envelope-encrypt** them, never return them to the client, and prefer *not* storing at all (use per-session).

---

## 4. Cost, metering & abuse — *cloud* (this is your business model's survival)

Your funding idea (subscriptions fund the managed key) **only works metered**. A flat "unlimited" plan loses money on the heaviest user and is a free target for abuse.

**Threats:** runaway spend from a power user; a compromised/shared account draining credits; scripted abuse hitting the AI endpoints in a loop; users pushing everything to the most expensive model; a bug that retries AI calls without bound.

**Controls to put in place:**
- **P0 Credits, never "unlimited."** Sell a capped number of tailors/hunts/runs per cycle; deduct **server-side before** each AI call; refuse at zero.
- **P0 Hard per-account ceilings** (daily + monthly) enforced server-side, above the plan quota, as an anti-abuse cap.
- **P0 Rate-limit the AI endpoints** per account and per IP.
- **P0 Tier-gate the cost knobs server-side** — e.g. your existing T4 `tailorConcurrency` and `useResearchFanout`, and model choice (Haiku/Sonnet/Opus), must be enforced on the server, **never trusted from the client.**
- **P1 Anomaly detection + auto-suspend:** spike in spend/req-rate → throttle and alert.
- **P1 Idempotency** on AI-triggering requests so a retry/double-click can't double-charge or double-spend.
- **P1 Real-time spend dashboard + alert** when daily spend crosses a threshold (catch a leak before the bill does).

---

## 5. Prompt injection & multi-tenant isolation — *cloud*

You already shield Agent 2/3 prompts. Two things change in the cloud: content is still untrusted, **and** one user's data must never leak into another's prompt.

**Threats:** a malicious job description or research brief injecting "ignore instructions" into the tailoring prompt; injection trying to make the model reveal system context or another tenant's data; model output used to drive a privileged action.

**Controls to put in place:**
- **P0** Keep the existing **injection shields + `[BEGIN/END UNTRUSTED …]` markers** (job description **and** the T4 research brief — *now wrapped, see §10*).
- **P0 Strict per-user data isolation:** every prompt is built only from the authenticated user's own data; never batch multiple users into one context; scope every DB query by user ID.
- **P1** Treat model output as **data, not commands** — never let it trigger an action (apply/submit/charge) without an explicit user step.
- **P1** Output validation/length caps; don't echo raw model output into HTML without escaping (see §6).

---

## 6. Standard web-app hardening — *cloud*

**Threats:** XSS via rendering a tailored CV, cover letter, or scraped job description in the dashboard; CSRF; clickjacking; SQL/NoSQL injection; vulnerable dependencies; oversized-payload DoS.

**Controls to put in place:**
- **P0 Output escaping + a strict Content-Security-Policy.** Anything derived from model output or scraped text is untrusted on render — escape it; if you must render markdown→HTML, sanitise (DOMPurify) the result. (The desktop PDF path already HTML-escapes — keep that discipline on the web.)
- **P0 Security headers** via Helmet: CSP, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, Referrer-Policy.
- **P0 Parameterised queries / ORM** — no string-built SQL.
- **P0 CSRF protection** (SameSite cookies + token on state-changing requests).
- **P0 Tight body-size limits** and input validation (zod/joi) on every endpoint.
- **P1 Dependency scanning:** `npm audit` in CI + Dignabot/Renovate; pin and update.
- **P1 Global rate limiting** + a WAF/CDN (Cloudflare) in front.

---

## 7. Web ↔ local applier bridge — *new surface*

The local companion must receive the tailored package and job from the user's web account.

**Threats:** a rogue local client pairing to someone else's account; a pairing token replayed/stolen; the local API exposed beyond loopback; the web app being tricked into *pushing* to a machine.

**Controls to put in place:**
- **P0 Local API binds to `127.0.0.1` only** — *already done in the current code (was binding to all interfaces).*
- **P0 Pull, don't push:** the local app **pulls** from the cloud authenticated as the logged-in user over TLS; the cloud never opens a connection to the user's machine.
- **P0 Short-lived, signed pairing tokens** (rotate, single-device, revocable from the account page).
- **P1** Pin the cloud TLS cert / verify it in the local client; reject downgrade.
- **P1** Show the user a list of paired devices with revoke.

---

## 8. Payments — *cloud*

**Threats:** touching raw card data (PCI scope); spoofed payment webhooks granting free premium; entitlement bypass (client claims "premium").

**Controls to put in place:**
- **P0 Use a merchant-of-record** (Lemon Squeezy / Paddle) or Stripe — **never handle raw cards.** They carry PCI + (for MoR) global VAT, which matters selling from SA.
- **P0 Verify webhook signatures**; treat webhooks as the source of truth for entitlements.
- **P0 Enforce entitlements server-side** on every gated action — never trust a client-side "isPremium" flag.
- **P1 Idempotent webhook handling**; reconcile against the provider periodically.

---

## 9. Auto-apply safety & liability — *local* (carried over, keep intact)

**Threats:** submitting without consent; applying to the wrong role; misrepresentation; ToS/bot-ban on the user's accounts.

**Controls (already in the desktop app — preserve them in the companion):**
- **P0 Never auto-submit.** The final submit stays a human click (hard-blocked in code, not just prompt).
- **P0 CAPTCHA/verification → detect and hand off**, never auto-solve.
- **P0 Visible, human-on-the-loop** apply window; per-application explicit action; audit log of actions.
- **P1** Keep the routine safety model: routines find/prepare, never apply.
- **P1** Keep the DOM injection scanner + `applyUrl` scheme allowlist (`http/https` only).

---

## 10. Already put in place this session (current code)

- **Loopback binding (§7 P0).** The API server bound to `0.0.0.0` (every interface) despite SECURITY.md claiming localhost — anyone on the same Wi-Fi could reach the unauthenticated API. Now binds `127.0.0.1` (override via `HOST` env if ever needed).
- **Untrusted research brief (§5 P0).** The T4 company-research brief (assembled from arbitrary employer pages) is now wrapped in `[BEGIN/END UNTRUSTED RESEARCH]` markers in the tailoring prompt, matching how job descriptions are handled.

---

## 11. Pre-launch gate — *do before the first paying user*

A blunt checklist; everything here is **P0** above.

- [ ] Passwords hashed (Argon2id) + Google sign-in + email verification.
- [ ] Session cookies hardened; login rate-limited.
- [ ] TLS + HSTS; security headers (Helmet); CSP.
- [ ] Managed AI key server-side only; secret scanning in CI; secrets never logged.
- [ ] **Credits metered + hard per-account caps server-side**; AI endpoints rate-limited; tier knobs enforced server-side.
- [ ] No SA ID numbers stored; EE/salary optional + field-encrypted; data encrypted at rest.
- [ ] Self-serve data **export + delete**; consent recorded at signup.
- [ ] Per-user data isolation verified (no cross-tenant prompt/query).
- [ ] Output escaping/sanitisation on anything model- or scrape-derived.
- [ ] Payments via merchant-of-record; webhook signatures verified; entitlements server-side.
- [ ] Local companion: loopback-only; authenticated pull; short-lived pairing tokens.
- [ ] Breach-response runbook + Anthropic spend cap as backstop.

---

## 12. Residual risks to accept consciously

- **AI provider sees user data.** CVs + job details go to Anthropic. Disclose it; review their retention/zero-retention terms; cover it in the privacy policy and DPA.
- **License/account sharing.** Some sharing is inevitable; per-account caps (§4) limit the damage rather than trying to stop it with heavy DRM.
- **Heuristic injection scanner.** It's a warning layer, not a guarantee — homoglyphs/novel phrasing can slip past. The "never auto-submit / output-is-data" rules are the real backstop.
- **Desktop app isn't a server.** Routines only run while the app is open; not a guaranteed cron. Fine — just don't promise always-on in marketing.
