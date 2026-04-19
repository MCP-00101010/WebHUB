'use strict';

// Only activate on pages that identify themselves as Morpheus WebHub.
const IS_MORPHEUS = !!document.querySelector('meta[name="morpheus-webhub"]');

if (IS_MORPHEUS) {
  // Tell the background script which tab we're in.
  browser.runtime.sendMessage({ type: 'MW_REGISTER' });

  // Receive tab data sent from the popup via background → content → page.
  browser.runtime.onMessage.addListener(msg => {
    if (msg.type === 'MW_RECEIVE_TAB') {
      window.postMessage({ _mw: true, _push: true, type: 'MW_RECEIVE_TAB', url: msg.url, title: msg.title }, '*');
    }
  });
}

// Bridge: relay postMessage requests from the page to extension APIs and back.
window.addEventListener('message', async e => {
  if (e.source !== window || !e.data?._mw || !e.data._req) return;

  const { id, type } = e.data;

  function reply(data) {
    window.postMessage({ _mw: true, _res: true, id, ...data }, '*');
  }

  try {
    switch (type) {
      case 'MW_PING':
        reply({ ok: true, version: '1.0' });
        break;

      case 'MW_SAVE': {
        await browser.storage.local.set({ morpheusState: e.data.json });
        reply({ ok: true });
        break;
      }

      case 'MW_LOAD': {
        const result = await browser.storage.local.get('morpheusState');
        reply({ ok: true, json: result.morpheusState || null });
        break;
      }

      default:
        break;
    }
  } catch (err) {
    reply({ ok: false, error: err.message });
  }
});
