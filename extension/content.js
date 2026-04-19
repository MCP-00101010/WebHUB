'use strict';

// Only activate on pages that identify themselves as Morpheus WebHub.
const IS_MORPHEUS = !!document.querySelector('meta[name="morpheus-webhub"]');

if (IS_MORPHEUS) {
  // Register with the background, sending our URL so it can derive the save path.
  browser.runtime.sendMessage({ type: 'MW_REGISTER', pageUrl: window.location.href });

  // Receive tab data pushed from the popup via background.
  browser.runtime.onMessage.addListener(msg => {
    if (msg.type === 'MW_RECEIVE_TAB') {
      window.postMessage({ _mw: true, _push: true, type: 'MW_RECEIVE_TAB', url: msg.url, title: msg.title }, '*');
    }
  });
}

// ---------------------------------------------------------------------------
// Bridge: relay postMessage requests from the page → background → page.
// ---------------------------------------------------------------------------

window.addEventListener('message', async e => {
  if (!e.data?._mw || e.source !== window || !e.data._req) return;

  const { id, type } = e.data;

  function reply(data) {
    window.postMessage({ _mw: true, _res: true, id, ...data }, '*');
  }

  try {
    // MW_PING is answered directly — no background round-trip needed.
    if (type === 'MW_PING') {
      reply({ ok: true, version: '1.0' });
      return;
    }

    // Everything else (MW_SAVE, MW_LOAD, MW_OPEN_FILE_PICKER) goes to background.
    const res = await browser.runtime.sendMessage({ type, ...e.data });
    reply(res);
  } catch (err) {
    reply({ ok: false, error: err.message });
  }
});
