const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function loadRssWidgets(fetchImpl = async () => { throw new Error('Unexpected fetch'); }, bridgeImpl = undefined) {
  const storage = new Map();
  const context = vm.createContext({
    console,
    URL,
    Date,
    Intl,
    AbortController,
    fetch: fetchImpl,
    bridge: bridgeImpl,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
    cloneData: value => structuredClone(value),
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    },
    saveState: () => { throw new Error('RSS runtime data must not save shared Hub state'); }
  });
  const filename = path.join(root, 'source/widgets.js');
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return { context, storage };
}

test('RSS Reader is a tabbed column widget with conservative defaults', () => {
  const { context } = loadRssWidgets();
  const definition = vm.runInContext(`(() => {
    const def = WIDGET_REGISTRY.rssReader;
    return { name: def.name, allowedIn: def.allowedIn, config: def.defaultConfig, reload: typeof def.reload };
  })()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(definition)), {
    name: 'RSS Reader',
    allowedIn: ['column'],
    config: { feeds: [], articleLimit: 20, refreshMinutes: 30, layout: 'compact', showImages: true },
    reload: 'function'
  });
});

test('new widget states deep-clone feed arrays', () => {
  const { context } = loadRssWidgets();
  const result = vm.runInContext(`(() => {
    WIDGET_REGISTRY.rssReader.defaultConfig.feeds.push({ id: 'default', name: 'Default', url: 'https://example.com/feed' });
    const first = _newWidgetState('rssReader');
    const second = _newWidgetState('rssReader');
    first.config.feeds[0].name = 'Changed';
    return { first: first.config.feeds[0].name, second: second.config.feeds[0].name, sameArray: first.config.feeds === second.config.feeds };
  })()`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { first: 'Changed', second: 'Default', sameArray: false });
});

test('combined view sorts chronologically and collapses tracking-parameter duplicates', () => {
  const { context } = loadRssWidgets();
  context.widget = {
    id: 'rss-combined',
    config: {
      feeds: [
        { id: 'feed-a', name: 'Alpha', url: 'https://alpha.test/feed' },
        { id: 'feed-b', name: 'Beta', url: 'https://beta.test/feed' }
      ]
    }
  };
  vm.runInContext(`_writeRssCache(widget.id, { feeds: {
    'feed-a': { url: 'https://alpha.test/feed', items: [
      { id: 'feed-a:1', title: 'Shared story', link: 'https://news.test/story?utm_source=alpha', summary: '', author: '', timestamp: 100 },
      { id: 'feed-a:2', title: 'Older story', link: 'https://news.test/older', summary: '', author: '', timestamp: 50 }
    ] },
    'feed-b': { url: 'https://beta.test/feed', items: [
      { id: 'feed-b:1', title: 'Shared story elsewhere', link: 'https://news.test/story?utm_source=beta', summary: '', author: '', timestamp: 110 },
      { id: 'feed-b:2', title: 'Newest story', link: 'https://news.test/newest', summary: '', author: '', timestamp: 200 }
    ] }
  } })`, context);
  const items = vm.runInContext("_rssItemsForView(widget, 'all', '')", context);
  assert.deepEqual(JSON.parse(JSON.stringify(items.map(item => item.title))), ['Newest story', 'Shared story', 'Older story']);
  const shared = items.find(item => item.title === 'Shared story');
  assert.deepEqual(JSON.parse(JSON.stringify(shared.feedNames)), ['Alpha', 'Beta']);
  assert.deepEqual(JSON.parse(JSON.stringify(shared.itemIds)), ['feed-a:1', 'feed-b:1']);

  context.favoriteId = shared.favoriteId;
  vm.runInContext("_writeRssView(widget.id, { starredIds: [favoriteId] })", context);
  const starred = vm.runInContext("_rssItemsForView(widget, 'starred', '')", context);
  assert.equal(starred.length, 1);
  assert.equal(starred[0].favoriteId, shared.favoriteId);
});

test('RSS parser extracts safe article fields from an RSS document', () => {
  const { context } = loadRssWidgets();
  const descendants = node => (node.children || []).flatMap(child => [child, ...descendants(child)]);
  const element = (localName, textContent = '', attributes = {}, children = []) => ({
    localName,
    nodeName: localName,
    textContent: textContent || children.map(child => child.textContent).join(''),
    children,
    prefix: localName === 'thumbnail' ? 'media' : '',
    getAttribute: name => attributes[name] ?? null,
    getElementsByTagName: () => descendants({ children })
  });
  const item = element('item', '', {}, [
    element('title', 'Launch update'),
    element('link', 'https://example.com/story'),
    element('guid', 'story-1'),
    element('description', '<p>A concise <strong>summary</strong>.</p>'),
    element('pubDate', 'Mon, 03 Aug 2026 12:00:00 GMT'),
    element('creator', 'Reporter'),
    element('thumbnail', '', { url: 'https://example.com/image.jpg' })
  ]);
  const channel = element('channel', '', {}, [element('title', 'Space News'), item]);
  const rss = element('rss', '', {}, [channel]);
  const rssDocument = {
    documentElement: rss,
    querySelector: () => null,
    getElementsByTagName: () => descendants({ children: [rss] })
  };
  context.DOMParser = class {
    parseFromString(value, type) {
      if (type === 'text/html') {
        return {
          body: { textContent: String(value).replace(/<[^>]*>/g, ' ') },
          querySelector: () => null
        };
      }
      return rssDocument;
    }
  };
  context.feed = { id: 'space', name: '', url: 'https://example.com/feed.xml' };
  const parsed = vm.runInContext("_parseRssFeed('<rss/>', feed, feed.url, Date.parse('2026-08-03T13:00:00Z'))", context);
  assert.equal(parsed.title, 'Space News');
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].title, 'Launch update');
  assert.equal(parsed.items[0].link, 'https://example.com/story');
  assert.equal(parsed.items[0].summary, 'A concise summary .');
  assert.equal(parsed.items[0].image, 'https://example.com/image.jpg');
  assert.equal(parsed.items[0].author, 'Reporter');
});

test('feed requests fall back to the extension when direct CORS access fails', async () => {
  const relayRequests = [];
  const { context } = loadRssWidgets(
    async () => { throw new TypeError('NetworkError when attempting to fetch resource.'); },
    { fetchFeed: async url => { relayRequests.push(url); return { text: '<rss/>', finalUrl: url }; } }
  );
  const response = await vm.runInContext("_fetchRssText('https://example.com/feed.xml')", context);
  assert.equal(response.transport, 'extension');
  assert.equal(response.text, '<rss/>');
  assert.deepEqual(relayRequests, ['https://example.com/feed.xml']);
});

test('feed refresh caches parsed articles locally without saving the Hub database', async () => {
  const { context, storage } = loadRssWidgets(async url => ({
    ok: true,
    status: 200,
    url: String(url),
    text: async () => '<rss/>'
  }));
  context.widget = {
    id: 'rss-refresh',
    config: { feeds: [{ id: 'one', name: 'One', url: 'https://example.com/feed.xml' }], articleLimit: 10, refreshMinutes: 30 }
  };
  vm.runInContext(`_parseRssFeed = () => ({ title: 'One feed', items: [
    { id: 'one:item', title: 'Cached item', link: 'https://example.com/item', summary: '', author: '', timestamp: Date.now() }
  ] })`, context);
  await vm.runInContext('_ensureRssData(widget, { force: true })', context);
  const cached = JSON.parse(storage.get('morpheus-webhub-rss-cache:rss-refresh'));
  assert.equal(cached.feeds.one.title, 'One feed');
  assert.equal(cached.feeds.one.items[0].title, 'Cached item');
});

test('RSS UI exposes combined, starred and feed tabs with local read state', () => {
  const widgets = fs.readFileSync(path.join(root, 'source/widgets.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'source/styles.css'), 'utf8');
  const bridge = fs.readFileSync(path.join(root, 'source/bridge.js'), 'utf8');
  const background = fs.readFileSync(path.join(root, 'extension/background.js'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8'));
  const rssSource = widgets.slice(widgets.indexOf("WIDGET_REGISTRY['rssReader']"));
  assert.match(rssSource, /\{ id: 'all', name: 'All'/);
  assert.match(rssSource, /\{ id: 'starred', name: '★ Starred'/);
  assert.match(rssSource, /widget-rss-unread-badge/);
  assert.match(rssSource, /Mark shown read/);
  assert.match(rssSource, /rss-settings-add-feed/);
  assert.match(rssSource, /settingsPanelWidth: 'wide'/);
  assert.match(rssSource, /heading\.textContent = widget\.title/);
  assert.match(widgets, /panel\.classList\.toggle\('widget-settings-panel--wide', def\.settingsPanelWidth === 'wide'\)/);
  assert.match(styles, /\.widget-rss-tabs\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(styles, /\.widget-rss-tabs\s*\{[^}]*padding-bottom:\s*7px/s);
  assert.match(styles, /\.widget-rss-articles\s*\{[^}]*max-height:\s*480px/s);
  assert.match(styles, /#widgetSettingsPanel\.widget-settings-panel--wide\s*\{[^}]*760px/s);
  assert.match(styles, /\.rss-settings-feed-inputs\s*\{[^}]*minmax\(260px, 1fr\)/s);
  assert.match(styles, /\.rss-settings-feed-actions \.icon-btn\.is-danger\s*\{[^}]*border:\s*1px solid var\(--danger\)/s);
  assert.match(bridge, /async fetchFeed\(url\)[\s\S]*?MW_FETCH_FEED/);
  assert.match(background, /MAX_FEED_RESPONSE_BYTES = 2 \* 1024 \* 1024/);
  assert.equal(manifest.permissions.includes('https://*/*'), true);
  assert.equal(manifest.permissions.includes('http://*/*'), true);
  assert.equal(manifest.version, '1.0.22');
});
