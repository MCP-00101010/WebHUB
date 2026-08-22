// --- Nexus Mods Tracker widget --------------------------------------------

const NEXUS_MODS_API_ROOT = 'https://api.nexusmods.com/v1';
const NEXUS_MODS_GRAPHQL_ROOT = 'https://api.nexusmods.com/v2/graphql';
const NEXUS_MODS_GAME_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const NEXUS_MODS_DEFAULT_REFRESH_MINUTES = 180;
const NEXUS_MODS_MANUAL_REFRESH_FLOOR_MS = 5 * 60 * 1000;
const NEXUS_MODS_MAX_GAMES = 1;
const NEXUS_MODS_FEED_LIMIT = 30;
const NEXUS_MODS_FEED_CACHE_VERSION = 3;
const NEXUS_MODS_GAME_CATALOG_LIMIT = 1500;
const NEXUS_MODS_FEEDS = Object.freeze(['added', 'updated']);
const _nexusModsRuntime = new Map();
let _nexusModsCatalogRequest = null;

function _nexusModsServiceKey() {
  return typeof getServiceSecret === 'function' ? getServiceSecret('nexusMods') : '';
}

function _nexusModsDomain(value) {
  const domain = String(value || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,79}$/.test(domain) ? domain : '';
}

function _nexusModsNormalizeGames(value) {
  const games = [];
  const seen = new Set();
  for (const entry of (Array.isArray(value) ? value : [])) {
    const domain = _nexusModsDomain(typeof entry === 'string' ? entry : entry?.domain);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    games.push({
      domain,
      name: String(typeof entry === 'string' ? entry : (entry?.name || domain)).trim().slice(0, 120) || domain
    });
    if (games.length >= NEXUS_MODS_MAX_GAMES) break;
  }
  return games;
}

function _nexusModsRefreshMinutes(value) {
  const minutes = Number(value);
  return [60, 180, 360, 720].includes(minutes) ? minutes : NEXUS_MODS_DEFAULT_REFRESH_MINUTES;
}

function _nexusModsItemLimit(value) {
  const limit = Number(value);
  return [5, 10].includes(limit) ? limit : 5;
}

function _nexusModsListHeight(config) {
  const visibleItems = _nexusModsItemLimit(config?.itemsPerGame);
  const rowHeight = config?.showSummaries === false ? 78 : 104;
  return visibleItems * rowHeight + (visibleItems - 1) * 6;
}

function _nexusModsConfig(widget) {
  widget.config ||= {};
  widget.config.games = _nexusModsNormalizeGames(widget.config.games);
  widget.config.refreshMinutes = _nexusModsRefreshMinutes(widget.config.refreshMinutes);
  widget.config.itemsPerGame = _nexusModsItemLimit(widget.config.itemsPerGame);
  widget.config.showSummaries = widget.config.showSummaries !== false;
  widget.config.showAdult = widget.config.showAdult === true;
  return widget.config;
}

function _nexusModsTitle(widget) {
  const config = _nexusModsConfig(widget);
  return String(widget?.title || config.games[0]?.name || 'Nexus Mods').trim().slice(0, 120) || 'Nexus Mods';
}

function _nexusModsState(widget) {
  let runtime = _nexusModsRuntime.get(widget.id);
  if (!runtime) {
    const view = WidgetSDK.cache.get('nexusModsTracker', widget.id, 'view') || {};
    runtime = {
      activeFeed: NEXUS_MODS_FEEDS.includes(view.activeFeed) ? view.activeFeed : 'added',
      loading: false,
      errors: {},
      rate: null
    };
    _nexusModsRuntime.set(widget.id, runtime);
  }
  return runtime;
}

function _nexusModsWriteView(widget, runtime) {
  try { WidgetSDK.cache.set('nexusModsTracker', widget.id, 'view', { activeFeed: runtime.activeFeed }); } catch {}
}

function _nexusModsHeaders() {
  return {
    Accept: 'application/json',
    APIKEY: _nexusModsServiceKey(),
    'Protocol-Version': '1.0.0',
    'Application-Name': 'Morpheus WebHub',
    'Application-Version': typeof APP_VERSION === 'string' ? APP_VERSION : '0.0.0'
  };
}

function _nexusModsRateInfo(response) {
  const number = name => {
    const value = Number(response?.headers?.get?.(name));
    return Number.isFinite(value) ? value : null;
  };
  const daily = number('x-rl-daily-remaining');
  const hourly = number('x-rl-hourly-remaining');
  return daily === null && hourly === null ? null : { daily, hourly };
}

async function _nexusModsResponsePayload(response) {
  try { return await response.json(); } catch { return null; }
}

function _nexusModsResponseError(response, payload, gameName = '') {
  const detail = String(payload?.message || payload?.error || '').trim();
  if (response?.status === 401 || response?.status === 403) return 'The Nexus Mods API key was rejected or lacks access.';
  if (response?.status === 404) return `${gameName || 'That game'} is unavailable on Nexus Mods.`;
  if (response?.status === 429) return 'Nexus Mods rate limit reached; cached results are being kept.';
  if (response?.status >= 500) return 'Nexus Mods is temporarily unavailable; cached results are being kept.';
  return detail || `Nexus Mods returned ${response?.status || 'an error'}.`;
}

async function _nexusModsRequest(path, fetchKey, query = {}) {
  const url = new URL(`${NEXUS_MODS_API_ROOT}${path}.json`);
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await _fetchWithTimeout(url.toString(), {
    method: 'GET',
    headers: _nexusModsHeaders(),
    credentials: 'omit',
    widgetFetchKey: fetchKey,
    widgetType: 'nexusModsTracker',
    maxResponseBytes: 1024 * 1024
  }, 20000);
  const payload = await _nexusModsResponsePayload(response);
  return { response, payload, rate: _nexusModsRateInfo(response) };
}

const NEXUS_MODS_FEED_QUERY = `
  query MorpheusNexusModsFeed($filter: ModsFilter, $sort: [ModsSort!], $count: Int!) {
    mods(filter: $filter, sort: $sort, count: $count) {
      nodes {
        modId name summary author version createdAt updatedAt endorsements downloads
        pictureUrl adult status uploader { name }
      }
    }
  }
`;

function _nexusModsGraphVariables(game, feed) {
  const sortField = feed === 'updated' ? 'updatedAt' : 'createdAt';
  return {
    filter: {
      filter: [
        { gameDomainName: { value: game.domain, op: 'EQUALS' } },
        { status: { value: 'published', op: 'EQUALS' } }
      ],
      op: 'AND'
    },
    sort: [{ [sortField]: { direction: 'DESC' } }],
    count: NEXUS_MODS_FEED_LIMIT
  };
}

async function _nexusModsGraphFeed(widget, game, feed) {
  const response = await _fetchWithTimeout(NEXUS_MODS_GRAPHQL_ROOT, {
    method: 'POST',
    headers: { ..._nexusModsHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operationName: 'MorpheusNexusModsFeed',
      query: NEXUS_MODS_FEED_QUERY,
      variables: _nexusModsGraphVariables(game, feed)
    }),
    credentials: 'omit',
    widgetFetchKey: `nexus-mods:${widget.id}:${game.domain}:${feed}:graphql`,
    widgetType: 'nexusModsTracker',
    maxResponseBytes: 1024 * 1024
  }, 20000);
  const payload = await _nexusModsResponsePayload(response);
  if (!response.ok || payload?.errors?.length) {
    const detail = payload?.errors?.map(error => error?.message).filter(Boolean).join(' ');
    const error = new Error(detail || _nexusModsResponseError(response, payload, game.name));
    error.status = response.status;
    throw error;
  }
  if (!Array.isArray(payload?.data?.mods?.nodes)) throw new Error('Nexus Mods returned an invalid recent-mods feed.');
  const items = payload.data.mods.nodes
    .map(mod => _nexusModsNormalizeMod(mod, game, feed))
    .filter(Boolean)
    .slice(0, NEXUS_MODS_FEED_LIMIT);
  return { items, rate: _nexusModsRateInfo(response) };
}

function _nexusModsNormalizeCatalog(payload) {
  return (Array.isArray(payload) ? payload : [])
    .map(game => ({
      id: Math.max(0, Number(game?.id) || 0),
      domain: _nexusModsDomain(game?.domain_name),
      name: String(game?.name || game?.domain_name || '').trim().slice(0, 120),
      mods: Math.max(0, Number(game?.mods) || 0)
    }))
    .filter(game => game.domain && game.name)
    .sort((left, right) => right.mods - left.mods || left.name.localeCompare(right.name))
    .slice(0, NEXUS_MODS_GAME_CATALOG_LIMIT);
}

async function _nexusModsLoadCatalog(force = false) {
  const cached = WidgetSDK.cache.get('nexusModsTracker', 'shared', 'games');
  if (!force && cached?.fetchedAt && Date.now() - cached.fetchedAt < NEXUS_MODS_GAME_CACHE_TTL_MS && Array.isArray(cached.games)) {
    return cached.games;
  }
  if (!_nexusModsServiceKey()) return cached?.games || [];
  if (_nexusModsCatalogRequest) return _nexusModsCatalogRequest;
  _nexusModsCatalogRequest = _nexusModsRequest('/games', 'nexus-mods:catalog')
    .then(({ response, payload }) => {
      if (!response.ok) throw new Error(_nexusModsResponseError(response, payload));
      const games = _nexusModsNormalizeCatalog(payload);
      if (!games.length) throw new Error('Nexus Mods returned an empty game catalogue.');
      WidgetSDK.cache.set('nexusModsTracker', 'shared', 'games', { fetchedAt: Date.now(), games });
      return games;
    })
    .finally(() => { _nexusModsCatalogRequest = null; });
  return _nexusModsCatalogRequest;
}

function _nexusModsTimestamp(secondsValue, dateValue) {
  const seconds = Number(secondsValue);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  const parsed = Date.parse(String(dateValue || ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function _nexusModsImageUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const hostname = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (hostname === 'nexusmods.com' || hostname.endsWith('.nexusmods.com')) ? url.href : '';
  } catch {
    return '';
  }
}

function _nexusModsNormalizeMod(value, game, feed, feedTimestamp = 0) {
  const id = Math.max(0, Number(value?.mod_id ?? value?.modId) || 0);
  if (!id) return null;
  const available = value?.available !== false && !['removed', 'wastebinned', 'hidden', 'under_moderation', 'not_published', 'publish_with_game'].includes(String(value?.status || '').toLowerCase());
  if (!available) return null;
  return {
    id,
    gameDomain: game.domain,
    gameName: game.name,
    name: String(value?.name || `Mod #${id}`).trim().slice(0, 180),
    summary: String(value?.summary || '').replace(/\s+/g, ' ').trim().slice(0, 320),
    author: String(value?.author || value?.uploaded_by || value?.uploader?.name || '').trim().slice(0, 100),
    version: String(value?.version || '').trim().slice(0, 60),
    createdAt: _nexusModsTimestamp(value?.created_timestamp, value?.createdAt),
    updatedAt: Math.max(0, Number(feedTimestamp) || _nexusModsTimestamp(value?.updated_timestamp, value?.updatedAt)),
    endorsements: Math.max(0, Number(value?.endorsement_count ?? value?.endorsements) || 0),
    downloads: Math.max(0, Number(value?.mod_downloads ?? value?.downloads) || 0),
    adult: value?.contains_adult_content === true || value?.adult === true,
    available,
    status: String(value?.status || '').slice(0, 40),
    feed,
    imageUrl: _nexusModsImageUrl(value?.picture_url || value?.pictureUrl),
    url: `https://www.nexusmods.com/${encodeURIComponent(game.domain)}/mods/${id}`
  };
}

function _nexusModsNormalizeUpdateEntries(payload) {
  const seen = new Set();
  return (Array.isArray(payload) ? payload : [])
    .map(entry => ({
      id: Math.max(0, Number(entry?.mod_id) || 0),
      updatedAt: Math.max(0, Number(entry?.latest_file_update) || 0) * 1000
    }))
    .filter(entry => {
      if (!entry.id || !entry.updatedAt || seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    })
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, NEXUS_MODS_FEED_LIMIT);
}

function _nexusModsFeedCache(widgetId, domain, feed) {
  return WidgetSDK.cache.get('nexusModsTracker', widgetId, `feed:${domain}:${feed}`);
}

function _nexusModsFeedIsFresh(cache, widget, force = false) {
  if (!cache?.fetchedAt || cache.version !== NEXUS_MODS_FEED_CACHE_VERSION) return false;
  const ttl = force ? NEXUS_MODS_MANUAL_REFRESH_FLOOR_MS : _nexusModsRefreshMinutes(widget.config?.refreshMinutes) * 60 * 1000;
  return Date.now() - cache.fetchedAt < ttl;
}

async function _nexusModsLoadOneFeed(widget, game, feed, force = false) {
  const current = _nexusModsFeedCache(widget.id, game.domain, feed);
  if (_nexusModsFeedIsFresh(current, widget, force)) return current;
  if (feed === 'added') {
    try {
      const graph = await _nexusModsGraphFeed(widget, game, feed);
      const next = { version: NEXUS_MODS_FEED_CACHE_VERSION, fetchedAt: Date.now(), game, feed, items: graph.items, rate: graph.rate };
      WidgetSDK.cache.set('nexusModsTracker', widget.id, `feed:${game.domain}:${feed}`, next);
      return next;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
    }
  }
  if (feed === 'updated') return _nexusModsLoadUpdatedFeed(widget, game);
  const { response, payload, rate } = await _nexusModsRequest(
    `/games/${encodeURIComponent(game.domain)}/mods/latest_added`,
    `nexus-mods:${widget.id}:${game.domain}:${feed}`
  );
  if (!response.ok) {
    const error = new Error(_nexusModsResponseError(response, payload, game.name));
    error.status = response.status;
    throw error;
  }
  const items = (Array.isArray(payload) ? payload : [])
    .slice(0, NEXUS_MODS_FEED_LIMIT)
    .map(mod => _nexusModsNormalizeMod(mod, game, feed))
    .filter(Boolean)
    .slice(0, NEXUS_MODS_FEED_LIMIT);
  const next = { version: NEXUS_MODS_FEED_CACHE_VERSION, fetchedAt: Date.now(), game, feed, items, rate };
  WidgetSDK.cache.set('nexusModsTracker', widget.id, `feed:${game.domain}:${feed}`, next);
  return next;
}

async function _nexusModsLoadUpdatedFeed(widget, game) {
  const domain = encodeURIComponent(game.domain);
  const updates = await _nexusModsRequest(
    `/games/${domain}/mods/updated`,
    `nexus-mods:${widget.id}:${game.domain}:updated:index`,
    { period: '1m' }
  );
  if (!updates.response.ok) {
    const error = new Error(_nexusModsResponseError(updates.response, updates.payload, game.name));
    error.status = updates.response.status;
    throw error;
  }

  const entries = _nexusModsNormalizeUpdateEntries(updates.payload);
  const results = await Promise.allSettled(entries.map(async entry => {
    const detail = await _nexusModsRequest(
      `/games/${domain}/mods/${entry.id}`,
      `nexus-mods:${widget.id}:${game.domain}:updated:${entry.id}`
    );
    if (!detail.response.ok) {
      if ([403, 404].includes(detail.response.status)) return { item: null, rate: detail.rate };
      const error = new Error(_nexusModsResponseError(detail.response, detail.payload, game.name));
      error.status = detail.response.status;
      throw error;
    }
    return { item: _nexusModsNormalizeMod(detail.payload, game, 'updated', entry.updatedAt), rate: detail.rate };
  }));

  const fulfilled = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  const items = fulfilled.map(result => result.item).filter(Boolean).slice(0, NEXUS_MODS_FEED_LIMIT);
  const failed = results.find(result => result.status === 'rejected');
  if (entries.length && !items.length && failed) throw failed.reason;
  const rate = [...fulfilled].reverse().find(result => result.rate)?.rate || updates.rate;
  const next = { version: NEXUS_MODS_FEED_CACHE_VERSION, fetchedAt: Date.now(), game, feed: 'updated', items, rate };
  WidgetSDK.cache.set('nexusModsTracker', widget.id, `feed:${game.domain}:updated`, next);
  return next;
}

async function _nexusModsLoadFeed(widget, feed, options = {}) {
  const config = _nexusModsConfig(widget);
  const runtime = _nexusModsState(widget);
  if (!_nexusModsServiceKey() || !config.games.length || runtime.loading) return false;
  const force = options.force === true;
  const work = config.games.filter(game => !_nexusModsFeedIsFresh(_nexusModsFeedCache(widget.id, game.domain, feed), widget, force));
  if (!work.length) return false;
  runtime.loading = true;
  runtime.errors = {};
  try {
    const results = await Promise.allSettled(work.map(game => _nexusModsLoadOneFeed(widget, game, feed, force)));
    results.forEach((result, index) => {
      const game = work[index];
      if (result.status === 'fulfilled') {
        if (result.value?.rate) runtime.rate = result.value.rate;
      } else if (result.reason?.name !== 'AbortError') {
        runtime.errors[game.domain] = result.reason?.message || `Could not load ${game.name}.`;
      }
    });
    return results.some(result => result.status === 'fulfilled');
  } finally {
    runtime.loading = false;
    _refreshWidget(widget.id, 'column');
  }
}

function _nexusModsItems(widget, feed) {
  const config = _nexusModsConfig(widget);
  return config.games.flatMap(game => {
    const cache = _nexusModsFeedCache(widget.id, game.domain, feed);
    return (Array.isArray(cache?.items) ? cache.items : [])
      .filter(item => item?.available !== false && (config.showAdult || !item.adult));
  })
    .sort((left, right) => {
      const leftTime = feed === 'updated' ? left.updatedAt : left.createdAt;
      const rightTime = feed === 'updated' ? right.updatedAt : right.createdAt;
      return rightTime - leftTime || left.name.localeCompare(right.name);
    });
}

function _nexusModsFormatCount(value) {
  try { return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value || 0); }
  catch { return String(value || 0); }
}

function _nexusModsFormatDate(timestamp) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const elapsedDays = Math.round((timestamp - Date.now()) / 86400000);
  if (Math.abs(elapsedDays) < 30) {
    try { return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(elapsedDays, 'day'); } catch {}
  }
  return new Date(timestamp).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function _nexusModsRemoveWidgetCaches(widget) {
  for (const game of _nexusModsNormalizeGames(widget.config?.games)) {
    for (const feed of NEXUS_MODS_FEEDS) WidgetSDK.cache.remove('nexusModsTracker', widget.id, `feed:${game.domain}:${feed}`);
  }
  WidgetSDK.cache.remove('nexusModsTracker', widget.id, 'view');
}

WIDGET_REGISTRY['nexusModsTracker'] = {
  name: 'Nexus Mods Tracker',
  category: 'Gaming',
  description: 'Browse recently added and updated mods for one Nexus Mods game',
  allowedIn: ['column'],
  defaultConfig: {
    games: [],
    itemsPerGame: 5,
    refreshMinutes: NEXUS_MODS_DEFAULT_REFRESH_MINUTES,
    showSummaries: true,
    showAdult: false
  },
  defaultData: {},
  settingsPanelWidth: 'wide',
  liveSettingsPreview: false,

  migrate(widget) {
    const retainedDomain = _nexusModsNormalizeGames(widget.config?.games)[0]?.domain || '';
    for (const entry of (Array.isArray(widget.config?.games) ? widget.config.games : [])) {
      const domain = _nexusModsDomain(typeof entry === 'string' ? entry : entry?.domain);
      if (!domain || domain === retainedDomain) continue;
      for (const feed of NEXUS_MODS_FEEDS) WidgetSDK.cache.remove('nexusModsTracker', widget.id, `feed:${domain}:${feed}`);
    }
    _nexusModsConfig(widget);
    widget.data = {};
    return widget;
  },

  cleanup(widget) {
    _nexusModsRuntime.delete(widget.id);
    _nexusModsRemoveWidgetCaches(widget);
  },

  reload(widget) {
    const runtime = _nexusModsState(widget);
    return _nexusModsLoadFeed(widget, runtime.activeFeed, { force: true });
  },

  onSettingsCommit(widget, previousConfig = {}) {
    const retained = new Set(_nexusModsConfig(widget).games.map(game => game.domain));
    for (const oldGame of _nexusModsNormalizeGames(previousConfig.games)) {
      if (retained.has(oldGame.domain)) continue;
      for (const feed of NEXUS_MODS_FEEDS) WidgetSDK.cache.remove('nexusModsTracker', widget.id, `feed:${oldGame.domain}:${feed}`);
    }
    _nexusModsRuntime.delete(widget.id);
  },

  beforeSettingsCommit(widget) {
    const config = _nexusModsConfig(widget);
    if (!config.games.length) {
      if (typeof showNotice === 'function') showNotice('Select a Nexus Mods game.');
      return false;
    }
    return true;
  },

  render(widget, el, context) {
    const config = _nexusModsConfig(widget);
    const runtime = _nexusModsState(widget);
    const apiKey = _nexusModsServiceKey();
    el.className = 'widget-nexus-mods-tracker';

    _setWidgetRefresher(widget.id, context, () => {
      if (!el.isConnected) return _widgetRefreshers.delete(`${widget.id}:${context}`);
      el.innerHTML = '';
      WIDGET_REGISTRY.nexusModsTracker.render(widget, el, context);
    });

    if (!config.games.length) {
      const state = document.createElement('div');
      state.className = 'nexus-mods-state';
      state.textContent = 'Open widget settings and select a game.';
      el.appendChild(state);
      return;
    }

    const title = document.createElement('div');
    title.className = 'nexus-mods-heading';
    title.textContent = _nexusModsTitle(widget);
    el.appendChild(title);

    if (!apiKey) {
      const state = document.createElement('div');
      state.className = 'nexus-mods-state is-warning';
      state.textContent = 'Add a Nexus Mods API key in Settings > API Keys to load this tracker.';
      el.appendChild(state);
      return;
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'nexus-mods-toolbar';
    const tabs = document.createElement('div');
    tabs.className = 'nexus-mods-tabs';
    [['added', 'Recently added'], ['updated', 'Recently updated']].forEach(([feed, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `nexus-mods-tab${runtime.activeFeed === feed ? ' is-active' : ''}`;
      button.textContent = label;
      button.addEventListener('click', event => {
        event.stopPropagation();
        runtime.activeFeed = feed;
        _nexusModsWriteView(widget, runtime);
        _refreshWidget(widget.id, context);
      });
      tabs.appendChild(button);
    });
    toolbar.appendChild(tabs);
    if (runtime.rate && (runtime.rate.daily !== null || runtime.rate.hourly !== null)) {
      const quota = document.createElement('span');
      quota.className = 'nexus-mods-quota';
      quota.textContent = `API ${runtime.rate.daily ?? '—'} daily · ${runtime.rate.hourly ?? '—'} hourly`;
      quota.title = 'Remaining Nexus Mods API requests reported by the provider';
      toolbar.appendChild(quota);
    }
    el.appendChild(toolbar);

    const feed = runtime.activeFeed;
    const items = _nexusModsItems(widget, feed);
    if (!runtime.loading) void _nexusModsLoadFeed(widget, feed);
    _setWidgetTimer(widget.id, context, () => {
      void _nexusModsLoadFeed(widget, runtime.activeFeed);
    }, config.refreshMinutes * 60 * 1000);

    const errors = Object.values(runtime.errors);
    if (errors.length) {
      const warning = document.createElement('div');
      warning.className = 'nexus-mods-state is-warning';
      warning.textContent = [...new Set(errors)].join(' ');
      el.appendChild(warning);
    }

    if (!items.length) {
      const state = document.createElement('div');
      state.className = 'nexus-mods-state';
      state.textContent = runtime.loading ? 'Loading Nexus Mods…' : (errors.length ? 'No cached results are available.' : 'No matching mods were returned.');
      el.appendChild(state);
    } else {
      const list = document.createElement('div');
      list.className = `nexus-mods-list widget-interactive-surface${config.showSummaries ? ' has-summaries' : ''}`;
      list.style.maxHeight = `${_nexusModsListHeight(config)}px`;
      items.forEach(item => {
        const article = document.createElement('article');
        article.className = `nexus-mods-item${item.imageUrl ? ' has-image' : ''}`;
        const content = document.createElement('div');
        content.className = 'nexus-mods-item-content';
        const titleRow = document.createElement('div');
        titleRow.className = 'nexus-mods-title-row';
        if (item.adult) {
          const badge = document.createElement('span');
          badge.className = 'nexus-mods-badge';
          badge.textContent = 'Adult';
          titleRow.appendChild(badge);
        }
        const heading = document.createElement(item.url ? 'a' : 'div');
        heading.className = 'nexus-mods-item-title';
        heading.textContent = item.name;
        if (item.url) {
          heading.href = item.url;
          heading.target = '_blank';
          heading.rel = 'noreferrer noopener';
          heading.addEventListener('mousedown', event => event.stopPropagation());
        }
        titleRow.appendChild(heading);
        const meta = document.createElement('div');
        meta.className = 'nexus-mods-meta';
        const timestamp = feed === 'updated' ? item.updatedAt : item.createdAt;
        const values = [
          item.author ? `by ${item.author}` : '',
          item.version ? `v${item.version}` : '',
          _nexusModsFormatDate(timestamp),
          `${_nexusModsFormatCount(item.endorsements)} endorsements`,
          `${_nexusModsFormatCount(item.downloads)} downloads`
        ].filter(Boolean);
        meta.textContent = values.join(' · ');
        content.append(titleRow, meta);
        if (config.showSummaries && item.summary) {
          const summary = document.createElement('p');
          summary.className = 'nexus-mods-summary';
          summary.textContent = item.summary;
          content.appendChild(summary);
        }
        let image = null;
        if (item.imageUrl) {
          image = document.createElement('img');
          image.className = 'nexus-mods-image';
          image.src = item.imageUrl;
          image.alt = '';
          image.loading = 'lazy';
          image.decoding = 'async';
          image.referrerPolicy = 'no-referrer';
          image.addEventListener('error', () => {
            image.hidden = true;
            article.classList.remove('has-image');
          }, { once: true });
        }
        if (image) article.appendChild(image);
        article.appendChild(content);
        list.appendChild(article);
      });
      el.appendChild(list);
    }

    const footer = document.createElement('div');
    footer.className = 'nexus-mods-footer';
    footer.append('Read-only data from ');
    const provider = document.createElement('a');
    provider.href = 'https://www.nexusmods.com/';
    provider.target = '_blank';
    provider.rel = 'noreferrer noopener';
    provider.textContent = 'Nexus Mods';
    footer.append(provider);
    el.appendChild(footer);
  },

  renderSettings(widget, container) {
    const config = _nexusModsConfig(widget);
    container.innerHTML = `
      <div class="settings-section nexus-mods-settings-games">
        <div class="settings-section-label">Game</div>
        <div class="nexus-mods-game-picker">
          <div class="nexus-mods-game-add">
            <input type="search" class="settings-text-input nexus-mods-game-query" list="nexusModsGameOptions" placeholder="Search or enter a Nexus game domain" autocomplete="off" />
            <datalist id="nexusModsGameOptions"></datalist>
            <button type="button" class="secondary-btn nexus-mods-game-add-btn">Select</button>
          </div>
          <div class="nexus-mods-game-picker-status settings-help">Loading the Nexus Mods game catalogue…</div>
          <div class="nexus-mods-selected-games"></div>
        </div>
      </div>
      <div class="settings-section">
        <div class="settings-section-label">Display & refresh</div>
        <div class="settings-row"><span>Mods displayed</span><select class="settings-select" data-cfg="itemsPerGame">
          ${[5, 10].map(value => `<option value="${value}" ${config.itemsPerGame === value ? 'selected' : ''}>${value}</option>`).join('')}
        </select></div>
        <div class="settings-help">Sets how many mod cards are visible at once. Scroll the feed to browse up to ${NEXUS_MODS_FEED_LIMIT} results.</div>
        <div class="settings-row"><span>Automatic refresh</span><select class="settings-select" data-cfg="refreshMinutes">
          ${[[60, 'Hourly'], [180, 'Every 3 hours'], [360, 'Every 6 hours'], [720, 'Every 12 hours']].map(([value, label]) => `<option value="${value}" ${config.refreshMinutes === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select></div>
        <div class="settings-row"><span>Show summaries</span><label class="settings-toggle"><input type="checkbox" data-cfg="showSummaries" ${config.showSummaries ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
        <div class="settings-row"><span>Show adult-tagged mods</span><label class="settings-toggle"><input type="checkbox" data-cfg="showAdult" ${config.showAdult ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
        <div class="settings-help">This tracker only reads compact mod metadata and opens Nexus Mods pages. It never downloads, installs, tracks, endorses, or changes provider data.</div>
      </div>`;

    const input = container.querySelector('.nexus-mods-game-query');
    const addButton = container.querySelector('.nexus-mods-game-add-btn');
    const datalist = container.querySelector('#nexusModsGameOptions');
    const selected = container.querySelector('.nexus-mods-selected-games');
    const status = container.querySelector('.nexus-mods-game-picker-status');
    let catalog = [];

    const renderSelected = () => {
      selected.innerHTML = '';
      config.games.forEach(game => {
        const row = document.createElement('div');
        row.className = 'nexus-mods-selected-game';
        const identity = document.createElement('span');
        identity.innerHTML = `<strong>${_escapeWidgetSettingValue(game.name)}</strong><small>${_escapeWidgetSettingValue(game.domain)}</small>`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'icon-btn is-danger';
        remove.textContent = '×';
        remove.title = `Remove ${game.name}`;
        remove.setAttribute('aria-label', remove.title);
        remove.addEventListener('click', () => {
          config.games = config.games.filter(entry => entry.domain !== game.domain);
          renderSelected();
        });
        row.append(identity, remove);
        selected.appendChild(row);
      });
      addButton.textContent = config.games.length ? 'Change' : 'Select';
      if (!config.games.length) {
        const empty = document.createElement('div');
        empty.className = 'settings-help nexus-mods-selected-empty';
        empty.textContent = 'No game selected.';
        selected.appendChild(empty);
      }
    };

    const showPickerStatus = (message, error = false) => {
      status.textContent = message;
      status.classList.toggle('is-error', error);
    };

    const addGame = () => {
      const query = input.value.trim();
      const lowered = query.toLowerCase();
      const match = catalog.find(game => game.domain === _nexusModsDomain(query) || game.name.toLowerCase() === lowered);
      const domain = match?.domain || _nexusModsDomain(query);
      if (!domain) return showPickerStatus('Choose a catalogue result or enter its URL domain, such as skyrimspecialedition.', true);
      if (config.games.some(game => game.domain === domain)) return showPickerStatus('That game is already selected.', true);
      config.games = [{ domain, name: match?.name || domain }];
      input.value = '';
      renderSelected();
      showPickerStatus(catalog.length ? `${catalog.length} games available.` : 'Game added by domain. The catalogue will verify it when the API is available.');
    };

    addButton.addEventListener('click', addGame);
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      addGame();
    });
    renderSelected();

    if (!_nexusModsServiceKey()) {
      showPickerStatus('Add an API key in Settings > API Keys to browse the catalogue. You can enter an exact game domain now.', true);
      return;
    }
    void _nexusModsLoadCatalog().then(games => {
      catalog = games;
      datalist.innerHTML = '';
      games.forEach(game => {
        const option = document.createElement('option');
        option.value = game.domain;
        option.label = `${game.name} · ${_nexusModsFormatCount(game.mods)} mods`;
        datalist.appendChild(option);
      });
      showPickerStatus(`${games.length} games available. Search by name or Nexus URL domain.`);
    }).catch(error => {
      showPickerStatus(`${error?.message || 'The game catalogue is unavailable.'} You can still enter an exact game domain.`, true);
    });
  }
};
