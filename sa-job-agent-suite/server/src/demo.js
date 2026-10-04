// These pages are local, fictional fixtures, never employer portals.
export const DEMO_JOB_ID = 'synthetic-software-engineer';
export const DEMO_QUESTION = 'Which fictional project would you like to discuss?';

export function demoOrigin() {
  if (!process.env.SAJAS_DEMO_ORIGIN) return null;
  const url = new URL(process.env.SAJAS_DEMO_ORIGIN);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('The synthetic demo must use an http://127.0.0.1 origin.');
  }
  return url.origin;
}

const shell = (title, body) => `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · SA-JAS synthetic demo</title><style>
body{background:#101827;color:#e8eef8;font:16px system-ui;margin:0;padding:40px}
main{max-width:740px;margin:auto} .tag{color:#67e8f9;font-weight:700;letter-spacing:.06em}
h1{font-size:34px}p{line-height:1.6;color:#bcc9dc}label{display:block;margin:18px 0 6px}
input,select,textarea{box-sizing:border-box;width:100%;padding:12px;border-radius:8px;border:1px solid #455574;background:#19253a;color:#fff;font:inherit}
button,a.button{display:inline-block;padding:12px 18px;margin:16px 8px 0 0;background:#6366f1;color:white;border:0;border-radius:8px;font:inherit;text-decoration:none;cursor:pointer}
section{padding:24px;background:#172338;border:1px solid #354564;border-radius:12px;margin:24px 0}
</style></head><body><main><div class="tag">SYNTHETIC DEMO · LOCAL ONLY</div>${body}</main></body></html>`;

export function installDemo(app) {
  const origin = demoOrigin();
  if (!origin) return;
  let submissions = 0;
  app.get('/api/demo', (_req, res) => res.json({ synthetic: true, submissions, origin }));
  app.get('/demo/jobs/software-engineer', (_req, res) => res.send(shell('Fictional vacancy', `
    <h1>Software Engineer</h1><p>Example Studio · Johannesburg · Hybrid</p>
    <section><h2>Build useful, dependable software</h2><p>This fictional vacancy explores React, Node.js and clear testing practices. It is not a real job advert.</p>
    <a class="button" href="/demo/application">Apply now</a></section>
    <p>The copilot can open this form and help you prepare it. Its final submission button belongs to you.</p>`)));
  app.get('/demo/application', (_req, res) => res.send(shell('Application form', `
    <h1>Apply to Example Studio</h1><p>Step 1 of 2 · Fictional applicant details only. Review the filled fields, answer the missing question, then choose Continue.</p>
    <form id="application"><section>
    <label for="fullName">Full name</label><input id="fullName" name="fullName" required>
    <label for="email">Email address</label><input id="email" name="email" type="email" required>
    <label for="phone">Phone number</label><input id="phone" name="phone" type="tel">
    <label for="notice">Notice period</label><input id="notice" name="notice">
    <label for="work">Right to work in South Africa</label><select id="work" name="work"><option value="">Choose</option><option>Yes</option><option>No</option></select>
    <label for="project">${DEMO_QUESTION}</label><textarea id="project" name="project" required></textarea>
    <label for="cv">CV PDF</label><input id="cv" name="cv" type="file" accept="application/pdf" required>
    <button type="button" id="continue">Continue</button></section></form>
    <script>document.querySelector('#continue').onclick=()=>{const f=document.querySelector('#application');if(f.reportValidity()){sessionStorage.setItem('demoApplicant',JSON.stringify(Object.fromEntries(new FormData(f))));location.href='/demo/review';}};</script>`)));
  app.get('/demo/review', (_req, res) => res.send(shell('Review application', `
    <h1>Review your fictional application</h1><p>Step 2 of 2 · The copilot must leave the final button for you. Check the applicant details before proceeding.</p>
    <section><h2>Ready for your review</h2><pre id="details" style="white-space:pre-wrap"></pre>
    <button type="button" id="submit">Submit application</button><p id="result" role="status"></p></section>
    <script>const d=JSON.parse(sessionStorage.getItem('demoApplicant')||'{}');document.querySelector('#details').textContent=Object.entries(d).filter(([k])=>k!=='cv').map(([k,v])=>k+': '+v).join('\\n');
    document.querySelector('#submit').onclick=async()=>{const r=await fetch('/api/demo/submit',{method:'POST'});if(r.ok)location.href='/demo/confirmation';};</script>`)));
  app.post('/api/demo/submit', (_req, res) => { submissions++; res.json({ synthetic: true }); });
  app.get('/demo/confirmation', (_req, res) => {
    if (!submissions) return res.redirect('/demo/review');
    res.send(shell('Local receipt', '<h1>Fictional application received</h1><p>This receipt was recorded only by the local fixture. Nothing was sent to an employer. You can close the copilot window.</p>'));
  });

  // An allowlist prevents new routes from accidentally enabling live work here.
  const reads = new Set(['/api/profile', '/api/jobs', '/api/logs', '/api/status',
    '/api/documents', '/api/memory', '/api/routines', '/api/usage', '/api/health',
    '/api/application/bank', '/api/application/pending', '/api/backup']);
  app.use('/api', (req, res, next) => {
    const fullPath = '/api' + req.path;
    if (req.method === 'GET' && reads.has(fullPath)) return next();
    if (req.method === 'POST' && (fullPath === `/api/jobs/${DEMO_JOB_ID}/apply` ||
        /^\/api\/application\/pending\/[^/]+\/resolve$/.test(fullPath))) return next();
    res.status(403).json({ error: 'Synthetic demo: live searches, AI calls, profile changes and other actions are disabled. Use the fictional copilot and answer manager.' });
  });
}
