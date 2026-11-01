// One fictional person and everything attached to her. Every employer, address,
// reference and link is invented, and every host uses the reserved .test domain.
import { bytesToBase64, textToBytes } from '../documents.js';

export const DEMO_QUESTION = 'Which fictional project would you like to discuss?';

export const DEMO_PERSONA = Object.freeze({
  fullName: 'Naledi Mokoena',
  preferredName: 'Naledi',
  role: 'Frontend and platform engineer',
  city: 'Johannesburg',
  province: 'Gauteng',
  yearsExperience: 5
});

export const DEMO_PROFILE = {
  v: 2,
  fullName: 'Naledi Mokoena',
  preferredName: 'Naledi',
  email: 'naledi@example.test',
  phone: '000 000 0000',
  location: 'Johannesburg, Gauteng',
  linkedInUrl: 'https://example.test/in/naledi-mokoena',
  portfolioUrl: 'https://example.test/naledi',
  headline: 'Frontend and platform engineer with five years in public-service technology',
  summary: 'I build accessible React interfaces and the Node services behind them. I have worked on public-service portals, reporting tools and the automated checks that keep both honest.',
  yearsExperience: 5,
  highestQualification: 'BSc Computer Science',
  keywords: 'frontend engineer, react, node, accessibility',
  locations: 'Johannesburg, Cape Town, Remote',
  feedSaOnly: true,
  maxKeywords: 3,
  maxLocations: 2,
  useStructuredOutputs: true,
  usePromptCaching: true,
  dailyBudgetUSD: 5,
  selectedModel: '',
  applicationDefaultsText: 'I am based in Johannesburg and open to hybrid or fully remote work in South Africa.',
  baseCv: '',
  address: {
    line1: '12 Example Street',
    line2: 'Unit 4',
    suburb: 'Braamfontein',
    city: 'Johannesburg',
    province: 'Gauteng',
    postalCode: '2001'
  },
  eeOptIn: false,
  salary: {
    currentAmount: 38000,
    currentPeriod: 'month',
    expectedAmount: 45000,
    expectedPeriod: 'month',
    negotiable: true
  },
  workHistory: [
    {
      company: 'Thuso Digital', title: 'Senior Frontend Engineer', current: true,
      start: '2023-03', end: '', location: 'Johannesburg, Gauteng',
      achievements: [
        'Led a three-person team that moved a reporting tool from a legacy stack to React and Node, cutting page load from 9 seconds to 2.',
        'Set the accessibility bar for a fictional public-service portal and taught two teammates to maintain the checks.'
      ]
    },
    {
      company: 'Tshwane Civic Labs', title: 'Frontend Engineer', current: false,
      start: '2021-01', end: '2023-02', location: 'Pretoria, Gauteng',
      achievements: [
        'Built an accessibility dashboard that audits colour contrast and keyboard paths on every release.',
        'Designed the PostgreSQL schema behind a fictional municipal service directory.'
      ]
    },
    {
      company: 'Ubuntu Studios', title: 'Junior Developer', current: false,
      start: '2020-02', end: '2020-12', location: 'Johannesburg, Gauteng',
      achievements: ['Shipped small React features and wrote the first browser tests for the studio site.']
    }
  ],
  education: [
    {
      institution: 'University of the Witwatersrand (fictional record)',
      qualification: 'BSc Computer Science', start: '2016', end: '2019',
      notes: 'Fictional academic record used only in the demo.'
    }
  ],
  certifications: [
    { name: 'Certificate in Web Accessibility (fictional record)', issuer: 'Fictional Skills Institute', year: '2022' },
    { name: 'Certificate in Cloud Foundations (fictional record)', issuer: 'Fictional Skills Institute', year: '2023' }
  ],
  skills: [
    'React', 'TypeScript', 'Node.js', 'PostgreSQL', 'Accessibility testing',
    'Playwright', 'CI pipelines', 'Docker', 'SQL', 'Technical writing'
  ],
  languages: ['English', 'Sesotho', 'isiZulu'],
  references: [
    { name: 'Palesa Motaung', company: 'Thuso Digital', email: 'palesa@example.test', relationship: 'Engineering manager' },
    { name: 'Johan van Wyk', company: 'Tshwane Civic Labs', email: 'johan@example.test', relationship: 'Team lead' }
  ],
  preferences: {
    roles: ['Frontend Engineer', 'Platform Engineer', 'Full Stack Developer'],
    sectors: ['Technology', 'Public service', 'Financial services'],
    locations: ['Johannesburg', 'Cape Town', 'Remote'],
    remote: 'hybrid',
    minSalary: 42000
  },
  applicationProfile: {
    rightToWorkSA: 'Yes, South African citizen',
    nationality: 'South African',
    noticePeriod: '30 days',
    currentSalary: 'R 38 000 per month',
    expectedSalary: 'R 45 000 per month',
    driversLicense: 'Code B',
    ownVehicle: 'Yes',
    willingToRelocate: 'Yes, within South Africa',
    highestQualification: 'BSc Computer Science',
    yearsExperience: '5 years',
    languages: 'English, Sesotho and conversational isiZulu',
    availabilityDate: '1 December 2026',
    criminalRecord: 'Willing to undergo a criminal record check',
    creditCheckConsent: 'Yes'
  }
};

export const DEMO_CV_TEXT = `# Naledi Mokoena

Frontend and platform engineer in Johannesburg with five years of experience building accessible web applications and the services behind them.

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

DEMO_PROFILE.baseCv = DEMO_CV_TEXT;

const SAMPLE_UPLOADED_AT = '2026-10-20T08:00:00.000Z';

function sampleDocument({ id, kind, label, fileName, text, isDefault = false }) {
  const bytes = textToBytes(text);
  return {
    id,
    kind,
    label,
    fileName,
    mime: 'text/plain',
    size: bytes.byteLength,
    text,
    dataBase64: bytesToBase64(bytes),
    uploadedAt: SAMPLE_UPLOADED_AT,
    isDefault
  };
}

export const DEMO_DOCUMENTS = [
  sampleDocument({
    id: 'demo-doc-cv',
    kind: 'cv',
    label: 'Base CV',
    fileName: 'Naledi-Mokoena-CV.txt',
    text: DEMO_CV_TEXT,
    isDefault: true
  }),
  sampleDocument({
    id: 'demo-doc-id',
    kind: 'certified-id',
    label: 'Certified ID copy (sample)',
    fileName: 'ID-copy-sample.txt',
    text: 'Sample certified copy of a South African ID. This is a fictional demo document and contains no real identity number or personal detail.'
  }),
  sampleDocument({
    id: 'demo-doc-degree',
    kind: 'qualification',
    label: 'BSc Computer Science certificate (sample)',
    fileName: 'BSc-certificate-sample.txt',
    text: 'Sample degree certificate. BSc Computer Science, University of the Witwatersrand (fictional record). This is a demo document.'
  }),
  sampleDocument({
    id: 'demo-doc-cover',
    kind: 'cover-letter',
    label: 'Cover letter template',
    fileName: 'Cover-letter-template.txt',
    text: 'Dear hiring team,\n\nI am applying for this role because it combines accessible frontend work with services that people depend on. I would bring five years of React and Node experience, a public-service mindset and a habit of leaving automated checks behind.\n\nKind regards,\nNaledi Mokoena'
  })
];

const STAMP = '2026-10-25T08:00:00.000Z';

const ANSWER = (id, question, answer, normalized, category, timesUsed = 0, lastUsed = null) => ({
  id, question, answer, normalized, category,
  source: 'manual', timesUsed, lastUsed, createdAt: '2026-09-01T08:00:00.000Z'
});

export const DEMO_ANSWERS = [
  ANSWER('demo-answer-notice', 'What is your notice period?', '30 days', 'notice period', 'availability', 6, '2026-10-24T09:00:00.000Z'),
  ANSWER('demo-answer-right', 'Do you have the right to work in South Africa?', 'Yes, South African citizen.', 'right to work', 'eligibility', 8, '2026-10-24T09:00:00.000Z'),
  ANSWER('demo-answer-salary', 'What is your expected salary?', 'R 45 000 per month', 'expected salary', 'salary', 5, '2026-10-23T10:00:00.000Z'),
  ANSWER('demo-answer-current', 'What is your current salary?', 'R 38 000 per month', 'current salary', 'salary', 3, '2026-10-20T10:00:00.000Z'),
  ANSWER('demo-answer-licence', 'Do you have a driver licence?', 'Code B', 'driver licence', 'eligibility', 4, '2026-10-22T09:00:00.000Z'),
  ANSWER('demo-answer-relocate', 'Are you willing to relocate?', 'Yes, within South Africa.', 'willing to relocate', 'availability', 2, '2026-10-18T09:00:00.000Z'),
  ANSWER('demo-answer-qualification', 'What is your highest qualification?', 'BSc Computer Science', 'highest qualification', 'qualification', 6, '2026-10-24T09:00:00.000Z'),
  ANSWER('demo-answer-languages', 'Which languages do you speak?', 'English, Sesotho and conversational isiZulu', 'languages', 'skills', 2, '2026-10-21T09:00:00.000Z'),
  ANSWER('demo-answer-criminal', 'Are you willing to undergo a criminal record check?', 'Yes, I am willing to undergo a criminal record check.', 'criminal record check', 'compliance', 3, '2026-10-22T09:00:00.000Z'),
  ANSWER('demo-answer-credit', 'Do you consent to a credit check?', 'Yes, I consent to a credit check.', 'credit check consent', 'compliance', 2, '2026-10-20T09:00:00.000Z'),
  ANSWER('demo-answer-vehicle', 'Do you have your own vehicle?', 'Yes, I have my own vehicle and a valid licence.', 'own vehicle', 'logistics', 2, '2026-10-19T09:00:00.000Z'),
  ANSWER('demo-answer-start', 'When can you start?', 'I can start on 1 December 2026 after 30 days notice.', 'availability date', 'availability', 4, '2026-10-24T09:00:00.000Z'),
  ANSWER('demo-answer-remote', 'What is your remote work preference?', 'Hybrid in Johannesburg or fully remote within South Africa.', 'remote preference', 'preference', 1, '2026-10-17T09:00:00.000Z'),
  ANSWER('demo-answer-travel', 'Are you willing to travel for work?', 'Yes, I am willing to travel within South Africa.', 'travel willingness', 'availability', 2, '2026-10-18T09:00:00.000Z')
];

export const JOB_QUESTION_LIBRARY = Object.freeze({
  'criminal-record': {
    question: 'Are you willing to undergo a criminal record check?',
    answer: 'Yes, I am willing to undergo a criminal record check.',
    normalized: 'criminal record check'
  },
  'credit-check': {
    question: 'Do you consent to a credit check?',
    answer: 'Yes, I consent to a credit check.',
    normalized: 'credit check consent'
  },
  'medical-fitness': {
    question: 'Do you have a valid medical certificate of fitness?',
    answer: 'Yes, I can provide a current certificate of fitness.',
    normalized: 'medical certificate of fitness'
  },
  'shift-work': {
    question: 'Are you available to work shifts and weekends?',
    answer: 'Yes, I am available for shifts and weekend work.',
    normalized: 'shift work availability'
  },
  'on-call': {
    question: 'Are you available for on-call duty one week in four?',
    answer: 'Yes, I am available for a one-week-in-four on-call rotation.',
    normalized: 'on call availability'
  },
  'professional-body': {
    question: 'Are you registered with a relevant professional body?',
    answer: 'I am willing to register with the relevant professional body.',
    normalized: 'professional registration'
  },
  'site-travel': {
    question: 'Are you willing to travel to project sites?',
    answer: 'Yes, I am willing to travel to project sites within South Africa.',
    normalized: 'site travel'
  },
  'pdp': {
    question: 'Do you have a valid professional driving permit (PDP)?',
    answer: 'Yes, I have a valid PDP.',
    normalized: 'professional driving permit'
  },
  'home-internet': {
    question: 'Do you have a reliable home internet connection?',
    answer: 'Yes, I have a reliable fibre connection and a backup mobile connection.',
    normalized: 'home internet'
  },
  'underground': {
    question: 'Are you comfortable working underground?',
    answer: 'Yes, I am comfortable with underground site work after the required induction.',
    normalized: 'underground work'
  },
  'public-procurement': {
    question: 'Do you have experience with public-sector procurement?',
    answer: 'Yes, I have supported procurement documentation on a fictional public-service project.',
    normalized: 'public sector procurement'
  },
  'weekend-availability': {
    question: 'Are you available to work weekends?',
    answer: 'Yes, I am available for weekend shifts on a roster.',
    normalized: 'weekend availability'
  },
  'own-transport': {
    question: 'Do you have your own reliable transport?',
    answer: 'Yes, I have my own vehicle and a valid licence.',
    normalized: 'own transport'
  }
});

export function jobQuestions(keys = []) {
  return keys.map((key) => {
    const entry = JOB_QUESTION_LIBRARY[key];
    if (!entry) throw new Error(`Unknown demo job question: ${key}`);
    return { ...entry, key };
  });
}

export const DEMO_MEMORY = {
  version: 2,
  updatedAt: STAMP,
  insights: [
    { id: 'demo-insight-1', text: 'Prefers roles with an accessibility or public service angle.', category: 'preference', source: 'manual', createdAt: STAMP, weight: 1, lastConfirmedAt: STAMP },
    { id: 'demo-insight-2', text: 'Strongest when explaining a migration tradeoff to non-engineers.', category: 'strength', source: 'manual', createdAt: STAMP, weight: 1, lastConfirmedAt: STAMP },
    { id: 'demo-insight-3', text: 'Cut page load from 9 seconds to 2 on the reporting project.', category: 'achievement', source: 'manual', createdAt: STAMP, weight: 1, lastConfirmedAt: STAMP },
    { id: 'demo-insight-4', text: 'Prefers a short cover letter that names one concrete project.', category: 'style', source: 'manual', createdAt: STAMP, weight: 1, lastConfirmedAt: STAMP },
    { id: 'demo-insight-5', text: 'Has 30 days notice and can start on 1 December 2026.', category: 'constraint', source: 'manual', createdAt: STAMP, weight: 1, lastConfirmedAt: STAMP },
    { id: 'demo-insight-6', text: 'Open to hybrid Johannesburg or fully remote work.', category: 'preference', source: 'manual', createdAt: STAMP, weight: 1, lastConfirmedAt: STAMP },
    { id: 'demo-insight-7', text: 'Wants to stay close to public-service delivery while deepening platform skills.', category: 'motivation', source: 'manual', createdAt: STAMP, weight: 1, lastConfirmedAt: STAMP },
    { id: 'demo-insight-8', text: 'Asks for the salary band before the first interview.', category: 'style', source: 'manual', createdAt: STAMP, weight: 1, lastConfirmedAt: STAMP }
  ],
  employers: [
    { id: 'demo-employer-1', company: 'Bokamoso Bank', normalized: 'bokamoso bank', notes: ['Fictional bank. Long application form and a credit check.'], applications: 0, updatedAt: STAMP },
    { id: 'demo-employer-2', company: 'Cape Meridian Bank', normalized: 'cape meridian bank', notes: ['Fictional bank. Replied within a week to a previous application.'], applications: 0, updatedAt: STAMP },
    { id: 'demo-employer-3', company: 'Golden Acre Stores', normalized: 'golden acre stores', notes: ['Fictional retailer. Weekend roster is part of the role.'], applications: 1, updatedAt: STAMP },
    { id: 'demo-employer-4', company: 'Masego Minerals', normalized: 'masego minerals', notes: ['Fictional mining group. Medical fitness certificate required.'], applications: 1, updatedAt: STAMP },
    { id: 'demo-employer-5', company: 'Cape Route Logistics', normalized: 'cape route logistics', notes: ['Fictional logistics group. Durban and Cape Town depots.'], applications: 1, updatedAt: STAMP },
    { id: 'demo-employer-6', company: 'Thuto Education Trust', normalized: 'thuto education trust', notes: ['Simulated rejection in October: they wanted two more years of experience.'], applications: 1, updatedAt: STAMP },
    { id: 'demo-employer-7', company: 'Thuso Digital', normalized: 'thuso digital', notes: ['Fictional consultancy. Current employer.'], applications: 1, updatedAt: STAMP },
    { id: 'demo-employer-8', company: 'Zola Systems', normalized: 'zola systems', notes: ['Fictional product team. Short take-home, then two interviews.'], applications: 0, updatedAt: STAMP }
  ],
  applications: [
    { id: 'demo-application-1', jobId: 'demo-job-5', title: 'Data Analyst', company: 'Golden Acre Stores', appliedAt: '2026-10-19T09:00:00.000Z', outcome: 'applied', salarySnapshot: 'R 32 000 to R 40 000 per month', transcript: [] },
    { id: 'demo-application-2', jobId: 'demo-job-7', title: 'DevOps Engineer', company: 'Masego Minerals', appliedAt: '2026-10-14T08:30:00.000Z', outcome: 'interviewing', salarySnapshot: 'R 52 000 to R 65 000 per month', transcript: [{ at: '2026-10-24T14:00:00.000Z', text: 'Simulated first interview booked for 4 November.' }] },
    { id: 'demo-application-3', jobId: 'demo-job-17', title: 'Junior Developer', company: 'Thuto Education Trust', appliedAt: '2026-10-09T10:15:00.000Z', outcome: 'rejected', salarySnapshot: 'R 22 000 to R 28 000 per month', transcript: [{ at: '2026-10-18T09:00:00.000Z', text: 'Simulated rejection: they wanted two more years of experience.' }] },
    { id: 'demo-application-4', jobId: 'demo-job-13', title: 'Logistics Coordinator', company: 'Cape Route Logistics', appliedAt: '2026-10-23T11:00:00.000Z', outcome: 'applied', salarySnapshot: 'R 27 000 to R 35 000 per month', transcript: [] },
    { id: 'demo-application-5', jobId: 'demo-history-1', title: 'Frontend Engineer', company: 'Thuso Digital', appliedAt: '2023-02-10T09:00:00.000Z', outcome: 'hired', salarySnapshot: 'R 32 000 per month', transcript: [{ at: '2023-03-01T09:00:00.000Z', text: 'Simulated offer accepted. This is the current role.' }] }
  ],
  preferences: {
    roles: ['Frontend Engineer', 'Platform Engineer', 'Full Stack Developer'],
    sectors: ['Technology', 'Public service', 'Financial services'],
    locations: ['Johannesburg', 'Cape Town', 'Remote'],
    remote: 'hybrid',
    minSalary: 42000
  },
  salaryHistory: [
    { at: '2020-02-01', label: 'Junior Developer', company: 'Ubuntu Studios', amount: 18000, period: 'month' },
    { at: '2021-01-01', label: 'Frontend Engineer', company: 'Tshwane Civic Labs', amount: 28000, period: 'month' },
    { at: '2023-03-01', label: 'Senior Frontend Engineer', company: 'Thuso Digital', amount: 38000, period: 'month' }
  ],
  applyEvents: [
    { at: '2026-10-09T10:15:00.000Z', jobId: 'demo-job-17', company: 'Thuto Education Trust', event: 'applied' },
    { at: '2026-10-14T08:30:00.000Z', jobId: 'demo-job-7', company: 'Masego Minerals', event: 'applied' },
    { at: '2026-10-18T09:00:00.000Z', jobId: 'demo-job-17', company: 'Thuto Education Trust', event: 'rejected' },
    { at: '2026-10-19T09:00:00.000Z', jobId: 'demo-job-5', company: 'Golden Acre Stores', event: 'applied' },
    { at: '2026-10-23T11:00:00.000Z', jobId: 'demo-job-13', company: 'Cape Route Logistics', event: 'applied' },
    { at: '2026-10-24T14:00:00.000Z', jobId: 'demo-job-7', company: 'Masego Minerals', event: 'interview' }
  ],
  lastDream: null
};

export const DEMO_ACTIVITY = [
  { message: 'Demo workspace opened with fictional South African data.', type: 'system' },
  { message: 'Simulated tailoring finished for Senior Frontend Engineer at Bokamoso Bank.', type: 'agent2' },
  { message: 'Simulated tailoring finished for Full Stack Developer at Cape Meridian Bank.', type: 'agent2' },
  { message: 'Simulated application recorded for Data Analyst at Golden Acre Stores.', type: 'system' },
  { message: 'Simulated application recorded for Logistics Coordinator at Cape Route Logistics.', type: 'system' },
  { message: 'Simulated interview logged for DevOps Engineer at Masego Minerals.', type: 'system' },
  { message: 'Simulated rejection recorded for Junior Developer at Thuto Education Trust.', type: 'system' },
  { message: 'Sample documents added to the demo library.', type: 'system' },
  { message: 'Profile v2 details reviewed for the demo persona.', type: 'system' }
];
