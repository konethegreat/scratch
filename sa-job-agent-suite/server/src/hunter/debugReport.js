// Pure helpers for scripts/hunter-debug.mjs so the CLI's decisions are testable
// without a browser or a network.
export const DEBUG_USAGE = 'node scripts/hunter-debug.mjs --source pnet --keyword developer [--location Johannesburg] [--headful] [--save] [--html path] [--capture path]';

export function parseDebugArgs(argv = []) {
  const out = {
    source: '', keyword: 'developer', location: null, headful: false,
    save: false, html: null, capture: null, help: false, error: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => { i += 1; return argv[i] ?? ''; };
    if (arg === '--source') out.source = next();
    else if (arg === '--keyword') out.keyword = next() || 'developer';
    else if (arg === '--location') out.location = next() || null;
    else if (arg === '--headful') out.headful = true;
    else if (arg === '--save') out.save = true;
    else if (arg === '--html') out.html = next();
    else if (arg === '--capture') out.capture = next();
    else if (arg === '--help' || arg === '-h') out.help = true;
    else out.error = `Unknown argument: ${arg}`;
  }
  if (!out.help && !out.source) out.error = out.error || 'Missing --source.';
  if (!out.help && out.capture && !out.html) out.error = out.error || '--capture needs --html.';
  return out;
}

export function formatDebugReport({
  source, url, title, httpStatus, blocked, blockKind, error,
  strategy, strategies = {}, rejectReasons = [], firstItem = null, malformed = 0, skipped = 0
} = {}) {
  const lines = [];
  lines.push(`Source: ${source?.name || source?.id || 'unknown'}`);
  lines.push(`URL: ${url || '(none)'}`);
  lines.push(`HTTP: ${httpStatus ?? '(none)'}  Title: ${title || '(none)'}`);
  lines.push(`Blocked: ${blocked ? `yes (${blockKind || 'unknown'})` : 'no'}`);
  if (error) lines.push(`Error: ${error}`);
  for (const [name, entry] of Object.entries(strategies)) {
    lines.push(`  ${name}: raw ${entry?.raw || 0}, valid ${entry?.valid || 0}, rejected ${entry?.rejected || 0}${entry?.error ? ` (error: ${entry.error})` : ''}`);
  }
  lines.push(`Winner: ${strategy || 'none'}`);
  if (rejectReasons.length) lines.push(`Rejections: ${rejectReasons.join('; ')}`);
  if (malformed || skipped) lines.push(`Capture: ${malformed} malformed payload(s), ${skipped} skipped response(s)`);
  if (firstItem) {
    lines.push(`First valid row: ${firstItem.title} | ${firstItem.company || '-'} | ${firstItem.location || '-'} | ${firstItem.applyUrl || '-'}`);
  }
  return lines.join('\n');
}
