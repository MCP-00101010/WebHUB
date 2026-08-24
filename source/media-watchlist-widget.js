// --- Media Watchlist widget -------------------------------------------------
// Records are provider-neutral and portable. Provider responses remain local.

const _mediaWatchlistRuntime = new Map();
const _mediaWatchlistLocalizedSeasonRequests = new Map();
const MEDIA_WATCHLIST_CACHE_TTL = 24 * 60 * 60 * 1000;
const MEDIA_WATCHLIST_MAX_RECORDS = 500;
const MEDIA_WATCHLIST_MAX_EPISODE_PROGRESS = 20000;
const MEDIA_WATCHLIST_MAX_WIKIS = 20;

function _mediaWatchlistId() { return `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
function _mediaWatchlistWikiId() { return `wiki-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }

function _mediaWatchlistDate(value) {
  const date = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function _mediaWatchlistEpisodeProgress(entry) {
  const source = entry && typeof entry === 'object' ? entry : {};
  const parsedSeason = Number.parseInt(source.season, 10);
  const parsedEpisode = Number.parseInt(source.episode, 10);
  if (!Number.isFinite(parsedEpisode) || parsedEpisode < 1) return null;
  const season = Math.max(0, Number.isFinite(parsedSeason) ? parsedSeason : 0);
  const episode = parsedEpisode;
  return {
    season, episode,
    providerId: String(source.providerId || '').replace(/\D/g, '').slice(0, 20),
    watchedAt: Math.max(0, Number(source.watchedAt) || Date.now())
  };
}

function _mediaWatchlistEpisodeKey(season, episode) {
  return `s${Math.max(0, Number.parseInt(season, 10) || 0)}e${Math.max(1, Number.parseInt(episode, 10) || 1)}`;
}

function _mediaWatchlistWatchedEpisodes(source) {
  const seen = new Set();
  return (Array.isArray(source) ? source : []).slice(0, MEDIA_WATCHLIST_MAX_EPISODE_PROGRESS).map(_mediaWatchlistEpisodeProgress).filter(entry => {
    if (!entry) return false;
    const key = _mediaWatchlistEpisodeKey(entry.season, entry.episode);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function _mediaWatchlistFandomCommunity(value) {
  try {
    const url = new URL(String(value || '').trim());
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || (url.port && url.port !== '443') || !hostname.endsWith('.fandom.com') || hostname === 'www.fandom.com') return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const language = parts[0] && /^[a-z]{2,3}(?:-[a-z]{2})?$/i.test(parts[0]) ? parts[0].toLowerCase() : '';
    const prefix = language ? `/${language}` : '';
    return { communityUrl: `${url.origin}${prefix}`, apiUrl: `${url.origin}${prefix}/api.php`, language };
  } catch { return null; }
}

function _mediaWatchlistFandomPageUrl(communityUrl, title) {
  const community = _mediaWatchlistFandomCommunity(communityUrl);
  if (!community || !String(title || '').trim()) return '';
  const path = String(title).trim().replace(/ /g, '_').split('/').map(part => encodeURIComponent(part)).join('/');
  return `${community.communityUrl}/wiki/${path}`;
}

function _mediaWatchlistWikiSource(source) {
  const item = source && typeof source === 'object' ? source : {};
  const community = _mediaWatchlistFandomCommunity(item.communityUrl || item.pageUrl);
  if (!community) return null;
  let pageUrl = '';
  try {
    const candidate = new URL(String(item.pageUrl || ''));
    const base = new URL(community.communityUrl);
    if (candidate.protocol === 'https:' && candidate.origin === base.origin && candidate.pathname.startsWith(`${base.pathname.replace(/\/$/, '')}/wiki/`)) pageUrl = candidate.href;
  } catch {}
  return {
    id: String(item.id || '').trim().slice(0, 100) || _mediaWatchlistWikiId(),
    label: String(item.label || community.communityUrl.replace(/^https:\/\//, '').replace(/\.fandom\.com/, '')).trim().slice(0, 100) || 'Fandom Wiki',
    language: String(community.language || item.language || '').trim().toLowerCase().slice(0, 16),
    communityUrl: community.communityUrl,
    pageTitle: String(item.pageTitle || '').trim().slice(0, 240),
    pageUrl,
    preferred: item.preferred === true
  };
}

function _mediaWatchlistWikiSources(source) {
  const seen = new Set(); let preferredFound = false;
  const wikis = (Array.isArray(source) ? source : []).slice(0, MEDIA_WATCHLIST_MAX_WIKIS).map(_mediaWatchlistWikiSource).filter(item => {
    if (!item || seen.has(item.communityUrl)) return false;
    seen.add(item.communityUrl);
    if (item.preferred && !preferredFound) preferredFound = true;
    else item.preferred = false;
    return true;
  });
  if (wikis.length && !preferredFound) wikis[0].preferred = true;
  return wikis;
}

function _mediaWatchlistRecord(record) {
  const source = record && typeof record === 'object' ? record : {};
  const type = source.type === 'series' ? 'series' : 'film';
  const upcoming = (Array.isArray(source.upcoming) ? source.upcoming : []).slice(0, 20).map(item => ({
    id: String(item?.id || '').slice(0, 120), title: String(item?.title || '').trim().slice(0, 200),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(item?.date || '')) ? String(item.date) : '',
    kind: ['release','season','episode'].includes(item?.kind) ? item.kind : 'release'
  })).filter(item => item.title && item.date);
  return {
    id: String(source.id || '').trim().slice(0, 100) || _mediaWatchlistId(), type,
    title: String(source.title || '').trim().slice(0, 200) || 'Untitled',
    provider: source.provider === 'tmdb' ? 'tmdb' : '', providerId: String(source.providerId || '').replace(/\D/g, '').slice(0, 20),
    watched: source.watched === true,
    watchedEpisodes: _mediaWatchlistWatchedEpisodes(source.watchedEpisodes),
    progress: { season: Math.max(0, Number.parseInt(source.progress?.season, 10) || 0), episode: Math.max(0, Number.parseInt(source.progress?.episode, 10) || 0) },
    rating: Math.max(0, Math.min(10, Number(source.rating) || 0)), notes: String(source.notes || '').slice(0, 4000),
    showRating: source.showRating !== false, showNotes: source.showNotes !== false,
    wikis: _mediaWatchlistWikiSources(source.wikis),
    notify: source.notify === true, upcoming, addedAt: Number(source.addedAt) || Date.now(), updatedAt: Number(source.updatedAt) || Date.now()
  };
}

function _mediaWatchlistSeriesSummary(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const seasons = (Array.isArray(source.seasons) ? source.seasons : []).slice(0, 200).map(item => ({
    id: String(item?.id || '').replace(/\D/g, '').slice(0, 20),
    number: Math.max(0, Number.parseInt(item?.season_number, 10) || 0),
    name: String(item?.name || '').trim().slice(0, 160),
    airDate: _mediaWatchlistDate(item?.air_date),
    episodeCount: Math.max(0, Number.parseInt(item?.episode_count, 10) || 0)
  })).sort((a, b) => a.number - b.number);
  return {
    name: String(source.name || '').trim().slice(0, 200),
    numberOfSeasons: Math.max(0, Number.parseInt(source.number_of_seasons, 10) || seasons.filter(season => season.number > 0).length),
    numberOfEpisodes: Math.max(0, Number.parseInt(source.number_of_episodes, 10) || seasons.filter(season => season.number > 0).reduce((total, season) => total + season.episodeCount, 0)),
    seasons
  };
}

function _mediaWatchlistSeasonDetails(payload, fallbackSeason = 0) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const seasonNumber = Math.max(0, Number.parseInt(source.season_number, 10) || Math.max(0, Number.parseInt(fallbackSeason, 10) || 0));
  const episodes = (Array.isArray(source.episodes) ? source.episodes : []).slice(0, 500).map(item => ({
    id: String(item?.id || '').replace(/\D/g, '').slice(0, 20),
    season: Math.max(0, Number.parseInt(item?.season_number, 10) || seasonNumber),
    number: Math.max(1, Number.parseInt(item?.episode_number, 10) || 1),
    name: String(item?.name || 'Untitled episode').trim().slice(0, 200),
    airDate: _mediaWatchlistDate(item?.air_date),
    runtime: Math.max(0, Number.parseInt(item?.runtime, 10) || 0),
    overview: String(item?.overview || '').trim().slice(0, 600)
  })).sort((a, b) => a.number - b.number);
  return {
    id: String(source.id || '').replace(/\D/g, '').slice(0, 20),
    number: seasonNumber,
    name: String(source.name || '').trim().slice(0, 160),
    airDate: _mediaWatchlistDate(source.air_date),
    episodes
  };
}

function _mediaWatchlistEpisodeIsAired(episode, today = new Date().toISOString().slice(0, 10)) {
  const cutoff = typeof today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : new Date().toISOString().slice(0, 10);
  return Boolean(episode?.airDate && episode.airDate <= cutoff);
}

function _mediaWatchlistEpisodeIsWatched(record, episode) {
  const key = _mediaWatchlistEpisodeKey(episode?.season, episode?.number);
  return record.watchedEpisodes.some(entry => _mediaWatchlistEpisodeKey(entry.season, entry.episode) === key);
}

function _mediaWatchlistSetEpisodeWatched(record, episode, watched) {
  const key = _mediaWatchlistEpisodeKey(episode?.season, episode?.number);
  record.watchedEpisodes = record.watchedEpisodes.filter(entry => _mediaWatchlistEpisodeKey(entry.season, entry.episode) !== key);
  if (watched) record.watchedEpisodes.push(_mediaWatchlistEpisodeProgress({
    season: episode?.season, episode: episode?.number, providerId: episode?.id, watchedAt: Date.now()
  }));
  record.watchedEpisodes = _mediaWatchlistWatchedEpisodes(record.watchedEpisodes);
}

function _mediaWatchlistSeriesProgress(record, summary, loadedSeasons = {}) {
  const regularWatched = record.watchedEpisodes.filter(entry => entry.season > 0).length;
  const total = Math.max(0, Number(summary?.numberOfEpisodes) || 0);
  const loadedEpisodes = Object.values(loadedSeasons).flatMap(state => state?.details?.episodes || []).filter(episode => episode.season > 0);
  const releasedLoaded = loadedEpisodes.filter(_mediaWatchlistEpisodeIsAired);
  const releasedWatched = releasedLoaded.filter(episode => _mediaWatchlistEpisodeIsWatched(record, episode)).length;
  return { watched: regularWatched, total, releasedLoaded: releasedLoaded.length, releasedWatched };
}

function _mediaWatchlistNextEpisode(record, summary, loadedSeasons = {}) {
  const today = new Date().toISOString().slice(0, 10);
  for (const season of (summary?.seasons || []).filter(item => item.number > 0)) {
    const details = loadedSeasons[season.number]?.details;
    if (details) {
      const next = details.episodes.find(episode => _mediaWatchlistEpisodeIsAired(episode, today) && !_mediaWatchlistEpisodeIsWatched(record, episode));
      if (next) return next;
      continue;
    }
    if (!season.airDate || season.airDate > today) continue;
    for (let episode = 1; episode <= season.episodeCount; episode += 1) {
      const candidate = { season: season.number, number: episode, name: '', airDate: '' };
      if (!_mediaWatchlistEpisodeIsWatched(record, candidate)) return candidate;
    }
  }
  return null;
}

function _mediaWatchlistRecords(widget) {
  widget.data = widget.data || {};
  const seen = new Set();
  widget.data.records = (Array.isArray(widget.data.records) ? widget.data.records : []).slice(0, MEDIA_WATCHLIST_MAX_RECORDS).map(_mediaWatchlistRecord).filter(record => {
    if (seen.has(record.id)) return false; seen.add(record.id); return true;
  });
  widget.config = widget.config || {};
  widget.config.provider = widget.config.provider === 'tmdb' ? 'tmdb' : 'none';
  widget.config.showWatched = widget.config.showWatched !== false;
  widget.config.includeInCalendar = widget.config.includeInCalendar === true;
  widget.config.notifications = widget.config.notifications === true;
  widget.config.sort = ['added','title','release'].includes(widget.config.sort) ? widget.config.sort : 'added';
  return widget.data.records;
}

function _mediaWatchlistSave(widget, rerender = true) {
  widget.data.records = _mediaWatchlistRecords(widget);
  widget.data.records.forEach(record => { record.updatedAt = Date.now(); });
  if (typeof invalidateCommandPaletteIndex === 'function') invalidateCommandPaletteIndex();
  if (typeof saveState === 'function') void saveState();
  if (rerender) { _refreshWidget(widget.id, 'column'); _refreshWidget(widget.id, 'navpane'); }
}

function _mediaWatchlistPushUndo() { if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot(); }

async function _mediaWatchlistToken(widget) {
  return typeof getServiceSecret === 'function' ? String(getServiceSecret('tmdb') || '').trim() : '';
}

async function _mediaWatchlistTmdb(widget, path, params = {}) {
  const token = await _mediaWatchlistToken(widget);
  if (!token) throw new Error('Add a TMDB API Read Access Token in Settings > API Keys.');
  const url = new URL(`https://api.themoviedb.org/3/${String(path).replace(/^\/+/, '')}`);
  Object.entries(params).forEach(([key, value]) => { if (value !== '' && value != null) url.searchParams.set(key, value); });
  const response = await _fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, credentials: 'omit',
    widgetType: 'mediaWatchlist', widgetFetchKey: `media-watchlist:${widget.id}:${path}`, maxResponseBytes: 512 * 1024
  }, 15000);
  if (response.status === 429) throw new Error('TMDB rate limit reached. Try again shortly.');
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.status_message || `TMDB returned ${response.status}`);
  return payload;
}

async function _mediaWatchlistFandomRequest(widget, communityUrl, params = {}) {
  const community = _mediaWatchlistFandomCommunity(communityUrl);
  if (!community) throw new Error('Enter an HTTPS Fandom community URL, such as https://memory-alpha.fandom.com/wiki/.');
  const url = new URL(community.apiUrl);
  Object.entries({ ...params, format: 'json', formatversion: '2', origin: '*' }).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await _fetchWithTimeout(url, {
    credentials: 'omit', widgetType: 'mediaWatchlist',
    widgetFetchKey: `media-watchlist:${widget.id}:fandom:${url.hostname}:${url.pathname}:${params.action || 'query'}`,
    maxResponseBytes: 256 * 1024
  }, 15000);
  const payload = await response.json();
  if (!response.ok) throw new Error(`Fandom returned ${response.status}.`);
  if (payload?.error) throw new Error(payload.error.info || payload.error.code || 'Fandom API request failed.');
  return payload;
}

async function _mediaWatchlistVerifyFandom(widget, communityUrl) {
  const community = _mediaWatchlistFandomCommunity(communityUrl);
  if (!community) throw new Error('Enter an HTTPS URL for a Fandom community.');
  const payload = await _mediaWatchlistFandomRequest(widget, community.communityUrl, { action: 'query', meta: 'siteinfo', siprop: 'general' });
  const general = payload?.query?.general || {};
  return {
    ...community,
    label: String(general.sitename || '').trim().slice(0, 100),
    language: String(general.lang || community.language || '').trim().toLowerCase().slice(0, 16)
  };
}

function _mediaWatchlistPlainText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

async function _mediaWatchlistSearchFandom(widget, wiki, query) {
  const normalized = String(query || '').trim().slice(0, 160);
  if (!normalized) return [];
  const community = _mediaWatchlistFandomCommunity(wiki?.communityUrl);
  if (!community) throw new Error('This Fandom community URL is invalid.');
  const cacheKey = `fandom-search:${community.communityUrl}:${normalized.toLowerCase()}`;
  const cached = WidgetSDK.cache.get('mediaWatchlist', widget.id, cacheKey);
  if (cached) return cached;
  const payload = await _mediaWatchlistFandomRequest(widget, community.communityUrl, {
    action: 'query', list: 'search', srsearch: normalized, srnamespace: '0', srlimit: '8', srprop: 'snippet'
  });
  const results = (Array.isArray(payload?.query?.search) ? payload.query.search : []).slice(0, 8).map(item => ({
    title: String(item?.title || '').trim().slice(0, 240),
    snippet: _mediaWatchlistPlainText(item?.snippet).slice(0, 400),
    pageUrl: _mediaWatchlistFandomPageUrl(community.communityUrl, item?.title)
  })).filter(item => item.title && item.pageUrl);
  try { WidgetSDK.cache.set('mediaWatchlist', widget.id, cacheKey, results, { ttlMs: MEDIA_WATCHLIST_CACHE_TTL }); } catch {}
  return results;
}

async function _mediaWatchlistSearch(widget, query, type = 'multi') {
  const normalized = String(query || '').trim().slice(0, 160);
  if (!normalized) return [];
  const key = `search:${type}:${normalized.toLowerCase()}`;
  const cached = WidgetSDK.cache.get('mediaWatchlist', widget.id, key);
  if (cached) return cached;
  const payload = await _mediaWatchlistTmdb(widget, 'search/multi', { query: normalized, include_adult: 'false', language: 'en-GB' });
  const results = (payload?.results || []).filter(item => item.media_type === 'movie' || item.media_type === 'tv').slice(0, 10).map(item => ({
    provider: 'tmdb', providerId: String(item.id), type: item.media_type === 'tv' ? 'series' : 'film',
    title: String(item.title || item.name || 'Untitled').slice(0, 200), date: String(item.release_date || item.first_air_date || ''),
    overview: String(item.overview || '').slice(0, 500)
  }));
  try { WidgetSDK.cache.set('mediaWatchlist', widget.id, key, results, { ttlMs: MEDIA_WATCHLIST_CACHE_TTL }); } catch {}
  return results;
}

async function _mediaWatchlistHydrate(widget, record) {
  if (record.provider !== 'tmdb' || !record.providerId) return record;
  const kind = record.type === 'series' ? 'tv' : 'movie';
  const key = `details:${kind}:${record.providerId}`;
  let details = WidgetSDK.cache.get('mediaWatchlist', widget.id, key);
  if (!details) {
    details = await _mediaWatchlistTmdb(widget, `${kind}/${record.providerId}`);
    try { WidgetSDK.cache.set('mediaWatchlist', widget.id, key, details, { ttlMs: MEDIA_WATCHLIST_CACHE_TTL }); } catch {}
  }
  record.title = String(details.title || details.name || record.title).slice(0, 200);
  const upcoming = [];
  const today = new Date().toISOString().slice(0, 10);
  if (kind === 'movie' && String(details.release_date || '') >= today) upcoming.push({ id: `release-${record.providerId}`, title: `${record.title} release`, date: details.release_date, kind: 'release' });
  if (kind === 'tv' && details.next_episode_to_air?.air_date >= today) upcoming.push({
    id: `episode-${details.next_episode_to_air.id || details.next_episode_to_air.air_date}`,
    title: `${record.title} · S${details.next_episode_to_air.season_number}E${details.next_episode_to_air.episode_number}${details.next_episode_to_air.name ? ` · ${details.next_episode_to_air.name}` : ''}`,
    date: details.next_episode_to_air.air_date, kind: 'episode'
  });
  if (kind === 'tv') {
    try { WidgetSDK.cache.set('mediaWatchlist', widget.id, `series:${record.providerId}`, _mediaWatchlistSeriesSummary(details), { ttlMs: MEDIA_WATCHLIST_CACHE_TTL }); } catch {}
  }
  record.upcoming = upcoming; record.updatedAt = Date.now(); return record;
}

function _mediaWatchlistGetSeriesState(runtime, recordId) {
  runtime.series = runtime.series && typeof runtime.series === 'object' ? runtime.series : {};
  runtime.series[recordId] = runtime.series[recordId] || { open: false, showSpecials: false, activeSeason: null, loading: false, error: '', summary: null, seasons: {} };
  runtime.series[recordId].seasons = runtime.series[recordId].seasons && typeof runtime.series[recordId].seasons === 'object' ? runtime.series[recordId].seasons : {};
  return runtime.series[recordId];
}

function _mediaWatchlistNormalizeView(widget, source) {
  const view = source && typeof source === 'object' ? source : {};
  const records = Array.isArray(widget?.data?.records) ? widget.data.records : [];
  const validIds = new Set(records.map(record => String(record?.id || '')).filter(Boolean));
  const detailsOpen = {};
  Object.entries(view.detailsOpen && typeof view.detailsOpen === 'object' ? view.detailsOpen : {}).slice(0, MEDIA_WATCHLIST_MAX_RECORDS).forEach(([recordId, open]) => {
    if (validIds.has(recordId) && open === true) detailsOpen[recordId] = true;
  });
  const series = {};
  Object.entries(view.series && typeof view.series === 'object' ? view.series : {}).slice(0, MEDIA_WATCHLIST_MAX_RECORDS).forEach(([recordId, entry]) => {
    if (!validIds.has(recordId) || !entry || typeof entry !== 'object') return;
    const parsedSeason = Number.parseInt(entry.activeSeason, 10);
    series[recordId] = {
      open: entry.open === true,
      showSpecials: entry.showSpecials === true,
      activeSeason: Number.isFinite(parsedSeason) && parsedSeason >= 0 && parsedSeason <= 1000 ? parsedSeason : null
    };
  });
  return { version: 1, detailsOpen, series };
}

function _mediaWatchlistGetRuntime(widget) {
  let runtime = _mediaWatchlistRuntime.get(widget.id);
  if (runtime) return runtime;
  const view = _mediaWatchlistNormalizeView(widget, WidgetSDK.cache.get('mediaWatchlist', widget.id, 'view'));
  runtime = { detailsOpen: view.detailsOpen, series: {} };
  Object.entries(view.series).forEach(([recordId, entry]) => {
    runtime.series[recordId] = { ...entry, loading: false, error: '', summary: null, seasons: {} };
  });
  _mediaWatchlistRuntime.set(widget.id, runtime);
  return runtime;
}

function _mediaWatchlistWriteView(widget, runtime) {
  const view = _mediaWatchlistNormalizeView(widget, runtime);
  try { WidgetSDK.cache.set('mediaWatchlist', widget.id, 'view', view); } catch {}
  return view;
}

async function _mediaWatchlistLoadSeries(widget, record, seriesState) {
  if (seriesState.summary || seriesState.loading) return seriesState.summary;
  seriesState.loading = true; seriesState.error = '';
  try {
    const key = `series:${record.providerId}`;
    let summary = WidgetSDK.cache.get('mediaWatchlist', widget.id, key);
    if (!summary) {
      const legacyDetails = WidgetSDK.cache.get('mediaWatchlist', widget.id, `details:tv:${record.providerId}`);
      summary = legacyDetails ? _mediaWatchlistSeriesSummary(legacyDetails) : null;
    }
    if (!summary) summary = _mediaWatchlistSeriesSummary(await _mediaWatchlistTmdb(widget, `tv/${record.providerId}`, { language: 'en-GB' }));
    seriesState.summary = summary;
    try { WidgetSDK.cache.set('mediaWatchlist', widget.id, key, summary, { ttlMs: MEDIA_WATCHLIST_CACHE_TTL }); } catch {}
    return summary;
  } catch (error) {
    seriesState.error = error?.message || 'Could not load series details.';
    return null;
  } finally {
    seriesState.loading = false;
  }
}

async function _mediaWatchlistLoadSeason(widget, record, seasonNumber, seriesState) {
  const number = Math.max(0, Number.parseInt(seasonNumber, 10) || 0);
  const seasonState = seriesState.seasons[number] || { open: false, loading: false, error: '', details: null };
  seriesState.seasons[number] = seasonState;
  if (seasonState.details || seasonState.loading) return seasonState.details;
  seasonState.loading = true; seasonState.error = '';
  try {
    const key = `season:${record.providerId}:${number}`;
    let details = WidgetSDK.cache.get('mediaWatchlist', widget.id, key);
    if (!details) details = _mediaWatchlistSeasonDetails(await _mediaWatchlistTmdb(widget, `tv/${record.providerId}/season/${number}`, { language: 'en-GB' }), number);
    seasonState.details = details;
    try { WidgetSDK.cache.set('mediaWatchlist', widget.id, key, details, { ttlMs: MEDIA_WATCHLIST_CACHE_TTL }); } catch {}
    return details;
  } catch (error) {
    seasonState.error = error?.message || `Could not load season ${number}.`;
    return null;
  } finally {
    seasonState.loading = false;
  }
}

function _mediaWatchlistFindWidgets() {
  const found = [];
  const walk = items => (items || []).forEach(item => { if (item?.type === 'widget' && item.widgetType === 'mediaWatchlist') found.push(item); if (Array.isArray(item?.children)) walk(item.children); });
  for (const board of (typeof state !== 'undefined' ? state.boards || [] : [])) for (const tab of (typeof getBoardTabs === 'function' ? getBoardTabs(board) : board.tabs || [])) {
    for (const column of (tab.columns || [])) walk(column.items);
    walk(typeof getBoardInbox === 'function' ? getBoardInbox(board, tab)?.items : tab.inbox?.items);
  }
  walk(typeof state !== 'undefined' ? state.navItems : []);
  return found;
}

function _mediaWatchlistCalendarEvents(source) {
  const events = [];
  _mediaWatchlistFindWidgets().filter(widget => widget.config?.includeInCalendar === true).forEach(widget => {
    _mediaWatchlistRecords(widget).forEach(record => record.upcoming.forEach(item => {
      const start = typeof _calendarDateOnlyTimestamp === 'function' ? _calendarDateOnlyTimestamp(item.date) : new Date(`${item.date}T00:00:00`).getTime();
      if (!Number.isFinite(start)) return;
      const values = { id: `${widget.id}:${record.id}:${item.id || item.date}`, title: item.title, description: record.notes, start, allDay: true };
      events.push(typeof _calendarProviderEvent === 'function' ? _calendarProviderEvent(source, values) : { ...values, end: start + 86400000, sourceId: source.id, sourceName: source.name, color: source.color });
    }));
  });
  return events;
}

function _mediaWatchlistSorted(widget) {
  let records = _mediaWatchlistRecords(widget).filter(record => widget.config.showWatched || !record.watched);
  if (widget.config.sort === 'title') records = records.sort((a, b) => a.title.localeCompare(b.title));
  else if (widget.config.sort === 'release') records = records.sort((a, b) => (a.upcoming[0]?.date || '9999').localeCompare(b.upcoming[0]?.date || '9999'));
  else records = records.sort((a, b) => b.addedAt - a.addedAt);
  return records;
}

function _mediaWatchlistExport(widget) {
  const payload = JSON.stringify({ format: 'morpheus-media-watchlist', version: 3, records: _mediaWatchlistRecords(widget) }, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'morpheus-media-watchlist.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function _mediaWatchlistImport(widget, file, options = {}) {
  if (!file || file.size > 2 * 1024 * 1024) throw new Error('Watchlist imports must be 2 MiB or smaller.');
  const payload = JSON.parse(await file.text());
  const rows = Array.isArray(payload) ? payload : payload?.records;
  if (!Array.isArray(rows)) throw new Error('This file does not contain watchlist records.');
  const existing = new Set(_mediaWatchlistRecords(widget).map(record => `${record.provider}:${record.providerId}:${record.type}:${record.title.toLowerCase()}`));
  const additions = rows.map(_mediaWatchlistRecord).filter(record => !existing.has(`${record.provider}:${record.providerId}:${record.type}:${record.title.toLowerCase()}`));
  if (options.persist === false) {
    widget.data.records = [...widget.data.records, ...additions].slice(0, MEDIA_WATCHLIST_MAX_RECORDS);
  } else {
    _mediaWatchlistPushUndo(); widget.data.records = [...widget.data.records, ...additions].slice(0, MEDIA_WATCHLIST_MAX_RECORDS); _mediaWatchlistSave(widget);
  }
  return additions.length;
}

async function _mediaWatchlistCheckNotifications(widget) {
  if (!widget.config.notifications || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const today = new Date(); const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString().slice(0, 10);
  const notified = WidgetSDK.cache.get('mediaWatchlist', widget.id, 'notified') || {};
  _mediaWatchlistRecords(widget).filter(record => record.notify).forEach(record => record.upcoming.filter(item => item.date <= tomorrow).forEach(item => {
    const key = `${record.id}:${item.id}:${item.date}`;
    if (notified[key]) return;
    try { new Notification(item.title, { body: item.date === tomorrow ? 'Arrives tomorrow' : `Scheduled for ${item.date}` }); notified[key] = Date.now(); } catch {}
  }));
  try { WidgetSDK.cache.set('mediaWatchlist', widget.id, 'notified', notified, { ttlMs: 90 * 86400000 }); } catch {}
}

function _mediaWatchlistSyncLegacyProgress(record) {
  const latest = [...record.watchedEpisodes].sort((a, b) => (b.season - a.season) || (b.episode - a.episode))[0];
  record.progress = latest ? { season: latest.season, episode: latest.episode } : { season: 0, episode: 0 };
}

function _mediaWatchlistTmdbLanguage(value) {
  const normalized = String(value || '').trim().replace('_', '-').toLowerCase();
  if (!/^[a-z]{2,3}(?:-[a-z]{2})?$/.test(normalized)) return '';
  const [language, region] = normalized.split('-');
  if (region) return `${language}-${region.toUpperCase()}`;
  const regions = {
    ar: 'SA', bg: 'BG', ca: 'ES', cs: 'CZ', da: 'DK', de: 'DE', el: 'GR', en: 'US', es: 'ES',
    eu: 'ES', fa: 'IR', fi: 'FI', fr: 'FR', he: 'IL', hi: 'IN', hu: 'HU', id: 'ID', it: 'IT',
    ja: 'JP', ko: 'KR', lt: 'LT', nb: 'NO', nl: 'NL', no: 'NO', pl: 'PL', pt: 'PT', ro: 'RO',
    ru: 'RU', sk: 'SK', sr: 'RS', sv: 'SE', th: 'TH', tr: 'TR', uk: 'UA', vi: 'VN', zh: 'CN'
  };
  return regions[language] ? `${language}-${regions[language]}` : language;
}

function _mediaWatchlistWikiLanguage(wiki) {
  const communityLanguage = _mediaWatchlistFandomCommunity(wiki?.communityUrl)?.language || '';
  const configuredLanguage = String(wiki?.language || '').trim().toLowerCase();
  return communityLanguage || configuredLanguage;
}

function _mediaWatchlistLocalizedSeasonCacheKey(record, season, language) {
  return `localized-season:${record.providerId}:s${Math.max(0, Number.parseInt(season, 10) || 0)}:${_mediaWatchlistTmdbLanguage(language)}`;
}

function _mediaWatchlistCachedLocalizedEpisodeName(widget, record, episode, language) {
  const tmdbLanguage = _mediaWatchlistTmdbLanguage(language);
  if (!tmdbLanguage || tmdbLanguage.startsWith('en-')) return String(episode?.name || '').trim();
  const cached = WidgetSDK.cache.get('mediaWatchlist', widget.id, _mediaWatchlistLocalizedSeasonCacheKey(record, episode?.season, tmdbLanguage));
  const localized = cached?.episodes?.find(item => item.number === episode?.number)?.name || '';
  if (!localized || localized.localeCompare(String(episode?.name || ''), undefined, { sensitivity: 'base' }) === 0) return '';
  return localized;
}

async function _mediaWatchlistPrimeLocalizedSeason(widget, record, season, language) {
  const tmdbLanguage = _mediaWatchlistTmdbLanguage(language);
  if (!tmdbLanguage || tmdbLanguage.startsWith('en-') || record.provider !== 'tmdb' || !record.providerId) return;
  const cacheKey = _mediaWatchlistLocalizedSeasonCacheKey(record, season, tmdbLanguage);
  if (WidgetSDK.cache.get('mediaWatchlist', widget.id, cacheKey)) return;
  const requestKey = `${widget.id}:${cacheKey}`;
  if (_mediaWatchlistLocalizedSeasonRequests.has(requestKey)) return _mediaWatchlistLocalizedSeasonRequests.get(requestKey);
  const request = (async () => {
    try {
      const payload = await _mediaWatchlistTmdb(widget, `tv/${record.providerId}/season/${season}`, { language: tmdbLanguage });
      const details = _mediaWatchlistSeasonDetails(payload, season);
      const localizedNames = { episodes: details.episodes.map(episode => ({ number: episode.number, name: episode.name })) };
      WidgetSDK.cache.set('mediaWatchlist', widget.id, cacheKey, localizedNames, { ttlMs: MEDIA_WATCHLIST_CACHE_TTL });
    } catch {
      try { WidgetSDK.cache.set('mediaWatchlist', widget.id, cacheKey, { episodes: [] }, { ttlMs: 60 * 60 * 1000 }); } catch {}
    } finally { _mediaWatchlistLocalizedSeasonRequests.delete(requestKey); }
  })();
  _mediaWatchlistLocalizedSeasonRequests.set(requestKey, request);
  return request;
}

function _mediaWatchlistEpisodeWikiSearchUrl(wiki, record, episode, localizedName = '') {
  const community = _mediaWatchlistFandomCommunity(wiki?.communityUrl);
  if (!community) return '';
  const season = Math.max(0, Number.parseInt(episode?.season, 10) || 0);
  const number = Math.max(1, Number.parseInt(episode?.number, 10) || 1);
  const code = `S${String(season).padStart(2, '0')}E${String(number).padStart(2, '0')}`;
  const language = _mediaWatchlistWikiLanguage(wiki).split('-')[0];
  const title = String(localizedName || (language && language !== 'en' ? '' : episode?.name) || '').trim();
  const query = (title || code).slice(0, 320);
  const url = new URL(`${community.communityUrl}/wiki/Special:Search`);
  url.searchParams.set('query', query);
  return url.href;
}

function _mediaWatchlistShowEpisodeWikiMenu(event, widget, record, episode) {
  if (!record.wikis.length || typeof showContextMenu !== 'function') return;
  event.preventDefault(); event.stopPropagation();
  const code = `S${episode.season}E${episode.number}`;
  const actions = record.wikis.map(wiki => ({
    label: `${wiki.preferred ? '★ ' : ''}Look up ${code} in ${wiki.label}${_mediaWatchlistWikiLanguage(wiki) ? ` · ${_mediaWatchlistWikiLanguage(wiki).toUpperCase()}` : ''}`,
    run: () => {
      const localizedName = _mediaWatchlistCachedLocalizedEpisodeName(widget, record, episode, _mediaWatchlistWikiLanguage(wiki));
      const url = _mediaWatchlistEpisodeWikiSearchUrl(wiki, record, episode, localizedName);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    }
  }));
  showContextMenu(event.clientX, event.clientY, actions);
}

function _mediaWatchlistRenderEpisodeList(widget, record, seasonState, parent) {
  const details = seasonState.details;
  if (!details) return;
  const released = details.episodes.filter(_mediaWatchlistEpisodeIsAired);
  const allReleasedWatched = released.length > 0 && released.every(episode => _mediaWatchlistEpisodeIsWatched(record, episode));
  const toolbar = document.createElement('div'); toolbar.className = 'media-watchlist-season-toolbar';
  const count = document.createElement('span'); count.textContent = `${released.filter(episode => _mediaWatchlistEpisodeIsWatched(record, episode)).length}/${released.length} aired watched`;
  const bulk = document.createElement('button'); bulk.type = 'button'; bulk.className = 'secondary-btn'; bulk.disabled = !released.length; bulk.textContent = allReleasedWatched ? 'Mark aired unwatched' : 'Mark aired watched';
  bulk.addEventListener('click', () => {
    _mediaWatchlistPushUndo();
    released.forEach(episode => _mediaWatchlistSetEpisodeWatched(record, episode, !allReleasedWatched));
    if (!allReleasedWatched) record.watched = false;
    _mediaWatchlistSyncLegacyProgress(record); _mediaWatchlistSave(widget);
  });
  toolbar.append(count, bulk); parent.appendChild(toolbar);
  if (!details.episodes.length) {
    const empty = document.createElement('div'); empty.className = 'widget-empty-state'; empty.textContent = 'TMDB has no episodes listed for this season.'; parent.appendChild(empty); return;
  }
  const list = document.createElement('div'); list.className = 'media-watchlist-episodes';
  [...new Set(record.wikis.map(_mediaWatchlistWikiLanguage).filter(language => language && !String(language).toLowerCase().startsWith('en')))]
    .forEach(language => { void _mediaWatchlistPrimeLocalizedSeason(widget, record, details.number, language); });
  details.episodes.forEach(episode => {
    const aired = _mediaWatchlistEpisodeIsAired(episode);
    const row = document.createElement('label'); row.className = `media-watchlist-episode${aired ? '' : ' is-unaired'}`;
    if (episode.overview) row.title = episode.overview;
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = _mediaWatchlistEpisodeIsWatched(record, episode); checkbox.disabled = !aired;
    checkbox.setAttribute('aria-label', `Mark season ${episode.season} episode ${episode.number} watched`);
    checkbox.addEventListener('change', () => {
      _mediaWatchlistPushUndo(); _mediaWatchlistSetEpisodeWatched(record, episode, checkbox.checked);
      if (checkbox.checked) record.watched = false;
      _mediaWatchlistSyncLegacyProgress(record); _mediaWatchlistSave(widget);
    });
    const number = document.createElement('span'); number.className = 'media-watchlist-episode-number'; number.textContent = `E${String(episode.number).padStart(2, '0')}`;
    const identity = document.createElement('span'); identity.className = 'media-watchlist-episode-identity';
    const title = document.createElement('span'); title.className = 'media-watchlist-episode-title'; title.textContent = episode.name;
    const meta = document.createElement('span'); meta.className = 'media-watchlist-episode-meta'; meta.textContent = episode.airDate ? `${episode.airDate}${episode.runtime ? ` · ${episode.runtime} min` : ''}` : 'Air date TBA';
    if (record.wikis.length) row.addEventListener('contextmenu', event => _mediaWatchlistShowEpisodeWikiMenu(event, widget, record, episode));
    identity.append(title, meta); row.append(checkbox, number, identity); list.appendChild(row);
  });
  parent.appendChild(list);
}

function _mediaWatchlistRenderSeriesTracker(widget, record, parent, runtime, rerender) {
  const seriesState = _mediaWatchlistGetSeriesState(runtime, record.id);
  const panel = document.createElement('section'); panel.className = 'media-watchlist-series-panel'; parent.appendChild(panel);
  if (seriesState.loading && !seriesState.summary) {
    const status = document.createElement('div'); status.className = 'widget-empty-state'; status.textContent = 'Loading seasons…'; panel.appendChild(status); return;
  }
  if (seriesState.error && !seriesState.summary) {
    const error = document.createElement('div'); error.className = 'widget-error-state'; error.textContent = seriesState.error;
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'secondary-btn'; retry.textContent = 'Retry'; retry.addEventListener('click', () => { seriesState.error = ''; void _mediaWatchlistLoadSeries(widget, record, seriesState).then(rerender); rerender(); });
    panel.append(error, retry); return;
  }
  if (!seriesState.summary) {
    void _mediaWatchlistLoadSeries(widget, record, seriesState).then(rerender); rerender(); return;
  }
  const summary = seriesState.summary;
  const progress = _mediaWatchlistSeriesProgress(record, summary, seriesState.seasons);
  const next = _mediaWatchlistNextEpisode(record, summary, seriesState.seasons);
  const overview = document.createElement('div'); overview.className = 'media-watchlist-series-overview';
  const stats = document.createElement('strong'); stats.textContent = `${summary.numberOfSeasons} season${summary.numberOfSeasons === 1 ? '' : 's'} · ${summary.numberOfEpisodes} episodes · ${progress.watched} watched`;
  const nextEl = document.createElement('span'); nextEl.textContent = next ? `Next: S${next.season}E${next.number}${next.name ? ` · ${next.name}` : ''}` : 'No released unwatched episode found';
  overview.append(stats, nextEl); panel.appendChild(overview);
  const specials = summary.seasons.find(season => season.number === 0);
  if (specials) {
    const specialToggle = document.createElement('label'); specialToggle.className = 'media-watchlist-specials-toggle';
    const input = document.createElement('input'); input.type = 'checkbox'; input.checked = seriesState.showSpecials; input.addEventListener('change', () => { seriesState.showSpecials = input.checked; _mediaWatchlistWriteView(widget, runtime); rerender(); });
    specialToggle.append(input, document.createTextNode(` Show specials (${specials.episodeCount})`)); panel.appendChild(specialToggle);
  }
  const visibleSeasons = summary.seasons.filter(season => season.number > 0 || seriesState.showSpecials);
  if (!visibleSeasons.some(season => season.number === seriesState.activeSeason)) {
    seriesState.activeSeason = visibleSeasons[0]?.number ?? null;
    _mediaWatchlistWriteView(widget, runtime);
  }
  const tabs = document.createElement('div'); tabs.className = 'media-watchlist-season-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', `${record.title} seasons`);
  visibleSeasons.forEach(season => {
    const watched = record.watchedEpisodes.filter(entry => entry.season === season.number).length;
    const tab = document.createElement('button'); tab.type = 'button'; tab.className = `media-watchlist-season-tab${seriesState.activeSeason === season.number ? ' is-active' : ''}`;
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(seriesState.activeSeason === season.number));
    tab.title = `${season.name || (season.number === 0 ? 'Specials' : `Season ${season.number}`)} · ${watched}/${season.episodeCount} watched`;
    const label = document.createElement('span'); label.textContent = season.number === 0 ? 'Specials' : `S${season.number}`;
    const count = document.createElement('small'); count.textContent = `${watched}/${season.episodeCount}`;
    tab.append(label, count);
    tab.addEventListener('click', () => { seriesState.activeSeason = season.number; _mediaWatchlistWriteView(widget, runtime); rerender(); });
    tabs.appendChild(tab);
  });
  panel.appendChild(tabs);
  const activeSeason = visibleSeasons.find(season => season.number === seriesState.activeSeason);
  if (!activeSeason) return;
  const seasonState = seriesState.seasons[activeSeason.number] || { loading: false, error: '', details: null };
  seriesState.seasons[activeSeason.number] = seasonState;
  const seasonPanel = document.createElement('div'); seasonPanel.className = 'media-watchlist-season-panel'; seasonPanel.setAttribute('role', 'tabpanel');
  const seasonHeading = document.createElement('div'); seasonHeading.className = 'media-watchlist-season-heading';
  const seasonName = document.createElement('strong'); seasonName.textContent = activeSeason.name || (activeSeason.number === 0 ? 'Specials' : `Season ${activeSeason.number}`);
  const seasonMeta = document.createElement('span'); seasonMeta.textContent = `${activeSeason.episodeCount} episode${activeSeason.episodeCount === 1 ? '' : 's'}${activeSeason.airDate ? ` · ${activeSeason.airDate.slice(0, 4)}` : ''}`;
  seasonHeading.append(seasonName, seasonMeta); seasonPanel.appendChild(seasonHeading);
  if (seasonState.loading) { const status = document.createElement('div'); status.className = 'widget-empty-state'; status.textContent = 'Loading episodes…'; seasonPanel.appendChild(status); }
  else if (seasonState.error) {
    const error = document.createElement('div'); error.className = 'widget-error-state'; error.textContent = seasonState.error;
    const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'secondary-btn'; retry.textContent = 'Retry'; retry.addEventListener('click', () => { seasonState.error = ''; void _mediaWatchlistLoadSeason(widget, record, activeSeason.number, seriesState).then(rerender); rerender(); });
    seasonPanel.append(error, retry);
  } else if (seasonState.details) _mediaWatchlistRenderEpisodeList(widget, record, seasonState, seasonPanel);
  else { void _mediaWatchlistLoadSeason(widget, record, activeSeason.number, seriesState).then(rerender); rerender(); }
  panel.appendChild(seasonPanel);
}

function _mediaWatchlistRenderEditor(widget, record, details) {
  details.querySelector('.media-watchlist-editor')?.remove();
  const grid = document.createElement('div'); grid.className = 'media-watchlist-editor';
  const rating = document.createElement('input'); rating.type = 'number'; rating.min = '0'; rating.max = '10'; rating.step = '0.5'; rating.value = record.rating || ''; rating.placeholder = 'Rating / 10';
  const notes = document.createElement('textarea'); notes.value = record.notes; notes.placeholder = 'Notes'; notes.maxLength = 4000;
  const notify = document.createElement('label'); const notifyInput = document.createElement('input'); notifyInput.type = 'checkbox'; notifyInput.checked = record.notify; notify.append(notifyInput, document.createTextNode(' Notify me about upcoming releases'));
  const save = document.createElement('button'); save.type = 'button'; save.className = 'secondary-btn'; save.textContent = 'Save details'; save.addEventListener('click', () => {
    _mediaWatchlistPushUndo();
    if (record.showRating) record.rating = Math.max(0, Math.min(10, Number(rating.value) || 0));
    if (record.showNotes) record.notes = notes.value.slice(0, 4000);
    record.notify = notifyInput.checked; _mediaWatchlistSave(widget);
  });
  if (record.showRating) grid.appendChild(rating);
  if (record.showNotes) grid.appendChild(notes);
  grid.append(notify, save); details.appendChild(grid);
}

function _mediaWatchlistDetailsLabel(record) {
  const visible = [];
  if (record.type === 'series' && record.provider === 'tmdb' && record.providerId) visible.push('Seasons and episodes');
  if (record.showRating) visible.push('rating');
  if (record.showNotes) visible.push('notes');
  visible.push('notifications');
  return visible.join(', ').replace(/^./, value => value.toUpperCase());
}

function _mediaWatchlistRenderWikiMenu(record) {
  if (!record.wikis.length) return null;
  const menu = document.createElement('details'); menu.className = 'media-watchlist-wiki-menu';
  const summary = document.createElement('summary'); summary.textContent = `Wikis (${record.wikis.length})`; summary.title = 'Open a linked Fandom wiki'; menu.appendChild(summary);
  const links = document.createElement('div'); links.className = 'media-watchlist-wiki-links';
  record.wikis.forEach(wiki => {
    const link = document.createElement('a'); link.href = wiki.pageUrl || wiki.communityUrl; link.target = '_blank'; link.rel = 'noreferrer noopener';
    const label = document.createElement('span'); label.textContent = `${wiki.preferred ? '★ ' : ''}${wiki.label}`;
    const meta = document.createElement('small'); meta.textContent = [wiki.language, wiki.pageTitle || 'Community home'].filter(Boolean).join(' · ');
    link.append(label, meta); links.appendChild(link);
  });
  menu.appendChild(links); return menu;
}

function _mediaWatchlistRender(widget, element, context) {
  const records = _mediaWatchlistSorted(widget); const runtime = _mediaWatchlistGetRuntime(widget);
  element.className = `media-watchlist-widget${context === 'navpane' ? ' is-compact' : ''}`;
  const rerender = () => { if (element.isConnected) { element.innerHTML = ''; _mediaWatchlistRender(widget, element, context); } }; _setWidgetRefresher(widget.id, context, rerender);
  if (!records.length) { const empty = document.createElement('div'); empty.className = 'widget-empty-state'; empty.textContent = 'Open widget settings to add a film or series.'; element.appendChild(empty); }
  const list = document.createElement('div'); list.className = 'media-watchlist-list';
  records.forEach(record => {
    const seriesState = record.type === 'series' ? _mediaWatchlistGetSeriesState(runtime, record.id) : null;
    runtime.detailsOpen = runtime.detailsOpen && typeof runtime.detailsOpen === 'object' ? runtime.detailsOpen : {};
    const card = document.createElement('article'); card.className = `media-watchlist-card${record.watched ? ' is-watched' : ''}`;
    const main = document.createElement('div'); main.className = 'media-watchlist-main';
    const identity = document.createElement('div'); identity.className = 'media-watchlist-identity';
    const titleEl = document.createElement('div'); titleEl.className = 'media-watchlist-title'; titleEl.textContent = record.title;
    const seriesProgress = seriesState?.summary ? _mediaWatchlistSeriesProgress(record, seriesState.summary, seriesState.seasons) : null;
    const nextEpisode = seriesState?.summary ? _mediaWatchlistNextEpisode(record, seriesState.summary, seriesState.seasons) : null;
    const progressMeta = record.type === 'series'
      ? (seriesProgress ? ` · ${seriesProgress.watched}/${seriesProgress.total} episodes${nextEpisode ? ` · Next S${nextEpisode.season}E${nextEpisode.number}` : ''}` : ((record.progress.season || record.progress.episode) ? ` · S${record.progress.season}E${record.progress.episode}` : ''))
      : '';
    const meta = document.createElement('div'); meta.className = 'media-watchlist-meta'; meta.textContent = `${record.type === 'series' ? 'Series' : 'Film'}${progressMeta}${record.showRating && record.rating ? ` · ★ ${record.rating}` : ''}${record.upcoming[0] ? ` · ${record.upcoming[0].date}` : ''}`;
    identity.append(titleEl, meta);
    const actions = document.createElement('div'); actions.className = 'media-watchlist-actions';
    const watched = document.createElement('button'); watched.type = 'button'; watched.textContent = record.watched ? (record.type === 'series' ? 'Reopen' : 'Unwatch') : (record.type === 'series' ? 'Complete' : 'Watched');
    if (record.type === 'series') watched.title = 'Set the title-level status without changing episode checkboxes.';
    watched.addEventListener('click', () => { _mediaWatchlistPushUndo(); record.watched = !record.watched; _mediaWatchlistSave(widget); });
    const wikiMenu = _mediaWatchlistRenderWikiMenu(record); if (wikiMenu) actions.appendChild(wikiMenu);
    actions.appendChild(watched); main.append(identity, actions); card.appendChild(main);
    const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = _mediaWatchlistDetailsLabel(record); details.appendChild(summary);
    details.open = seriesState ? seriesState.open : runtime.detailsOpen[record.id] === true;
    if (details.open) {
      if (record.type === 'series' && record.provider === 'tmdb' && record.providerId) _mediaWatchlistRenderSeriesTracker(widget, record, details, runtime, rerender);
      _mediaWatchlistRenderEditor(widget, record, details);
    }
    details.addEventListener('toggle', () => {
      if (seriesState) seriesState.open = details.open;
      else runtime.detailsOpen[record.id] = details.open;
      _mediaWatchlistWriteView(widget, runtime);
      if (details.open && !details.querySelector('.media-watchlist-editor')) rerender();
    });
    card.appendChild(details); list.appendChild(card);
  });
  element.appendChild(list);
  void _mediaWatchlistCheckNotifications(widget);
  _setWidgetTimer(widget.id, context, () => _mediaWatchlistCheckNotifications(widget), 6 * 60 * 60 * 1000);
}

function _mediaWatchlistMoveWiki(record, index, direction) {
  const target = index + direction;
  if (index < 0 || target < 0 || target >= record.wikis.length) return;
  const [wiki] = record.wikis.splice(index, 1); record.wikis.splice(target, 0, wiki);
}

function _mediaWatchlistRenderWikiSettings(widget, record, manager, rerender) {
  const panel = document.createElement('div'); panel.className = 'media-watchlist-settings-wikis';
  record.wikis.forEach((wiki, index) => {
    const row = document.createElement('div'); row.className = 'media-watchlist-settings-wiki';
    const fields = document.createElement('div'); fields.className = 'media-watchlist-settings-wiki-fields';
    const label = document.createElement('input'); label.type = 'text'; label.className = 'settings-text-input'; label.value = wiki.label; label.placeholder = 'Display label'; label.maxLength = 100; label.addEventListener('input', () => { wiki.label = label.value.slice(0, 100); });
    const language = document.createElement('input'); language.type = 'text'; language.className = 'settings-text-input'; language.value = wiki.language; language.placeholder = 'Language'; language.maxLength = 16; language.addEventListener('input', () => { wiki.language = language.value.trim().toLowerCase().slice(0, 16); });
    const address = document.createElement('span'); address.textContent = wiki.communityUrl; address.title = wiki.communityUrl;
    fields.append(label, language, address);
    const actions = document.createElement('div'); actions.className = 'media-watchlist-settings-wiki-actions';
    const search = document.createElement('button'); search.type = 'button'; search.className = 'secondary-btn'; search.textContent = wiki.pageUrl ? 'Change page' : 'Find page'; search.addEventListener('click', () => {
      const current = manager.wikiSearch[wiki.id] || { query: record.title, results: [], searching: false, error: '', open: false };
      current.open = !current.open; manager.wikiSearch[wiki.id] = current; rerender();
    });
    const preferred = document.createElement('button'); preferred.type = 'button'; preferred.className = 'secondary-btn'; preferred.textContent = wiki.preferred ? '★ Default' : 'Set default'; preferred.disabled = wiki.preferred; preferred.addEventListener('click', () => { record.wikis.forEach(item => { item.preferred = item.id === wiki.id; }); rerender(); });
    const up = document.createElement('button'); up.type = 'button'; up.className = 'secondary-btn'; up.textContent = '↑'; up.title = 'Move up'; up.disabled = index === 0; up.addEventListener('click', () => { _mediaWatchlistMoveWiki(record, index, -1); rerender(); });
    const down = document.createElement('button'); down.type = 'button'; down.className = 'secondary-btn'; down.textContent = '↓'; down.title = 'Move down'; down.disabled = index === record.wikis.length - 1; down.addEventListener('click', () => { _mediaWatchlistMoveWiki(record, index, 1); rerender(); });
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary-btn'; remove.textContent = 'Remove'; remove.addEventListener('click', () => { record.wikis = _mediaWatchlistWikiSources(record.wikis.filter(item => item.id !== wiki.id)); delete manager.wikiSearch[wiki.id]; rerender(); });
    actions.append(search, preferred, up, down, remove); row.append(fields, actions);
    const selected = wiki.pageUrl ? document.createElement('a') : document.createElement('span'); selected.className = 'media-watchlist-settings-wiki-page'; selected.textContent = wiki.pageTitle ? `Linked page: ${wiki.pageTitle}` : 'No article selected; the community home will open.';
    if (wiki.pageUrl) { selected.href = wiki.pageUrl; selected.target = '_blank'; selected.rel = 'noreferrer noopener'; }
    row.appendChild(selected);
    const searchState = manager.wikiSearch[wiki.id];
    if (searchState?.open) {
      const searchPanel = document.createElement('div'); searchPanel.className = 'media-watchlist-settings-wiki-search';
      const searchInput = document.createElement('input'); searchInput.type = 'search'; searchInput.className = 'settings-text-input'; searchInput.value = searchState.query; searchInput.placeholder = 'Search this wiki';
      const run = document.createElement('button'); run.type = 'button'; run.className = 'secondary-btn'; run.textContent = searchState.searching ? 'Searching…' : 'Search'; run.disabled = searchState.searching || !searchState.query.trim();
      searchInput.addEventListener('input', () => { searchState.query = searchInput.value; run.disabled = searchState.searching || !searchState.query.trim(); });
      const runSearch = async () => {
        if (searchState.searching || !searchState.query.trim()) return;
        searchState.searching = true; searchState.error = ''; searchState.results = []; rerender();
        try { searchState.results = await _mediaWatchlistSearchFandom(widget, wiki, searchState.query); }
        catch (error) { searchState.error = error?.message || 'Fandom page search failed.'; }
        finally { searchState.searching = false; rerender(); }
      };
      run.addEventListener('click', () => void runSearch()); searchInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void runSearch(); } });
      searchPanel.append(searchInput, run);
      if (wiki.pageUrl) { const clear = document.createElement('button'); clear.type = 'button'; clear.className = 'secondary-btn'; clear.textContent = 'Use community home'; clear.addEventListener('click', () => { wiki.pageTitle = ''; wiki.pageUrl = ''; searchState.open = false; searchState.results = []; rerender(); }); searchPanel.appendChild(clear); }
      if (searchState.error) { const error = document.createElement('div'); error.className = 'widget-error-state'; error.textContent = searchState.error; searchPanel.appendChild(error); }
      if (searchState.results.length) {
        const results = document.createElement('div'); results.className = 'media-watchlist-settings-wiki-results';
        searchState.results.forEach(result => {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-btn'; button.textContent = result.title; button.title = result.snippet;
          button.addEventListener('click', () => { wiki.pageTitle = result.title; wiki.pageUrl = result.pageUrl; searchState.open = false; searchState.results = []; rerender(); }); results.appendChild(button);
        });
        searchPanel.appendChild(results);
      }
      row.appendChild(searchPanel);
    }
    panel.appendChild(row);
  });
  const draft = manager.wikiDrafts[record.id] || { communityUrl: '', label: '', language: '', loading: false, error: '' }; manager.wikiDrafts[record.id] = draft;
  const add = document.createElement('div'); add.className = 'media-watchlist-settings-wiki-add';
  const url = document.createElement('input'); url.type = 'url'; url.className = 'settings-text-input'; url.placeholder = 'https://memory-alpha.fandom.com/wiki/'; url.value = draft.communityUrl;
  const label = document.createElement('input'); label.type = 'text'; label.className = 'settings-text-input'; label.placeholder = 'Optional label'; label.value = draft.label; label.addEventListener('input', () => { draft.label = label.value; });
  const language = document.createElement('input'); language.type = 'text'; language.className = 'settings-text-input'; language.placeholder = 'Language'; language.value = draft.language; language.addEventListener('input', () => { draft.language = language.value; });
  const verify = document.createElement('button'); verify.type = 'button'; verify.className = 'secondary-btn'; verify.textContent = draft.loading ? 'Verifying…' : 'Verify & add'; verify.disabled = draft.loading || record.wikis.length >= MEDIA_WATCHLIST_MAX_WIKIS || !_mediaWatchlistFandomCommunity(draft.communityUrl);
  url.addEventListener('input', () => { draft.communityUrl = url.value; verify.disabled = draft.loading || record.wikis.length >= MEDIA_WATCHLIST_MAX_WIKIS || !_mediaWatchlistFandomCommunity(draft.communityUrl); });
  verify.addEventListener('click', async () => {
    if (draft.loading) return;
    draft.loading = true; draft.error = ''; rerender();
    try {
      if (record.wikis.length >= MEDIA_WATCHLIST_MAX_WIKIS) throw new Error(`A title can link to up to ${MEDIA_WATCHLIST_MAX_WIKIS} Fandom communities.`);
      const verified = await _mediaWatchlistVerifyFandom(widget, draft.communityUrl);
      if (record.wikis.some(item => item.communityUrl === verified.communityUrl)) throw new Error('That Fandom community is already linked to this title.');
      const source = _mediaWatchlistWikiSource({
        label: draft.label.trim() || verified.label, language: draft.language.trim() || verified.language,
        communityUrl: verified.communityUrl, preferred: record.wikis.length === 0
      });
      record.wikis.push(source); manager.wikiSearch[source.id] = { query: record.title, results: [], searching: true, error: '', open: true };
      draft.communityUrl = ''; draft.label = ''; draft.language = ''; draft.loading = false; rerender();
      const searchState = manager.wikiSearch[source.id];
      try { searchState.results = await _mediaWatchlistSearchFandom(widget, source, record.title); }
      catch (error) { searchState.error = error?.message || 'Community added, but its page search failed.'; }
      finally { searchState.searching = false; rerender(); }
      return;
    } catch (error) { draft.error = error?.message || 'Could not verify this Fandom community.'; }
    finally { draft.loading = false; rerender(); }
  });
  const discover = document.createElement('a'); discover.className = 'secondary-btn'; discover.href = `https://www.fandom.com/?s=${encodeURIComponent(record.title)}`; discover.target = '_blank'; discover.rel = 'noreferrer noopener'; discover.textContent = 'Find communities';
  add.append(url, label, language, verify, discover);
  if (draft.error) { const error = document.createElement('div'); error.className = 'widget-error-state'; error.textContent = draft.error; add.appendChild(error); }
  panel.appendChild(add); return panel;
}

function _mediaWatchlistRenderSettings(widget, container) {
  _mediaWatchlistRecords(widget);
  container.innerHTML = `<section class="settings-section media-watchlist-settings-general">
      <div class="settings-section-label">Display and integration</div>
      <div class="settings-row"><span>Metadata provider</span><select class="settings-select" data-cfg="provider"><option value="none" ${widget.config.provider !== 'tmdb' ? 'selected' : ''}>None / manual</option><option value="tmdb" ${widget.config.provider === 'tmdb' ? 'selected' : ''}>TMDB</option></select></div>
      <div class="settings-row settings-row--top"><span>TMDB API token</span><div class="tz-picker-group"><span class="settings-muted">Managed globally in Settings &gt; API Keys.</span></div></div>
      <div class="settings-row"><span>Sort by</span><select class="settings-select" data-cfg="sort"><option value="added" ${widget.config.sort === 'added' ? 'selected' : ''}>Recently added</option><option value="title" ${widget.config.sort === 'title' ? 'selected' : ''}>Title</option><option value="release" ${widget.config.sort === 'release' ? 'selected' : ''}>Upcoming release</option></select></div>
      <div class="settings-row"><span>Show watched titles</span><label class="settings-toggle"><input type="checkbox" data-cfg="showWatched" ${widget.config.showWatched ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
      <div class="settings-row"><span>Expose upcoming dates to Calendar</span><label class="settings-toggle"><input type="checkbox" data-cfg="includeInCalendar" ${widget.config.includeInCalendar ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
      <div class="settings-row"><span>Release notifications</span><label class="settings-toggle"><input type="checkbox" data-cfg="notifications" ${widget.config.notifications ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
    </section>
    <section class="settings-section media-watchlist-settings-library">
      <div class="settings-section-label">Movies and series</div>
      <div class="settings-help">Add, match, import, remove, and choose which details appear in this widget. Changes are applied only when you select Done.</div>
      <div class="media-watchlist-settings-manager"></div>
    </section>
    <div class="settings-help media-watchlist-settings-attribution">Watchlist records remain portable without TMDB. Provider responses stay in the local widget cache. TMDB attribution: this product uses the TMDB API but is not endorsed or certified by TMDB.</div>`;
  const managerHost = container.querySelector('.media-watchlist-settings-manager');
  const manager = { query: '', type: 'film', results: [], searching: false, error: '', matchRecordId: '', wikiExpanded: {}, wikiDrafts: {}, wikiSearch: {} };
  const renderManager = () => {
    managerHost.innerHTML = '';
    const controls = document.createElement('div'); controls.className = 'media-watchlist-settings-controls';
    const query = document.createElement('input'); query.type = 'search'; query.className = 'settings-text-input'; query.placeholder = 'Film or series title'; query.value = manager.query;
    const type = document.createElement('select'); type.className = 'settings-select'; type.innerHTML = '<option value="film">Film</option><option value="series">Series</option>'; type.value = manager.type;
    const manual = document.createElement('button'); manual.type = 'button'; manual.className = 'secondary-btn'; manual.textContent = 'Add manual'; manual.disabled = !manager.query.trim();
    manual.addEventListener('click', () => {
      if (!manager.query.trim()) return;
      widget.data.records.push(_mediaWatchlistRecord({ title: manager.query, type: manager.type }));
      manager.query = ''; manager.results = []; manager.error = ''; renderManager();
    });
    const search = document.createElement('button'); search.type = 'button'; search.className = 'secondary-btn'; search.textContent = manager.searching ? 'Searching…' : (manager.matchRecordId ? 'Find match' : 'Search TMDB'); search.disabled = manager.searching || widget.config.provider !== 'tmdb' || !manager.query.trim();
    const runSearch = async () => {
      if (!manager.query.trim() || manager.searching || widget.config.provider !== 'tmdb') return;
      manager.searching = true; manager.error = ''; renderManager();
      try { manager.results = (await _mediaWatchlistSearch(widget, manager.query)).filter(result => result.type === manager.type); }
      catch (error) { manager.error = error?.message || 'Metadata search failed.'; manager.results = []; }
      finally { manager.searching = false; renderManager(); }
    };
    search.addEventListener('click', () => void runSearch());
    query.addEventListener('input', () => { manager.query = query.value; manual.disabled = !manager.query.trim(); search.disabled = manager.searching || widget.config.provider !== 'tmdb' || !manager.query.trim(); });
    query.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void runSearch(); } });
    type.addEventListener('change', () => { manager.type = type.value; manager.results = []; manager.matchRecordId = ''; renderManager(); });
    const importInput = document.createElement('input'); importInput.type = 'file'; importInput.accept = 'application/json,.json'; importInput.hidden = true;
    importInput.addEventListener('change', async () => {
      try {
        const count = await _mediaWatchlistImport(widget, importInput.files?.[0], { persist: false });
        manager.error = count ? `Imported ${count} item${count === 1 ? '' : 's'}.` : 'No new items were found in that file.';
      } catch (error) { manager.error = error?.message || 'Import failed.'; }
      renderManager();
    });
    const importButton = document.createElement('button'); importButton.type = 'button'; importButton.className = 'secondary-btn'; importButton.textContent = 'Import'; importButton.addEventListener('click', () => importInput.click());
    const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.className = 'secondary-btn'; exportButton.textContent = 'Export'; exportButton.disabled = !widget.data.records.length; exportButton.addEventListener('click', () => _mediaWatchlistExport(widget));
    controls.append(query, type, manual, search, importButton, exportButton, importInput); managerHost.appendChild(controls);
    if (manager.matchRecordId) {
      const matching = widget.data.records.find(record => record.id === manager.matchRecordId);
      const target = document.createElement('div'); target.className = 'media-watchlist-settings-match-target'; target.textContent = matching ? `Matching “${matching.title}”` : 'Matching selected title';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'secondary-btn'; cancel.textContent = 'Cancel match'; cancel.addEventListener('click', () => { manager.matchRecordId = ''; manager.results = []; renderManager(); });
      target.appendChild(cancel); managerHost.appendChild(target);
    }
    if (manager.error) { const status = document.createElement('div'); status.className = manager.error.startsWith('Imported') || manager.error.startsWith('No new') ? 'settings-muted' : 'widget-error-state'; status.textContent = manager.error; managerHost.appendChild(status); }
    if (manager.results.length) {
      const results = document.createElement('div'); results.className = 'media-watchlist-settings-results';
      manager.results.forEach(result => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary-btn'; button.textContent = `${manager.matchRecordId ? 'Use' : 'Add'} ${result.title}${result.date ? ` (${result.date.slice(0, 4)})` : ''}`; button.title = result.overview;
        button.addEventListener('click', async () => {
          button.disabled = true;
          let record = manager.matchRecordId ? widget.data.records.find(item => item.id === manager.matchRecordId) : null;
          if (!record) { record = _mediaWatchlistRecord(result); widget.data.records.push(record); }
          else {
            const identityChanged = record.provider !== result.provider || record.providerId !== result.providerId || record.type !== result.type;
            Object.assign(record, { provider: result.provider, providerId: result.providerId, type: result.type, title: result.title });
            if (identityChanged) { record.watchedEpisodes = []; record.progress = { season: 0, episode: 0 }; record.watched = false; }
          }
          try { await _mediaWatchlistHydrate(widget, record); }
          catch (error) { manager.error = error?.message || 'Title was added, but its details could not be loaded.'; }
          widget.data.records = _mediaWatchlistRecords(widget); manager.query = ''; manager.results = []; manager.matchRecordId = ''; renderManager();
        });
        results.appendChild(button);
      });
      managerHost.appendChild(results);
    }
    const library = document.createElement('div'); library.className = 'media-watchlist-settings-items';
    if (!widget.data.records.length) { const empty = document.createElement('div'); empty.className = 'widget-empty-state'; empty.textContent = 'No movies or series in this widget yet.'; library.appendChild(empty); }
    widget.data.records.forEach(record => {
      const row = document.createElement('div'); row.className = 'media-watchlist-settings-item';
      const identity = document.createElement('div'); identity.className = 'media-watchlist-settings-item-identity';
      const titleEl = document.createElement('strong'); titleEl.textContent = record.title;
      const meta = document.createElement('span'); meta.textContent = `${record.type === 'series' ? 'Series' : 'Film'}${record.provider === 'tmdb' ? ' · TMDB' : ' · Manual'}`;
      identity.append(titleEl, meta);
      const visibility = document.createElement('div'); visibility.className = 'media-watchlist-settings-visibility';
      const ratingLabel = document.createElement('label'); const ratingInput = document.createElement('input'); ratingInput.type = 'checkbox'; ratingInput.checked = record.showRating; ratingInput.addEventListener('change', () => { record.showRating = ratingInput.checked; }); ratingLabel.append(ratingInput, document.createTextNode(' Rating'));
      const notesLabel = document.createElement('label'); const notesInput = document.createElement('input'); notesInput.type = 'checkbox'; notesInput.checked = record.showNotes; notesInput.addEventListener('change', () => { record.showNotes = notesInput.checked; }); notesLabel.append(notesInput, document.createTextNode(' Notes'));
      visibility.append(ratingLabel, notesLabel);
      const actions = document.createElement('div'); actions.className = 'media-watchlist-settings-item-actions';
      const wikis = document.createElement('button'); wikis.type = 'button'; wikis.className = 'secondary-btn'; wikis.textContent = `Wikis (${record.wikis.length})`; wikis.addEventListener('click', () => { manager.wikiExpanded[record.id] = !manager.wikiExpanded[record.id]; renderManager(); });
      const match = document.createElement('button'); match.type = 'button'; match.className = 'secondary-btn'; match.textContent = 'Match'; match.disabled = widget.config.provider !== 'tmdb'; match.addEventListener('click', () => { manager.matchRecordId = record.id; manager.query = record.title; manager.type = record.type; manager.results = []; manager.error = ''; renderManager(); });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary-btn'; remove.textContent = 'Remove'; remove.addEventListener('click', () => { widget.data.records = widget.data.records.filter(item => item.id !== record.id); if (manager.matchRecordId === record.id) manager.matchRecordId = ''; renderManager(); });
      actions.append(wikis, match, remove); row.append(identity, visibility, actions);
      if (manager.wikiExpanded[record.id]) row.appendChild(_mediaWatchlistRenderWikiSettings(widget, record, manager, renderManager));
      library.appendChild(row);
    });
    managerHost.appendChild(library);
  };
  const providerInput = container.querySelector('[data-cfg="provider"]');
  providerInput?.addEventListener('change', () => { widget.config.provider = providerInput.value; manager.results = []; manager.error = ''; renderManager(); });
  renderManager();
}

async function _mediaWatchlistCommitSettings(widget, container) {
  if (widget.config.provider === 'tmdb') {
    const token = typeof getServiceSecret === 'function' ? String(getServiceSecret('tmdb') || '').trim() : '';
    if (!token) throw new Error('Add a TMDB API Read Access Token in Settings > API Keys, or choose manual metadata.');
  }
  if (widget.config.notifications && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
    let permission = Notification.permission; if (permission === 'default') try { permission = await Notification.requestPermission(); } catch { permission = 'denied'; }
    if (permission !== 'granted') widget.config.notifications = false;
  }
  return true;
}

WIDGET_REGISTRY['mediaWatchlist'] = {
  id: 'mediaWatchlist', name: 'Media Watchlist', category: 'Content & Feeds', description: 'A portable film and series watchlist with progress, ratings, notes, optional TMDB matching, release dates, and Calendar integration.',
  allowedIn: ['column', 'navpane'], liveSettingsPreview: false, settingsPanelWidth: 'wide',
  defaultConfig: { provider: 'none', showWatched: true, includeInCalendar: false, notifications: false, sort: 'added' }, defaultData: { records: [] },
  settingsSchema: { type: 'object', properties: { provider: { type: 'string', enum: ['none','tmdb'] }, showWatched: { type: 'boolean' }, includeInCalendar: { type: 'boolean' }, notifications: { type: 'boolean' }, sort: { type: 'string', enum: ['added','title','release'] } }, additionalProperties: false },
  capabilities: { network: { domains: ['api.themoviedb.org', 'fandom.com'], optional: true }, secureCredentials: { optional: true }, timers: true, localCache: { quotaBytes: 1024 * 1024 }, notifications: { optional: true } }, responsive: { minWidth: 260, preferredWidth: 600, compactBelow: 360 },
  migrate(widget) { widget.config = { ...this.defaultConfig, ...(widget.config || {}) }; widget.data = { records: Array.isArray(widget.data?.records) ? widget.data.records : [] }; _mediaWatchlistRecords(widget); return widget; },
  beforeSettingsCommit(widget, container) { return _mediaWatchlistCommitSettings(widget, container); }, onSettingsCommit(widget) { _mediaWatchlistRuntime.delete(widget.id); }, cleanup(widget) { _mediaWatchlistRuntime.delete(widget.id); },
  render(widget, element, context) { _mediaWatchlistRender(widget, element, context); }, renderSettings(widget, container) { _mediaWatchlistRenderSettings(widget, container); }
};
