# Acceptable use

SA-JAS (South African Job Agent Suite) is free, open-source software built for South African job seekers. This document sets out the rules for using the desktop build, what it does and does not do with your data, and what you agree to by running it.

The hosted web app has its own data handling: see [../POLICY.md](../POLICY.md) for what is stored where, what leaves the device, and POPIA rights. The visitor-facing notices are on the landing page and in Help.

---

## 1. What this software is

SA-JAS is a personal automation tool. It:

- Finds publicly listed jobs, through Anthropic web search on desktop or the public Remotive, Arbeitnow and Jobicy feeds in the browser
- Uses your own Anthropic API key to tailor your CV and cover letter
- Injects a helper overlay into employer application portals in a visible browser window so you remain in control of every submission

**You submit every application yourself.** SA-JAS never submits anything on your behalf without your explicit action.

---

## 2. Your data stays on your machine

SA-JAS is local-first by design.

- On desktop, your CV, contact details, API keys and job records are stored in files on your own computer (`db.json`, `keys.json`, `browser-profile/`).
- In the hosted web app, everything lives in your browser's storage for the site, and the key stays in the open tab.
- None of this data is sent to any SA-JAS server, because there is no SA-JAS server.
- The only outbound network requests this software makes are:
  - To job sources (public feeds or, on desktop, search results, the same as using a browser)
  - To Anthropic, with your own key, to generate tailored documents

You are responsible for reviewing Anthropic's data retention and privacy policies before use.

---

## 3. Acceptable use

You may use SA-JAS to:

- Automate the discovery and tracking of job listings for your own personal job search
- Generate tailored application documents using your own AI provider API key
- Assist your own manual application submissions

You may **not** use SA-JAS to:

- Apply for jobs on behalf of someone else without their knowledge and consent
- Scrape job sites in violation of their Terms of Service at a scale that disrupts their services
- Misrepresent your qualifications, invent credentials, or submit fraudulent applications
- Circumvent employer systems, CAPTCHAs, or ATS in a way that violates their Terms of Service
- Resell, white-label, or offer SA-JAS as a managed or hosted service without the permission of the project maintainers

---

## 4. Responsible scraping

SA-JAS inserts polite delays between requests (at least 2 seconds per request, 1.5 seconds between sources) and limits the number of simultaneous searches. Please do not modify these delays to scrape at a rate that could harm the sites being accessed. If a job board blocks automated access, respect that and use their official search interface instead.

---

## 5. AI-generated content

Documents produced by SA-JAS are drafts. You are responsible for:

- Reviewing every AI-generated CV and cover letter before submitting it
- Ensuring the content is accurate and truthful
- Not submitting documents that contain fabricated experience, fake qualifications, or false claims

The AI providers used by SA-JAS are instructed not to invent credentials, but you must verify the output yourself. Submitting a fraudulent application is your legal and ethical responsibility, not the tool's.

---

## 6. Third-party terms

Using SA-JAS does not exempt you from the Terms of Service of:

- The job sites being read (Careers24, Indeed SA, LinkedIn, PNet, CareerJunction, Jobs.co.za, Gumtree SA, Adzuna SA, and others), plus the public feeds used by the hosted app
- Anthropic, for any AI feature
- The employers whose portals the Apply Copilot interacts with

You are solely responsible for your compliance with those terms.

---

## 7. No warranty

SA-JAS is provided **as is**, without warranty of any kind, express or implied. The maintainers make no guarantees that:

- Scraped listings are accurate, current, or complete
- AI-generated documents will improve your chances of employment
- The software will work correctly with any specific job site or application portal
- The software will remain free of bugs or security vulnerabilities

---

## 8. Limitation of liability

To the fullest extent permitted by applicable law, the SA-JAS contributors are not liable for any loss, damage, or missed opportunity arising from your use of this software, including but not limited to:

- Inaccurate or outdated job listings
- AI-generated content that contains errors
- Failed or misdirected job applications
- Data loss resulting from software bugs

---

## 9. Open source licence

SA-JAS is released under the **MIT Licence**, and the licence text is the [LICENSE](../LICENSE) file at the repository root. You are free to use, copy, modify, merge, publish, distribute, sublicense and sell copies of the software, subject to those terms. The SA-JAS name and branding are not covered by the licence; see [TRADEMARK.md](../TRADEMARK.md).

---

## 10. Contributing

Contributions are welcome. By submitting a pull request you agree that your contribution may be distributed under the same MIT Licence. Please do not submit code that:

- Introduces hardcoded credentials or API keys
- Removes or weakens the prompt injection hardening in Agent 2 or Agent 3
- Adds telemetry, tracking, or any outbound data transmission beyond what is documented in this policy

---

## 11. Contact

For questions about this policy or to report a misuse concern, contact **erictshivhinda@gmail.com**.

For security vulnerability reports, see [../SECURITY.md](../SECURITY.md).
