const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'source', 'football-tracker-widget.js'), 'utf8');

function createContext(extra = {}) {
  const cache = new Map();
  const context = vm.createContext({
    WIDGET_REGISTRY: {}, Map, Set, Object, String, Number, Date, Math, Promise, URL,
    getServiceSecret: name => ({ footballData: 'football-data-token', sportmonks: 'sportmonks-token', apiFootball: 'api-football-key' })[name] || '',
    _refreshWidget() {},
    WidgetSDK: {
      cache: {
        get: (type, id, key) => cache.get(`${type}:${id}:${key}`) || null,
        set: (type, id, key, value) => cache.set(`${type}:${id}:${key}`, JSON.parse(JSON.stringify(value))),
        remove: (type, id, key) => cache.delete(`${type}:${id}:${key}`)
      },
      extensionRelay: { invoke: async () => { throw new Error('relay unavailable'); } }
    },
    ...extra
  });
  context.__cache = cache;
  vm.runInContext(source, context);
  return context;
}

function widget(config = {}) {
  return { id: 'football-1', type: 'widget', widgetType: 'footballTracker', config: { competitionCode: 'PL', defaultView: 'matches', showCrests: true, favouriteTeam: '', ...config }, data: {} };
}

test('competition catalogue focuses on European leagues and Champions League', () => {
  const context = createContext();
  const competitions = vm.runInContext('FOOTBALL_TRACKER_COMPETITIONS.map(({ area, code, kind }) => ({ area, code, kind }))', context);
  assert.ok([...competitions].some(entry => entry.code === 'PL' && entry.area === 'England'));
  assert.ok([...competitions].some(entry => entry.code === 'BL1' && entry.area === 'Germany'));
  assert.ok([...competitions].some(entry => entry.code === 'CL' && entry.kind === 'cup'));
});

test('legacy Scottish Premier League labels canonicalize to the current Premiership', () => {
  const context = createContext();
  context.competition = { id: 4330, name: 'Scottish Premier League', area: 'Scotland', provider: 'theSportsDb' };
  const canonical = vm.runInContext('_footballTrackerCanonicalCompetition(competition)', context);
  assert.equal(canonical.key, 'SCO-PL');
  assert.equal(canonical.name, 'Premiership');
});

test('provider priority keeps free coverage ahead of API-Football', () => {
  const context = createContext();
  context.codes = ['PL', 'SCO-PL', 'DEU-DFB', 'ENG-FAC', 'SCO-FAC', 'EC', 'WC'];
  const providers = vm.runInContext('Object.fromEntries(codes.map(code => { const competition = _footballTrackerCompetition(code); return [code, competition.provider]; }))', context);
  assert.deepEqual(JSON.parse(JSON.stringify(providers)), {
    PL: 'footballData', 'SCO-PL': 'sportmonks', 'DEU-DFB': 'apiFootball', 'ENG-FAC': 'apiFootball', 'SCO-FAC': 'apiFootball', EC: 'footballData', WC: 'footballData'
  });
});

test('match normalization keeps bounded display data and full-time scores', () => {
  const context = createContext();
  context.payload = { matches: [{ id: 7, utcDate: '2026-08-21T19:00:00Z', status: 'FINISHED', matchday: 3, stage: 'REGULAR_SEASON', homeTeam: { id: 1, name: 'Home FC', shortName: 'Home', crest: 'https://crests.football-data.org/1.png' }, awayTeam: { id: 2, name: 'Away FC' }, score: { winner: 'HOME_TEAM', fullTime: { home: 2, away: 1 } } }] };
  const matches = vm.runInContext('_footballTrackerMatches(payload)', context);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].home.name, 'Home');
  assert.equal(matches[0].homeScore, 2);
  assert.equal(matches[0].awayScore, 1);
  assert.equal(matches[0].matchday, 3);
  context.payload.matches[0].status = 'SCHEDULED';
  context.payload.matches[0].score.fullTime = { home: null, away: null };
  const scheduled = vm.runInContext('_footballTrackerMatches(payload)', context);
  assert.equal(scheduled[0].homeScore, null);
  assert.equal(scheduled[0].awayScore, null);
});

test('current football season rolls over in July', () => {
  const context = createContext();
  context.january = Date.parse('2027-01-15T12:00:00Z'); context.august = Date.parse('2027-08-15T12:00:00Z');
  assert.equal(vm.runInContext('_footballTrackerSeasonYear(january)', context), 2026);
  assert.equal(vm.runInContext('_footballTrackerSeasonYear(august)', context), 2027);
});

test('league rounds group by matchday while Champions League groups by calendar day', () => {
  const context = createContext();
  context.matches = [
    { utcDate: Date.parse('2026-09-15T17:00:00Z'), matchday: 1, status: 'SCHEDULED' },
    { utcDate: Date.parse('2026-09-15T20:00:00Z'), matchday: 1, status: 'SCHEDULED' },
    { utcDate: Date.parse('2026-09-16T20:00:00Z'), matchday: 2, status: 'SCHEDULED' }
  ];
  const league = vm.runInContext("_footballTrackerRounds(matches, _footballTrackerCompetition('PL'))", context);
  const championsLeague = vm.runInContext("_footballTrackerRounds(matches, _footballTrackerCompetition('CL'))", context);
  assert.deepEqual([...league].map(round => round.key), ['1', '2']);
  assert.deepEqual([...championsLeague].map(round => round.key), ['2026-09-15', '2026-09-16']);
});

test('current-round selection prefers live play and then the next scheduled round', () => {
  const context = createContext();
  context.rounds = [
    { key: '1', matches: [{ status: 'FINISHED', utcDate: 1000 }] },
    { key: '2', matches: [{ status: 'IN_PLAY', utcDate: 2000 }] },
    { key: '3', matches: [{ status: 'SCHEDULED', utcDate: 3000 }] }
  ];
  assert.equal(vm.runInContext('_footballTrackerDefaultRound(rounds, 2500).key', context), '2');
  context.rounds[1].matches[0].status = 'FINISHED';
  assert.equal(vm.runInContext('_footballTrackerDefaultRound(rounds, 2500).key', context), '3');
});

test('football view, round and team-history navigation survive runtime recreation', () => {
  const context = createContext(); context.widget = widget({ competitionCode: 'SCO-PL' });
  const restored = vm.runInContext(`(() => {
    const first = _footballTrackerState(widget);
    first.view = 'standings'; first.roundKey = 'round-4'; first.historyTabKey = 'CL';
    first.selectedTeam = { id: 53, name: 'Celtic', crest: 'https://example.test/celtic.png', provider: 'sportmonks', area: 'Scotland', competitionCode: 'SCO-PL' };
    _footballTrackerWriteView(widget, first);
    _footballTrackerRuntime.clear(); _footballTrackerViewMemory.clear();
    const next = _footballTrackerState(widget);
    return { view: next.view, roundKey: next.roundKey, historyTabKey: next.historyTabKey, selectedTeam: next.selectedTeam };
  })()`, context);
  assert.equal(restored.view, 'standings');
  assert.equal(restored.roundKey, 'round-4');
  assert.equal(restored.historyTabKey, 'CL');
  assert.equal(restored.selectedTeam.name, 'Celtic');
  assert.equal(context.__cache.has('footballTracker:football-1:view'), true);
  assert.deepEqual(context.widget.data, {});
});

test('standings retain total tables and discard redundant home/away tables', () => {
  const context = createContext();
  context.payload = { standings: [
    { type: 'TOTAL', stage: 'REGULAR_SEASON', table: [{ position: 1, team: { name: 'Leaders' }, playedGames: 4, goalDifference: 8, points: 12 }] },
    { type: 'HOME', stage: 'REGULAR_SEASON', table: [{ position: 1, team: { name: 'Home leaders' }, points: 6 }] }
  ] };
  const standings = vm.runInContext('_footballTrackerStandings(payload)', context);
  assert.equal(standings.length, 1);
  assert.equal(standings[0].table[0].team.name, 'Leaders');
  assert.equal(standings[0].table[0].points, 12);
});

test('provider request uses the global token and bounded SDK network route', async () => {
  const requests = [];
  const context = createContext({
    _fetchWithTimeout: async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ matches: [] }) }; }
  });
  context.widget = widget();
  const payload = await vm.runInContext("_footballTrackerProviderRequest(widget, _footballTrackerCompetition('PL'), 'competitions/PL/matches')", context);
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), { matches: [] });
  assert.equal(requests[0].options.headers['X-Auth-Token'], 'football-data-token');
  assert.equal(requests[0].options.widgetType, 'footballTracker');
  assert.equal(requests[0].options.credentials, 'omit');
  assert.equal(requests[0].options.redirect, 'error');
});

test('annual football-data.org competitions request and cache the explicit current season', async () => {
  const requests = [];
  const context = createContext({
    _fetchWithTimeout: async url => { requests.push(url); return { ok: true, json: async () => ({ matches: [] }) }; }
  });
  context.codes = ['PL', 'ELC', 'BL1', 'PD', 'SA', 'FL1', 'DED', 'PPL', 'CL']; context.widget = widget();
  await vm.runInContext("Promise.all(codes.map(code => _footballTrackerCompetitionPayload(widget, _footballTrackerCompetition(code), 'matches')))", context);
  for (const code of context.codes) assert.ok(requests.some(url => url.endsWith(`/competitions/${code}/matches?season=2026`)), `${code} should select season 2026`);
  assert.equal(vm.runInContext("_footballTrackerCacheKey(_footballTrackerCompetition('PL'), 'matches')", context), 'footballData:PL:matches:season:2026');
  assert.equal(vm.runInContext("_footballTrackerCacheKey(_footballTrackerCompetition('CL'), 'matches')", context), 'footballData:CL:matches:season:2026:feed:2');
});

test('non-annual international tournaments retain provider-managed seasons', async () => {
  const requests = [];
  const context = createContext({
    _fetchWithTimeout: async url => { requests.push(url); return { ok: true, json: async () => ({ matches: [] }) }; }
  });
  context.codes = ['EC', 'WC']; context.widget = widget();
  await vm.runInContext("Promise.all(codes.map(code => _footballTrackerCompetitionPayload(widget, _footballTrackerCompetition(code), 'matches')))", context);
  assert.ok(requests.some(url => url.endsWith('/competitions/EC/matches')));
  assert.ok(requests.some(url => url.endsWith('/competitions/WC/matches')));
  assert.ok(requests.every(url => !url.includes('?season=')));
});

test('Champions League tracker falls back to current TheSportsDB events on provider rejection', async () => {
  const requests = [];
  const event = (id, season, date, home, away, homeScore, awayScore, status) => ({
    idEvent: String(id), strTimestamp: `${date}T19:00:00`, dateEvent: date, strStatus: status, strSeason: season, idLeague: '4480', strLeague: 'UEFA Champions League',
    idHomeTeam: String(id + 1), strHomeTeam: home, intHomeScore: homeScore, idAwayTeam: String(id + 2), strAwayTeam: away, intAwayScore: awayScore
  });
  const context = createContext({
    _fetchWithTimeout: async url => {
      requests.push(url);
      if (url.includes('api.football-data.org')) return { ok: false, status: 404, json: async () => ({ message: 'Season unavailable' }) };
      if (url.includes('/eventspastleague.php')) return { ok: true, json: async () => ({ events: [
        event(1, '2025-2026', '2026-05-30', 'Old FC', 'Previous FC', '2', '1', 'FT'),
        event(2, '2026-2027', '2026-08-19', 'Slovan Bratislava', 'Celje', '1', '1', 'FT')
      ] }) };
      if (url.includes('/eventsnextleague.php')) return { ok: true, json: async () => ({ events: [event(3, '2026-2027', '2026-08-25', 'Sabah Baku', "Hapoel Be'er Sheva", null, null, 'NS')] }) };
      if (url.includes('/eventsday.php?d=2026-08-19&l=4480')) return { ok: true, json: async () => ({ events: [
        event(4, '2026-2027', '2026-08-19', 'Celtic', 'LASK', '3', '0', 'FT'),
        event(5, '2026-2027', '2026-08-19', 'NEC Nijmegen', 'Bodø/Glimt', '1', '3', 'FT'),
        event(6, '2025-2026', '2026-08-19', 'Wrong Season', 'Old Season', '1', '0', 'FT')
      ] }) };
      if (url.includes('/eventsday.php?d=2026-08-25&l=4480')) return { ok: true, json: async () => ({ events: [event(3, '2026-2027', '2026-08-25', 'Sabah Baku', "Hapoel Be'er Sheva", null, null, 'NS')] }) };
      throw new Error(`Unexpected URL: ${url}`);
    }
  });
  context.widget = widget({ competitionCode: 'CL' }); context.event = event;
  const matches = await vm.runInContext("_footballTrackerLoad(widget, 'matches')", context);
  assert.equal(matches.length, 4);
  assert.ok(matches.every(match => match.utcDate >= Date.parse('2026-07-01T00:00:00Z')));
  assert.ok(matches.some(match => match.home.name === 'Celtic' && match.away.name === 'LASK'));
  assert.equal(vm.runInContext("_footballTrackerState(widget).providers.matches", context), 'theSportsDb');
  assert.equal(vm.runInContext("_footballTrackerState(widget).errors.matches", context), '');
  assert.ok(requests.some(url => url.includes('/eventspastleague.php?id=4480')));
  assert.ok(requests.some(url => url.includes('/eventsnextleague.php?id=4480')));
  assert.ok(requests.some(url => url.includes('/eventsday.php?d=2026-08-19&l=4480')));
});

test('unavailable current Champions League standings resolve to an empty state', async () => {
  const context = createContext({ _fetchWithTimeout: async () => { throw new Error('Season unavailable'); } });
  context.widget = widget({ competitionCode: 'CL' });
  const result = await vm.runInContext("_footballTrackerCompetitionData(widget, _footballTrackerCompetition(widget), 'standings')", context);
  assert.deepEqual([...result.value], []);
  assert.equal(result.provider, 'footballData');
});

test('Sportmonks network failures explain the required extension relay', async () => {
  const context = createContext({
    _fetchWithTimeout: async () => { throw new TypeError('NetworkError when attempting to fetch resource.'); },
    WidgetSDK: {
      cache: { get: () => null, set: value => value, remove: () => false },
      extensionRelay: { invoke: async () => ({ error: 'api.sportmonks.com returned 401: No token provided.' }) }
    }
  });
  context.widget = widget({ competitionCode: 'SCO-PL' });
  await assert.rejects(vm.runInContext("_footballTrackerProviderRequest(widget, _footballTrackerCompetition(widget), 'leagues/501')", context), /Reload Firefox extension 1\.0\.33/);
});

test('API-Football fixtures and standings normalize into the shared model', () => {
  const context = createContext();
  context.payload = { response: [{
    fixture: { id: 45, timestamp: 1787338800, status: { short: 'FT' } }, league: { round: 'Quarter-finals' },
    teams: { home: { id: 1, name: 'Home', logo: 'https://media.api-sports.io/home.png', winner: true }, away: { id: 2, name: 'Away', logo: 'https://media.api-sports.io/away.png', winner: false } },
    goals: { home: 2, away: 1 }, score: { fulltime: { home: 2, away: 1 } }
  }] };
  const matches = vm.runInContext('_footballTrackerApiFootballMatches(payload)', context);
  assert.equal(matches[0].status, 'FINISHED');
  assert.equal(matches[0].home.name, 'Home');
  assert.equal(matches[0].homeScore, 2);
  context.payload = { response: [{ league: { standings: [[{ rank: 1, team: { id: 1, name: 'Leaders', logo: 'https://media.api-sports.io/leaders.png' }, points: 12, goalsDiff: 8, all: { played: 4, win: 4, draw: 0, lose: 0, goals: { for: 10, against: 2 } } }]] } }] };
  const standings = vm.runInContext('_footballTrackerApiFootballStandings(payload)', context);
  assert.equal(standings[0].table[0].team.name, 'Leaders');
  assert.equal(standings[0].table[0].played, 4);
});

test('TheSportsDB results normalize qualifying matches into the shared model', () => {
  const context = createContext();
  context.payload = { results: [{
    idEvent: '2558133', strTimestamp: '2026-08-19T19:00:00', strStatus: 'FT', intRound: '400', strSeason: '2026-2027',
    idLeague: '4480', strLeague: 'UEFA Champions League', strLeagueBadge: 'https://r2.thesportsdb.com/champions.png',
    idHomeTeam: '133647', strHomeTeam: 'Celtic', strHomeTeamBadge: 'https://r2.thesportsdb.com/celtic.png', intHomeScore: '3',
    idAwayTeam: '137261', strAwayTeam: 'LASK', strAwayTeamBadge: 'https://r2.thesportsdb.com/lask.png', intAwayScore: '0'
  }] };
  const matches = vm.runInContext('_footballTrackerTheSportsDbMatches(payload)', context);
  assert.equal(matches[0].status, 'FINISHED');
  assert.equal(matches[0].competition.provider, 'theSportsDb');
  assert.equal(matches[0].competition.name, 'UEFA Champions League');
  assert.equal(matches[0].homeScore, 3);
  assert.equal(matches[0].awayScore, 0);
});

test('Sportmonks fixtures and standings normalize into the shared model', () => {
  const context = createContext();
  context.payload = { data: { fixtures: [{
    id: 501, starting_at_timestamp: 1787338800, state: { developer_name: 'FT' }, round: { name: '3' }, stage: { name: '1st Phase' },
    participants: [{ id: 53, name: 'Celtic', short_code: 'CEL', image_path: 'https://cdn.sportmonks.com/celtic.png', meta: { location: 'home' } }, { id: 62, name: 'Rangers', short_code: 'RAN', image_path: 'https://cdn.sportmonks.com/rangers.png', meta: { location: 'away' } }],
    scores: [{ description: 'CURRENT', score: { participant: 'home', goals: 2 } }, { description: 'CURRENT', score: { participant: 'away', goals: 1 } }]
  }] } };
  const matches = vm.runInContext('_footballTrackerSportmonksMatches(payload)', context);
  assert.equal(matches[0].home.name, 'Celtic');
  assert.equal(matches[0].awayScore, 1);
  context.payload = { data: [{ position: 1, points: 9, participant: { id: 53, name: 'Celtic', image_path: 'https://cdn.sportmonks.com/celtic.png' }, details: [
    { type_id: 129, value: 3 }, { type_id: 133, value: 8 }, { type_id: 134, value: 2 }, { type_id: 179, value: 6 }
  ] }] };
  const standings = vm.runInContext('_footballTrackerSportmonksStandings(payload)', context);
  assert.equal(standings[0].table[0].team.name, 'Celtic');
  assert.equal(standings[0].table[0].played, 3);
  assert.equal(standings[0].table[0].goalDifference, 6);
});

test('team history groups official competitions into tabs and keeps provider priority', () => {
  const context = createContext();
  context.team = { id: 1, name: 'Home FC', provider: 'footballData', area: 'England', competitionCode: 'PL' };
  context.ids = { footballData: 1, apiFootball: 101 };
  context.matches = [
    { id: 1, utcDate: 1000, status: 'FINISHED', home: { id: 1, name: 'Home FC' }, away: { id: 2, name: 'Away' }, homeScore: 2, awayScore: 1, competition: { provider: 'footballData', code: 'PL', name: 'Premier League', area: 'England' } },
    { id: 2, utcDate: 1000, status: 'FINISHED', home: { id: 101, name: 'Home' }, away: { id: 202, name: 'Away' }, homeScore: 2, awayScore: 1, competition: { provider: 'apiFootball', name: 'Premier League', area: 'England' } },
    { id: 3, utcDate: 2000, status: 'FINISHED', home: { id: 303, name: 'Cup Side' }, away: { id: 101, name: 'Home' }, homeScore: 0, awayScore: 3, competition: { provider: 'apiFootball', name: 'FA Cup', area: 'England' } },
    { id: 4, utcDate: 3000, status: 'SCHEDULED', home: { id: 101, name: 'Home' }, away: { id: 404, name: 'European Side' }, homeScore: null, awayScore: null, competition: { provider: 'apiFootball', name: 'UEFA Europa League', area: 'World' } },
    { id: 5, utcDate: 4000, status: 'FINISHED', home: { id: 101, name: 'Home' }, away: { id: 505, name: 'Friendly Side' }, homeScore: 1, awayScore: 1, competition: { provider: 'apiFootball', name: 'Club Friendlies', area: 'World' } }
  ];
  const history = vm.runInContext('_footballTrackerBuildTeamHistory(matches, team, ids, "PL")', context);
  assert.deepEqual([...history.groups].map(group => group.key), ['PL', 'ENG-FAC', 'EUR-EL']);
  assert.equal(history.groups[0].provider, 'footballData');
  assert.equal(history.groups[0].matches.length, 1);
  assert.equal(history.groups[1].matches[0].venue, 'A');
  assert.equal(history.groups[1].matches[0].result, 'W');
  assert.equal(history.groups[2].matches.length, 0);
});

test('cross-provider team history resolves API-Football once and adds missing cups', async () => {
  const requests = [];
  const context = createContext({
    _fetchWithTimeout: async url => {
      requests.push(url);
      if (url.includes('api.football-data.org') && url.includes('/teams/1/matches')) return { ok: true, json: async () => ({ matches: [{
        id: 11, utcDate: '2026-08-12T19:00:00Z', status: 'FINISHED', homeTeam: { id: 1, name: 'Home FC' }, awayTeam: { id: 2, name: 'League Side' }, score: { fullTime: { home: 2, away: 0 } }, competition: { id: 2021, code: 'PL', name: 'Premier League', area: { name: 'England' } }
      }] }) };
      if (url.includes('/teams?search=')) return { ok: true, json: async () => ({ response: [{ team: { id: 101, name: 'Home FC', country: 'England', logo: 'https://media.api-sports.io/home.png' } }] }) };
      if (url.includes('/fixtures?team=101')) return { ok: true, json: async () => ({ response: [{
        fixture: { id: 22, timestamp: 1787173200, status: { short: 'FT' } }, league: { id: 45, name: 'FA Cup', country: 'England' },
        teams: { home: { id: 101, name: 'Home FC', winner: true }, away: { id: 202, name: 'Cup Side', winner: false } }, goals: { home: 1, away: 0 }, score: { fulltime: { home: 1, away: 0 } }
      }] }) };
      throw new Error(`Unexpected URL: ${url}`);
    }
  });
  context.widget = widget(); context.team = { id: 1, name: 'Home FC', provider: 'footballData', area: 'England', competitionCode: 'PL' };
  const history = await vm.runInContext('_footballTrackerFetchTeamHistory(widget, team)', context);
  assert.deepEqual([...history.groups].map(group => group.key), ['PL', 'ENG-FAC']);
  assert.ok(requests.some(url => /teams\/1\/matches\?season=\d{4}&status=FINISHED&limit=500/.test(url)));
  assert.ok(requests.some(url => /teams\?search=Home%20FC/.test(url)));
  assert.ok(requests.some(url => /fixtures\?team=101&season=\d{4}/.test(url)));
  await vm.runInContext('_footballTrackerResolveApiFootballTeam(widget, team)', context);
  assert.equal(requests.filter(url => url.includes('/teams?search=')).length, 1);
});

test('a failed fallback stays silent when the primary provider returns team history', async () => {
  const context = createContext({
    _fetchWithTimeout: async url => {
      if (url.includes('api.football-data.org')) return { ok: true, json: async () => ({ matches: [{
        id: 11, utcDate: '2026-08-12T19:00:00Z', status: 'FINISHED', homeTeam: { id: 1, name: 'Home FC' }, awayTeam: { id: 2, name: 'League Side' }, score: { fullTime: { home: 2, away: 0 } }, competition: { code: 'PL', name: 'Premier League', area: { name: 'England' } }
      }] }) };
      return { ok: true, json: async () => ({ errors: { plan: 'Free plans do not have access to this season.' }, response: [] }) };
    }
  });
  context.widget = widget(); context.team = { id: 1, name: 'Home FC', provider: 'footballData', area: 'England', competitionCode: 'PL' };
  const history = await vm.runInContext('_footballTrackerFetchTeamHistory(widget, team)', context);
  assert.equal(history.groups[0].key, 'PL');
  assert.equal(history.warnings, undefined);
});

test('total team-history failure reports one generic provider warning', async () => {
  const context = createContext({ _fetchWithTimeout: async () => { throw new Error('private provider diagnostic'); } });
  context.widget = widget(); context.team = { id: 1, name: 'Home FC', provider: 'footballData', area: 'England', competitionCode: 'PL' };
  await assert.rejects(vm.runInContext('_footballTrackerFetchTeamHistory(widget, team)', context), error => {
    assert.match(error.message, /Home FC's current-season match history could not be retrieved from any available provider/);
    assert.doesNotMatch(error.message, /private provider diagnostic|relay unavailable|API-Football/);
    return true;
  });
});

test('Sportmonks team history uses the active-team schedule and labels the Premiership', async () => {
  const requests = [];
  const context = createContext({
    _fetchWithTimeout: async url => {
      requests.push(url);
      return { ok: true, json: async () => ({ data: [{ league_id: 501, rounds: [{ name: '1', fixtures: [{
        id: 900, starting_at_timestamp: 1787338800, state: { developer_name: 'FT' },
        participants: [{ id: 53, name: 'Celtic', meta: { location: 'home' } }, { id: 62, name: 'Rangers', meta: { location: 'away' } }],
        scores: [{ description: 'CURRENT', score: { participant: 'home', goals: 2 } }, { description: 'CURRENT', score: { participant: 'away', goals: 1 } }]
      }] }] }] }) };
    }
  });
  context.widget = widget({ competitionCode: 'SCO-PL' }); context.team = { id: 53, name: 'Celtic', provider: 'sportmonks', area: 'Scotland', competitionCode: 'SCO-PL' };
  const matches = await vm.runInContext('_footballTrackerProviderTeamMatches(widget, team, 2026)', context);
  assert.match(requests[0], /schedules\/teams\/53$/);
  assert.equal(matches[0].competition.name, 'Premiership');
  assert.equal(matches[0].home.name, 'Celtic');
});

test('Sportmonks clubs gain a cached football-data.org Champions League tab', async () => {
  const requests = [];
  const context = createContext({
    _fetchWithTimeout: async url => {
      requests.push(url);
      if (url.includes('api.sportmonks.com') && url.includes('/schedules/teams/53')) return { ok: true, json: async () => ({ data: [{ league_id: 501, rounds: [{ name: '1', fixtures: [{
        id: 900, starting_at_timestamp: 1786734000, state: { developer_name: 'FT' }, participants: [{ id: 53, name: 'Celtic', meta: { location: 'home' } }, { id: 70, name: 'Dundee', meta: { location: 'away' } }],
        scores: [{ description: 'CURRENT', score: { participant: 'home', goals: 1 } }, { description: 'CURRENT', score: { participant: 'away', goals: 0 } }]
      }] }] }] }) };
      if (url.includes('api.football-data.org') && url.includes('/competitions/CL/matches')) return { ok: true, json: async () => ({ matches: [{
        id: 901, utcDate: '2026-08-19T19:00:00Z', status: 'FINISHED', homeTeam: { id: 732, name: 'Celtic FC', shortName: 'Celtic' }, awayTeam: { id: 185, name: 'LASK' }, score: { fullTime: { home: 2, away: 1 } }, competition: { id: 2001, code: 'CL', name: 'UEFA Champions League', area: { name: 'Europe' } }
      }] }) };
      if (url.includes('v3.football.api-sports.io')) return { ok: true, json: async () => ({ errors: { plan: 'Current season unavailable.' }, response: [] }) };
      throw new Error(`Unexpected URL: ${url}`);
    }
  });
  context.widget = widget({ competitionCode: 'SCO-PL' }); context.team = { id: 53, name: 'Celtic', provider: 'sportmonks', area: 'Scotland', competitionCode: 'SCO-PL' };
  vm.runInContext("WidgetSDK.cache.set('footballTracker', widget.id, 'footballData:CL:matches', [], { ttlMs: 86400000 })", context);
  const history = await vm.runInContext('_footballTrackerFetchTeamHistory(widget, team)', context);
  assert.deepEqual([...history.groups].map(group => group.key), ['SCO-PL', 'CL']);
  assert.equal(history.groups[1].matches[0].opponent.name, 'LASK');
  assert.equal(history.groups[1].provider, 'footballData');
  await vm.runInContext('_footballTrackerFootballDataChampionsLeagueMatches(widget, team, 2026)', context);
  assert.equal(requests.filter(url => url.includes('/competitions/CL/matches')).length, 1);
  assert.ok(requests.some(url => url.includes('/competitions/CL/matches?season=2026')));
});

test('TheSportsDB fills a Champions League tab when configured providers omit it', async () => {
  const requests = [];
  const context = createContext({
    _fetchWithTimeout: async url => {
      requests.push(url);
      if (url.includes('api.sportmonks.com') && url.includes('/schedules/teams/53')) return { ok: true, json: async () => ({ data: [{ league_id: 501, rounds: [{ name: '1', fixtures: [{
        id: 900, starting_at_timestamp: 1786734000, state: { developer_name: 'FT' }, participants: [{ id: 53, name: 'Celtic', meta: { location: 'home' } }, { id: 70, name: 'Dundee', meta: { location: 'away' } }],
        scores: [{ description: 'CURRENT', score: { participant: 'home', goals: 1 } }, { description: 'CURRENT', score: { participant: 'away', goals: 0 } }]
      }] }] }] }) };
      if (url.includes('api.football-data.org') && url.includes('/competitions/CL/matches')) return { ok: true, json: async () => ({ matches: [] }) };
      if (url.includes('v3.football.api-sports.io')) return { ok: true, json: async () => ({ errors: { plan: 'Current season unavailable.' }, response: [] }) };
      if (url.includes('/searchteams.php?t=Celtic')) return { ok: true, json: async () => ({ teams: [{ idTeam: '133647', idAPIfootball: '247', strTeam: 'Celtic', strCountry: 'Scotland', strBadge: 'https://r2.thesportsdb.com/celtic.png' }] }) };
      if (url.includes('/eventslast.php?id=133647')) return { ok: true, json: async () => ({ results: [{
        idEvent: '2558133', strTimestamp: '2026-08-19T19:00:00', strStatus: 'FT', strSeason: '2026-2027', idLeague: '4480', strLeague: 'UEFA Champions League',
        idHomeTeam: '133647', strHomeTeam: 'Celtic', strHomeTeamBadge: 'https://r2.thesportsdb.com/celtic.png', intHomeScore: '3',
        idAwayTeam: '137261', strAwayTeam: 'LASK', strAwayTeamBadge: 'https://r2.thesportsdb.com/lask.png', intAwayScore: '0'
      }] }) };
      throw new Error(`Unexpected URL: ${url}`);
    }
  });
  context.widget = widget({ competitionCode: 'SCO-PL' }); context.team = { id: 53, name: 'Celtic', provider: 'sportmonks', area: 'Scotland', competitionCode: 'SCO-PL' };
  const history = await vm.runInContext('_footballTrackerFetchTeamHistory(widget, team)', context);
  assert.deepEqual([...history.groups].map(group => group.key), ['SCO-PL', 'CL']);
  assert.equal(history.groups[1].provider, 'theSportsDb');
  assert.equal(history.groups[1].matches[0].opponent.name, 'LASK');
  assert.equal(history.groups[1].matches[0].homeScore, 3);
  assert.ok(requests.some(url => url.includes('/eventslast.php?id=133647')));
});

test('TheSportsDB retains discovered current-season results across later checks', async () => {
  let latest = 'champions';
  const context = createContext({
    _fetchWithTimeout: async url => {
      if (url.includes('/searchteams.php')) return { ok: true, json: async () => ({ teams: [{ idTeam: '133647', strTeam: 'Celtic', strCountry: 'Scotland' }] }) };
      if (url.includes('/eventslast.php')) return { ok: true, json: async () => ({ results: latest === 'champions' ? [{
        idEvent: '2558133', strTimestamp: '2026-08-19T19:00:00', strStatus: 'FT', strSeason: '2026-2027', idLeague: '4480', strLeague: 'UEFA Champions League',
        idHomeTeam: '133647', strHomeTeam: 'Celtic', intHomeScore: '3', idAwayTeam: '137261', strAwayTeam: 'LASK', intAwayScore: '0'
      }] : [{
        idEvent: '2559000', strTimestamp: '2026-08-22T14:00:00', strStatus: 'FT', strSeason: '2026-2027', idLeague: '4330', strLeague: 'Scottish Premier League',
        idHomeTeam: '133639', strHomeTeam: 'St. Johnstone', intHomeScore: '0', idAwayTeam: '133647', strAwayTeam: 'Celtic', intAwayScore: '2'
      }] }) };
      throw new Error(`Unexpected URL: ${url}`);
    }
  });
  context.widget = widget({ competitionCode: 'SCO-PL' }); context.team = { id: 53, name: 'Celtic', provider: 'sportmonks', area: 'Scotland', competitionCode: 'SCO-PL' };
  const first = await vm.runInContext('_footballTrackerTheSportsDbRecentMatches(widget, team, 2026)', context);
  latest = 'league';
  const second = await vm.runInContext('_footballTrackerTheSportsDbRecentMatches(widget, team, 2026)', context);
  assert.equal(first.matches.length, 1);
  assert.equal(second.matches.length, 2);
  assert.ok(second.matches.some(match => match.competition.name === 'UEFA Champions League'));
});

test('team history is date-cached and manual reload bypasses the cached result', async () => {
  const context = createContext(); context.widget = widget(); context.team = { id: 1, name: 'Home FC', provider: 'footballData', area: 'England', competitionCode: 'PL' }; context.calls = 0;
  vm.runInContext('_footballTrackerFetchTeamHistory = async (_widget, selected) => { calls += 1; return { team: selected, groups: [], providers: [selected.provider], warnings: [] }; }; _footballTrackerState(widget).selectedTeam = team;', context);
  await vm.runInContext('_footballTrackerLoadTeamHistory(widget, team)', context);
  await vm.runInContext('_footballTrackerLoadTeamHistory(widget, team)', context);
  assert.equal(context.calls, 1);
  await vm.runInContext('_footballTrackerLoadTeamHistory(widget, team, true)', context);
  assert.equal(context.calls, 2);
});

test('provider metadata resolution is cached and builds competition-specific requests', async () => {
  const requests = [];
  const context = createContext({
    _fetchWithTimeout: async (url, options) => {
      requests.push({ url, options });
      if (url.includes('/leagues?')) return { ok: true, json: async () => ({ response: [{ league: { id: 81, name: 'DFB Pokal' }, seasons: [{ year: 2026, current: true }] }] }) };
      if (url.includes('/fixtures?')) return { ok: true, json: async () => ({ response: [] }) };
      if (url.includes('/leagues/501')) return { ok: true, json: async () => ({ data: { current_season: { id: 25500 } } }) };
      return { ok: true, json: async () => ({ data: { fixtures: [] } }) };
    }
  });
  context.widget = widget({ competitionCode: 'DEU-DFB' });
  await vm.runInContext("_footballTrackerCompetitionPayload(widget, _footballTrackerCompetition(widget), 'matches')", context);
  assert.match(requests[0].url, /leagues\?current=true&country=Germany&search=DFB%20Pokal/);
  assert.match(requests[1].url, /fixtures\?league=81&season=2026/);
  assert.equal(requests[0].options.headers['x-apisports-key'], 'api-football-key');
  await vm.runInContext("_footballTrackerCompetitionPayload(widget, _footballTrackerCompetition(widget), 'matches')", context);
  assert.equal(requests.filter(request => request.url.includes('/leagues?')).length, 1);

  context.widget = widget({ competitionCode: 'SCO-PL' });
  await vm.runInContext("_footballTrackerCompetitionPayload(widget, _footballTrackerCompetition(widget), 'matches')", context);
  assert.match(requests.at(-2).url, /leagues\/501\?include=currentSeason/);
  assert.match(requests.at(-1).url, /schedules\/seasons\/25500/);
  assert.equal(requests.at(-1).options.headers.Authorization, 'sportmonks-token');
});

test('same-day duplicate widgets share one provider load', async () => {
  let requestCount = 0;
  const context = createContext({
    _fetchWithTimeout: async () => { requestCount += 1; return { ok: true, json: async () => ({ matches: [] }) }; }
  });
  context.first = widget(); context.second = { ...widget(), id: 'football-2', config: { ...widget().config } };
  await vm.runInContext("_footballTrackerLoad(first, 'matches')", context);
  await vm.runInContext("_footballTrackerLoad(second, 'matches')", context);
  assert.equal(requestCount, 1);
});

test('widget is a responsive Sports descriptor using local cache and optional relay', () => {
  const context = createContext(); const descriptor = context.WIDGET_REGISTRY.footballTracker;
  assert.equal(descriptor.category, 'Sports');
  assert.deepEqual(JSON.parse(JSON.stringify(descriptor.allowedIn)), ['column', 'navpane']);
  assert.deepEqual(JSON.parse(JSON.stringify(descriptor.defaultData)), {});
  assert.equal(descriptor.capabilities.localCache.quotaBytes, 2 * 1024 * 1024);
  assert.equal(descriptor.capabilities.extensionRelay.optional, true);
  assert.ok(descriptor.capabilities.network.domains.includes('api.football-data.org'));
  assert.ok(descriptor.capabilities.network.domains.includes('api.sportmonks.com'));
  assert.ok(descriptor.capabilities.network.domains.includes('v3.football.api-sports.io'));
  assert.ok(descriptor.capabilities.network.domains.includes('www.thesportsdb.com'));
  assert.match(source, /FOOTBALL_TRACKER_PROVIDERS\[runtime\.providers\[runtime\.view\]\]/);
  assert.doesNotMatch(source, /\blocalStorage\b|\bfetch\s*\(/);
});

test('football assets load after the SDK and include compact layouts', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'source', 'football-tracker-widget.css'), 'utf8');
  assert.ok(html.indexOf('source/widget-sdk.js') < html.indexOf('source/football-tracker-widget.js'));
  assert.match(html, /source\/football-tracker-widget\.css/);
  assert.match(css, /football-tracker-widget\.is-compact/);
  assert.match(css, /@container\(max-width:340px\)/);
  assert.match(source, /Country \/ area/);
  assert.match(source, /League \/ competition/);
  assert.match(css, /football-tracker-history-tabs/);
  assert.match(css, /football-tracker-history-match/);
});

test('teams are keyboard-accessible history controls with competition tabs and a back action', () => {
  assert.match(source, /document\.createElement\(canOpen \? 'button' : 'span'\)/);
  assert.match(source, /View \$\{team\.name\} current-season match history/);
  assert.match(source, /setAttribute\('role', 'tablist'\)/);
  assert.match(source, /Back to competition/);
  assert.match(source, /runtime\.selectedTeam \? _footballTrackerLoadTeamHistory/);
  assert.match(source, /could not be retrieved from any available provider/);
  assert.doesNotMatch(source, /history\.warnings/);
});

test('standings render goals for and against alongside the existing statistics', () => {
  assert.match(source, /<span>P<\/span><span>GF<\/span><span>GA<\/span><span>GD<\/span><span>Pts<\/span>/);
  assert.match(source, /goalsFor\.textContent = String\(entry\.goalsFor\)/);
  assert.match(source, /goalsAgainst\.textContent = String\(entry\.goalsAgainst\)/);
  assert.match(source, /row\.append\(position, team, played, goalsFor, goalsAgainst, difference, points\)/);
});

test('completed async loads refresh every rendered tracker instance', () => {
  assert.match(source, /_setWidgetRefresher\(widget\.id, context, rerender\)/);
  assert.match(source, /_refreshWidget\(widget\.id, 'column'\)/);
  assert.match(source, /_refreshWidget\(widget\.id, 'navpane'\)/);
});

test('football data remains cached until the local date changes', () => {
  const context = createContext();
  const now = new Date(2026, 7, 21, 23, 59, 0).getTime();
  context.now = now;
  const delay = vm.runInContext('_footballTrackerMsUntilDateChange(now)', context);
  assert.ok(delay >= 60_000 && delay <= 62_000);
  assert.doesNotMatch(source, /FOOTBALL_TRACKER_(?:MATCH|STANDINGS)_CACHE_MS/);
  assert.match(source, /ttlMs: _footballTrackerMsUntilDateChange\(\)/);
});

test('date rollover clears both cached views once and rerenders the tracker', () => {
  const refreshes = [];
  const context = createContext({ _refreshWidget: (...args) => refreshes.push(args.join(':')) });
  context.widget = widget();
  vm.runInContext("_footballTrackerState(widget).dateKey = '2000-01-01'; WidgetSDK.cache.set('footballTracker', widget.id, 'footballData:PL:matches:season:2026', [1]); WidgetSDK.cache.set('footballTracker', widget.id, 'footballData:PL:standings:season:2026', [2]);", context);
  assert.equal(vm.runInContext('_footballTrackerRefreshForDate(widget)', context), true);
  assert.equal(context.__cache.has('footballTracker:football-1:footballData:PL:matches:season:2026'), false);
  assert.equal(context.__cache.has('footballTracker:football-1:footballData:PL:standings:season:2026'), false);
  assert.deepEqual(refreshes, ['football-1:column', 'football-1:navpane']);
  assert.equal(vm.runInContext('_footballTrackerRefreshForDate(widget)', context), false);
  assert.equal(refreshes.length, 2);
});
