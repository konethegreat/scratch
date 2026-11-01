// Twenty fictional South African employers. Every host uses .test, every
// vacancy is invented, and the salary bands exist only to exercise the UI.
import { jobQuestions, DEMO_PERSONA } from './persona.js';

export function salaryBand(min, max) {
  const format = (value) => `R ${String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
  return `${format(min)} to ${format(max)} per month`;
}

export function tailoredDocuments(job = {}) {
  const title = String(job.title || 'Developer').trim();
  const company = String(job.company || 'Fictional Employer').trim();
  return {
    tailoredCvText: `# ${DEMO_PERSONA.fullName}

Simulated tailored CV for the ${title} role at ${company}.

## Summary

Frontend and platform engineer with five years of experience building accessible React interfaces and the Node services behind them.

## Selected work

- Built an accessibility dashboard that audits colour contrast and keyboard paths for a fictional public service portal.
- Led a three-person team that moved a reporting tool to React and Node, cutting page load from 9 seconds to 2.
- Wrote the automated checks that kept the dashboard honest and taught two teammates to maintain them.
- Designed the PostgreSQL schema behind a fictional municipal service directory.

## Why this role

The ${title} role at ${company} matches the accessibility, platform and reporting work in this fictional CV. I am based in Johannesburg, available after 30 days notice, and open to hybrid or remote work in South Africa.`,
    tailoredCoverLetterText: `# Cover letter

Dear ${company} team,

I am applying for the ${title} role. In this simulated letter I would point to the accessibility dashboard I built, the reporting migration I led and the checks that kept both honest.

I am based in Johannesburg, available after 30 days notice, and open to hybrid or remote work.

Thank you for considering this fictional application.

${DEMO_PERSONA.fullName}`
  };
}

const ROWS = [
  ['Senior Frontend Engineer', 'Bokamoso Bank', 'Johannesburg, Gauteng', 'Gauteng', 'Banking', 55000, 70000, 'tailored', 93, '2026-10-20', '2026-10-21', ['criminal-record', 'credit-check', 'on-call'], true, true, ''],
  ['Full Stack Developer', 'Cape Meridian Bank', 'Cape Town, Western Cape', 'Western Cape', 'Banking', 48000, 62000, 'tailored', 89, '2026-10-22', '2026-10-22', ['criminal-record', 'credit-check', 'home-internet'], true, false, ''],
  ['Claims Systems Analyst', 'Ubuntu Mutual', 'Pretoria, Gauteng', 'Gauteng', 'Banking', 42000, 54000, 'found', 72, '2026-10-25', '2026-10-25', ['criminal-record', 'credit-check'], false, false, ''],
  ['Platform Engineer', 'Kalahari Retail Co', 'Remote, South Africa', 'Remote', 'Retail', 52000, 66000, 'found', 85, '2026-10-18', '2026-10-18', ['on-call', 'home-internet'], false, false, ''],
  ['Data Analyst', 'Golden Acre Stores', 'Stellenbosch, Western Cape', 'Western Cape', 'Retail', 32000, 40000, 'applied', 76, '2026-10-16', '2026-10-16', ['weekend-availability', 'own-transport'], false, false, '2026-10-19T09:00:00.000Z'],
  ['Business Analyst', 'Mzansi Market', 'Durban, KwaZulu-Natal', 'KwaZulu-Natal', 'Retail', 35000, 45000, 'found', 70, '2026-10-23', '2026-10-23', ['weekend-availability', 'own-transport'], false, false, ''],
  ['DevOps Engineer', 'Masego Minerals', 'Rustenburg, North West', 'North West', 'Mining', 52000, 65000, 'interviewing', 87, '2026-10-12', '2026-10-12', ['medical-fitness', 'shift-work', 'underground'], false, false, '2026-10-14T08:30:00.000Z'],
  ['Mine Systems Analyst', 'Red Sands Mining', 'Kathu, Northern Cape', 'Northern Cape', 'Mining', 46000, 58000, 'found', 78, '2026-10-24', '2026-10-24', ['medical-fitness', 'shift-work', 'underground'], false, false, ''],
  ['Production Systems Coordinator', 'Highveld Coal Partners', 'eMalahleni, Mpumalanga', 'Mpumalanga', 'Mining', 40000, 52000, 'found', 68, '2026-10-21', '2026-10-21', ['medical-fitness', 'shift-work'], false, false, ''],
  ['GIS Technician', 'Limpopo Roads Agency', 'Polokwane, Limpopo', 'Limpopo', 'Public works', 28000, 36000, 'found', 66, '2026-10-19', '2026-10-19', ['professional-body', 'site-travel'], false, false, ''],
  ['Operations Coordinator', 'Amandla Public Works', 'East London, Eastern Cape', 'Eastern Cape', 'Public works', 25000, 32000, 'found', 61, '2026-10-17', '2026-10-17', ['public-procurement', 'site-travel'], false, false, ''],
  ['Support Engineer', 'Ndlovu Freight', 'Durban, KwaZulu-Natal', 'KwaZulu-Natal', 'Logistics', 26000, 34000, 'found', 74, '2026-10-20', '2026-10-20', ['shift-work', 'own-transport'], false, false, ''],
  ['Logistics Coordinator', 'Cape Route Logistics', 'Cape Town, Western Cape', 'Western Cape', 'Logistics', 27000, 35000, 'applied', 71, '2026-10-21', '2026-10-21', ['pdp', 'shift-work', 'own-transport'], false, false, '2026-10-23T11:00:00.000Z'],
  ['Data Engineer', 'Highveld Haulage', 'Johannesburg, Gauteng', 'Gauteng', 'Logistics', 45000, 58000, 'found', 82, '2026-10-23', '2026-10-23', ['shift-work', 'site-travel'], false, false, ''],
  ['Monitoring and Evaluation Officer', 'Thusanang Foundation', 'Johannesburg, Gauteng', 'Gauteng', 'NGO', 30000, 38000, 'found', 69, '2026-10-18', '2026-10-18', ['site-travel', 'own-transport'], false, false, ''],
  ['Mobile Developer', 'Siyabonga Health Trust', 'Cape Town, Western Cape', 'Western Cape', 'NGO', 40000, 50000, 'found', 77, '2026-10-22', '2026-10-22', ['home-internet', 'site-travel'], false, false, ''],
  ['Junior Developer', 'Thuto Education Trust', 'Pretoria, Gauteng', 'Gauteng', 'NGO', 22000, 28000, 'rejected', 58, '2026-10-08', '2026-10-08', ['home-internet', 'own-transport'], false, false, '2026-10-09T10:15:00.000Z'],
  ['Backend Engineer', 'Zola Systems', 'Johannesburg, Gauteng', 'Gauteng', 'Technology', 50000, 65000, 'tailored', 90, '2026-10-16', '2026-10-16', ['on-call', 'home-internet'], true, false, ''],
  ['Cloud Engineer', 'Kalahari Cloud', 'Remote, South Africa', 'Remote', 'Technology', 54000, 68000, 'tailored', 88, '2026-10-21', '2026-10-21', ['on-call', 'home-internet'], true, false, ''],
  ['Frontend Engineer', 'Lerato Labs', 'Cape Town, Western Cape', 'Western Cape', 'Technology', 42000, 52000, 'tailored', 86, '2026-10-19', '2026-10-19', ['home-internet', 'on-call'], true, false, '']
];

const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const host = (value) => slug(value).replace(/-/g, '');

const FOCUS = {
  'Senior Frontend Engineer': 'Lead the frontend for a fictional civic portal, set the accessibility bar and mentor two mid-level engineers.',
  'Full Stack Developer': 'Build fictional payment dashboards and the Node services behind them, with a weekly accessibility pass.',
  'Claims Systems Analyst': 'Turn fictional claims data into clear reports and help the operations team trust the numbers.',
  'Platform Engineer': 'Keep a fictional storefront platform fast and observable, from the build pipeline to the alerts.',
  'Data Analyst': 'Read fictional store data and turn it into weekly trading reports for the buying team.',
  'Business Analyst': 'Map fictional store processes and write the requirements the delivery team builds against.',
  'DevOps Engineer': 'Run fictional mining systems with infrastructure as code, short on-call rotations and monthly recovery drills.',
  'Mine Systems Analyst': 'Support the fictional systems used by a remote mining operation and keep site data flowing.',
  'Production Systems Coordinator': 'Coordinate the fictional production systems that keep a coal operation reporting cleanly.',
  'GIS Technician': 'Maintain fictional road and asset layers for a provincial public works programme.',
  'Operations Coordinator': 'Coordinate fictional maintenance requests and procurement paperwork across two depots.',
  'Support Engineer': 'Help fictional depots use a tracking tool, triage tickets and write short guides.',
  'Logistics Coordinator': 'Plan fictional deliveries across the Western Cape and keep the depot schedule honest.',
  'Data Engineer': 'Move fictional depot data into a warehouse the reporting team can trust, and catch broken feeds early.',
  'Monitoring and Evaluation Officer': 'Turn fictional programme data into evidence that a community foundation can act on.',
  'Mobile Developer': 'Build a fictional clinic booking app for web and mobile, with offline-first screens.',
  'Junior Developer': 'A fictional first role on an education platform, with small React tickets and a mentor for six months.',
  'Backend Engineer': 'Build the fictional services behind a product team: Node, PostgreSQL and a queue that never loses a job.',
  'Cloud Engineer': 'Look after fictional cloud accounts with cost reviews, infrastructure as code and a monthly disaster-recovery drill.',
  'Frontend Engineer': 'Build fictional product interfaces in React and TypeScript, with a strong review culture.'
};

export const DEMO_JOBS = ROWS.map((row, index) => {
  const [title, company, location, province, sector, min, max, status, matchScore, datePosted, dateAdded, questionKeys, tailored, applyDemo, appliedAt] = row;
  const base = {
    id: `demo-job-${index + 1}`,
    title,
    company,
    location,
    province,
    sector,
    salaryBand: salaryBand(min, max),
    description: `${FOCUS[title]} This is a fictional vacancy used only in the simulation.`,
    applyUrl: `https://${host(company)}.test/careers/${slug(title)}`,
    datePosted,
    dateAdded,
    matchScore,
    status,
    notes: applyDemo ? 'Fictional role used for the simulated portal walkthrough.' : '',
    source: company,
    questions: jobQuestions(questionKeys),
    tailoredCvText: '',
    tailoredCoverLetterText: '',
    ...(appliedAt ? { appliedAt } : {}),
    ...(applyDemo ? { applyDemo: true } : {})
  };
  return tailored ? { ...base, ...tailoredDocuments({ title, company }) } : base;
});

const hunter = (title, company, location, feed, matchScore, datePosted) => ({
  title,
  company,
  location,
  description: `${FOCUS[title] || 'A fictional role on a simulated board.'} This posting exists only in the demo.`,
  applyUrl: `https://${host(company)}.test/feeds/${slug(title)}`,
  source: 'Simulated board',
  feed,
  matchScore,
  datePosted
});

export const DEMO_HUNTER_JOBS = [
  hunter('Data Engineer', 'Red Sands Mining', 'Kathu, Northern Cape', 'remotive', 84, '2026-10-27'),
  hunter('Cloud Engineer', 'Ubuntu Mutual', 'Pretoria, Gauteng', 'arbeitnow', 81, '2026-10-27'),
  hunter('IT Support Officer', 'Ndlovu Freight', 'Durban, KwaZulu-Natal', 'jobicy', 73, '2026-10-26'),
  hunter('QA Engineer', 'Siyabonga Health Trust', 'Cape Town, Western Cape', 'remotive', 79, '2026-10-26'),
  hunter('Business Intelligence Analyst', 'Mzansi Market', 'Durban, KwaZulu-Natal', 'arbeitnow', 76, '2026-10-26'),
  hunter('Junior Developer', 'Thusanang Foundation', 'Johannesburg, Gauteng', 'jobicy', 68, '2026-10-25'),
  hunter('Network Engineer', 'Highveld Coal Partners', 'eMalahleni, Mpumalanga', 'remotive', 72, '2026-10-25'),
  hunter('Frontend Developer', 'Kalahari Cloud', 'Remote, South Africa', 'arbeitnow', 88, '2026-10-27'),
  hunter('Data Analyst', 'Limpopo Roads Agency', 'Polokwane, Limpopo', 'jobicy', 70, '2026-10-24'),
  hunter('Frontend Developer', 'Northwind Labs', 'Remote, United States', 'arbeitnow', 66, '2026-10-26'),
  hunter('Product Designer', 'Fjord Commerce', 'Berlin, Germany', 'remotive', 64, '2026-10-25'),
  hunter('Senior Frontend Engineer', 'Bokamoso Bank', 'Johannesburg, Gauteng', 'remotive', 92, '2026-10-24'),
  hunter('Data Analyst', 'Golden Acre Stores', 'Stellenbosch, Western Cape', 'jobicy', 75, '2026-10-23'),
  hunter('Backend Engineer', 'Zola Systems', 'Johannesburg, Gauteng', 'arbeitnow', 86, '2026-10-22')
];

function feedJob(source, title, company, location, applyUrl, description) {
  return {
    source,
    sourceId: `${source}-${slug(title)}-${slug(company)}`,
    title,
    company,
    location,
    description,
    applyUrl,
    datePosted: '2026-10-26',
    remote: /remote/i.test(location),
    tags: ['simulated'],
    salaryText: '',
    matchScore: 72
  };
}

export const DEMO_FEEDS = {
  remotive: [
    feedJob('remotive', 'Frontend Developer', 'Kalahari Cloud', 'Remote, South Africa', 'https://kalaharicloud.test/feeds/frontend-developer', 'Build fictional product interfaces from anywhere in South Africa.'),
    feedJob('remotive', 'Data Engineer', 'Highveld Haulage', 'Johannesburg, Gauteng', 'https://highveldhaulage.test/feeds/data-engineer', 'Model fictional depot data for a reporting team.'),
    feedJob('remotive', 'Product Designer', 'Fjord Commerce', 'Berlin, Germany', 'https://fjordcommerce.test/feeds/product-designer', 'A fictional design role in Berlin.'),
    feedJob('remotive', 'Junior Developer', 'Thusanang Foundation', 'Johannesburg, Gauteng', 'https://thusanangfoundation.test/feeds/junior-developer', 'A fictional first role at a community foundation.')
  ],
  arbeitnow: [
    feedJob('arbeitnow', 'Platform Engineer', 'Kalahari Retail Co', 'Remote, South Africa', 'https://kalahariretailco.test/feeds/platform-engineer', 'Keep a fictional storefront observable.'),
    feedJob('arbeitnow', 'DevOps Engineer', 'Masego Minerals', 'Rustenburg, North West', 'https://masegominerals.test/feeds/devops-engineer', 'Run fictional mining systems.'),
    feedJob('arbeitnow', 'Frontend Developer', 'Northwind Labs', 'Remote, United States', 'https://northwindlabs.test/feeds/frontend-developer', 'A fictional United States role for the SA filter.'),
    feedJob('arbeitnow', 'Backend Engineer', 'Zola Systems', 'Johannesburg, Gauteng', 'https://zolasystems.test/feeds/backend-engineer', 'Build fictional product services.')
  ],
  jobicy: [
    feedJob('jobicy', 'Full Stack Developer', 'Cape Meridian Bank', 'Cape Town, Western Cape', 'https://capemeridianbank.test/feeds/full-stack-developer', 'Build fictional payment dashboards.'),
    feedJob('jobicy', 'Data Analyst', 'Limpopo Roads Agency', 'Polokwane, Limpopo', 'https://limpoporoadsagency.test/feeds/data-analyst', 'Read fictional road maintenance data.'),
    feedJob('jobicy', 'QA Engineer', 'Siyabonga Health Trust', 'Cape Town, Western Cape', 'https://siyabongahealthtrust.test/feeds/qa-engineer', 'Test a fictional clinic booking flow.'),
    feedJob('jobicy', 'Business Analyst', 'Mzansi Market', 'Durban, KwaZulu-Natal', 'https://mzansimarket.test/feeds/business-analyst', 'Map fictional retail processes.')
  ]
};
