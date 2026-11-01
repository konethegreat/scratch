// Injected into the job page only when the person presses Fill in the popup.
// It reads its own packet from the worker, fills what it is sure about, and
// opens the review panel. Submitting is a separate, explicit click.
import { adapterForHost } from '@sajas/core/apply';
import { fillForm } from './fill.js';
import { captchaText, findSubmit, watchSuccess } from './submit.js';
import { openPanel } from './panel.js';

let current = null;

async function askPacket(packetId) {
  try {
    return await chrome.runtime.sendMessage({ type: 'sajas:packet-by-id', packetId }) || {};
  } catch {
    return { ok: false, error: 'The apply assistant could not read the waiting application.' };
  }
}

async function run(packetId) {
  const response = await askPacket(packetId);
  current?.destroy();
  if (!response.ok || !response.packet) {
    current = openPanel({ error: response.error || 'That application is no longer waiting.' });
    return;
  }
  const packet = response.packet;
  const adapter = adapterForHost(location.hostname);
  const { result, applied } = fillForm(packet, document, { adapter, host: location.hostname });
  const captcha = captchaText(document);

  current = openPanel({
    packet,
    result,
    applied,
    captcha,
    onRefill: () => run(packetId),
    onSubmit: async (confirm) => {
      if (!confirm) return { ok: false, error: 'Tick the review box first.' };
      if (captchaText(document)) {
        return { ok: false, error: 'This page has a CAPTCHA. Complete it yourself, then press Submit application again.' };
      }
      const button = findSubmit(document, adapter);
      if (!button) return { ok: false, error: 'Could not find the submit button on this page.' };
      const watch = watchSuccess(document, adapter, { timeoutMs: 8000 });
      button.click();
      const outcome = await watch;
      if (!outcome.ok) {
        return { ok: false, error: 'Could not confirm the submission. Check the page, then mark it applied in the app.' };
      }
      const submittedAt = new Date().toISOString();
      await chrome.runtime.sendMessage({
        type: 'sajas:record-result',
        result: {
          id: packet.packetId,
          packetId: packet.packetId,
          jobId: packet.job.id,
          site: location.hostname,
          submittedAt,
          confirmation: { confirmedAt: submittedAt, text: outcome.confirmation },
          fields: applied.map(({ label, value }) => ({ label, value })),
          warnings: packet.warnings || []
        }
      });
      return { ok: true, confirmation: outcome.confirmation };
    }
  });
}

if (!globalThis.__sajasPageLoaded) {
  globalThis.__sajasPageLoaded = true;
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'sajas:fill') return;
    run(message.packetId);
  });
}
