const statusEl = document.getElementById('status');
const jobEl = document.getElementById('job');
const fillEl = document.getElementById('fill');

function say(message) {
  statusEl.textContent = message;
}

async function send(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch {
    return null;
  }
}

async function main() {
  if (!globalThis.chrome?.tabs?.query) {
    say('Open the SA-JAS app to send an application first.');
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let host = '';
  try {
    host = new URL(tab?.url || '').hostname;
  } catch {
    host = '';
  }
  if (!host) {
    say('This tab has no site to fill.');
    return;
  }
  const response = await send({ type: 'sajas:matching-packet', host });
  const match = response?.match;
  if (!match) {
    say('No application is waiting for this site. Press Send to extension in the app, then open the application link.');
    return;
  }
  jobEl.textContent = `${match.title} at ${match.company}`;
  jobEl.hidden = false;
  fillEl.hidden = false;
  say(`Ready to fill ${match.site}.`);
  fillEl.addEventListener('click', async () => {
    fillEl.disabled = true;
    const result = await send({ type: 'sajas:inject', tabId: tab.id, packetId: match.packetId });
    if (result?.ok) {
      say('Filling the page. Check the review panel before you submit.');
      setTimeout(() => window.close(), 1500);
      return;
    }
    say(result?.error || 'Could not fill this page. Reload it and try again.');
    fillEl.disabled = false;
  });
}

main().catch(() => {
  say('The apply assistant could not start. Reload the extension and try again.');
});
