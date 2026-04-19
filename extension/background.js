'use strict';

// Tab ID of the currently open Morpheus WebHub page (null if not open).
let morpheusTabId = null;

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {

    // Content script calls this when a morpheus page loads.
    case 'MW_REGISTER':
      morpheusTabId = sender.tab.id;
      sendResponse({ ok: true });
      break;

    // Popup asks whether morpheus is currently open.
    case 'MW_GET_STATUS':
      sendResponse({ ok: true, morpheusOpen: morpheusTabId !== null });
      break;

    // Popup sends the current tab to the morpheus inbox.
    case 'MW_SEND_TAB':
      if (morpheusTabId === null) {
        sendResponse({ ok: false, error: 'Morpheus WebHub is not open' });
        break;
      }
      browser.tabs.sendMessage(morpheusTabId, {
        type: 'MW_RECEIVE_TAB',
        url: msg.url,
        title: msg.title
      })
        .then(() => sendResponse({ ok: true }))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true; // keep channel open for async response

    default:
      break;
  }
});

// Clear the registered tab when it closes.
browser.tabs.onRemoved.addListener(tabId => {
  if (tabId === morpheusTabId) morpheusTabId = null;
});
