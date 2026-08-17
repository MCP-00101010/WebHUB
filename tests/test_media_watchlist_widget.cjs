const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'source', 'media-watchlist-widget.js'), 'utf8');
const calendarSource = fs.readFileSync(path.join(__dirname, '..', 'source', 'calendar-widget.js'), 'utf8');

function context() {
  const sandbox = vm.createContext({
    WIDGET_REGISTRY: {}, URL, console, document: {}, Notification: undefined,
    WidgetSDK: { cache: { get: () => null, set() {} } },
    getServiceSecret: serviceName => serviceName === 'tmdb' ? 'global-tmdb-token' : '',
    state: { boards: [], navItems: [] }, getBoardTabs: board => board.tabs || []
  });
  vm.runInContext(source, sandbox); return sandbox;
}

test('media records are provider-neutral, bounded, and preserve user fields', () => {
  const sandbox = context();
  const record = vm.runInContext(`_mediaWatchlistRecord({ type: 'series', title: 'Example', provider: 'tmdb', providerId: '12x', progress: { season: 2, episode: 3 }, watchedEpisodes: [{ season: 2, episode: 3, providerId: '44' }, { season: 2, episode: 3, providerId: 'duplicate' }, { season: 3, episode: 0 }], rating: 99, notes: 'note', showRating: false, showNotes: false, notify: true, upcoming: [{ id: 'one', title: 'Episode', date: '2026-10-02', kind: 'episode' }] })`, sandbox);
  assert.equal(record.type, 'series');
  assert.equal(record.providerId, '12');
  assert.equal(record.rating, 10);
  assert.deepEqual(JSON.parse(JSON.stringify(record.progress)), { season: 2, episode: 3 });
  assert.equal(record.watchedEpisodes.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(record.watchedEpisodes[0])).providerId, '44');
  assert.equal(record.showRating, false);
  assert.equal(record.showNotes, false);
  assert.equal(record.upcoming[0].date, '2026-10-02');
});

test('Fandom communities are HTTPS-only, language-aware, and normalize article URLs', () => {
  const sandbox = context();
  const result = vm.runInContext(`(() => ({
    english: _mediaWatchlistFandomCommunity('https://memory-alpha.fandom.com/wiki/Star_Trek'),
    german: _mediaWatchlistFandomCommunity('https://memory-alpha.fandom.com/de/wiki/Star_Trek'),
    page: _mediaWatchlistFandomPageUrl('https://memory-beta.fandom.com', 'Star Trek / Destiny'),
    insecure: _mediaWatchlistFandomCommunity('http://memory-alpha.fandom.com'),
    customPort: _mediaWatchlistFandomCommunity('https://memory-alpha.fandom.com:8443'),
    unrelated: _mediaWatchlistFandomCommunity('https://example.com'),
    portal: _mediaWatchlistFandomCommunity('https://www.fandom.com')
  }))()`, sandbox);
  const plain = JSON.parse(JSON.stringify(result));
  assert.deepEqual(plain.english, {
    communityUrl: 'https://memory-alpha.fandom.com', apiUrl: 'https://memory-alpha.fandom.com/api.php', language: ''
  });
  assert.deepEqual(plain.german, {
    communityUrl: 'https://memory-alpha.fandom.com/de', apiUrl: 'https://memory-alpha.fandom.com/de/api.php', language: 'de'
  });
  assert.equal(plain.page, 'https://memory-beta.fandom.com/wiki/Star_Trek_/_Destiny');
  assert.equal(plain.insecure, null);
  assert.equal(plain.customPort, null);
  assert.equal(plain.unrelated, null);
  assert.equal(plain.portal, null);
});

test('records preserve multiple Fandom communities with one default and no duplicates', () => {
  const sandbox = context();
  const record = vm.runInContext(`_mediaWatchlistRecord({ title: 'Star Trek', wikis: [
    { id: 'alpha-en', label: 'Memory Alpha', communityUrl: 'https://memory-alpha.fandom.com', pageTitle: 'Star Trek', pageUrl: 'https://memory-alpha.fandom.com/wiki/Star_Trek', preferred: true },
    { id: 'alpha-de', label: 'Memory Alpha DE', language: 'en', communityUrl: 'https://memory-alpha.fandom.com/de', pageTitle: 'Star Trek', pageUrl: 'https://memory-alpha.fandom.com/de/wiki/Star_Trek', preferred: true },
    { id: 'beta', label: 'Memory Beta', communityUrl: 'https://memory-beta.fandom.com' },
    { id: 'duplicate', label: 'Duplicate', communityUrl: 'https://memory-alpha.fandom.com/wiki/Other' },
    { id: 'bad', label: 'Bad', communityUrl: 'https://example.com' }
  ] })`, sandbox);
  const plain = JSON.parse(JSON.stringify(record));
  assert.equal(plain.wikis.length, 3);
  assert.deepEqual(plain.wikis.map(wiki => wiki.id), ['alpha-en', 'alpha-de', 'beta']);
  assert.deepEqual(plain.wikis.map(wiki => wiki.preferred), [true, false, false]);
  assert.equal(plain.wikis[1].communityUrl, 'https://memory-alpha.fandom.com/de');
  assert.equal(plain.wikis[1].language, 'de');
  assert.equal(plain.wikis[1].pageUrl, 'https://memory-alpha.fandom.com/de/wiki/Star_Trek');
});

test('Fandom verification and article search use the bounded SDK network path and cache', async () => {
  const sandbox = context();
  const result = await vm.runInContext(`(async () => {
    const calls = [];
    const cache = new Map();
    WidgetSDK.cache.get = (type, id, key) => cache.get(type + ':' + id + ':' + key) || null;
    WidgetSDK.cache.set = (type, id, key, value) => cache.set(type + ':' + id + ':' + key, value);
    _fetchWithTimeout = async (url, options, timeout) => {
      calls.push({ url: String(url), options, timeout });
      const parsed = new URL(String(url));
      const data = parsed.searchParams.get('meta') === 'siteinfo'
        ? { query: { general: { sitename: 'Memory Alpha', lang: 'en' } } }
        : { query: { search: [{ title: 'Star Trek', snippet: '<span>Series</span> &amp; films' }] } };
      return { ok: true, status: 200, json: async () => data };
    };
    const widget = { id: 'media-1' };
    const verified = await _mediaWatchlistVerifyFandom(widget, 'https://memory-alpha.fandom.com/wiki/Star_Trek');
    const wiki = _mediaWatchlistWikiSource({ communityUrl: verified.communityUrl, label: verified.label });
    const first = await _mediaWatchlistSearchFandom(widget, wiki, 'Star Trek');
    const second = await _mediaWatchlistSearchFandom(widget, wiki, 'Star Trek');
    return { verified, first, second, calls };
  })()`, sandbox);
  const plain = JSON.parse(JSON.stringify(result));
  assert.equal(plain.verified.label, 'Memory Alpha');
  assert.equal(plain.verified.language, 'en');
  assert.equal(plain.first[0].pageUrl, 'https://memory-alpha.fandom.com/wiki/Star_Trek');
  assert.equal(plain.first[0].snippet, 'Series & films');
  assert.deepEqual(plain.second, plain.first);
  assert.equal(plain.calls.length, 2);
  assert.match(plain.calls[0].url, /^https:\/\/memory-alpha\.fandom\.com\/api\.php\?/);
  assert.equal(new URL(plain.calls[0].url).searchParams.get('origin'), '*');
  assert.equal(plain.calls[0].options.widgetType, 'mediaWatchlist');
  assert.equal(plain.calls[0].options.maxResponseBytes, 256 * 1024);
  assert.equal(plain.calls[0].timeout, 15000);
});

test('TMDB series and season responses are reduced to bounded portable display data', () => {
  const sandbox = context();
  const result = vm.runInContext(`(() => {
    const summary = _mediaWatchlistSeriesSummary({ name: 'Example', number_of_seasons: 2, number_of_episodes: 5, seasons: [
      { id: 9, season_number: 0, name: 'Specials', episode_count: 1 },
      { id: 10, season_number: 1, name: 'Season 1', air_date: '2025-01-02', episode_count: 3 },
      { id: 11, season_number: 2, name: 'Season 2', air_date: 'not-a-date', episode_count: 2 }
    ] });
    const season = _mediaWatchlistSeasonDetails({ id: 10, season_number: 1, name: 'Season 1', episodes: [
      { id: 101, season_number: 1, episode_number: 1, name: 'Pilot', air_date: '2025-01-02', runtime: 48, overview: 'First episode' },
      { id: 102, season_number: 1, episode_number: 2, name: 'Future', air_date: '2999-01-02' }
    ] }, 1);
    return { summary, season };
  })()`, sandbox);
  const plain = JSON.parse(JSON.stringify(result));
  assert.equal(plain.summary.numberOfSeasons, 2);
  assert.equal(plain.summary.numberOfEpisodes, 5);
  assert.equal(plain.summary.seasons[2].airDate, '');
  assert.deepEqual(plain.season.episodes[0], { id: '101', season: 1, number: 1, name: 'Pilot', airDate: '2025-01-02', runtime: 48, overview: 'First episode' });
});

test('episode checkboxes persist by season and episode while progress excludes unaired episodes', () => {
  const sandbox = context();
  const result = vm.runInContext(`(() => {
    const record = _mediaWatchlistRecord({ type: 'series', title: 'Example' });
    const aired = { id: '101', season: 1, number: 1, name: 'Pilot', airDate: '2025-01-02' };
    const future = { id: '102', season: 1, number: 2, name: 'Future', airDate: '2999-01-02' };
    _mediaWatchlistSetEpisodeWatched(record, aired, true);
    _mediaWatchlistSetEpisodeWatched(record, aired, true);
    _mediaWatchlistSyncLegacyProgress(record);
    const summary = { numberOfEpisodes: 2, seasons: [{ number: 1, episodeCount: 2, airDate: '2025-01-02' }] };
    const loaded = { 1: { details: { episodes: [aired, future] } } };
    return { record, progress: _mediaWatchlistSeriesProgress(record, summary, loaded), next: _mediaWatchlistNextEpisode(record, summary, loaded) };
  })()`, sandbox);
  const plain = JSON.parse(JSON.stringify(result));
  assert.equal(plain.record.watchedEpisodes.length, 1);
  assert.deepEqual(plain.record.progress, { season: 1, episode: 1 });
  assert.deepEqual(plain.progress, { watched: 1, total: 2, releasedLoaded: 1, releasedWatched: 1 });
  assert.equal(plain.next, null);
});

test('episode wiki lookup uses localized titles and a language-neutral fallback', () => {
  const sandbox = context();
  const result = vm.runInContext(`(() => ({
    english: _mediaWatchlistEpisodeWikiSearchUrl(
      { communityUrl: 'https://memory-alpha.fandom.com' },
      { title: 'Star Trek: Picard' },
      { season: 2, number: 3, name: 'Assimilation' }
    ),
    german: _mediaWatchlistEpisodeWikiSearchUrl(
      { communityUrl: 'https://memory-alpha.fandom.com/de', language: 'de' },
      { title: 'Star Trek: Picard' },
      { season: 2, number: 3, name: 'Assimilation' },
      'Assimilierung'
    ),
    germanFallback: _mediaWatchlistEpisodeWikiSearchUrl(
      { communityUrl: 'https://memory-alpha.fandom.com/de', language: 'de' },
      { title: 'Star Trek: Picard' },
      { season: 2, number: 3, name: 'Assimilation' }
    ),
    germanPathOverridesStaleLanguage: _mediaWatchlistEpisodeWikiSearchUrl(
      { communityUrl: 'https://memory-alpha.fandom.com/de', language: 'en' },
      { title: 'Star Trek: Picard' },
      { season: 2, number: 3, name: 'Assimilation' }
    ),
    invalid: _mediaWatchlistEpisodeWikiSearchUrl(
      { communityUrl: 'https://example.com' }, { title: 'Example' }, { season: 1, number: 1, name: 'Pilot' }
    )
  }))()`, sandbox);
  const english = new URL(result.english);
  const german = new URL(result.german); const germanFallback = new URL(result.germanFallback);
  const germanPathOverridesStaleLanguage = new URL(result.germanPathOverridesStaleLanguage);
  assert.equal(english.pathname, '/wiki/Special:Search');
  assert.equal(german.pathname, '/de/wiki/Special:Search');
  assert.equal(english.searchParams.get('query'), 'Assimilation');
  assert.equal(german.searchParams.get('query'), 'Assimilierung');
  assert.equal(germanFallback.searchParams.get('query'), 'S02E03');
  assert.equal(germanPathOverridesStaleLanguage.searchParams.get('query'), 'S02E03');
  assert.equal(vm.runInContext(`_mediaWatchlistWikiLanguage({ communityUrl: 'https://akte-x.fandom.com/de', language: '' })`, sandbox), 'de');
  assert.equal(vm.runInContext(`_mediaWatchlistWikiLanguage({ communityUrl: 'https://akte-x.fandom.com/de', language: 'en' })`, sandbox), 'de');
  assert.equal(result.invalid, '');
  assert.match(source, /row\.addEventListener\('contextmenu'/);
  assert.match(source, /Look up \$\{code\} in \$\{wiki\.label\}/);
  assert.match(source, /window\.open\(url, '_blank', 'noopener,noreferrer'\)/);
});

test('localized season metadata is fetched once per wiki language and kept in local cache', async () => {
  const sandbox = context();
  const result = await vm.runInContext(`(async () => {
    const calls = []; const cache = new Map();
    WidgetSDK.cache.get = (type, id, key) => cache.get(type + ':' + id + ':' + key) || null;
    WidgetSDK.cache.set = (type, id, key, value) => cache.set(type + ':' + id + ':' + key, value);
    _mediaWatchlistTmdb = async (widget, path, params) => {
      calls.push({ path, params });
      return { season_number: 2, episodes: [{ id: 203, season_number: 2, episode_number: 3, name: 'Assimilierung' }] };
    };
    const widget = { id: 'media-1' };
    const record = _mediaWatchlistRecord({ type: 'series', title: 'Star Trek: Picard', provider: 'tmdb', providerId: '85949' });
    const episode = { season: 2, number: 3, name: 'Assimilation' };
    await _mediaWatchlistPrimeLocalizedSeason(widget, record, 2, 'de');
    await _mediaWatchlistPrimeLocalizedSeason(widget, record, 2, 'de-DE');
    return { calls, localized: _mediaWatchlistCachedLocalizedEpisodeName(widget, record, episode, 'de') };
  })()`, sandbox);
  const plain = JSON.parse(JSON.stringify(result));
  assert.deepEqual(plain.calls, [{ path: 'tv/85949/season/2', params: { language: 'de-DE' } }]);
  assert.equal(plain.localized, 'Assimilierung');
});

test('expanded details and season navigation survive runtime recreation in local view cache', () => {
  const sandbox = context();
  const result = vm.runInContext(`(() => {
    const cache = new Map();
    WidgetSDK.cache.get = (type, id, key) => cache.get(type + ':' + id + ':' + key) || null;
    WidgetSDK.cache.set = (type, id, key, value) => cache.set(type + ':' + id + ':' + key, value);
    const widget = { id: 'media-1', config: {}, data: { records: [
      _mediaWatchlistRecord({ id: 'series-1', type: 'series', title: 'Series' }),
      _mediaWatchlistRecord({ id: 'film-1', type: 'film', title: 'Film' })
    ] } };
    const runtime = _mediaWatchlistGetRuntime(widget);
    runtime.detailsOpen['film-1'] = true;
    const series = _mediaWatchlistGetSeriesState(runtime, 'series-1');
    series.open = true; series.showSpecials = true; series.activeSeason = 5;
    _mediaWatchlistWriteView(widget, runtime);
    const stored = cache.get('mediaWatchlist:media-1:view');
    _mediaWatchlistRuntime.clear();
    const restored = _mediaWatchlistGetRuntime(widget);
    return { stored, restored };
  })()`, sandbox);
  const plain = JSON.parse(JSON.stringify(result));
  assert.deepEqual(plain.stored, {
    version: 1,
    detailsOpen: { 'film-1': true },
    series: { 'series-1': { open: true, showSpecials: true, activeSeason: 5 } }
  });
  assert.equal(plain.restored.detailsOpen['film-1'], true);
  assert.equal(plain.restored.series['series-1'].open, true);
  assert.equal(plain.restored.series['series-1'].showSpecials, true);
  assert.equal(plain.restored.series['series-1'].activeSeason, 5);
  assert.deepEqual(plain.restored.series['series-1'].seasons, {});
});

test('local view state is bounded to current records and excludes provider runtime data', () => {
  const sandbox = context();
  const view = vm.runInContext(`_mediaWatchlistNormalizeView(
    { data: { records: [{ id: 'current' }] } },
    {
      detailsOpen: { current: true, deleted: true },
      series: {
        current: { open: true, showSpecials: false, activeSeason: 5001, summary: { name: 'Private cache' }, seasons: { 1: { details: {} } } },
        deleted: { open: true, showSpecials: true, activeSeason: 2 }
      }
    }
  )`, sandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(view)), {
    version: 1,
    detailsOpen: { current: true },
    series: { current: { open: true, showSpecials: false, activeSeason: null } }
  });
  assert.match(source, /_mediaWatchlistWriteView\(widget, runtime\); rerender\(\)/);
  assert.match(source, /WidgetSDK\.cache\.set\('mediaWatchlist', widget\.id, 'view', view\)/);
});

test('series metadata loads before season episodes and both use the local SDK cache', async () => {
  const sandbox = context();
  const result = await vm.runInContext(`(async () => {
    const calls = [];
    const cache = new Map();
    WidgetSDK.cache.get = (type, id, key) => cache.get(type + ':' + id + ':' + key) || null;
    WidgetSDK.cache.set = (type, id, key, value) => cache.set(type + ':' + id + ':' + key, value);
    _mediaWatchlistTmdb = async (widget, path) => {
      calls.push(path);
      if (path === 'tv/77') return { name: 'Example', number_of_seasons: 1, number_of_episodes: 1, seasons: [{ season_number: 1, name: 'Season 1', episode_count: 1 }] };
      return { season_number: 1, name: 'Season 1', episodes: [{ id: 701, season_number: 1, episode_number: 1, name: 'Pilot', air_date: '2025-01-02' }] };
    };
    const widget = { id: 'media-1' };
    const record = _mediaWatchlistRecord({ type: 'series', provider: 'tmdb', providerId: '77', title: 'Example' });
    const state = { open: true, showSpecials: false, loading: false, error: '', summary: null, seasons: {} };
    await _mediaWatchlistLoadSeries(widget, record, state);
    const callsAfterSeries = [...calls];
    await _mediaWatchlistLoadSeason(widget, record, 1, state);
    return { callsAfterSeries, calls, cachedSeries: cache.has('mediaWatchlist:media-1:series:77'), cachedSeason: cache.has('mediaWatchlist:media-1:season:77:1') };
  })()`, sandbox);
  const plain = JSON.parse(JSON.stringify(result));
  assert.deepEqual(plain.callsAfterSeries, ['tv/77']);
  assert.deepEqual(plain.calls, ['tv/77', 'tv/77/season/1']);
  assert.equal(plain.cachedSeries, true);
  assert.equal(plain.cachedSeason, true);
});

test('series seasons use horizontal tabs with one episode panel', () => {
  assert.match(source, /media-watchlist-season-tabs/);
  assert.match(source, /setAttribute\('role', 'tablist'\)/);
  assert.match(source, /media-watchlist-season-tab\$\{seriesState\.activeSeason/);
  assert.match(source, /setAttribute\('role', 'tabpanel'\)/);
  assert.doesNotMatch(source, /className = 'media-watchlist-season';/);
});

test('library management lives in settings and live cards no longer expose manual progress fields', () => {
  assert.match(source, /media-watchlist-settings-manager/);
  assert.match(source, /Changes are applied only when you select Done/);
  assert.match(source, /_mediaWatchlistImport\(widget, importInput\.files\?\.\[0\], \{ persist: false \}\)/);
  assert.match(source, /record\.showRating = ratingInput\.checked/);
  assert.match(source, /record\.showNotes = notesInput\.checked/);
  assert.doesNotMatch(source, /className = 'media-watchlist-controls'/);
  assert.doesNotMatch(source, /season\.placeholder = 'Season'/);
  assert.doesNotMatch(source, /episode\.placeholder = 'Episode'/);
});

test('multiple Fandom sources are managed in settings and exposed through one compact card menu', () => {
  const sandbox = context();
  const domains = vm.runInContext('WIDGET_REGISTRY.mediaWatchlist.capabilities.network.domains', sandbox);
  assert.match(source, /summary\.textContent = `Wikis \(\$\{record\.wikis\.length\}\)`/);
  assert.match(source, /record\.wikis\.forEach\(wiki =>/);
  assert.match(source, /Verify & add/);
  assert.match(source, /Find communities/);
  assert.match(source, /Set default/);
  assert.match(source, /Move up/);
  assert.match(source, /Move down/);
  assert.match(source, /Search this wiki/);
  assert.match(source, /version: 3/);
  assert.deepEqual(JSON.parse(JSON.stringify(domains)), ['api.themoviedb.org', 'fandom.com']);
  assert.doesNotMatch(source, /domains: \[[^\]]*user-configured/);
});

test('settings imports update only the draft when persistence is disabled', async () => {
  const sandbox = context();
  const count = await vm.runInContext(`_mediaWatchlistImport(
    { id: 'media-1', data: { records: [] }, config: {} },
    { size: 100, text: async () => JSON.stringify({ records: [{ title: 'Imported', type: 'film' }] }) },
    { persist: false }
  )`, sandbox);
  assert.equal(count, 1);
});

test('Calendar feed includes only explicitly exposed watchlists', () => {
  const sandbox = context();
  sandbox.state = { boards: [{ tabs: [{ columns: [{ items: [
    { id: 'visible', type: 'widget', widgetType: 'mediaWatchlist', config: { includeInCalendar: true }, data: { records: [{ title: 'Visible', upcoming: [{ title: 'Premiere', date: '2026-12-10' }] }] } },
    { id: 'hidden', type: 'widget', widgetType: 'mediaWatchlist', config: { includeInCalendar: false }, data: { records: [{ title: 'Hidden', upcoming: [{ title: 'Secret', date: '2026-12-11' }] }] } }
  ] }] }] }], navItems: [] };
  const events = vm.runInContext(`_mediaWatchlistCalendarEvents({ id: 'source', name: 'Watchlist', color: '#123456' })`, sandbox);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'Premiere');
});

test('media provider access uses SDK networking and the global TMDB service credential', async () => {
  const sandbox = context();
  assert.equal(await vm.runInContext('_mediaWatchlistToken({ id: "media-1" })', sandbox), 'global-tmdb-token');
  assert.doesNotMatch(source, /\blocalStorage\b|\bfetch\s*\(/);
  assert.match(source, /getServiceSecret\('tmdb'\)/);
  assert.doesNotMatch(source, /WidgetSDK\.credentials|media-watchlist-token/);
  assert.doesNotMatch(source, /class="settings-text-input media-watchlist-token"/);
  assert.match(source, /widgetType: 'mediaWatchlist'/);
  assert.match(calendarSource, /mediaWatchlist/);
});
