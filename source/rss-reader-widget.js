// --- RSS Reader widget -----------------------------------------------------

const _rssMemoryCache = new Map();
const _rssViewMemory = new Map();
const _rssRuntime = new Map();

const RSS_CACHE_PREFIX = 'morpheus-webhub-rss-cache:';
const RSS_VIEW_PREFIX = 'morpheus-webhub-rss-view:';
const RSS_CACHE_SCHEMA = 1;
const RSS_MAX_FEEDS = 12;
const RSS_MAX_RESPONSE_CHARS = 2 * 1024 * 1024;
const RSS_RETRY_MS = 5 * 60 * 1000;

// ---- RSS Reader widget ----

function _rssNewFeedId() {
  return `rss-feed-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function _rssFeedConfigs(widget) {
  widget.config = widget.config || {};
  if (!Array.isArray(widget.config.feeds)) widget.config.feeds = [];
  const seen = new Set();
  widget.config.feeds = widget.config.feeds.slice(0, RSS_MAX_FEEDS).map(feed => {
    const normalized = feed && typeof feed === 'object' ? feed : {};
    let id = String(normalized.id || '').trim();
    if (!id || seen.has(id)) id = _rssNewFeedId();
    seen.add(id);
    return {
      id,
      name: String(normalized.name || '').trim(),
      url: String(normalized.url || '').trim()
    };
  });
  return widget.config.feeds;
}

function _normalizeRssArticleLimit(value) {
  const parsed = Number.parseInt(value, 10);
  return [10, 20, 40, 80].includes(parsed) ? parsed : 20;
}

function _normalizeRssRefreshMinutes(value) {
  const parsed = Number.parseInt(value, 10);
  return [15, 30, 60, 180].includes(parsed) ? parsed : 30;
}

function _normalizeRssLayout(value) {
  return value === 'expanded' ? 'expanded' : 'compact';
}

function _rssValidUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return /^https?:$/.test(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function _rssCacheKey(widgetId) {
  return `${RSS_CACHE_PREFIX}${widgetId}`;
}

function _readRssCache(widgetId) {
  if (_rssMemoryCache.has(widgetId)) return _rssMemoryCache.get(widgetId);
  let cache = WidgetSDK.cache.get('rssReader', widgetId, 'feeds')
    || WidgetSDK.cache.migrateLegacy('rssReader', widgetId, 'feeds', _rssCacheKey(widgetId));
  if (!cache || cache.schema !== RSS_CACHE_SCHEMA || typeof cache.feeds !== 'object') {
    cache = { schema: RSS_CACHE_SCHEMA, feeds: {} };
  }
  _rssMemoryCache.set(widgetId, cache);
  return cache;
}

function _writeRssCache(widgetId, cache) {
  const normalized = { schema: RSS_CACHE_SCHEMA, feeds: cache?.feeds || {} };
  _rssMemoryCache.set(widgetId, normalized);
  try { WidgetSDK.cache.set('rssReader', widgetId, 'feeds', normalized); } catch {}
  return normalized;
}

function _rssViewKey(widgetId) {
  return `${RSS_VIEW_PREFIX}${widgetId}`;
}

function _readRssView(widgetId) {
  if (_rssViewMemory.has(widgetId)) return _rssViewMemory.get(widgetId);
  let view = WidgetSDK.cache.get('rssReader', widgetId, 'view')
    || WidgetSDK.cache.migrateLegacy('rssReader', widgetId, 'view', _rssViewKey(widgetId));
  view = {
    activeFeedId: String(view?.activeFeedId || 'all'),
    search: String(view?.search || ''),
    readIds: Array.isArray(view?.readIds) ? view.readIds.slice(-2000) : [],
    starredIds: Array.isArray(view?.starredIds) ? view.starredIds.slice(-1000) : []
  };
  _rssViewMemory.set(widgetId, view);
  return view;
}

function _writeRssView(widgetId, updates = {}) {
  const current = _readRssView(widgetId);
  const view = {
    ...current,
    ...updates,
    readIds: Array.isArray(updates.readIds) ? [...new Set(updates.readIds)].slice(-2000) : current.readIds,
    starredIds: Array.isArray(updates.starredIds) ? [...new Set(updates.starredIds)].slice(-1000) : current.starredIds
  };
  _rssViewMemory.set(widgetId, view);
  try { WidgetSDK.cache.set('rssReader', widgetId, 'view', view); } catch {}
  return view;
}

function _getRssRuntime(widgetId) {
  let runtime = _rssRuntime.get(widgetId);
  if (!runtime) {
    runtime = { loading: new Set(), nextRetryAt: new Map() };
    _rssRuntime.set(widgetId, runtime);
  }
  return runtime;
}

function _rssHash(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function _rssElementsByLocalName(node, names) {
  const wanted = new Set(names.map(name => name.toLowerCase()));
  return Array.from(node?.getElementsByTagName?.('*') || [])
    .filter(element => wanted.has(String(element.localName || element.nodeName || '').toLowerCase()));
}

function _rssDirectChild(node, names) {
  const children = Array.from(node?.children || []);
  for (const name of names) {
    const match = children.find(element => String(element.localName || element.nodeName || '').toLowerCase() === name.toLowerCase());
    if (match) return match;
  }
  return null;
}

function _rssNodeText(node) {
  return String(node?.textContent || '').replace(/\s+/g, ' ').trim();
}

function _rssPlainText(value) {
  const html = String(value || '').trim();
  if (!html) return '';
  try {
    const documentFragment = new DOMParser().parseFromString(html, 'text/html');
    return String(documentFragment.body?.textContent || '').replace(/\s+/g, ' ').trim();
  } catch {
    return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

function _rssResolveUrl(value, baseUrl) {
  try {
    const url = new URL(String(value || '').trim(), baseUrl);
    return /^https?:$/.test(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function _rssEntryLink(node, baseUrl) {
  const links = Array.from(node?.children || []).filter(element => String(element.localName || '').toLowerCase() === 'link');
  const atomLink = links.find(element => !element.getAttribute('rel') || element.getAttribute('rel') === 'alternate')
    || links[0];
  return _rssResolveUrl(atomLink?.getAttribute?.('href') || _rssNodeText(atomLink), baseUrl);
}

function _rssEntryImage(node, rawContent, baseUrl) {
  const media = _rssElementsByLocalName(node, ['enclosure', 'thumbnail', 'content'])
    .find(element => {
      const url = element.getAttribute?.('url') || element.getAttribute?.('href');
      const type = String(element.getAttribute?.('type') || '');
      return url && (String(element.prefix || '').toLowerCase() === 'media'
        || /image/i.test(type)
        || String(element.localName || '').toLowerCase() === 'thumbnail');
    });
  const mediaUrl = _rssResolveUrl(media?.getAttribute?.('url') || media?.getAttribute?.('href'), baseUrl);
  if (mediaUrl) return mediaUrl;
  try {
    const fragment = new DOMParser().parseFromString(String(rawContent || ''), 'text/html');
    return _rssResolveUrl(fragment.querySelector('img')?.getAttribute('src'), baseUrl);
  } catch {
    return '';
  }
}

function _parseRssFeed(xmlText, feed, responseUrl = feed.url, fetchedAt = Date.now()) {
  const documentXml = new DOMParser().parseFromString(String(xmlText || ''), 'application/xml');
  if (documentXml.querySelector('parsererror')) throw new Error('Feed returned invalid XML.');
  const root = documentXml.documentElement;
  const rootName = String(root?.localName || '').toLowerCase();
  const isAtom = rootName === 'feed' || _rssElementsByLocalName(documentXml, ['entry']).length > 0;
  const itemNodes = _rssElementsByLocalName(documentXml, isAtom ? ['entry'] : ['item']);
  if (!['rss', 'rdf', 'feed'].includes(rootName) && !itemNodes.length) {
    throw new Error('The URL did not return an RSS or Atom feed.');
  }
  const channel = _rssElementsByLocalName(documentXml, ['channel'])[0] || root;
  const parsedTitle = _rssNodeText(_rssDirectChild(channel, ['title'])) || feed.name || 'Untitled feed';
  const items = itemNodes.map((node, index) => {
    const title = _rssNodeText(_rssDirectChild(node, ['title'])) || 'Untitled article';
    const link = _rssEntryLink(node, responseUrl);
    const guid = _rssNodeText(_rssDirectChild(node, ['guid', 'id'])) || link;
    const contentNode = _rssDirectChild(node, ['encoded', 'content', 'description', 'summary']);
    const rawContent = String(contentNode?.textContent || '');
    const summary = _rssPlainText(rawContent).slice(0, 1000);
    const dateText = _rssNodeText(_rssDirectChild(node, ['pubdate', 'published', 'updated', 'date']));
    const parsedDate = Date.parse(dateText);
    const authorNode = _rssDirectChild(node, ['creator', 'author']);
    const author = _rssNodeText(_rssDirectChild(authorNode, ['name'])) || _rssNodeText(authorNode);
    const identity = guid || `${title}:${dateText}:${index}`;
    return {
      id: `${feed.id}:${_rssHash(identity)}`,
      title,
      link,
      summary,
      image: _rssEntryImage(node, rawContent, responseUrl),
      author,
      timestamp: Number.isFinite(parsedDate) ? parsedDate : fetchedAt,
      dateText
    };
  }).sort((left, right) => right.timestamp - left.timestamp);
  return { title: parsedTitle, items };
}

async function _fetchRssText(url, widgetId = 'shared', feedId = 'feed') {
  let directError = null;
  try {
    const response = await _fetchWithTimeout(url, {
      widgetType: 'rssReader',
      widgetFetchKey: `rss:${widgetId}:${feedId}`,
      maxResponseBytes: RSS_MAX_RESPONSE_CHARS,
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store',
      headers: { Accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml, */*;q=0.2' }
    }, 15000);
    if (!response.ok) throw new Error(`Feed returned ${response.status}`);
    const text = await response.text();
    if (text.length > RSS_MAX_RESPONSE_CHARS) throw new Error('Feed exceeds the 2 MiB response limit');
    return { text, finalUrl: response.url || url, transport: 'direct' };
  } catch (error) {
    directError = error;
  }

  try {
    const relayed = await WidgetSDK.extensionRelay.invoke('rssReader', 'fetchFeed', url);
    if (relayed?.text) return { ...relayed, transport: 'extension' };
  } catch {}
  const reason = ['AbortError', 'TimeoutError'].includes(directError?.name)
    ? 'Feed request timed out.'
    : (directError?.message || 'Direct feed request failed.');
  throw new Error(`${reason} The extension relay could not fetch it either.`);
}

function _rssFeedFresh(widget, entry) {
  return !!entry?.fetchedAt
    && Date.now() - Number(entry.fetchedAt) < _normalizeRssRefreshMinutes(widget.config?.refreshMinutes) * 60 * 1000;
}

function _ensureRssData(widget, options = {}) {
  const feeds = _rssFeedConfigs(widget);
  if (!feeds.length) return null;
  const runtime = _getRssRuntime(widget.id);
  const force = options.force === true;
  const selectedFeedId = options.feedId || '';
  const tasks = [];

  feeds.forEach(feed => {
    if (selectedFeedId && feed.id !== selectedFeedId) return;
    const validUrl = _rssValidUrl(feed.url);
    if (!validUrl) return;
    const cached = _readRssCache(widget.id).feeds[feed.id];
    if (!force && _rssFeedFresh(widget, cached) && cached.url === validUrl) return;
    if (!force && Number(runtime.nextRetryAt.get(feed.id) || 0) > Date.now()) return;
    const fetchKey = `rss:${widget.id}:${feed.id}`;
    if (_widgetFetches.has(fetchKey)) {
      tasks.push(_widgetFetches.get(fetchKey));
      return;
    }
    runtime.loading.add(feed.id);
    const request = _fetchRssText(validUrl, widget.id, feed.id)
      .then(response => {
        const parsed = _parseRssFeed(response.text, feed, response.finalUrl || validUrl);
        const cache = _readRssCache(widget.id);
        cache.feeds[feed.id] = {
          url: validUrl,
          title: parsed.title,
          fetchedAt: Date.now(),
          transport: response.transport,
          error: '',
          items: parsed.items.slice(0, 80)
        };
        _writeRssCache(widget.id, cache);
        runtime.nextRetryAt.delete(feed.id);
        return { ok: true, feedId: feed.id };
      })
      .catch(error => {
        const cache = _readRssCache(widget.id);
        const previous = cache.feeds[feed.id] || { url: validUrl, title: feed.name || validUrl, items: [] };
        cache.feeds[feed.id] = {
          ...previous,
          url: validUrl,
          error: error?.message || 'Unable to load feed.',
          lastAttemptAt: Date.now()
        };
        _writeRssCache(widget.id, cache);
        runtime.nextRetryAt.set(feed.id, Date.now() + RSS_RETRY_MS);
        return { ok: false, feedId: feed.id, error };
      })
      .finally(() => {
        runtime.loading.delete(feed.id);
        _widgetFetches.delete(fetchKey);
      });
    _widgetFetches.set(fetchKey, request);
    tasks.push(request);
  });

  if (!tasks.length) return null;
  return Promise.all(tasks).finally(() => _refreshWidget(widget.id, 'column'));
}

function _rssCanonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    [...url.searchParams.keys()].forEach(key => {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    });
    return url.toString();
  } catch {
    return '';
  }
}

function _rssItemsForView(widget, activeFeedId = 'all', search = '') {
  const feeds = _rssFeedConfigs(widget);
  const cache = _readRssCache(widget.id);
  const selectedFeeds = activeFeedId === 'all' || activeFeedId === 'starred'
    ? feeds
    : feeds.filter(feed => feed.id === activeFeedId);
  const merged = [];
  const seen = new Map();
  selectedFeeds.forEach(feed => {
    const entry = cache.feeds[feed.id];
    (entry?.items || []).slice(0, _normalizeRssArticleLimit(widget.config?.articleLimit)).forEach(item => {
      const key = _rssCanonicalUrl(item.link) || item.title.toLowerCase();
      if (['all', 'starred'].includes(activeFeedId) && seen.has(key)) {
        const existing = seen.get(key);
        if (!existing.feedNames.includes(feed.name || entry.title)) existing.feedNames.push(feed.name || entry.title);
        if (!existing.itemIds.includes(item.id)) existing.itemIds.push(item.id);
        return;
      }
      const enriched = {
        ...item,
        favoriteId: `rss-star:${_rssHash(key)}`,
        feedId: feed.id,
        feedName: feed.name || entry?.title || 'Feed',
        feedNames: [feed.name || entry?.title || 'Feed'],
        itemIds: [item.id]
      };
      seen.set(key, enriched);
      merged.push(enriched);
    });
  });
  const query = String(search || '').trim().toLowerCase();
  const starred = activeFeedId === 'starred' ? new Set(_readRssView(widget.id).starredIds) : null;
  return merged
    .filter(item => !starred || starred.has(item.favoriteId))
    .filter(item => !query || `${item.title} ${item.summary} ${item.author} ${item.feedNames.join(' ')}`.toLowerCase().includes(query))
    .sort((left, right) => right.timestamp - left.timestamp);
}

function _rssRelativeTime(timestamp) {
  const difference = Number(timestamp) - Date.now();
  const absolute = Math.abs(difference);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (absolute < 60 * 60 * 1000) return formatter.format(Math.round(difference / 60000), 'minute');
  if (absolute < 24 * 60 * 60 * 1000) return formatter.format(Math.round(difference / 3600000), 'hour');
  if (absolute < 7 * 24 * 60 * 60 * 1000) return formatter.format(Math.round(difference / 86400000), 'day');
  try { return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return ''; }
}

function _rssPruneAfterSettings(widget) {
  const feeds = _rssFeedConfigs(widget);
  const valid = new Map(feeds.map(feed => [feed.id, _rssValidUrl(feed.url)]));
  const cache = _readRssCache(widget.id);
  Object.keys(cache.feeds).forEach(feedId => {
    if (!valid.has(feedId) || cache.feeds[feedId]?.url !== valid.get(feedId)) delete cache.feeds[feedId];
  });
  _writeRssCache(widget.id, cache);
  const view = _readRssView(widget.id);
  if (!['all', 'starred'].includes(view.activeFeedId) && !valid.has(view.activeFeedId)) {
    _writeRssView(widget.id, { activeFeedId: 'all' });
  }
  _rssRuntime.delete(widget.id);
}

WIDGET_REGISTRY['rssReader'] = {
  name: 'RSS Reader',
  category: 'Content & Feeds',
  description: 'Tabbed RSS and Atom feeds with a combined chronological view',
  allowedIn: ['column'],
  settingsPanelWidth: 'wide',
  defaultConfig: {
    feeds: [],
    articleLimit: 20,
    refreshMinutes: 30,
    layout: 'compact',
    showImages: true
  },
  defaultData: {},
  liveSettingsPreview: false,
  reloadLabel: 'Refresh all RSS feeds',

  dispose(widget) {
    _rssRuntime.delete(widget.id);
    _rssMemoryCache.delete(widget.id);
    _rssViewMemory.delete(widget.id);
    WidgetSDK.cache.remove('rssReader', widget.id, 'feeds', { legacyKeys: [_rssCacheKey(widget.id)] });
    WidgetSDK.cache.remove('rssReader', widget.id, 'view', { legacyKeys: [_rssViewKey(widget.id)] });
  },

  reload(widget) {
    return _ensureRssData(widget, { force: true });
  },

  onSettingsCommit(widget) {
    _rssPruneAfterSettings(widget);
  },

  render(widget, el, context) {
    const feeds = _rssFeedConfigs(widget);
    const runtime = _getRssRuntime(widget.id);
    let view = _readRssView(widget.id);
    if (!['all', 'starred'].includes(view.activeFeedId) && !feeds.some(feed => feed.id === view.activeFeedId)) {
      view = _writeRssView(widget.id, { activeFeedId: 'all' });
    }

    _setWidgetRefresher(widget.id, context, () => {
      if (!el.isConnected) {
        _widgetRefreshers.delete(`${widget.id}:${context}`);
        return;
      }
      el.innerHTML = '';
      WIDGET_REGISTRY.rssReader.render(widget, el, context);
    });

    el.className = `widget-rss-reader is-${_normalizeRssLayout(widget.config?.layout)}`;
    if (widget.title) {
      const heading = document.createElement('div');
      heading.className = 'widget-rss-heading';
      heading.textContent = widget.title;
      el.appendChild(heading);
    }
    if (!feeds.length) {
      const placeholder = document.createElement('div');
      placeholder.className = 'widget-rss-empty';
      placeholder.textContent = 'Add one or more RSS or Atom feed URLs in the widget settings.';
      el.appendChild(placeholder);
      return;
    }

    _ensureRssData(widget);
    _setWidgetTimer(widget.id, context, () => _ensureRssData(widget), 60 * 1000);

    const tabs = document.createElement('div');
    tabs.className = 'widget-rss-tabs widget-interactive-surface';
    tabs.setAttribute('role', 'tablist');
    const toolbar = document.createElement('div');
    toolbar.className = 'widget-rss-toolbar widget-interactive-surface';
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'widget-rss-search';
    search.placeholder = 'Search articles';
    search.value = view.search;
    search.setAttribute('aria-label', 'Search RSS articles');
    const markRead = document.createElement('button');
    markRead.type = 'button';
    markRead.className = 'widget-rss-mark-read';
    markRead.textContent = 'Mark shown read';
    toolbar.append(search, markRead);

    const status = document.createElement('div');
    status.className = 'widget-rss-status';
    const articles = document.createElement('div');
    articles.className = 'widget-rss-articles widget-interactive-surface';
    el.append(tabs, toolbar, status, articles);

    const renderTabs = () => {
      const cache = _readRssCache(widget.id);
      const read = new Set(_readRssView(widget.id).readIds);
      tabs.innerHTML = '';
      const definitions = [
        { id: 'all', name: 'All', items: _rssItemsForView(widget, 'all', '') },
        { id: 'starred', name: '★ Starred', items: _rssItemsForView(widget, 'starred', '') },
        ...feeds.map(feed => ({
          id: feed.id,
          name: feed.name || cache.feeds[feed.id]?.title || 'Feed',
          items: _rssItemsForView(widget, feed.id, '')
        }))
      ];
      definitions.forEach(definition => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'widget-rss-tab';
        button.dataset.feedId = definition.id;
        button.setAttribute('role', 'tab');
        const active = _readRssView(widget.id).activeFeedId === definition.id;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
        const label = document.createElement('span');
        label.textContent = definition.name;
        const unreadCount = definition.items.filter(item => item.itemIds.some(itemId => !read.has(itemId))).length;
        button.appendChild(label);
        if (unreadCount) {
          const badge = document.createElement('span');
          badge.className = 'widget-rss-unread-badge';
          badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
          button.appendChild(badge);
        }
        button.addEventListener('click', event => {
          event.stopPropagation();
          view = _writeRssView(widget.id, { activeFeedId: definition.id });
          renderTabs();
          renderArticles();
        });
        tabs.appendChild(button);
      });
    };

    const renderStatus = () => {
      const cache = _readRssCache(widget.id);
      const loading = runtime.loading.size;
      const errors = feeds
        .map(feed => ({
          name: feed.name || cache.feeds[feed.id]?.title || 'Feed',
          error: _rssValidUrl(feed.url) ? (cache.feeds[feed.id]?.error || '') : 'Enter a valid HTTP(S) feed URL in settings.'
        }))
        .filter(item => item.error);
      status.innerHTML = '';
      status.classList.toggle('hidden', !loading && !errors.length);
      if (loading) {
        const loadingLine = document.createElement('div');
        loadingLine.textContent = `Refreshing ${loading} feed${loading === 1 ? '' : 's'}…`;
        status.appendChild(loadingLine);
      }
      errors.forEach(item => {
        const line = document.createElement('div');
        line.className = 'is-error';
        line.textContent = `${item.name}: ${item.error}`;
        status.appendChild(line);
      });
    };

    const renderArticles = () => {
      const currentView = _readRssView(widget.id);
      const read = new Set(currentView.readIds);
      const starred = new Set(currentView.starredIds);
      const items = _rssItemsForView(widget, currentView.activeFeedId, currentView.search);
      articles.innerHTML = '';
      markRead.disabled = !items.some(item => item.itemIds.some(itemId => !read.has(itemId)));
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'widget-rss-empty';
        empty.textContent = currentView.search ? 'No articles match this search.' : 'No articles are available in this view yet.';
        articles.appendChild(empty);
        renderStatus();
        return;
      }
      items.forEach(item => {
        const article = document.createElement('article');
        const itemIsRead = item.itemIds.every(itemId => read.has(itemId));
        article.className = `widget-rss-article${itemIsRead ? ' is-read' : ' is-unread'}`;
        if (widget.config?.showImages !== false && _normalizeRssLayout(widget.config?.layout) === 'expanded' && item.image) {
          const image = document.createElement('img');
          image.className = 'widget-rss-image';
          image.src = item.image;
          image.alt = '';
          image.loading = 'lazy';
          image.referrerPolicy = 'no-referrer';
          image.addEventListener('error', () => image.remove(), { once: true });
          article.appendChild(image);
        }
        const content = document.createElement('div');
        content.className = 'widget-rss-article-content';
        const titleRow = document.createElement('div');
        titleRow.className = 'widget-rss-title-row';
        const link = document.createElement('a');
        link.className = 'widget-rss-title';
        link.href = item.link || '#';
        link.target = '_blank';
        link.rel = 'noreferrer noopener';
        link.textContent = item.title;
        if (!item.link) link.removeAttribute('href');
        link.addEventListener('click', () => {
          if (item.itemIds.every(itemId => read.has(itemId))) return;
          item.itemIds.forEach(itemId => read.add(itemId));
          _writeRssView(widget.id, { readIds: [...read] });
          article.classList.remove('is-unread');
          article.classList.add('is-read');
          renderTabs();
        });
        const star = document.createElement('button');
        star.type = 'button';
        star.className = `widget-rss-star${starred.has(item.favoriteId) ? ' active' : ''}`;
        star.textContent = starred.has(item.favoriteId) ? '★' : '☆';
        star.title = starred.has(item.favoriteId) ? 'Remove favourite' : 'Add favourite';
        star.setAttribute('aria-pressed', String(starred.has(item.favoriteId)));
        star.addEventListener('click', event => {
          event.stopPropagation();
          if (starred.has(item.favoriteId)) starred.delete(item.favoriteId);
          else starred.add(item.favoriteId);
          _writeRssView(widget.id, { starredIds: [...starred] });
          star.classList.toggle('active', starred.has(item.favoriteId));
          star.textContent = starred.has(item.favoriteId) ? '★' : '☆';
          star.setAttribute('aria-pressed', String(starred.has(item.favoriteId)));
          renderTabs();
          if (_readRssView(widget.id).activeFeedId === 'starred') renderArticles();
        });
        titleRow.append(link, star);
        const meta = document.createElement('div');
        meta.className = 'widget-rss-meta';
        const source = document.createElement('span');
        source.textContent = item.feedNames.join(' + ');
        const time = document.createElement('time');
        time.dateTime = new Date(item.timestamp).toISOString();
        time.textContent = _rssRelativeTime(item.timestamp);
        meta.append(source, time);
        content.append(titleRow, meta);
        if (_normalizeRssLayout(widget.config?.layout) === 'expanded' && item.summary) {
          const summary = document.createElement('p');
          summary.className = 'widget-rss-summary';
          summary.textContent = item.summary;
          content.appendChild(summary);
        }
        article.appendChild(content);
        articles.appendChild(article);
      });
      renderStatus();
    };

    tabs.addEventListener('wheel', event => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      tabs.scrollLeft += event.deltaY;
      event.preventDefault();
    }, { passive: false });
    search.addEventListener('input', () => {
      view = _writeRssView(widget.id, { search: search.value });
      renderArticles();
    });
    markRead.addEventListener('click', event => {
      event.stopPropagation();
      const currentView = _readRssView(widget.id);
      const read = new Set(currentView.readIds);
      _rssItemsForView(widget, currentView.activeFeedId, currentView.search)
        .forEach(item => item.itemIds.forEach(itemId => read.add(itemId)));
      view = _writeRssView(widget.id, { readIds: [...read] });
      renderTabs();
      renderArticles();
    });

    renderTabs();
    renderArticles();
  },

  renderSettings(widget, container) {
    const c = widget.config || {};
    const feeds = _rssFeedConfigs(widget);
    container.innerHTML = `
      <div class="rss-settings-feed-section">
        <div class="rss-settings-feed-label">Feed tabs</div>
        <div class="rss-settings-feed-editor">
          <div class="rss-settings-feed-list"></div>
          <button type="button" class="secondary-btn rss-settings-add-feed">Add feed</button>
        </div>
      </div>
      <div class="settings-row">
        <span>Articles per feed</span>
        <select class="settings-select" data-cfg="articleLimit">
          ${[10, 20, 40, 80].map(limit => `<option value="${limit}" ${_normalizeRssArticleLimit(c.articleLimit) === limit ? 'selected' : ''}>${limit}</option>`).join('')}
        </select>
      </div>
      <div class="settings-row">
        <span>Automatic refresh</span>
        <select class="settings-select" data-cfg="refreshMinutes">
          ${[[15, '15 minutes'], [30, '30 minutes'], [60, 'Hourly'], [180, 'Every 3 hours']].map(([minutes, label]) => `<option value="${minutes}" ${_normalizeRssRefreshMinutes(c.refreshMinutes) === minutes ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </div>
      <div class="settings-row">
        <span>Article layout</span>
        <div class="board-fit-radios weather-option-radios">
          <label class="board-fit-label"><input type="radio" name="rssLayout" data-cfg="layout" value="compact" ${_normalizeRssLayout(c.layout) === 'compact' ? 'checked' : ''}/><span>Compact</span></label>
          <label class="board-fit-label"><input type="radio" name="rssLayout" data-cfg="layout" value="expanded" ${_normalizeRssLayout(c.layout) === 'expanded' ? 'checked' : ''}/><span>Expanded</span></label>
        </div>
      </div>
      <div class="settings-row">
        <span>Article images</span>
        <label class="settings-toggle"><input type="checkbox" data-cfg="showImages" ${c.showImages !== false ? 'checked' : ''}/><span class="toggle-track"></span></label>
      </div>
      <div class="settings-help">The All tab merges every feed chronologically and collapses duplicate links. Feeds that block direct browser access are requested through extension 1.0.21.</div>`;

    const list = container.querySelector('.rss-settings-feed-list');
    const addButton = container.querySelector('.rss-settings-add-feed');
    const renderFeedRows = () => {
      list.innerHTML = '';
      feeds.forEach((feed, index) => {
        const row = document.createElement('div');
        row.className = 'rss-settings-feed-row';
        const inputs = document.createElement('div');
        inputs.className = 'rss-settings-feed-inputs';
        const name = document.createElement('input');
        name.type = 'text';
        name.className = 'settings-text-input';
        name.placeholder = 'Tab name';
        name.value = feed.name;
        const url = document.createElement('input');
        url.type = 'url';
        url.className = 'settings-text-input';
        url.placeholder = 'https://example.com/feed.xml';
        url.value = feed.url;
        const actions = document.createElement('div');
        actions.className = 'rss-settings-feed-actions';
        const up = document.createElement('button');
        up.type = 'button';
        up.className = 'icon-btn';
        up.textContent = '↑';
        up.title = 'Move feed up';
        up.disabled = index === 0;
        const down = document.createElement('button');
        down.type = 'button';
        down.className = 'icon-btn';
        down.textContent = '↓';
        down.title = 'Move feed down';
        down.disabled = index === feeds.length - 1;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'icon-btn is-danger';
        remove.textContent = '×';
        remove.title = 'Remove feed';
        remove.setAttribute('aria-label', `Remove ${feed.name || 'feed'}`);
        name.addEventListener('input', () => { feed.name = name.value; });
        url.addEventListener('input', () => { feed.url = url.value; });
        up.addEventListener('click', () => {
          if (index < 1) return;
          feeds.splice(index - 1, 0, feeds.splice(index, 1)[0]);
          renderFeedRows();
        });
        down.addEventListener('click', () => {
          if (index >= feeds.length - 1) return;
          feeds.splice(index + 1, 0, feeds.splice(index, 1)[0]);
          renderFeedRows();
        });
        remove.addEventListener('click', () => {
          feeds.splice(index, 1);
          renderFeedRows();
        });
        inputs.append(name, url);
        actions.append(up, down, remove);
        row.append(inputs, actions);
        list.appendChild(row);
      });
      addButton.disabled = feeds.length >= RSS_MAX_FEEDS;
      if (!feeds.length) {
        const empty = document.createElement('div');
        empty.className = 'settings-muted rss-settings-empty';
        empty.textContent = 'No feeds configured yet.';
        list.appendChild(empty);
      }
    };
    addButton.addEventListener('click', () => {
      if (feeds.length >= RSS_MAX_FEEDS) return;
      feeds.push({ id: _rssNewFeedId(), name: '', url: '' });
      renderFeedRows();
      list.querySelector('.rss-settings-feed-row:last-of-type input')?.focus();
    });
    renderFeedRows();
  }
};
