# Usage Policy

SA-JAS (South African Job Agent Suite) is free, open-source software built for South African job seekers. This document sets out the rules for using it, what it does and does not do with your data, and what you agree to by running it.

---

## 1. What this software is

SA-JAS is a personal automation tool. It:

- Scrapes publicly accessible job listings from South African job boards
- Uses your chosen AI provider (Gemini, Anthropic, or OpenRouter) to tailor your CV and cover letter
- Injects a helper overlay into employer application portals in a visible browser window so you remain in control of every submission

**You submit every application yourself.** SA-JAS never submits anything on your behalf without your explicit action.

---

## 2. Your data stays on your machine

SA-JAS is local-first by design.

- Your CV, contact details, API keys, and job records are stored in files on your own computer (`db.json`, `keys.json`, `browser-profile/`).
- None of this data is sent to any SA-JAS server, because there is no SA-JAS server.
- The only outbound network requests this software makes are:
  - To the job sites it scrapes (public search results, same as using a browser)
  - To your chosen AI provider (Gemini / Anthropic / OpenRouter) to generate tailored documents

You are responsible for reviewing the privacy policies of whichever AI provider you configure.

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

- The job sites being scraped (Careers24, Indeed SA, LinkedIn, PNet, CareerJunction, Jobs.co.za, Gumtree SA, Adzuna SA, and others)
- Your chosen AI provider (Google, Anthropic, OpenRouter)
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

SA-JAS is released under the **MIT Licence**. You are free to use, copy, modify, merge, publish, distribute, sublicense, and sell copies of the software, subject to the licence terms. The full licence text will be included in the repository `LICENSE` file.

---

## 10. Contributing

Contributions are welcome. By submitting a pull request you agree that your contribution may be distributed under the same MIT Licence. Please do not submit code that:

- Introduces hardcoded credentials or API keys
- Removes or weakens the prompt injection hardening in Agent 2 or Agent 3
- Adds telemetry, tracking, or any outbound data transmission beyond what is documented in this policy

---

## 11. Contact

For questions about this policy or to report a misuse concern, contact **erictshivhinda@gmail.com**.

For security vulnerability reports, see [SECURITY.md](./SECURITY.md).
