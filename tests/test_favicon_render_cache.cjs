const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadFaviconFunctions(options = {}) {
  const requests = [];
  const nativeRequests = [];

  class MockImage {
    set src(value) {
      this._src = value;
      requests.push(value);
      queueMicrotask(() => options.failAll ? this.onerror?.() : this.onload?.());
    }

    get src() {
      return this._src || '';
    }
  }

  const document = {
    hidden: false,
    querySelector: () => null,
    getElementById: () => null
  };
  const context = vm.createContext({
    URL,
    Image: MockImage,
    bridge: {
      fetchFavicon: async url => {
        nativeRequests.push(url);
        return null;
      }
    },
    document,
    setTimeout,
    clearTimeout
  });
  const filename = path.join(__dirname, '..', 'source', 'render.js');
  const source = fs.readFileSync(filename, 'utf8');
  const faviconSection = source.slice(0, source.indexOf('function createCountChip'));
  vm.runInContext(faviconSection, context, { filename });
  return { context, requests, nativeRequests };
}

test('resolved favicon sources are reused across DOM renders', async () => {
  const { context, requests, nativeRequests } = loadFaviconFunctions();
  const item = { url: 'https://example.com/one' };

  const first = await context.resolveFaviconSource(item);
  assert.equal(first, 'https://example.com/favicon.ico');
  assert.equal(nativeRequests.length, 1);
  assert.deepEqual(requests, ['https://example.com/favicon.ico']);

  const img = {};
  context.setFavicon(img, { url: 'https://example.com/two' }, 64);
  assert.equal(img.src, first);
  assert.equal(nativeRequests.length, 1);
  assert.deepEqual(requests, ['https://example.com/favicon.ico']);
});

test('manual favicon refresh invalidates the resolved source cache', async () => {
  const { context, requests, nativeRequests } = loadFaviconFunctions();
  const item = { url: 'https://example.com/page' };

  await context.resolveFaviconSource(item);
  context.requestNativeFaviconRefresh(item);
  context.setFavicon({}, item, 64);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(nativeRequests.length, 2);
  assert.deepEqual(requests, [
    'https://example.com/favicon.ico',
    'https://example.com/favicon.ico'
  ]);
});

test('effective favicon state includes successfully resolved remote icons', async () => {
  const { context } = loadFaviconFunctions();
  const item = { url: 'https://example.com/page', faviconCache: '' };

  assert.equal(context.getBookmarkFaviconResolutionState(item), 'unchecked');
  await context.resolveFaviconSource(item);
  assert.equal(context.getBookmarkFaviconResolutionState(item), 'available');
});

test('a favicon is missing only after every bounded candidate fails', async () => {
  const { context, requests } = loadFaviconFunctions({ failAll: true });
  const item = { url: 'https://missing.example/page', faviconCache: '' };

  assert.equal(await context.resolveFaviconSource(item), '');
  assert.equal(context.getBookmarkFaviconResolutionState(item), 'missing');
  assert.deepEqual(requests, [
    'https://missing.example/favicon.ico',
    'https://missing.example/favicon.svg',
    'https://missing.example/apple-touch-icon.png',
    'https://missing.example/favicon-32x32.png',
    'https://icons.duckduckgo.com/ip3/missing.example.ico',
    'https://www.google.com/s2/favicons?domain=missing.example&sz=64'
  ]);
});

test('a persisted favicon marks other bookmarks from the same origin as available', () => {
  const { context, nativeRequests } = loadFaviconFunctions();
  const cached = { url: 'https://example.com/one', faviconCache: 'data:image/png;base64,AAAA' };
  context.setFavicon({}, cached, 32);

  assert.equal(context.getBookmarkFaviconResolutionState({ url: 'https://example.com/two', faviconCache: '' }), 'available');
  assert.equal(nativeRequests.length, 0);
});
