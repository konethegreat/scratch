/**
 * Synthetic job pages for tests. No real employer, no real person, no network.
 *
 * Every page records the label of each control that is clicked in
 * window.__clicks and cancels the click's default action (links do not
 * navigate, forms do not submit), so a test can read back exactly what the
 * copilot pressed. Nothing here can submit anything anywhere.
 */
export const RECORDER = `<script>
  window.__clicks = [];
  document.addEventListener('click', (e) => {
    const el = e.target.closest('button, a, input[type=button], input[type=submit], [role=button]');
    if (!el) return;
    window.__clicks.push((el.innerText || el.value || el.getAttribute('aria-label') || '').trim());
    e.preventDefault();
  }, true);
</script>`;

/** Wraps a body in a document that carries the click recorder. */
export const page = (title, body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}${RECORDER}</body></html>`;

/** A job listing: reading material, a harmless button and one link to the application. */
export function listingPage({ applyLabel = 'Apply now' } = {}) {
  return page('Senior Developer at Example Pty Ltd', `
    <h1>Senior Developer</h1>
    <p>Example Pty Ltd, Johannesburg. Hybrid. Synthetic listing for tests.</p>
    <button type="button">Save job</button>
    <a href="#apply">${applyLabel}</a>`);
}

/**
 * An application form with the usual fields (name, email, phone, cover letter,
 * CV upload) already filled in with made-up values, a Back button, an optional
 * step-forward button, and a final button labelled `finalLabel`.
 */
export function formPage({ finalLabel = 'Submit application', stepLabel = null } = {}) {
  return page('Apply - Senior Developer', `
    <h1>Apply for Senior Developer</h1>
    <form onsubmit="return false">
      <label>Full name <input name="fullname" value="Test Candidate"></label>
      <label>Email <input type="email" name="email" value="test.candidate@example.test"></label>
      <label>Phone <input name="phone" value="0000000000"></label>
      <label>Cover letter <textarea name="cover">Synthetic text for tests.</textarea></label>
      <input type="file" name="cv">
      <button type="button">Back</button>
      ${stepLabel ? `<button type="button">${stepLabel}</button>` : ''}
      <button type="submit">${finalLabel}</button>
    </form>`);
}

/** A review step: no inputs at all, just a summary and the final button. */
export function reviewPage({ finalLabel = 'Apply' } = {}) {
  return page('Review your application', `
    <h1>Review your application</h1>
    <p>Test Candidate - Senior Developer - Example Pty Ltd</p>
    <button type="button">Edit</button>
    <button type="button">${finalLabel}</button>`);
}