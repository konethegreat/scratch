# SA-JAS — Video Demo Script

For the current runnable, verified recording path, use the
[synthetic walkthrough](docs/DEMO.md). It has fictional data, local pages and
screenshots; live search and AI generation described below require separate
configured evidence.

**Runtime:** ~6 minutes · **Audience:** prospective users + recruiters
**Format:** left column = what you SAY (voiceover), right column = what you DO/SHOW on screen.

> Tip: Read the SAY column at a relaxed pace. The DO column tells you what to have on screen and when to click. Time codes are approximate.

---

## 0:00 — Cold open / hook (20s)

| SAY | DO / SHOW |
|---|---|
| "Job hunting in South Africa is a grind — the same forms, the same screening questions, over and over. So I built SA-JAS: the South African Job Agent Suite. It finds the jobs, rewrites your CV and cover letter for each one, and then sits next to you in the browser and helps you actually submit the application." | Open on the app's landing screen (the aurora-dark hero). Let it breathe for a second. |
| "It runs as a desktop app, and under the hood it's three AI agents working together. Let me show you." | Slowly scroll the landing hero, then hover over the top nav tabs. |

---

## 0:20 — The big picture (30s)

| SAY | DO / SHOW |
|---|---|
| "Everything lives in one window. There's a Job Hunter, a Document Tailor, and an Apply Copilot — three agents, each doing one job well. There's also a Candidate Memory that learns from every application, and Routines that can run the whole thing while I'm asleep." | Point the cursor across the tabs as you name each: Hunter, Jobs, Candidate Memory, Routines, Settings. |
| "It's built as an Electron desktop app — React front end, Express back end — and it talks to live AI models. Your keys and your documents never leave your machine." | Briefly show the Settings tab so the provider dropdown (Gemini / Anthropic / OpenRouter) is visible. |

---

## 0:50 — Setup & Settings (40s) — *flex: privacy + flexibility*

| SAY | DO / SHOW |
|---|---|
| "Quick setup first. I pick my AI provider — it works with Gemini, Anthropic, or OpenRouter, so I'm never locked in. My API keys are stored locally, separate from everything else, never in the cloud." | In Settings, open the provider dropdown, then point at the API-key field showing it's saved locally. |
| "I fill in a structured questionnaire once — the recurring South African application questions: notice period, salary expectation, work eligibility, EE details if I choose to share them. The agent reuses these everywhere so I never retype them." | Scroll the Application Answers questionnaire. Hover a few fields. |
| "I upload my supporting documents once too — ID, matric certificate, degree, academic record — all PDFs. The Apply Copilot attaches the right one to the right field automatically later." | Show the Supporting Documents panel with the uploaded PDF slots. |
| "And there's a setup checklist that tells me exactly what's still missing before I'm ready to run." | Point at the Setup Checklist widget. |

---

## 1:30 — Agent 1: The Job Hunter (75s) — *flex: AI grounded search*

| SAY | DO / SHOW |
|---|---|
| "Agent one is the Job Hunter. Its primary engine is Claude's grounded web search — so it returns real, current vacancies with real source links, localised to South Africa. No made-up jobs." | Go to the Job Hunter tab. Show the engine echo line ("engine = AI Search…"). |
| "If I want extra coverage, it also falls back to thirteen South African job boards — Careers24, PNet, Indeed SA, CareerJunction and more — each with a structured-data fallback so it keeps working even when sites change their layout." | Briefly show the keyword and location fields; mention them as you fill, e.g. 'Software Engineer', 'Cape Town'. |
| "I set my keywords and locations, hit Start, and watch it work in the activity console. I can stop it any time — and every job gets a match score from zero to a hundred, so the best fits float to the top." | Click Start. Let the activity log scroll for a few seconds. Then show the Jobs list populating with match scores. |
| "When it finishes, I get a run summary: how many it found, how many it saved, and a per-source breakdown — so I always know what happened." | Show the Run Summary panel with found/saved counts. |

---

## 2:45 — Agent 2: The Document Tailor (70s) — *flex: per-job AI + PDF*

| SAY | DO / SHOW |
|---|---|
| "Agent two is the Document Tailor. I pick a job and hit Tailor. It rewrites my base CV for that specific role and writes a fresh three-to-four-hundred-word cover letter — ATS-optimised, in South African English." | In the Jobs list, click a job, then click Tailor. Show the status moving found → tailoring → tailored. |
| "It even researches the company first — sector, recent news, what the role really wants — and weaves that into both documents. So the cover letter actually sounds like I know the company." | Open the tailored cover letter preview. Scroll it so the company-specific lines are visible. |
| "And it renders both the CV and the cover letter to polished PDFs, ready to upload. No copy-paste, no formatting fights." | Open the generated CV PDF. Show it side by side with the cover letter PDF. |
| "If I've got a stack of jobs, I can tailor them all at once — it runs them in parallel batches to save time." | Click 'Tailor all found' and show several jobs flipping to tailored together. |

---

## 3:55 — Agent 3: The Apply Copilot (90s) — *the showstopper*

| SAY | DO / SHOW |
|---|---|
| "This is the part I'm proudest of. Agent three is the Apply Copilot. I hit Apply, and it opens a real, visible browser at the application page with a floating assistant docked on top." | Click Apply on a tailored job. Show the Chromium window opening with the HUD overlay. |
| "It's supervised autonomy — human on the loop. Auto-pilot walks the multi-step form: it Smart-fills each page from my saved answers, attaches my CV and the right supporting documents, and clicks through Apply, Continue, and Next on its own." | Let auto-pilot fill a form page. Point at fields populating and the CV attaching. |
| "But here's the rule that matters: it never clicks the final Submit. That's always my decision. And if it hits a CAPTCHA or a login wall, it stops and hands control straight back to me — it never tries to fake its way past security." | Hover the final Submit button without clicking. Mention the CAPTCHA hand-off. |
| "For tricky custom fields, it can even see the page and operate it like a person would. And when it can't answer a screening question, it saves the question so I answer it once — and from then on it fills it in automatically, on every site." | Show a screening question being captured into Pending Questions, then answered in Settings. |
| "When a confirmation page appears, it screenshots the proof and marks the job as applied. Done." | Show a job's status as 'applied' with the confirmation screenshot. |

---

## 5:25 — The smart layer: Memory + Routines (45s) — *flex: it gets better over time*

| SAY | DO / SHOW |
|---|---|
| "Two more things make this more than a form-filler. First, Candidate Memory — every application teaches it something. It remembers which phrasings won me interviews, builds notes on each employer, and feeds that back into the next CV and cover letter. It literally improves the more I use it." | Open the Candidate Memory tab. Show insights, employer notes, and the outcome log. |
| "Second, Routines — I can schedule the hunt and tailoring to run unattended, every morning, so a fresh batch of ready-to-apply jobs is waiting for me. Routines never submit anything — applying always stays a human decision." | Open the Routines tab. Show a daily routine and the ready-to-apply tray. |
| "And after I apply, there's even a direct-outreach helper that drafts a short, personal message to a real engineering lead at the company — so I'm not just another name in an applicant pile." | Briefly show the referral/outreach panel on an applied job. |

---

## 6:10 — Close (20s)

| SAY | DO / SHOW |
|---|---|
| "So that's SA-JAS — three AI agents that find the jobs, tailor every application, and help me apply, with me in control the whole way and my data staying on my own machine. It's a full desktop product I designed and built end to end." | Return to the landing screen. Let the creator links (LinkedIn / GitHub / Credly) show in the footer. |
| "Thanks for watching — links are on screen if you'd like to see the code or get in touch." | Hold on the footer links for a beat, then fade out. |

---

## Recording checklist (for you, before you hit record)

- Run a hunt **beforehand** so the Jobs list already has results — then re-run a short one on camera for the live moment.
- Have **one job pre-tailored** as a backup in case the live tailor call is slow.
- Pre-log into one job site in the browser profile so the Apply Copilot demo flows without a login wall.
- Keep the activity console visible during Agent 1 and 3 — the live logs are the most convincing part.
- Recommended order if you want to cut for time: **Hunter → Tailor → Apply** are essential; **Memory / Routines / Referral** can be trimmed for a 3-minute version.

## One-line tagline options (for the title card / thumbnail)

- "SA-JAS — three AI agents that find, tailor, and apply to South African jobs."
- "I built an AI suite that does the job hunt for me — and lets me stay in control."
- "From job board to submit button: an AI co-pilot for the South African job market."
