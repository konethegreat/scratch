const statusEl = document.getElementById('status');
const jobEl = document.getElementById('job');
const matchesEl = document.getElementById('matches');
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
  const matches = Array.isArray(response?.matches) ? response.matches : [];
  if (!matches.length) {
    say('No application is waiting for this site. Press Send to extension in the app, then open the application link.');
    return;
  }
  // One host can carry several roles, so let the person pick the one they are
  // looking at rather than guessing from the newest packet.
  let chosen = matches[0];
  jobEl.textContent = matches.length === 1
    ? `${chosen.title} at ${chosen.company}`
    : `${matches.length} applications are waiting for this site. Pick the one on this page.`;
  jobEl.hidden = false;
  if (matches.length > 1) {
    matchesEl.hidden = false;
    matchesEl.textContent = '';
    for (const match of matches) {
      const label = document.createElement('label');
      label.className = 'match';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'match';
      radio.value = match.packetId;
      radio.checked = match.packetId === chosen.packetId;
      radio.addEventListener('change', () => {
        if (radio.checked) chosen = match;
      });
      const text = document.createElement('span');
      text.textContent = `${match.title} at ${match.company}`;
      label.append(radio, text);
      matchesEl.append(label);
    }
  }
  fillEl.hidden = false;
  say(`Ready to fill ${chosen.site}.`);
  fillEl.addEventListener('click', async () => {
    fillEl.disabled = true;
    const result = await send({ type: 'sajas:inject', tabId: tab.id, packetId: chosen.packetId });
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
