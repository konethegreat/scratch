// Single source of truth for the legal notices shown on the landing page and
// in Help. Plain text only, so the same words render in both places.
import { SUPPORT } from './support.js';

export const LEGAL_UPDATED = '30 October 2026';

export const REPOSITORY = 'https://github.com/konethegreat/scratch';
export const REGULATOR = 'https://inforegulator.org.za';

export const LEGAL_SECTIONS = Object.freeze([
  {
    id: 'terms',
    title: 'Terms of use',
    summary: 'What this beta is, and what you agree to by using it.',
    clauses: [
      {
        heading: 'A personal project in open beta',
        body: `SA-JAS is built and run by ${SUPPORT.name} as a working demonstration of an AI job agent. It is in beta: features can change or be removed without notice, and there is no uptime or support commitment.`
      },
      {
        heading: 'Your key, your costs',
        body: 'The hosted app runs on an Anthropic API key that you supply. Anthropic bills the account behind that key. You are responsible for keeping the key private and for the usage it records.'
      },
      {
        heading: 'Review before you send',
        body: 'The app drafts documents and can open an application page. It never sends an application, an email or a message on your behalf. You check every document and you submit it yourself.'
      },
      {
        heading: 'Acceptable use',
        body: 'Use the app for your own job search. Do not use it for unlawful purposes, to impersonate someone else, to overload the site, or to scrape it automatically. Do not enter another person\'s personal information without their consent.'
      },
      {
        heading: 'No outcome promised',
        body: 'Nothing here promises a callback, an interview or a job. Match scores are estimates, not hiring decisions.'
      },
      {
        heading: 'Provided as is',
        body: 'The app is provided as is and without warranties, to the extent the law allows. Nothing in these terms limits rights you have under the Consumer Protection Act 68 of 2008 or any other law that cannot be excluded.'
      },
      {
        heading: 'Changes and governing law',
        body: 'The date at the top of this notice changes when the terms change, and the beta banner returns when they do. These terms are governed by South African law.'
      }
    ]
  },
  {
    id: 'privacy',
    title: 'Privacy notice (POPIA)',
    summary: 'What stays in your browser, what leaves it, and your rights.',
    clauses: [
      {
        heading: 'Who is responsible',
        body: `The responsible party is ${SUPPORT.name}, ${SUPPORT.location}, acting as the Information Officer for this project. Write to ${SUPPORT.email} for any privacy request.`
      },
      {
        heading: 'What stays on your device',
        body: 'Your profile, jobs, documents, answer bank and usage history are stored in this browser under the sajas-web database. There are no accounts and no server copy. Your API key is held in memory for the tab, and only if you choose to save it is it stored on this device behind a passphrase.'
      },
      {
        heading: 'What the site itself collects',
        body: 'The app sets no analytics, no advertising cookies and no tracking pixels. The static host (Cloudflare) keeps standard request logs such as IP address, page, browser and time under its own policy. That is the only record the operator of this site can see.'
      },
      {
        heading: 'What leaves your browser, and when',
        body: 'Three things, and only when you ask for them: the text you send to Anthropic when you run an AI task, requests for public job postings when you hunt, and the application page when you open it. Anthropic processes your prompt as the operator of its own service.'
      },
      {
        heading: 'Cross-border processing',
        body: 'Anthropic may process text outside South Africa. You instruct that transfer when you run a task with your own key, and you can avoid it entirely by not running AI features.'
      },
      {
        heading: 'How long it is kept',
        body: 'For as long as your browser keeps it. There is no server copy to expire. Use Backup in Profile and Settings to keep your own copy, Clear everything there to empty the tracker, or clear this site\'s storage in the browser to remove everything at once.'
      },
      {
        heading: 'Your rights under POPIA',
        body: `You may ask for access, correction or deletion of your personal information, object to processing, and complain to the Information Regulator (South Africa) at ${REGULATOR} or inforeg@justice.gov.za. Because the data sits in your browser, most of these rights are exercised directly in the app, where you can export, edit or delete it.`
      },
      {
        heading: 'Direct marketing and children',
        body: 'There is no mailing list and no marketing. The app is not directed at children under 18, and you should not enter information about anyone else without their consent.'
      }
    ]
  },
  {
    id: 'ai',
    title: 'AI disclaimer',
    summary: 'Generated text can be wrong. You are the final check.',
    clauses: [
      {
        heading: 'Model output is a draft',
        body: 'CVs, cover letters, answers and explanations are produced by a large language model from the text you give it. They can be incomplete, out of date or simply wrong. Treat every result as a draft you must verify.'
      },
      {
        heading: 'Check every claim',
        body: 'Before you send anything, confirm that each skill, date, employer and achievement is true and that you can speak to it in an interview. Remove anything you cannot defend.'
      },
      {
        heading: 'Scores are estimates',
        body: 'A match score estimates how closely a posting overlaps your keywords and profile. It does not predict what a recruiter or an applicant tracking system will decide.'
      },
      {
        heading: 'Not professional advice',
        body: 'Nothing in the app is legal, immigration, financial or career advice. For decisions with legal consequences, speak to a qualified professional.'
      },
      {
        heading: 'You submit',
        body: 'The final Send or Submit is always yours. The app prepares work; it does not act as you.'
      }
    ]
  },
  {
    id: 'ownership',
    title: 'Ownership and licence',
    summary: 'The code is open. The name and brand are not.',
    clauses: [
      {
        heading: 'Code under MIT',
        body: `The source is published under the MIT licence, so you may read, run, change and share it. The licence text is in the repository: ${REPOSITORY}/blob/main/LICENSE.`
      },
      {
        heading: 'Name and branding reserved',
        body: 'The SA-JAS name, the SA Job Agent Suite name, the wordmark and the app mark are not covered by the MIT licence. See TRADEMARK.md in the repository for what is allowed.'
      },
      {
        heading: 'Your content stays yours',
        body: 'The CVs, letters, answers and profile details you enter remain yours. They are never used to train a model by this app, and they never reach the operator of this site.'
      },
      {
        heading: 'Other people\'s marks',
        body: 'Anthropic, Claude, Remotive, Arbeitnow, Jobicy and the employers named in postings belong to their owners. SA-JAS is not affiliated with or endorsed by any of them.'
      }
    ]
  }
]);
