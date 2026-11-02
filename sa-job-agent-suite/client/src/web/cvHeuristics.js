// A deliberately conservative CV reader. It only proposes what it can point to
// in the text, never guesses demographics or salary, and reports the groups it
// could not find so the review screen can say so.
export const MAX_PARSE_CHARS = 60_000;

const MAX_SHORT = 200;
const MAX_SUMMARY = 4_000;
const MAX_BULLET = 500;
const MAX_SKILLS = 30;
const MAX_ROLES = 10;
const MAX_EDUCATION = 8;
const MAX_CERTIFICATIONS = 10;
const MAX_LANGUAGES = 10;

const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const YEAR = '(?:19|20)\\d{2}';
const DATE = `(?:${MONTH}\\s*)?(?:\\d{1,2}[/-])?${YEAR}`;
const DATE_RANGE = new RegExp(`\\b(${DATE})\\s*(?:-|\\u2013|\\u2014|to|until)\\s*(${DATE}|present|current|now|date|to\\s*date)\\b`, 'i');

const SECTION_PATTERNS = [
  ['summary', /^(?:professional\s+|career\s+|personal\s+)?(?:profile|summary|objective|about(?:\s+me)?|personal\s+statement)$/i],
  ['skills', /^(?:technical\s+|core\s+|key\s+|professional\s+)?(?:skills|competencies|expertise|areas\s+of\s+expertise|tools(?:\s*(?:and|&)\s*technologies)?)$/i],
  ['languages', /^(?:languages|language\s+proficiency)$/i],
  ['experience', /^(?:work\s+|professional\s+|employment\s+|career\s+)?(?:experience|employment\s+history|work\s+history|career\s+history)$/i],
  ['education', /^(?:education|qualifications|academic\s+background|academic\s+qualifications)$/i],
  ['certifications', /^(?:certifications|certificates|professional\s+development|courses|training)$/i],
  ['references', /^references?$/i],
  ['interests', /^(?:interests|hobbies)$/i]
];

const CITY_PROVINCE = new Map(Object.entries({
  'cape town': 'Western Cape', 'stellenbosch': 'Western Cape', 'george': 'Western Cape', 'knysna': 'Western Cape',
  'paarl': 'Western Cape', 'worcester': 'Western Cape', 'somerset west': 'Western Cape', 'mossel bay': 'Western Cape',
  'johannesburg': 'Gauteng', 'joburg': 'Gauteng', 'sandton': 'Gauteng', 'midrand': 'Gauteng', 'centurion': 'Gauteng',
  'pretoria': 'Gauteng', 'tshwane': 'Gauteng', 'soweto': 'Gauteng', 'benoni': 'Gauteng', 'boksburg': 'Gauteng',
  'germiston': 'Gauteng', 'roodepoort': 'Gauteng', 'krugersdorp': 'Gauteng', 'vereeniging': 'Gauteng',
  'durban': 'KwaZulu-Natal', 'pietermaritzburg': 'KwaZulu-Natal', 'richards bay': 'KwaZulu-Natal',
  'newcastle': 'KwaZulu-Natal', 'umhlanga': 'KwaZulu-Natal', 'ballito': 'KwaZulu-Natal',
  'port elizabeth': 'Eastern Cape', 'gqeberha': 'Eastern Cape', 'east london': 'Eastern Cape',
  'mthatha': 'Eastern Cape', 'queenstown': 'Eastern Cape', 'grahamstown': 'Eastern Cape',
  'bloemfontein': 'Free State', 'welkom': 'Free State', 'bethlehem': 'Free State',
  'polokwane': 'Limpopo', 'tzaneen': 'Limpopo', 'thohoyandou': 'Limpopo', 'lephalale': 'Limpopo',
  'nelspruit': 'Mpumalanga', 'mbombela': 'Mpumalanga', 'secunda': 'Mpumalanga', 'witbank': 'Mpumalanga',
  'emalahleni': 'Mpumalanga', 'middelburg': 'Mpumalanga',
  'rustenburg': 'North West', 'mafikeng': 'North West', 'mahikeng': 'North West', 'potchefstroom': 'North West',
  'klerksdorp': 'North West',
  'kimberley': 'Northern Cape', 'upington': 'Northern Cape'
}));

const PROVINCES = [
  'Western Cape', 'Gauteng', 'KwaZulu-Natal', 'Eastern Cape', 'Free State',
  'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape'
];

const ROLE_WORDS = /\b(engineer|developer|manager|analyst|designer|officer|administrator|consultant|specialist|lead|head|director|coordinator|technician|accountant|teacher|nurse|sales|marketing|representative|assistant|supervisor|intern|student|clerk|cashier|driver|receptionist|artisan|electrician|plumber|mechanic|chef|waiter|security|cleaner|worker|foreman|architect|scientist|researcher|lecturer|professor|bookkeeper|payroll|recruiter|buyer|planner|controller|operator|teller|pharmacist|paramedic|attorney|advocate|paralegal|auditor|economist|statistician|software|systems|network|support|quality|production|logistics|warehouse|procurement|supply\s+chain|administrator|personal\s+assistant|executive|chief|founder|partner|principal)\b/i;
const COMPANY_WORDS = /\b(pty|ltd|limited|inc|llc|corp(?:oration)?|group|holdings|solutions|technologies|systems|services|consulting|company|bank|insurers?|assurance|university|college|school|hospital|clinic|municipality|department|agency|foundation|trust|ngo)\b/i;
const INSTITUTION_WORDS = /\b(university|college|school|institute|technikon|tvet|academy|polytechnic)\b/i;
const QUALIFICATION_WORDS = /\b(phd|doctorate|master(?:'s)?|mba|honours|honors|bachelor(?:'s)?|bsc|bcom|btech|\bba\b|\bdegree|national\s+diploma|advanced\s+diploma|diploma|advanced\s+certificate|higher\s+certificate|certificate|matric|national\s+senior\s+certificate|\bnsc\b|nqf\s*level\s*\d)\b/i;

const NON_NAME_WORDS = new Set([
  'to', 'whom', 'it', 'may', 'concern', 'dear', 'sir', 'madam', 'curriculum', 'vitae', 'resume', 'cv',
  'profile', 'contact', 'details', 'references', 'application', 'applications', 'position', 'advertised',
  'website', 'email', 'phone', 'address', 'available', 'south', 'africa', 'taxi', 'transport'
]);

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20
};

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /(?:\+27|0)\s?\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/;
const URL_PATTERN = /(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9-]+\.)+(?:com|co\.za|org|net|io|dev|me|africa|site|tech)(?:\/[^\s|,;)]*)?/gi;

const clean = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
const trimTo = (value, cap) => clean(value).slice(0, cap);

function linesOf(text) {
  return String(text ?? '')
    .slice(0, MAX_PARSE_CHARS)
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\t/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+$/, '').trim());
}

function sectionKey(line) {
  const candidate = clean(line.replace(/[:\s]+$/, ''));
  if (!candidate || candidate.length > 60 || /[.!?]$/.test(candidate)) return null;
  for (const [key, pattern] of SECTION_PATTERNS) {
    if (pattern.test(candidate)) return key;
  }
  return null;
}

function findSections(lines) {
  const sections = {};
  let last = null;
  lines.forEach((line, index) => {
    const key = sectionKey(line);
    if (!key) return;
    if (!sections[key]) sections[key] = { start: index, end: lines.length };
    if (last && sections[last] && sections[last].end === lines.length) sections[last].end = index;
    last = key;
  });
  return sections;
}

function sectionLines(lines, sections, key) {
  const section = sections[key];
  if (!section) return [];
  return lines.slice(section.start + 1, section.end).filter(Boolean);
}

function labelled(lines, pattern) {
  for (const line of lines) {
    const match = line.match(pattern);
    if (match && clean(match[1])) return clean(match[1]);
  }
  return '';
}

function isBullet(line) {
  return /^[-*\u2022\u00b7\u25aa]/.test(line);
}

function splitSegments(value) {
  return clean(value)
    .split(/\s*(?:\||\u2022|\u00b7|\u2013|\u2014|;|\s-\s|,\s*|\bat\s)\s*/i)
    .map((part) => clean(part).replace(/^[-*:]+|[-*:]+$/g, ''))
    .filter(Boolean);
}

function cityIn(value) {
  const text = clean(value).toLowerCase();
  if (!text) return '';
  for (const city of CITY_PROVINCE.keys()) {
    if (new RegExp(`\\b${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) {
      return city.replace(/\b\w/g, (letter) => letter.toUpperCase());
    }
  }
  return '';
}

function provinceIn(value) {
  const text = clean(value).toLowerCase();
  return PROVINCES.find((province) => text.includes(province.toLowerCase())) || '';
}

function isName(value) {
  const text = clean(value).split('|')[0];
  if (!text || text.length > 60) return false;
  if (/[0-9@/:,;()[\]{}<>]|https?:|www\./i.test(text)) return false;
  const words = text.split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  if (!words.every((word) => /^[A-Za-z][A-Za-z'.-]*$/.test(word))) return false;
  if (words.some((word) => NON_NAME_WORDS.has(word.toLowerCase()))) return false;
  if (ROLE_WORDS.test(text) || COMPANY_WORDS.test(text) || QUALIFICATION_WORDS.test(text)) return false;
  return words.some((word) => word.replace(/[^A-Za-z]/g, '').length >= 2);
}

function parseName(lines) {
  const explicit = labelled(lines, /^(?:full\s*name|candidate\s*name|name)\s*[:\-]\s*(.+)$/i);
  if (explicit && isName(explicit)) return clean(explicit.split('|')[0]);
  for (const line of lines.slice(0, 12)) {
    const candidate = clean(line.split('|')[0]);
    if (isName(candidate)) return candidate;
  }
  return '';
}

function parseHeadline(lines, sections) {
  const explicit = labelled(lines, /^(?:headline|professional\s+title|job\s+title|position|role)\s*[:\-]\s*(.+)$/i);
  if (explicit) return trimTo(explicit, MAX_SHORT);
  const header = lines.slice(0, 12).filter((line) => !sectionKey(line));
  for (const line of header) {
    for (const segment of line.split('|')) {
      const text = clean(segment);
      if (!text || text.length > 80 || /[0-9@]|https?:/i.test(text)) continue;
      if (ROLE_WORDS.test(text)) return text;
    }
  }
  return '';
}

function normaliseUrl(value) {
  const raw = clean(value).replace(/[.,;:)]+$/, '');
  if (!raw) return '';
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) return '';
    return url.href.replace(/\/$/, '');
  } catch {
    return '';
  }
}

function parseLinks(text, headerLines) {
  const urls = [...String(text).matchAll(URL_PATTERN)].map((match) => normaliseUrl(match[0])).filter(Boolean);
  const linkedIn = urls.find((url) => /(^|\.)linkedin\.com$/i.test(new URL(url).hostname));
  const github = urls.find((url) => /(^|\.)github\.com$/i.test(new URL(url).hostname));
  const labelledPortfolio = labelled(headerLines, /^(?:portfolio|website|personal\s+website|portfolio\s+or\s+website)\s*[:\-]\s*(.+)$/i);
  const portfolio = normaliseUrl(labelledPortfolio)
    || urls.find((url) => {
      const host = new URL(url).hostname;
      return !/(^|\.)linkedin\.com$/i.test(host) && !/(^|\.)github\.com$/i.test(host);
    })
    || '';
  return { linkedInUrl: linkedIn || '', githubUrl: github || '', portfolioUrl: portfolio };
}

function parseSummary(lines, sections) {
  const explicit = labelled(lines, /^(?:summary|profile|about(?:\s+me)?|objective|professional\s+summary|career\s+summary)\s*[:\-]\s*(.+)$/i);
  if (explicit) return trimTo(explicit, MAX_SUMMARY);
  return trimTo(sectionLines(lines, sections, 'summary').join(' '), MAX_SUMMARY);
}

function splitList(content) {
  const items = [];
  const seen = new Set();
  for (const raw of content) {
    const line = clean(raw).replace(/^[-*\u2022\u00b7]+\s*/, '');
    const withoutLabel = line.includes(':') ? line.slice(line.indexOf(':') + 1) : line;
    for (const part of withoutLabel.split(/\s*[,;|\u2022\u00b7/]\s*/)) {
      const item = clean(part).replace(/[.;]+$/, '');
      if (!item || item.length > 60 || /^(?:and|etc|other|others)$/i.test(item)) continue;
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  return items;
}

function parseSkills(lines, sections) {
  const inline = labelled(lines, /^(?:technical\s+|core\s+|key\s+)?skills?\s*[:\-]\s*(.+)$/i);
  const content = inline ? [inline] : sectionLines(lines, sections, 'skills');
  return splitList(content).slice(0, MAX_SKILLS);
}

function parseLanguages(lines, sections) {
  const inline = labelled(lines, /^languages?\s*[:\-]\s*(.+)$/i);
  const content = inline ? [inline] : sectionLines(lines, sections, 'languages');
  const items = [];
  const seen = new Set();
  for (const raw of content) {
    for (const part of raw.split(/\s*[,;|\u2022\u00b7/]\s*/)) {
      const item = clean(part).replace(/\s*\([^)]*\)/g, '').replace(/[.;]+$/, '');
      if (!item || item.length > 40) continue;
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  return items.slice(0, MAX_LANGUAGES);
}

function parseYears(text) {
  const match = String(text).match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s*\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:experience|exp)\b/i);
  if (!match) return 0;
  const raw = match[1].toLowerCase();
  const value = NUMBER_WORDS[raw] || Number(raw);
  return Number.isFinite(value) && value > 0 && value <= 60 ? value : 0;
}

function dateOf(value) {
  const match = String(value).match(new RegExp(YEAR));
  return match ? match[0] : '';
}

function parseWork(lines, sections) {
  const section = sections.experience;
  if (!section) return [];
  const pool = lines.slice(section.start + 1, section.end);
  const anchors = [];
  pool.forEach((line, index) => {
    const match = line.match(DATE_RANGE);
    if (match) anchors.push({ index, start: dateOf(match[1]), end: match[2], current: /present|current|now|date|to\s*date/i.test(match[2]) });
  });
  const roles = [];
  for (let index = 0; index < anchors.length && roles.length < MAX_ROLES; index += 1) {
    const anchor = anchors[index];
    const line = pool[anchor.index];
    const anchorText = clean(line.replace(DATE_RANGE, '').replace(/^[-|,;:]+|[-|,;:]+$/g, ''));
    const segments = splitSegments(anchorText);
    if (segments.length <= 1) {
      const floor = index === 0 ? -1 : anchors[index - 1].index;
      for (let back = anchor.index - 1; back > floor; back -= 1) {
        const previous = clean(pool[back]);
        if (!previous || isBullet(previous) || DATE_RANGE.test(previous)) continue;
        segments.unshift(...splitSegments(previous));
        if (splitSegments(previous).length > 1) break;
        if (segments.length >= 3) break;
      }
    }
    let title = '';
    let company = '';
    let location = '';
    for (const segment of segments) {
      const city = cityIn(segment);
      if (city && !location) { location = city; continue; }
      if (/^remote$/i.test(segment) && !location) { location = 'Remote'; continue; }
      if (!company && COMPANY_WORDS.test(segment)) { company = segment; continue; }
      if (!title && ROLE_WORDS.test(segment)) { title = segment; continue; }
      if (!company) company = segment;
      else if (!title) title = segment;
      else if (!location) location = segment;
    }
    if (!location) {
      const next = clean(pool[anchor.index + 1] || '');
      const city = cityIn(next);
      if (city) location = city;
      else if (/^remote$/i.test(next)) location = 'Remote';
    }
    if (!title && !company) continue;

    const bullets = [];
    const nextAnchor = index + 1 < anchors.length ? anchors[index + 1].index : pool.length;
    for (let cursor = anchor.index + 1; cursor < nextAnchor && bullets.length < 10; cursor += 1) {
      const text = clean(pool[cursor]);
      if (!text) continue;
      if (!isBullet(text) && (ROLE_WORDS.test(text) || COMPANY_WORDS.test(text))) break;
      if (isBullet(text) || text.length > 25) bullets.push(trimTo(text.replace(/^[-*\u2022\u00b7]+\s*/, ''), MAX_BULLET));
    }

    roles.push({
      company: trimTo(company, MAX_SHORT),
      title: trimTo(title, MAX_SHORT),
      start: anchor.start,
      end: anchor.current ? '' : dateOf(anchor.end),
      current: anchor.current,
      location: trimTo(location, MAX_SHORT),
      bullets
    });
  }
  return roles;
}

function qualificationOf(segment) {
  const match = segment.match(/((?:national\s+senior\s+certificate|national\s+diploma|advanced\s+diploma|advanced\s+certificate|higher\s+certificate|bachelor(?:'s)?(?:\s+of\s+[a-z]+)?|master(?:'s)?(?:\s+of\s+[a-z]+)?|doctorate|phd|honours|honors|mba|bsc|bcom|btech|diploma|certificate|matric|nsc|nqf\s*level\s*\d|\bdegree|\bba\b)\b[^,;|]*)/i);
  if (!match) return null;
  const text = clean(match[1]);
  const short = text.match(/^(bsc|bcom|btech|ba|mba|phd|nsc|matric)\b(.*)$/i);
  if (short) return { qualification: short[1].toUpperCase() === 'BA' ? 'BA' : short[1], field: clean(short[2].replace(/^in\s+/i, '')) };
  const inMatch = text.match(/^(.+?)\s+in\s+(.+)$/i);
  if (inMatch) return { qualification: clean(inMatch[1]), field: clean(inMatch[2]) };
  return { qualification: text, field: '' };
}

function parseEducation(lines, sections) {
  const entries = [];
  for (const raw of sectionLines(lines, sections, 'education')) {
    const line = clean(raw);
    if (!line || isBullet(line) || line.length > 240) continue;
    const yearMatch = [...line.matchAll(/\b(?:19|20)\d{2}\b/g)].pop();
    if (!yearMatch && !QUALIFICATION_WORDS.test(line)) continue;
    const withoutYear = clean(line.replace(/\b(?:19|20)\d{2}\b/g, '').replace(/[,;|]+$/, ''));
    const segments = splitSegments(withoutYear);
    let institution = segments.find((segment) => INSTITUTION_WORDS.test(segment)) || '';
    const qualificationSegment = segments.find((segment) => QUALIFICATION_WORDS.test(segment)) || '';
    const qualification = qualificationOf(qualificationSegment);
    const field = qualification?.field
      || clean(line.match(/\bin\s+([^,;|]+)/i)?.[1] || '');
    const result = clean(line.match(/(distinction|cum\s+laude|first\s+class|second\s+class|gpa[^,;|]*|\d{1,3}(?:\.\d+)?\s*%)/i)?.[1] || '');
    if (!qualification && !institution) continue;
    if (!institution && segments.length && !QUALIFICATION_WORDS.test(segments[0])) institution = segments[0];
    entries.push({
      institution: trimTo(institution, MAX_SHORT),
      qualification: trimTo(qualification?.qualification || '', MAX_SHORT),
      field: trimTo(field, MAX_SHORT),
      year: yearMatch ? yearMatch[0] : '',
      result: trimTo(result, MAX_SHORT)
    });
    if (entries.length >= MAX_EDUCATION) break;
  }
  return entries;
}

const QUALIFICATION_RANK = [
  [/phd|doctorate/i, 7],
  [/master|mba/i, 6],
  [/honours|honors/i, 5],
  [/bachelor|bsc|bcom|btech|\bba\b|degree/i, 4],
  [/national\s+diploma|diploma|advanced\s+certificate|higher\s+certificate/i, 3],
  [/certificate|matric|national\s+senior\s+certificate|\bnsc\b|nqf/i, 2]
];

function highestQualification(education) {
  let best = null;
  let bestRank = 0;
  for (const entry of education) {
    const text = `${entry.qualification} ${entry.field}`;
    const rank = QUALIFICATION_RANK.reduce((value, [pattern, score]) => (pattern.test(text) ? Math.max(value, score) : value), 0);
    if (rank > bestRank) { best = entry; bestRank = rank; }
  }
  if (!best) return '';
  return trimTo(`${best.qualification}${best.field ? ` ${best.field}` : ''}`, MAX_SHORT);
}

function parseCertifications(lines, sections) {
  const entries = [];
  for (const raw of sectionLines(lines, sections, 'certifications')) {
    const line = clean(raw.replace(/^[-*\u2022\u00b7]+\s*/, ''));
    if (!line || line.length > 200) continue;
    const yearMatch = [...line.matchAll(/\b(?:19|20)\d{2}\b/g)].pop();
    const withoutYear = clean(line.replace(/\b(?:19|20)\d{2}\b/g, '').replace(/[,;|]+$/, ''));
    const segments = splitSegments(withoutYear);
    if (!segments.length) continue;
    const name = segments[0];
    const issuer = segments.length > 1 ? segments[segments.length - 1] : '';
    entries.push({ name: trimTo(name, MAX_SHORT), issuer: trimTo(issuer, MAX_SHORT), year: yearMatch ? yearMatch[0] : '' });
    if (entries.length >= MAX_CERTIFICATIONS) break;
  }
  return entries;
}

function parseCity(lines, sections, labelledCity) {
  const explicitProvince = labelled(lines, /^(?:province|state)\s*[:\-]\s*(.+)$/i);
  let province = provinceIn(explicitProvince);
  if (labelledCity) {
    const city = cityIn(labelledCity) || (labelledCity.length <= 40 && !/[0-9]/.test(labelledCity) ? labelledCity : '');
    if (city) return { city, province: province || CITY_PROVINCE.get(city.toLowerCase()) || '' };
  }
  const firstSection = Math.min(...Object.values(sections).map((section) => section.start), lines.length);
  const header = lines.slice(0, Math.min(firstSection, 25));
  for (const line of header) {
    const city = cityIn(line);
    if (city) return { city, province: province || CITY_PROVINCE.get(city.toLowerCase()) || '' };
  }
  if (!province) province = header.map(provinceIn).find(Boolean) || '';
  return { city: '', province };
}

export function parseCvText(rawText) {
  const lines = linesOf(rawText);
  const text = lines.join('\n');
  const sections = findSections(lines);
  const fullName = parseName(lines);
  const headline = parseHeadline(lines, sections);
  const email = text.match(EMAIL)?.[0] || '';
  const phone = clean(text.match(PHONE)?.[0] || '');
  const links = parseLinks(text, lines.slice(0, 25));
  const summary = parseSummary(lines, sections);
  const skills = parseSkills(lines, sections);
  const languages = parseLanguages(lines, sections);
  const workHistory = parseWork(lines, sections);
  const education = parseEducation(lines, sections);
  const certifications = parseCertifications(lines, sections);
  const city = parseCity(lines, sections, labelled(lines, /^(?:city|town|location|based\s+in)\s*[:\-]\s*(.+)$/i));
  const preferredName = labelled(lines, /^(?:preferred\s+name|known\s+as|goes\s+by)\s*[:\-]\s*(.+)$/i);

  const proposals = {
    fullName,
    preferredName: trimTo(preferredName, MAX_SHORT),
    email,
    phone,
    linkedInUrl: links.linkedInUrl,
    portfolioUrl: links.portfolioUrl,
    githubUrl: links.githubUrl,
    city: city.city,
    province: city.province,
    headline,
    summary,
    skills,
    languages,
    workHistory,
    education,
    certifications,
    yearsExperience: parseYears(text),
    highestQualification: highestQualification(education)
  };

  const unread = [];
  if (!proposals.fullName) unread.push('name');
  if (!proposals.email) unread.push('email');
  if (!proposals.phone) unread.push('phone');
  if (!proposals.headline) unread.push('headline');
  if (!proposals.summary) unread.push('summary');
  if (!proposals.city && !proposals.province) unread.push('city');
  if (!proposals.skills.length) unread.push('skills');
  if (!proposals.languages.length) unread.push('languages');
  if (!proposals.workHistory.length) unread.push('workHistory');
  if (!proposals.education.length) unread.push('education');
  if (!proposals.certifications.length) unread.push('certifications');

  return { proposals, unread };
}
