// The demo universe. Every employer, address, phone number and link is
// fictional, and every host uses the reserved .test domain.
import { STORES } from '../vault.js';

export const DEMO_SEED_VERSION = 1;
export const DEMO_QUESTION = 'Which fictional project would you like to discuss?';

const BASE_CV = `# Alex Example

Software engineer in Johannesburg with four years of experience building accessible web applications.

## Selected work

- Built an accessibility dashboard that audits colour contrast and keyboard paths for a fictional public service portal.
- Led a small team that moved a reporting tool from a legacy stack to React and Node.
- Wrote the automated checks that kept the dashboard honest.

## Skills

React, Node.js, TypeScript, PostgreSQL, automated accessibility testing.`;

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
  applicationDefaultsText: '',
  baseCv: BASE_CV,
  applicationProfile: {
    rightToWorkSA: 'Yes, South African citizen',
    noticePeriod: '30 days',
    expectedSalary: 'R 45 000 per month',
    driversLicense: 'Code B',
    willingToRelocate: 'Yes, within South Africa',
    highestQualification: 'BSc Computer Science',
    yearsExperience: '4 years',
    languages: 'English, Sesotho'
  }
};

export function tailoredDocuments(job = {}) {
  const title = String(job.title || 'Developer').trim();
  const company = String(job.company || 'Example Studio').trim();
  return {
    tailoredCvText: `# Alex Example

Simulated tailored CV for the ${title} role at ${company}.

## Summary

Software engineer with four years of experience building accessible React interfaces and the services behind them.

## Selected work

- Built an accessibility dashboard that audits colour contrast and keyboard paths for a fictional public service portal.
- Led a small team that moved a reporting tool to React and Node.
- Wrote automated checks that kept the dashboard honest.

## Why this role

The ${title} role at ${company} matches the accessibility and platform work in this fictional CV.`,
    tailoredCoverLetterText: `# Cover letter

Dear ${company} team,

I am applying for the ${title} role. In this simulated letter I would point to the accessibility dashboard I built and the reporting migration I led.

Thank you for considering this fictional application.

Alex Example`
  };
}

const GENERATED = (job) => tailoredDocuments(job);

export const DEMO_JOBS = [
  {
    id: 'demo-job-1', title: 'Frontend Engineer', company: 'Example Studio',
    location: 'Johannesburg, South Africa',
    description: 'Build accessible React interfaces for a fictional design studio.',
    applyUrl: 'https://example-studio.test/jobs/frontend',
    datePosted: '2026-10-20', matchScore: 92, status: 'tailored',
    notes: 'Fictional role for the demo.', source: 'Example Studio', dateAdded: '2026-10-21',
    ...GENERATED({ title: 'Frontend Engineer', company: 'Example Studio' })
  },
  {
    id: 'demo-job-2', title: 'Full Stack Developer', company: 'Fable Fintech',
    location: 'Cape Town, South Africa',
    description: 'Build fictional payment dashboards and the services behind them.',
    applyUrl: 'https://fable-fintech.test/careers/full-stack',
    datePosted: '2026-10-22', matchScore: 86, status: 'tailored',
    notes: '', source: 'Fable Fintech', dateAdded: '2026-10-22',
    ...GENERATED({ title: 'Full Stack Developer', company: 'Fable Fintech' })
  },
  {
    id: 'demo-job-3', title: 'Data Engineer', company: 'Sample Logistics',
    location: 'Durban, South Africa',
    description: 'Move fictional depot data into a warehouse the reporting team can trust.',
    applyUrl: 'https://sample-logistics.test/jobs/data',
    datePosted: '2026-10-23', matchScore: 78, status: 'found',
    notes: '', source: 'Sample Logistics', dateAdded: '2026-10-23',
    tailoredCvText: '', tailoredCoverLetterText: ''
  },
  {
    id: 'demo-job-4', title: 'QA Analyst', company: 'Placeholder Health',
    location: 'Pretoria, South Africa',
    description: 'Test a fictional clinic booking flow on web and mobile.',
    applyUrl: 'https://placeholder-health.test/jobs/qa',
    datePosted: '2026-10-24', matchScore: 71, status: 'found',
    notes: '', source: 'Placeholder Health', dateAdded: '2026-10-24',
    tailoredCvText: '', tailoredCoverLetterText: ''
  },
  {
    id: 'demo-job-5', title: 'Platform Engineer', company: 'Imaginary Retail',
    location: 'Remote, South Africa',
    description: 'Keep a fictional storefront platform fast and observable.',
    applyUrl: 'https://imaginary-retail.test/jobs/platform',
    datePosted: '2026-10-18', matchScore: 68, status: 'applied',
    appliedAt: '2026-10-19T09:00:00.000Z',
    notes: '', source: 'Imaginary Retail', dateAdded: '2026-10-18',
    tailoredCvText: '', tailoredCoverLetterText: ''
  }
];

export const DEMO_ANSWERS = [
  { id: 'demo-answer-notice', question: 'What is your notice period?', answer: '30 days', normalized: 'notice period' },
  { id: 'demo-answer-right', question: 'Do you have the right to work in South Africa?', answer: 'Yes, South African citizen.', normalized: 'right to work' },
  { id: 'demo-answer-salary', question: 'What is your expected salary?', answer: 'R 45 000 per month', normalized: 'expected salary' }
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
    }
  ],
  employers: [
    {
      id: 'demo-employer-1', company: 'Imaginary Retail', normalized: 'imaginary retail',
      notes: ['Simulated: replied within a week.'], applications: 1, updatedAt: STAMP
    },
    {
      id: 'demo-employer-2', company: 'Example Studio', normalized: 'example studio',
      notes: [], applications: 0, updatedAt: STAMP
    }
  ],
  applications: [
    {
      id: 'demo-application-1', jobId: 'demo-job-5', title: 'Platform Engineer',
      company: 'Imaginary Retail', appliedAt: '2026-10-19T09:00:00.000Z',
      outcome: 'applied', salarySnapshot: null, transcript: []
    }
  ],
  lastDream: null
};

export const DEMO_ACTIVITY = [
  { message: 'Demo workspace opened with fictional data.', type: 'system' },
  { message: 'Simulated application recorded for Imaginary Retail.', type: 'system' },
  { message: 'Simulated tailoring finished for Frontend Engineer at Example Studio.', type: 'system' }
];

export const DEMO_HUNTER_JOBS = [
  {
    title: 'Full Stack Developer', company: 'Fable Fintech', location: 'Cape Town, South Africa',
    description: 'Duplicate of a role already in the demo tracker.',
    applyUrl: 'https://fable-fintech.test/careers/full-stack',
    source: 'Simulated board', matchScore: 86, datePosted: '2026-10-22'
  },
  {
    title: 'Backend Engineer', company: 'Fable Fintech', location: 'Cape Town, South Africa',
    description: 'Build fictional payment services.',
    applyUrl: 'https://fable-fintech.test/careers/backend',
    source: 'Simulated board', matchScore: 83, datePosted: '2026-10-24'
  },
  {
    title: 'Support Engineer', company: 'Sample Logistics', location: 'Durban, South Africa',
    description: 'Help fictional depots use a tracking tool.',
    applyUrl: 'https://sample-logistics.test/jobs/support',
    source: 'Simulated board', matchScore: 74, datePosted: '2026-10-25'
  },
  {
    title: 'Mobile Developer', company: 'Placeholder Health', location: 'Pretoria, South Africa',
    description: 'Build a fictional clinic booking app.',
    applyUrl: 'https://placeholder-health.test/jobs/mobile',
    source: 'Simulated board', matchScore: 69, datePosted: '2026-10-26'
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
    feedJob('remotive', 'Node Developer', 'Sample Logistics', 'Durban, South Africa', 'https://sample-logistics.test/feeds/node', 'Build fictional depot services.')
  ],
  arbeitnow: [
    feedJob('arbeitnow', 'Platform Engineer', 'Imaginary Retail', 'Remote, South Africa', 'https://imaginary-retail.test/feeds/platform', 'Keep a fictional storefront observable.'),
    feedJob('arbeitnow', 'Site Reliability Engineer', 'Fable Fintech', 'Cape Town, South Africa', 'https://fable-fintech.test/feeds/sre', 'Run fictional payment systems.'),
    feedJob('arbeitnow', 'Frontend Developer', 'Placeholder Health', 'Remote, United States', 'https://placeholder-health.test/feeds/frontend-us', 'Build a fictional clinic portal for a United States team.')
  ],
  jobicy: [
    feedJob('jobicy', 'Full Stack Developer', 'Fable Fintech', 'Cape Town, South Africa', 'https://fable-fintech.test/feeds/full-stack', 'Build fictional payment dashboards.'),
    feedJob('jobicy', 'Data Analyst', 'Sample Logistics', 'Pretoria, South Africa', 'https://sample-logistics.test/jobs/analyst', 'Read fictional depot data.')
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
            calls: 6, inputTokens: 14200, outputTokens: 3600,
            cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, estCostUSD: 0.18,
            byBucket: {
              tailor: { calls: 2, inputTokens: 6000, outputTokens: 1600, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, estCostUSD: 0.09 },
              rag: { calls: 4, inputTokens: 8200, outputTokens: 2000, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 0, estCostUSD: 0.09 }
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
