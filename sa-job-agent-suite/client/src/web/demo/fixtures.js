// The demo universe. Every employer, address, phone number and link is
// fictional, and every host uses the reserved .test domain.
import { STORES } from '../vault.js';

export const DEMO_SEED_VERSION = 2;
export const DEMO_QUESTION = 'Which fictional project would you like to discuss?';

const BASE_CV = `# Alex Example

Software engineer in Johannesburg with five years of experience building accessible web applications and the services behind them.

## Selected work

- Built an accessibility dashboard for a fictional public service portal. The project now audits colour contrast and keyboard paths on every release.
- Led a three-person team that moved a reporting tool from a legacy stack to React and Node, cutting page load from 9 seconds to 2.
- Wrote the automated checks that kept the dashboard honest, then taught two teammates to maintain them.
- Designed the PostgreSQL schema behind a fictional municipal service directory.

## Skills

React, Node.js, TypeScript, PostgreSQL, automated accessibility testing, CI pipelines.

## Education

BSc Computer Science, University of the Witwatersrand (fictional record).

## Availability

30 days notice. Open to hybrid Johannesburg or fully remote work.`;

export const DEMO_PROFILE = {
  fullName: 'Alex Example',
  email: 'alex@example.test',
  phone: '000 000 0000',
  location: 'Johannesburg, South Africa',
  linkedInUrl: 'https://example.test/in/alex-example',
  portfolioUrl: 'https://example.test/alex',
  keywords: 'software engineer, react, node',
  locations: 'Johannesburg, Cape Town, Remote',
  feedSaOnly: true,
  maxKeywords: 3,
  maxLocations: 2,
  useStructuredOutputs: true,
  usePromptCaching: true,
  dailyBudgetUSD: 5,
  selectedModel: '',
  applicationDefaultsText: 'I am based in Johannesburg and happy to work hybrid or fully remote.',
  baseCv: BASE_CV,
  applicationProfile: {
    rightToWorkSA: 'Yes, South African citizen',
    noticePeriod: '30 days',
    currentSalary: 'R 38 000 per month',
    expectedSalary: 'R 45 000 per month',
    driversLicense: 'Code B',
    willingToRelocate: 'Yes, within South Africa',
    highestQualification: 'BSc Computer Science',
    yearsExperience: '5 years',
    languages: 'English, Sesotho',
    availabilityDate: '1 December 2026'
  }
};

export function tailoredDocuments(job = {}) {
  const title = String(job.title || 'Developer').trim();
  const company = String(job.company || 'Example Studio').trim();
  return {
    tailoredCvText: `# Alex Example

Simulated tailored CV for the ${title} role at ${company}.

## Summary

Software engineer with five years of experience building accessible React interfaces and the services behind them.

## Selected work

- Built an accessibility dashboard that audits colour contrast and keyboard paths for a fictional public service portal.
- Led a three-person team that moved a reporting tool to React and Node, cutting page load from 9 seconds to 2.
- Wrote the automated checks that kept the dashboard honest and taught two teammates to maintain them.
- Designed the PostgreSQL schema behind a fictional municipal service directory.

## Why this role

The ${title} role at ${company} matches the accessibility, platform and reporting work in this fictional CV.`,
    tailoredCoverLetterText: `# Cover letter

Dear ${company} team,

I am applying for the ${title} role. In this simulated letter I would point to the accessibility dashboard I built, the reporting migration I led and the checks that kept both honest.

I am based in Johannesburg, available after 30 days notice, and open to hybrid or remote work.

Thank you for considering this fictional application.

Alex Example`
  };
}

const GENERATED = (job) => tailoredDocuments(job);

export const DEMO_JOBS = [
  {
    id: 'demo-job-1', title: 'Frontend Engineer', company: 'Example Studio',
    location: 'Johannesburg, South Africa',
    description: 'Build accessible React interfaces for a fictional design studio. You will own the component library, pair with designers on a public-facing portal, and keep keyboard and screen-reader paths working on every release.',
    applyUrl: 'https://example-studio.test/jobs/frontend',
    datePosted: '2026-10-20', matchScore: 92, status: 'tailored',
    notes: 'Fictional role for the demo. Portfolio link is required.', source: 'Example Studio', dateAdded: '2026-10-21',
    ...GENERATED({ title: 'Frontend Engineer', company: 'Example Studio' })
  },
  {
    id: 'demo-job-2', title: 'Full Stack Developer', company: 'Fable Fintech',
    location: 'Cape Town, South Africa',
    description: 'Build fictional payment dashboards and the services behind them. The team ships in small slices, reviews every change and runs a weekly accessibility pass on the customer portal.',
    applyUrl: 'https://fable-fintech.test/careers/full-stack',
    datePosted: '2026-10-22', matchScore: 88, status: 'tailored',
    notes: '', source: 'Fable Fintech', dateAdded: '2026-10-22',
    ...GENERATED({ title: 'Full Stack Developer', company: 'Fable Fintech' })
  },
  {
    id: 'demo-job-3', title: 'Data Engineer', company: 'Sample Logistics',
    location: 'Durban, South Africa',
    description: 'Move fictional depot data into a warehouse the reporting team can trust. You will model deliveries, catch broken feeds early and document every table you touch.',
    applyUrl: 'https://sample-logistics.test/jobs/data',
    datePosted: '2026-10-23', matchScore: 78, status: 'found',
    notes: '', source: 'Sample Logistics', dateAdded: '2026-10-23',
    tailoredCvText: '', tailoredCoverLetterText: ''
  },
  {
    id: 'demo-job-4', title: 'QA Analyst', company: 'Placeholder Health',
    location: 'Pretoria, South Africa',
    description: 'Test a fictional clinic booking flow on web and mobile. The role is mostly exploratory testing, with a small amount of automation for the paths that must never break.',
    applyUrl: 'https://placeholder-health.test/jobs/qa',
    datePosted: '2026-10-24', matchScore: 71, status: 'found',
    notes: '', source: 'Placeholder Health', dateAdded: '2026-10-24',
    tailoredCvText: '', tailoredCoverLetterText: ''
  },
  {
    id: 'demo-job-5', title: 'Platform Engineer', company: 'Imaginary Retail',
    location: 'Remote, South Africa',
    description: 'Keep a fictional storefront platform fast and observable. You will own the build pipeline, trim the slowest pages and make sure alerts reach a human before a customer notices.',
    applyUrl: 'https://imaginary-retail.test/jobs/platform',
    datePosted: '2026-10-18', matchScore: 84, status: 'applied',
    appliedAt: '2026-10-19T09:00:00.000Z',
    notes: '', source: 'Imaginary Retail', dateAdded: '2026-10-18',
    tailoredCvText: '', tailoredCoverLetterText: ''
  },
  {
    id: 'demo-job-6', title: 'Senior Frontend Engineer', company: 'Example Studio',
    location: 'Johannesburg, South Africa',
    description: 'Lead the frontend for a fictional civic portal. You will set the accessibility bar, review pull requests and mentor two mid-level engineers.',
    applyUrl: 'https://example-studio.test/jobs/senior-frontend',
    datePosted: '2026-10-12', matchScore: 91, status: 'interviewing',
    appliedAt: '2026-10-14T08:30:00.000Z',
    notes: 'Simulated first interview booked for 4 November.', source: 'Example Studio', dateAdded: '2026-10-12',
    ...GENERATED({ title: 'Senior Frontend Engineer', company: 'Example Studio' })
  },
  {
    id: 'demo-job-7', title: 'Backend Engineer', company: 'Fable Fintech',
    location: 'Cape Town, South Africa',
    description: 'Build the fictional services behind payment dashboards: Node, PostgreSQL and a queue that never loses a job. The team keeps a short on-call rotation.',
    applyUrl: 'https://fable-fintech.test/careers/backend',
    datePosted: '2026-10-16', matchScore: 86, status: 'tailored',
    notes: '', source: 'Fable Fintech', dateAdded: '2026-10-16',
    ...GENERATED({ title: 'Backend Engineer', company: 'Fable Fintech' })
  },
  {
    id: 'demo-job-8', title: 'Cloud Engineer', company: 'Imaginary Retail',
    location: 'Remote, South Africa',
    description: 'Look after the fictional cloud accounts behind a retail platform. Expect infrastructure as code, cost reviews and a monthly disaster-recovery drill.',
    applyUrl: 'https://imaginary-retail.test/jobs/cloud',
    datePosted: '2026-10-21', matchScore: 81, status: 'found',
    notes: '', source: 'Imaginary Retail', dateAdded: '2026-10-21',
    tailoredCvText: '', tailoredCoverLetterText: ''
  },
  {
    id: 'demo-job-9', title: 'Support Engineer', company: 'Sample Logistics',
    location: 'Durban, South Africa',
    description: 'Help fictional depots use a tracking tool. You will triage tickets, write short guides and pass repeat bugs back to the product team.',
    applyUrl: 'https://sample-logistics.test/jobs/support',
    datePosted: '2026-10-19', matchScore: 73, status: 'found',
    notes: '', source: 'Sample Logistics', dateAdded: '2026-10-19',
    tailoredCvText: '', tailoredCoverLetterText: ''
  },
  {
    id: 'demo-job-10', title: 'Junior Developer', company: 'Placeholder Health',
    location: 'Pretoria, South Africa',
    description: 'A fictional first role on a clinic booking team. Mostly small React tickets, with reviews and a mentor assigned for the first six months.',
    applyUrl: 'https://placeholder-health.test/jobs/junior',
    datePosted: '2026-10-08', matchScore: 64, status: 'rejected',
    appliedAt: '2026-10-09T10:15:00.000Z',
    notes: 'Simulated rejection: they wanted two more years of experience.', source: 'Placeholder Health', dateAdded: '2026-10-08',
    tailoredCvText: '', tailoredCoverLetterText: ''
  }
];

export const DEMO_ANSWERS = [
  { id: 'demo-answer-notice', question: 'What is your notice period?', answer: '30 days', normalized: 'notice period' },
  { id: 'demo-answer-right', question: 'Do you have the right to work in South Africa?', answer: 'Yes, South African citizen.', normalized: 'right to work' },
  { id: 'demo-answer-salary', question: 'What is your expected salary?', answer: 'R 45 000 per month', normalized: 'expected salary' },
  { id: 'demo-answer-current', question: 'What is your current salary?', answer: 'R 38 000 per month', normalized: 'current salary' },
  { id: 'demo-answer-licence', question: 'Do you have a driver licence?', answer: 'Code B', normalized: 'driver licence' },
  { id: 'demo-answer-relocate', question: 'Are you willing to relocate?', answer: 'Yes, within South Africa.', normalized: 'willing to relocate' },
  { id: 'demo-answer-qualification', question: 'What is your highest qualification?', answer: 'BSc Computer Science', normalized: 'highest qualification' },
  { id: 'demo-answer-languages', question: 'Which languages do you speak?', answer: 'English and Sesotho', normalized: 'languages' }
];

const STAMP = '2026-10-25T08:00:00.000Z';

export const DEMO_MEMORY = {
  version: 1,
  updatedAt: STAMP,
  insights: [
    {
      id: 'demo-insight-1', text: 'Prefers roles with an accessibility or public service angle.',
      category: 'preference', source: 'manual', createdAt: STAMP, weight: 1, lastConfirmedAt: STAMP
    },
    {
      id: 'demo-insight-2', text: 'Strongest when explaining a migration tradeoff to non-engineers.',
      category: 'strength', source: 'manual', createdAt: STAMP, weight: 1, lastConfirmedAt: STAMP
    },
    {
      id: 'demo-insight-3', text: 'Cut page load from 9 seconds to 2 on the reporting project.',
      category: 'achievement', source: 'manual', createdAt: STAMP, weight: 1, lastConfirmedAt: STAMP
    },
    {
      id: 'demo-insight-4', text: 'Prefers a short cover letter that names one concrete project.',
      category: 'style', source: 'manual', createdAt: STAMP, weight: 1, lastConfirmedAt: STAMP
    },
    {
      id: 'demo-insight-5', text: 'Has 30 days notice and can start on 1 December 2026.',
      category: 'constraint', source: 'manual', createdAt: STAMP, weight: 1, lastConfirmedAt: STAMP
    },
    {
      id: 'demo-insight-6', text: 'Open to hybrid Johannesburg or fully remote work.',
      category: 'preference', source: 'manual', createdAt: STAMP, weight: 1, lastConfirmedAt: STAMP
    }
  ],
  employers: [
    {
      id: 'demo-employer-1', company: 'Example Studio', normalized: 'example studio',
      notes: ['Fictional studio. Portfolio link is required.'], applications: 2, updatedAt: STAMP
    },
    {
      id: 'demo-employer-2', company: 'Fable Fintech', normalized: 'fable fintech',
      notes: ['Fictional fintech. Replied within a week last time.'], applications: 1, updatedAt: STAMP
    },
    {
      id: 'demo-employer-3', company: 'Sample Logistics', normalized: 'sample logistics',
      notes: ['Fictional logistics group. Durban office, hybrid.'], applications: 0, updatedAt: STAMP
    },
    {
      id: 'demo-employer-4', company: 'Placeholder Health', normalized: 'placeholder health',
      notes: ['Simulated rejection in October: they wanted two more years.'], applications: 1, updatedAt: STAMP
    },
    {
      id: 'demo-employer-5', company: 'Imaginary Retail', normalized: 'imaginary retail',
      notes: ['Simulated: replied within a week.'], applications: 1, updatedAt: STAMP
    }
  ],
  applications: [
    {
      id: 'demo-application-1', jobId: 'demo-job-5', title: 'Platform Engineer',
      company: 'Imaginary Retail', appliedAt: '2026-10-19T09:00:00.000Z',
      outcome: 'applied', salarySnapshot: null, transcript: []
    },
    {
      id: 'demo-application-2', jobId: 'demo-job-6', title: 'Senior Frontend Engineer',
      company: 'Example Studio', appliedAt: '2026-10-14T08:30:00.000Z',
      outcome: 'interviewing', salarySnapshot: null,
      transcript: [{ at: '2026-10-24T14:00:00.000Z', text: 'Simulated first interview booked for 4 November.' }]
    },
    {
      id: 'demo-application-3', jobId: 'demo-job-10', title: 'Junior Developer',
      company: 'Placeholder Health', appliedAt: '2026-10-09T10:15:00.000Z',
      outcome: 'rejected', salarySnapshot: null,
      transcript: [{ at: '2026-10-18T09:00:00.000Z', text: 'Simulated rejection: they wanted two more years of experience.' }]
    }
  ],
  lastDream: null
};

export const DEMO_ACTIVITY = [
  { message: 'Demo workspace opened with fictional data.', type: 'system' },
  { message: 'Simulated tailoring finished for Frontend Engineer at Example Studio.', type: 'agent2' },
  { message: 'Simulated tailoring finished for Full Stack Developer at Fable Fintech.', type: 'agent2' },
  { message: 'Simulated application recorded for Platform Engineer at Imaginary Retail.', type: 'system' },
  { message: 'Simulated interview logged for Senior Frontend Engineer at Example Studio.', type: 'system' },
  { message: 'Simulated rejection recorded for Junior Developer at Placeholder Health.', type: 'system' }
];

export const DEMO_HUNTER_JOBS = [
  {
    title: 'React Developer', company: 'Example Studio', location: 'Johannesburg, South Africa',
    description: 'Build fictional interfaces for a design studio. React, TypeScript and an accessibility review on every change.',
    applyUrl: 'https://example-studio.test/feeds/react',
    source: 'Simulated board', feed: 'remotive', matchScore: 90, datePosted: '2026-10-27'
  },
  {
    title: 'Backend Engineer', company: 'Fable Fintech', location: 'Cape Town, South Africa',
    description: 'Build fictional payment services in Node and PostgreSQL.',
    applyUrl: 'https://fable-fintech.test/careers/backend',
    source: 'Simulated board', feed: 'arbeitnow', matchScore: 86, datePosted: '2026-10-16'
  },
  {
    title: 'Node Developer', company: 'Sample Logistics', location: 'Durban, South Africa',
    description: 'Build fictional depot services and the queue behind them.',
    applyUrl: 'https://sample-logistics.test/feeds/node',
    source: 'Simulated board', feed: 'remotive', matchScore: 76, datePosted: '2026-10-27'
  },
  {
    title: 'Site Reliability Engineer', company: 'Fable Fintech', location: 'Cape Town, South Africa',
    description: 'Run fictional payment systems with clear alerts and short on-call rotations.',
    applyUrl: 'https://fable-fintech.test/feeds/sre',
    source: 'Simulated board', feed: 'arbeitnow', matchScore: 82, datePosted: '2026-10-26'
  },
  {
    title: 'Support Engineer', company: 'Sample Logistics', location: 'Durban, South Africa',
    description: 'Help fictional depots use a tracking tool.',
    applyUrl: 'https://sample-logistics.test/jobs/support',
    source: 'Simulated board', feed: 'jobicy', matchScore: 74, datePosted: '2026-10-19'
  },
  {
    title: 'Mobile Developer', company: 'Placeholder Health', location: 'Pretoria, South Africa',
    description: 'Build a fictional clinic booking app for web and mobile.',
    applyUrl: 'https://placeholder-health.test/feeds/mobile',
    source: 'Simulated board', feed: 'jobicy', matchScore: 69, datePosted: '2026-10-26'
  },
  {
    title: 'Data Analyst', company: 'Sample Logistics', location: 'Pretoria, South Africa',
    description: 'Read fictional depot data and turn it into weekly delivery reports.',
    applyUrl: 'https://sample-logistics.test/jobs/analyst',
    source: 'Simulated board', feed: 'remotive', matchScore: 71, datePosted: '2026-10-25'
  },
  {
    title: 'Frontend Developer', company: 'Placeholder Health', location: 'Remote, United States',
    description: 'Build a fictional clinic portal for a United States team.',
    applyUrl: 'https://placeholder-health.test/feeds/frontend-us',
    source: 'Simulated board', feed: 'arbeitnow', matchScore: 66, datePosted: '2026-10-26'
  }
];

function feedJob(source, title, company, location, applyUrl, description) {
  return {
    source,
    sourceId: `${source}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    title, company, location, description, applyUrl,
    datePosted: '2026-10-26',
    remote: /remote/i.test(location),
    tags: ['simulated'],
    salaryText: '',
    matchScore: 72
  };
}

export const DEMO_FEEDS = {
  remotive: [
    feedJob('remotive', 'React Developer', 'Example Studio', 'Johannesburg, South Africa', 'https://example-studio.test/feeds/react', 'Build fictional interfaces for a design studio.'),
    feedJob('remotive', 'Node Developer', 'Sample Logistics', 'Durban, South Africa', 'https://sample-logistics.test/feeds/node', 'Build fictional depot services.'),
    feedJob('remotive', 'Data Analyst', 'Sample Logistics', 'Pretoria, South Africa', 'https://sample-logistics.test/jobs/analyst', 'Read fictional depot data.')
  ],
  arbeitnow: [
    feedJob('arbeitnow', 'Platform Engineer', 'Imaginary Retail', 'Remote, South Africa', 'https://imaginary-retail.test/feeds/platform', 'Keep a fictional storefront observable.'),
    feedJob('arbeitnow', 'Site Reliability Engineer', 'Fable Fintech', 'Cape Town, South Africa', 'https://fable-fintech.test/feeds/sre', 'Run fictional payment systems.'),
    feedJob('arbeitnow', 'Frontend Developer', 'Placeholder Health', 'Remote, United States', 'https://placeholder-health.test/feeds/frontend-us', 'Build a fictional clinic portal for a United States team.')
  ],
  jobicy: [
    feedJob('jobicy', 'Full Stack Developer', 'Fable Fintech', 'Cape Town, South Africa', 'https://fable-fintech.test/feeds/full-stack', 'Build fictional payment dashboards.'),
    feedJob('jobicy', 'Data Analyst', 'Sample Logistics', 'Pretoria, South Africa', 'https://sample-logistics.test/jobs/analyst', 'Read fictional depot data.'),
    feedJob('jobicy', 'QA Engineer', 'Placeholder Health', 'Durban, South Africa', 'https://placeholder-health.test/jobs/qa', 'Test a fictional clinic booking flow.')
  ]
};

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export function buildDemoSeed(now = new Date()) {
  const today = (now instanceof Date ? now : new Date(now)).toISOString().slice(0, 10);
  return {
    profile: { current: clone(DEMO_PROFILE) },
    jobs: Object.fromEntries(DEMO_JOBS.map((job) => [job.id, clone(job)])),
    answers: Object.fromEntries(DEMO_ANSWERS.map((answer) => [answer.id, clone(answer)])),
    memory: { dossier: clone(DEMO_MEMORY) },
    usage: {
      days: {
        days: {
          [today]: {
            calls: 8, inputTokens: 21400, outputTokens: 5200,
            cacheReadTokens: 1200, cacheWriteTokens: 800, webSearches: 0, estCostUSD: 0.24,
            byBucket: {
              tailor: { calls: 3, inputTokens: 9600, outputTokens: 2600, cacheReadTokens: 0, cacheWriteTokens: 800, webSearches: 0, estCostUSD: 0.12 },
              rag: { calls: 3, inputTokens: 7400, outputTokens: 1800, cacheReadTokens: 1200, cacheWriteTokens: 0, webSearches: 0, estCostUSD: 0.08 },
              ground: { calls: 2, inputTokens: 4400, outputTokens: 800, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, estCostUSD: 0.04 }
            },
            byTask: {}
          }
        }
      }
    },
    meta: { app: { onboarded: true, demoSeed: DEMO_SEED_VERSION } },
    activity: DEMO_ACTIVITY.map((entry) => ({ ...entry }))
  };
}

export async function seedDemoVault(vault, now = new Date()) {
  if (!vault) throw new Error('A vault is required to seed the demo.');
  const meta = (await vault.get(STORES.meta, 'app', {})) || {};
  if (meta.demoSeed === DEMO_SEED_VERSION) return false;
  const seed = buildDemoSeed(now);
  for (const store of [STORES.profile, STORES.jobs, STORES.answers, STORES.memory, STORES.usage, STORES.meta]) {
    await vault.clear(store);
  }
  for (const store of [STORES.profile, STORES.jobs, STORES.answers, STORES.memory, STORES.usage]) {
    for (const [key, value] of Object.entries(seed[store])) await vault.put(store, key, value);
  }
  await vault.put(STORES.meta, 'app', seed.meta.app);
  return true;
}
