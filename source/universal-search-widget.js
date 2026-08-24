// --- Universal Search Launcher widget --------------------------------------

const _universalSearchRuntime = new Map();
// Unfinished queries and the keyboard-highlighted result are deliberately transient.
// Only completed recent searches are cached, when the user enables that option.
const UNIVERSAL_SEARCH_RECENTS_KEY = 'recent-searches';
const UNIVERSAL_SEARCH_RESERVED_ALIASES = new Set(['open','edit','move','tag','set','inbox','add','http','https']);
const UNIVERSAL_SEARCH_PROVIDER_PRESETS = Object.freeze([
  { group: 'General', id: 'google', name: 'Google', alias: 'g', icon: 'G', template: 'https://www.google.com/search?q={query}' },
  { group: 'General', id: 'duckduckgo', name: 'DuckDuckGo', alias: 'ddg', icon: 'D', template: 'https://duckduckgo.com/?q={query}' },
  { group: 'General', id: 'bing', name: 'Bing', alias: 'b', icon: 'B', template: 'https://www.bing.com/search?q={query}' },
  { group: 'General', id: 'google-maps', name: 'Google Maps', alias: 'maps', icon: 'M', template: 'https://www.google.com/maps/search/?api=1&query={query}' },
  { group: 'General', id: 'reddit', name: 'Reddit', alias: 'reddit', icon: 'r', template: 'https://www.reddit.com/search/?q={query}' },
  { group: 'Knowledge', id: 'wikipedia', name: 'Wikipedia', alias: 'wiki', icon: 'W', template: 'https://en.wikipedia.org/w/index.php?search={query}' },
  { group: 'Knowledge', id: 'wolfram-alpha', name: 'Wolfram Alpha', alias: 'wa', icon: 'Wα', template: 'https://www.wolframalpha.com/input?i={query}' },
  { group: 'Knowledge', id: 'internet-archive', name: 'Internet Archive', alias: 'ia', icon: 'IA', template: 'https://archive.org/search?query={query}' },
  { group: 'Development', id: 'github', name: 'GitHub', alias: 'gh', icon: 'GH', template: 'https://github.com/search?q={query}' },
  { group: 'Development', id: 'stackoverflow', name: 'Stack Overflow', alias: 'so', icon: 'SO', template: 'https://stackoverflow.com/search?q={query}' },
  { group: 'Development', id: 'mdn', name: 'MDN Web Docs', alias: 'mdn', icon: 'MDN', template: 'https://developer.mozilla.org/en-US/search?q={query}' },
  { group: 'Development', id: 'npm', name: 'npm', alias: 'npm', icon: 'npm', template: 'https://www.npmjs.com/search?q={query}' },
  { group: 'Development', id: 'pypi', name: 'PyPI', alias: 'pypi', icon: 'PyPI', template: 'https://pypi.org/search/?q={query}' },
  { group: 'Development', id: 'docker-hub', name: 'Docker Hub', alias: 'docker', icon: 'D', template: 'https://hub.docker.com/search?q={query}' },
  { group: 'Shopping', id: 'amazon-uk', name: 'Amazon UK', alias: 'amz', icon: 'A', template: 'https://www.amazon.co.uk/s?k={query}' },
  { group: 'Shopping', id: 'ebay-uk', name: 'eBay UK', alias: 'ebay', icon: 'e', template: 'https://www.ebay.co.uk/sch/i.html?_nkw={query}' },
  { group: 'Gaming', id: 'steam', name: 'Steam', alias: 'steam', icon: 'S', template: 'https://store.steampowered.com/search/?term={query}' },
  { group: 'Gaming', id: 'gog', name: 'GOG', alias: 'gog', icon: 'GOG', template: 'https://www.gog.com/en/games?query={query}' },
  { group: 'Gaming', id: 'steamdb', name: 'SteamDB', alias: 'steamdb', icon: 'SDB', template: 'https://steamdb.info/search/?a=app&q={query}' },
  { group: 'Gaming', id: 'itch-io', name: 'itch.io', alias: 'itch', icon: 'itch', template: 'https://itch.io/search?q={query}' },
  { group: 'Gaming', id: 'protondb', name: 'ProtonDB', alias: 'proton', icon: 'P', template: 'https://www.protondb.com/search?q={query}' },
  { group: 'Gaming', id: 'pcgamingwiki', name: 'PCGamingWiki', alias: 'pcgw', icon: 'PC', template: 'https://www.pcgamingwiki.com/w/index.php?search={query}' },
  { group: 'Gaming', id: 'nexus-mods', name: 'Nexus Mods', alias: 'nexus', icon: 'N', template: 'https://www.nexusmods.com/search/?gsearch={query}&gsearchtype=mods' },
  { group: 'Media', id: 'youtube', name: 'YouTube', alias: 'yt', icon: '▶', template: 'https://www.youtube.com/results?search_query={query}' },
  { group: 'Media', id: 'twitch', name: 'Twitch', alias: 'twitch', icon: 'T', template: 'https://www.twitch.tv/search?term={query}' },
  { group: 'Media', id: 'bandcamp', name: 'Bandcamp', alias: 'bandcamp', icon: 'B', template: 'https://bandcamp.com/search?q={query}' },
  { group: 'Media', id: 'imdb', name: 'IMDb', alias: 'imdb', icon: 'IMDb', template: 'https://www.imdb.com/find/?q={query}' }
]);

function _universalSearchProviderId() { return `provider-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
function _universalSearchAlias(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 16); }
function _universalSearchPreset(id) { return UNIVERSAL_SEARCH_PROVIDER_PRESETS.find(provider => provider.id === id) || null; }
function _universalSearchProviderCopy(provider, preserveId = false) {
  return { id: preserveId ? provider.id : _universalSearchProviderId(), name: provider.name, alias: provider.alias, icon: provider.icon, template: provider.template };
}

function _universalSearchTemplate(value) {
  const input = String(value || '').trim().slice(0, 2048);
  try {
    const marker = '__MORPHEUS_QUERY__';
    if ((input.match(/\{query\}/g) || []).length !== 1) return '';
    const parsed = new URL(input.replace('{query}', marker));
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.hostname || !parsed.href.includes(marker)) return '';
    return parsed.href.replace(marker, '{query}');
  } catch { return ''; }
}

function _universalSearchProviders(widget) {
  widget.config = widget.config || {};
  const defaults = ['google', 'duckduckgo', 'youtube', 'wikipedia'].map(id => _universalSearchProviderCopy(_universalSearchPreset(id), true));
  const source = Array.isArray(widget.config.providers) && widget.config.providers.length ? widget.config.providers : defaults;
  const ids = new Set(); const aliases = new Set();
  widget.config.providers = source.slice(0, 20).map(entry => {
    let id = String(entry?.id || '').trim().slice(0, 80); if (!id || ids.has(id)) id = _universalSearchProviderId(); ids.add(id);
    let alias = _universalSearchAlias(entry?.alias);
    if (!alias || aliases.has(alias) || UNIVERSAL_SEARCH_RESERVED_ALIASES.has(alias)) alias = '';
    if (alias) aliases.add(alias);
    const template = _universalSearchTemplate(entry?.template);
    if (!template) return null;
    return { id, name: String(entry?.name || 'Search').trim().slice(0, 60) || 'Search', alias, icon: String(entry?.icon || '⌕').trim().slice(0, 8) || '⌕', template };
  }).filter(Boolean);
  if (!widget.config.providers.length) widget.config.providers = defaults;
  if (!widget.config.providers.some(provider => provider.id === widget.config.defaultProviderId)) widget.config.defaultProviderId = widget.config.providers[0]?.id || '';
  widget.config.rememberSearches = widget.config.rememberSearches !== false;
  widget.config.openInNewTab = widget.config.openInNewTab !== false;
  widget.config.localResultCount = Math.max(3, Math.min(20, Number(widget.config.localResultCount) || 8));
  return widget.config.providers;
}

function _universalSearchKnownProviders(widget) {
  const configured = _universalSearchProviders(widget).map(provider => ({ ...provider, configured: true, group: _universalSearchPreset(provider.id)?.group || 'Custom' }));
  const configuredIds = new Set(configured.map(provider => provider.id));
  const claimedAliases = new Set(configured.map(provider => provider.alias).filter(Boolean));
  const catalogue = UNIVERSAL_SEARCH_PROVIDER_PRESETS.filter(provider => !configuredIds.has(provider.id) && !claimedAliases.has(provider.alias)).map(provider => ({ ...provider, configured: false }));
  return [...configured, ...catalogue];
}

function _universalSearchProviderHome(provider) {
  try { return new URL(provider.template.replace('{query}', '')).origin; } catch { return ''; }
}

function _universalSearchProviderIcon(provider, className, size = 16) {
  const wrapper = document.createElement('span'); wrapper.className = className; wrapper.style.display = 'inline-grid'; wrapper.style.placeItems = 'center';
  const fallback = document.createElement('span'); fallback.textContent = provider?.icon || '⌕'; fallback.style.gridArea = '1 / 1';
  const image = document.createElement('img'); image.alt = ''; image.draggable = false; image.style.gridArea = '1 / 1'; image.style.width = `${size}px`; image.style.height = `${size}px`; image.style.objectFit = 'contain';
  image.addEventListener('load', () => fallback.classList.add('hidden'));
  image.addEventListener('error', () => image.remove());
  wrapper.append(fallback, image);
  const home = _universalSearchProviderHome(provider);
  if (!home) { image.remove(); return wrapper; }
  if (typeof resolveFaviconSource === 'function') Promise.resolve(resolveFaviconSource({ title: provider.name, url: home, faviconCache: '' })).then(source => { if (source && image.isConnected) image.src = source; }).catch(() => {});
  else image.src = `${home}/favicon.ico`;
  return wrapper;
}

function _universalSearchDirectUrl(query) {
  const input = String(query || '').trim();
  if (!input || /\s/.test(input)) return '';
  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(input);
    const localAddress = /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:\/|$)/i.test(input);
    const domain = /^(?:[a-z0-9-]+\.)+[a-z]{2,63}(?::\d+)?(?:\/|$)/i.test(input);
    if (!hasScheme && !localAddress && !domain) return '';
    const candidate = hasScheme ? input : (localAddress ? `http://${input}` : `https://${input}`);
    const url = new URL(candidate);
    if (!['http:','https:'].includes(url.protocol) || !url.hostname) return '';
    return url.href;
  } catch { return ''; }
}

function _universalSearchParse(widget, input) {
  const query = String(input || '').trim(); const providers = _universalSearchProviders(widget);
  const firstSpace = query.indexOf(' '); const providerToken = firstSpace < 0 ? query : query.slice(0, firstSpace); const potentialAlias = _universalSearchAlias(providerToken);
  const provider = providers.find(item => item.alias && item.alias === potentialAlias) || (providerToken.startsWith('@') ? _universalSearchKnownProviders(widget).find(item => item.alias === potentialAlias) : null);
  if (provider && firstSpace >= 0) return { query: query.slice(firstSpace + 1).trim(), provider, explicit: true };
  return { query, provider: providers.find(item => item.id === widget.config.defaultProviderId) || providers[0] || null, explicit: false };
}

function _universalSearchProviderChoices(widget, input) {
  const match = String(input || '').match(/^@([^\s]*)$/);
  if (!match) return [];
  const filter = match[1].toLowerCase();
  return _universalSearchKnownProviders(widget).filter(provider => provider.alias && (!filter || provider.alias.includes(filter) || provider.name.toLowerCase().includes(filter) || provider.group.toLowerCase().includes(filter))).map(provider => ({
    id: `provider-choice:${provider.id}`,
    group: 'Search providers',
    label: provider.name,
    detail: `${provider.group} · ${provider.configured ? 'Added' : 'Built-in'} · @${provider.alias} · ${new URL(provider.template.replace('{query}', '')).hostname}`,
    icon: provider.icon,
    provider,
    fill: `@${provider.alias} `
  }));
}

function _universalSearchPresetMatches(provider, input) {
  const terms = String(input || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = `${provider.group} ${provider.name} ${provider.alias} ${provider.id}`.toLowerCase();
  return terms.every(term => haystack.includes(term));
}

function _universalSearchUrl(provider, query) { return provider ? provider.template.replace('{query}', encodeURIComponent(String(query || ''))) : ''; }

function _universalSearchRecents(widget) {
  const value = WidgetSDK.cache.get('universalSearch', widget.id, UNIVERSAL_SEARCH_RECENTS_KEY);
  return Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0, 20) : [];
}

function _universalSearchRemember(widget, query) {
  if (!widget.config.rememberSearches || !String(query).trim()) return;
  const value = String(query).trim().slice(0, 300); const recents = [value, ..._universalSearchRecents(widget).filter(item => item !== value)].slice(0, 20);
  try { WidgetSDK.cache.set('universalSearch', widget.id, UNIVERSAL_SEARCH_RECENTS_KEY, recents); } catch {}
}

function _universalSearchLocalEntries(query, limit) {
  if (!query || typeof buildCommandPaletteEntries !== 'function') return [];
  const entries = buildCommandPaletteEntries();
  return entries.map(entry => ({ entry, score: typeof scoreCommandPaletteEntry === 'function' ? scoreCommandPaletteEntry(entry, query) : 0 }))
    .filter(result => result.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(result => result.entry);
}

function _universalSearchOpen(widget, url) {
  const safe = _universalSearchDirectUrl(url); if (!safe) return false;
  if (widget.config.openInNewTab) window.open(safe, '_blank', 'noopener'); else window.location.assign(safe);
  return true;
}

function _universalSearchBuildResults(widget, input) {
  const providerChoices = _universalSearchProviderChoices(widget, input);
  if (String(input || '').startsWith('@') && !String(input || '').includes(' ')) return providerChoices;
  const parsed = _universalSearchParse(widget, input); const results = [];
  const direct = _universalSearchDirectUrl(parsed.query);
  if (direct) results.push({ id: `url:${direct}`, group: 'Navigate', label: `Open ${direct}`, detail: 'Direct URL', run: () => _universalSearchOpen(widget, direct) });
  if (!parsed.explicit) _universalSearchLocalEntries(parsed.query, widget.config.localResultCount).forEach(entry => results.push({ ...entry, id: `local:${entry.id}`, run: () => { _universalSearchRemember(widget, parsed.query); return entry.run?.(); } }));
  if (parsed.provider && parsed.query) {
    const searchUrl = _universalSearchUrl(parsed.provider, parsed.query);
    results.push({ id: `provider:${parsed.provider.id}:${parsed.query}`, group: 'Web Search', label: `${parsed.provider.name}: ${parsed.query}`, detail: parsed.explicit ? `Alias ${parsed.provider.alias}` : 'Default provider', icon: parsed.provider.icon, provider: parsed.provider, run: () => { _universalSearchRemember(widget, input); _universalSearchOpen(widget, searchUrl); } });
  }
  return results;
}

function _universalSearchRender(widget, element, context) {
  _universalSearchProviders(widget); const runtime = _universalSearchRuntime.get(widget.id) || { query: '', selected: 0 }; _universalSearchRuntime.set(widget.id, runtime);
  element.className = `universal-search-widget${context === 'navpane' ? ' is-compact' : ''}`;
  const inputRow = document.createElement('div'); inputRow.className = 'universal-search-input-row';
  const input = document.createElement('input'); input.type = 'search'; input.placeholder = 'Search the Hub, enter a URL, or type @ for providers…'; input.value = runtime.query; input.autocomplete = 'off'; input.setAttribute('aria-label', 'Universal search');
  const clear = document.createElement('button'); clear.type = 'button'; clear.textContent = '×'; clear.title = 'Clear'; inputRow.append(input, clear); element.appendChild(inputRow);
  const providers = document.createElement('div'); providers.className = 'universal-search-providers';
  _universalSearchProviders(widget).forEach(provider => { const button = document.createElement('button'); button.type = 'button'; button.style.display = 'inline-flex'; button.style.alignItems = 'center'; button.style.gap = '5px'; button.append(_universalSearchProviderIcon(provider, 'universal-search-provider-icon', 14), document.createTextNode(provider.alias || provider.name)); button.title = provider.alias ? `Search ${provider.name} with @${provider.alias}` : `${provider.name} needs an alias before it can be selected here`; button.disabled = !provider.alias; button.addEventListener('click', () => { input.value = `@${provider.alias} `; runtime.query = input.value; input.focus(); renderResults(); }); providers.appendChild(button); }); element.appendChild(providers);
  const results = document.createElement('div'); results.className = 'universal-search-results'; results.setAttribute('role', 'listbox'); element.appendChild(results);
  const renderResults = () => {
    runtime.query = input.value; const entries = _universalSearchBuildResults(widget, input.value); runtime.entries = entries; runtime.selected = Math.max(0, Math.min(runtime.selected, entries.length - 1)); results.innerHTML = '';
    if (!input.value.trim()) {
      const recents = _universalSearchRecents(widget); if (!recents.length) { const hint = document.createElement('div'); hint.className = 'widget-empty-state'; hint.textContent = 'Type to match Hub items, commands, URLs, or a web search.'; results.appendChild(hint); return; }
      recents.forEach(value => { const button = document.createElement('button'); button.type = 'button'; button.className = 'universal-search-recent'; button.textContent = value; button.addEventListener('click', () => { input.value = value; runtime.selected = 0; renderResults(); input.focus(); }); results.appendChild(button); }); return;
    }
    if (!entries.length) { const empty = document.createElement('div'); empty.className = 'widget-empty-state'; const parsed = _universalSearchParse(widget, input.value); empty.textContent = parsed.explicit && !parsed.query ? `Type a query to search ${parsed.provider.name}.` : (input.value === '@' ? 'No providers with aliases are configured.' : 'No local match or valid search provider.'); results.appendChild(empty); return; }
    const activateEntry = entry => {
      if (typeof entry.fill === 'string') { input.value = entry.fill; runtime.query = input.value; runtime.selected = 0; renderResults(); input.focus(); return; }
      entry.run?.();
    };
    entries.forEach((entry, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = `universal-search-result${index === runtime.selected ? ' is-selected' : ''}`; button.setAttribute('role', 'option'); button.setAttribute('aria-selected', index === runtime.selected ? 'true' : 'false');
      const icon = entry.provider ? _universalSearchProviderIcon(entry.provider, 'universal-search-result-icon', 16) : document.createElement('span'); if (!entry.provider) { icon.className = 'universal-search-result-icon'; icon.textContent = entry.icon || (entry.group === 'Web Search' ? '⌕' : '→'); }
      const text = document.createElement('span'); text.className = 'universal-search-result-text'; const label = document.createElement('span'); label.className = 'universal-search-result-label'; label.textContent = entry.label; const detail = document.createElement('span'); detail.className = 'universal-search-result-detail'; detail.textContent = `${entry.group || 'Hub'}${entry.detail ? ` · ${entry.detail}` : ''}`; text.append(label, detail); button.append(icon, text);
      button.addEventListener('mouseenter', () => {
        runtime.selected = index;
        results.querySelectorAll('.universal-search-result').forEach((item, itemIndex) => { item.classList.toggle('is-selected', itemIndex === index); item.setAttribute('aria-selected', itemIndex === index ? 'true' : 'false'); });
      }); button.addEventListener('click', () => activateEntry(entry)); results.appendChild(button);
    });
  };
  input.addEventListener('input', () => { runtime.selected = 0; renderResults(); });
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); runtime.selected = Math.min((runtime.entries?.length || 1) - 1, runtime.selected + 1); renderResults(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); runtime.selected = Math.max(0, runtime.selected - 1); renderResults(); }
    else if (event.key === 'Enter') { event.preventDefault(); const entry = runtime.entries?.[runtime.selected]; if (entry) { if (typeof entry.fill === 'string') { input.value = entry.fill; runtime.query = input.value; runtime.selected = 0; renderResults(); } else entry.run?.(); } }
    else if (event.key === 'Escape') { input.value = ''; runtime.query = ''; runtime.selected = 0; renderResults(); }
  });
  clear.addEventListener('click', () => { input.value = ''; runtime.query = ''; runtime.selected = 0; renderResults(); input.focus(); }); renderResults();
}

function _universalSearchRenderSettings(widget, container) {
  const providers = _universalSearchProviders(widget);
  container.innerHTML = `<div class="settings-section"><div class="settings-section-label">Search providers</div><div class="universal-search-settings-list"></div><button type="button" class="secondary-btn universal-search-add">Add provider</button></div>
    <div class="settings-row"><span>Default provider</span><select class="settings-select" data-cfg="defaultProviderId"></select></div>
    <div class="settings-row"><span>Local result count</span><input class="settings-text-input" type="number" min="3" max="20" data-cfg="localResultCount" value="${widget.config.localResultCount}"/></div>
    <div class="settings-row"><span>Open searches in a new tab</span><label class="settings-toggle"><input type="checkbox" data-cfg="openInNewTab" ${widget.config.openInNewTab ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
    <div class="settings-row"><span>Remember recent searches locally</span><label class="settings-toggle"><input type="checkbox" data-cfg="rememberSearches" ${widget.config.rememberSearches ? 'checked' : ''}/><span class="toggle-track"></span></label></div>
    <button type="button" class="secondary-btn universal-search-clear-recents">Clear recent searches</button>
    <div class="settings-help">Templates must be HTTPS and contain exactly one {query} placeholder. Aliases are unique; reserved command words are ignored. Recent searches stay in this browser.</div>
    <div class="universal-search-provider-editor hidden" role="dialog" aria-modal="true" aria-labelledby="universalSearchProviderEditorTitle">
      <div class="universal-search-provider-editor-card">
        <div class="universal-search-provider-editor-header"><strong id="universalSearchProviderEditorTitle">Add search provider</strong><button type="button" class="icon-btn universal-search-provider-cancel" aria-label="Close">×</button></div>
        <label class="universal-search-provider-field"><span>Start from a preset</span><span class="universal-search-provider-preset-picker"><input type="search" class="settings-text-input universal-search-provider-preset-filter" placeholder="Filter by name or purpose…" aria-label="Filter provider presets"/><select class="settings-select universal-search-provider-preset"><option value="">Custom provider</option></select></span></label>
        <div class="universal-search-provider-form">
          <label><span>Name</span><input class="settings-text-input" data-provider-field="name" maxlength="60" /></label>
          <label><span>Alias</span><input class="settings-text-input" data-provider-field="alias" maxlength="16" /></label>
          <label><span>Fallback icon</span><input class="settings-text-input" data-provider-field="icon" maxlength="8" /></label>
          <label class="universal-search-provider-template"><span>HTTPS template</span><input class="settings-text-input" data-provider-field="template" placeholder="https://example.com/search?q={query}" /></label>
        </div>
        <div class="settings-warning universal-search-provider-error hidden"></div>
        <div class="universal-search-provider-editor-actions"><button type="button" class="secondary-btn universal-search-provider-cancel">Cancel</button><button type="button" class="primary-btn universal-search-provider-save">Add provider</button></div>
      </div>
    </div>`;
  const list = container.querySelector('.universal-search-settings-list'); const defaultSelect = container.querySelector('[data-cfg="defaultProviderId"]');
  const editor = container.querySelector('.universal-search-provider-editor');
  const editorTitle = container.querySelector('#universalSearchProviderEditorTitle');
  const editorSave = container.querySelector('.universal-search-provider-save');
  const editorError = container.querySelector('.universal-search-provider-error');
  const presetSelect = container.querySelector('.universal-search-provider-preset');
  const presetFilter = container.querySelector('.universal-search-provider-preset-filter');
  const providerFields = Object.fromEntries([...container.querySelectorAll('[data-provider-field]')].map(input => [input.dataset.providerField, input]));
  let editingIndex = -1;
  const renderPresetOptions = () => {
    const current = presetSelect.value; const matches = UNIVERSAL_SEARCH_PROVIDER_PRESETS.filter(provider => _universalSearchPresetMatches(provider, presetFilter.value)); const presetGroups = new Map();
    presetSelect.innerHTML = '<option value="">Custom provider</option>';
    matches.forEach(provider => {
      if (!presetGroups.has(provider.group)) { const group = document.createElement('optgroup'); group.label = provider.group; presetGroups.set(provider.group, group); presetSelect.appendChild(group); }
      const option = document.createElement('option'); option.value = provider.id; option.textContent = `${provider.name} (@${provider.alias})`; presetGroups.get(provider.group).appendChild(option);
    });
    if (!matches.length) { const option = document.createElement('option'); option.disabled = true; option.textContent = 'No matching presets'; presetSelect.appendChild(option); }
    presetSelect.value = matches.some(provider => provider.id === current) ? current : '';
  };
  const renderRows = () => {
    list.innerHTML = '';
    providers.forEach((provider, index) => {
      const row = document.createElement('div'); row.className = 'universal-search-settings-row';
      const icon = _universalSearchProviderIcon(provider, 'universal-search-settings-icon', 18);
      const summary = document.createElement('span'); summary.className = 'universal-search-settings-summary';
      const name = document.createElement('strong'); name.textContent = provider.name;
      const detail = document.createElement('small'); detail.textContent = provider.alias ? `@${provider.alias} · ${new URL(provider.template.replace('{query}', '')).hostname}` : new URL(provider.template.replace('{query}', '')).hostname;
      summary.append(name, detail);
      const order = document.createElement('span'); order.className = 'universal-search-settings-order';
      const up = document.createElement('button'); up.type = 'button'; up.className = 'icon-btn'; up.textContent = '↑'; up.title = `Move ${provider.name} up`; up.disabled = index === 0; up.addEventListener('click', () => { providers.splice(index - 1, 0, providers.splice(index, 1)[0]); renderRows(); renderDefault(); });
      const down = document.createElement('button'); down.type = 'button'; down.className = 'icon-btn'; down.textContent = '↓'; down.title = `Move ${provider.name} down`; down.disabled = index === providers.length - 1; down.addEventListener('click', () => { providers.splice(index + 1, 0, providers.splice(index, 1)[0]); renderRows(); renderDefault(); });
      order.append(up, down);
      const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'secondary-btn universal-search-provider-edit'; edit.textContent = 'Edit'; edit.addEventListener('click', () => openEditor(index));
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-btn is-danger'; remove.textContent = '×'; remove.setAttribute('aria-label', `Remove ${provider.name}`); remove.addEventListener('click', () => { providers.splice(index, 1); renderRows(); renderDefault(); });
      row.append(icon, summary, order, edit, remove); list.appendChild(row);
    });
    container.querySelector('.universal-search-add').disabled = providers.length >= 20;
  };
  const renderDefault = () => { const current = defaultSelect.value || widget.config.defaultProviderId; defaultSelect.innerHTML = ''; providers.forEach(provider => { const option = document.createElement('option'); option.value = provider.id; option.textContent = provider.name; option.selected = provider.id === current; defaultSelect.appendChild(option); }); };
  function openEditor(index = -1) {
    editingIndex = index; const provider = index >= 0 ? providers[index] : { name: '', alias: '', icon: '⌕', template: '' };
    editorTitle.textContent = index >= 0 ? 'Edit search provider' : 'Add search provider'; editorSave.textContent = index >= 0 ? 'Update provider' : 'Add provider'; presetFilter.value = ''; renderPresetOptions(); presetSelect.value = '';
    Object.entries(providerFields).forEach(([key, input]) => { input.value = provider[key] || ''; });
    editorError.classList.add('hidden'); editor.classList.remove('hidden'); editor.setAttribute('aria-hidden', 'false'); providerFields.name.focus();
  }
  function closeEditor() { editor.classList.add('hidden'); editor.setAttribute('aria-hidden', 'true'); editingIndex = -1; }
  presetSelect.addEventListener('change', () => {
    const preset = _universalSearchPreset(presetSelect.value); if (!preset) return;
    Object.entries(providerFields).forEach(([key, input]) => { input.value = preset[key] || ''; });
  });
  presetFilter.addEventListener('input', renderPresetOptions);
  editorSave.addEventListener('click', () => {
    const candidate = { id: editingIndex >= 0 ? providers[editingIndex].id : _universalSearchProviderId(), name: providerFields.name.value.trim(), alias: _universalSearchAlias(providerFields.alias.value), icon: providerFields.icon.value.trim(), template: _universalSearchTemplate(providerFields.template.value) };
    if (!candidate.name || !candidate.template) { editorError.textContent = 'Enter a name and a valid HTTPS template containing one {query} placeholder.'; editorError.classList.remove('hidden'); return; }
    const duplicateAlias = candidate.alias && providers.some((provider, index) => index !== editingIndex && provider.alias === candidate.alias);
    if (duplicateAlias || UNIVERSAL_SEARCH_RESERVED_ALIASES.has(candidate.alias)) { editorError.textContent = 'Choose a unique alias that is not a reserved command word.'; editorError.classList.remove('hidden'); return; }
    candidate.icon = candidate.icon.slice(0, 8) || '⌕';
    if (editingIndex >= 0) providers[editingIndex] = candidate; else providers.push(candidate);
    closeEditor(); renderRows(); renderDefault();
  });
  container.querySelectorAll('.universal-search-provider-cancel').forEach(button => button.addEventListener('click', closeEditor));
  editor.addEventListener('click', event => { if (event.target === editor) closeEditor(); });
  editor.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeEditor(); } });
  container.querySelector('.universal-search-add').addEventListener('click', () => openEditor());
  container.querySelector('.universal-search-clear-recents').addEventListener('click', () => { WidgetSDK.cache.remove('universalSearch', widget.id, UNIVERSAL_SEARCH_RECENTS_KEY); if (typeof showNotice === 'function') showNotice('Recent searches cleared.'); }); renderPresetOptions(); renderRows(); renderDefault();
}

WIDGET_REGISTRY['universalSearch'] = {
  id: 'universalSearch', name: 'Universal Search Launcher', category: 'Personal & Productivity', description: 'Search Hub content and commands locally, navigate URLs, or launch configurable HTTPS search providers with aliases.',
  allowedIn: ['column', 'navpane'], liveSettingsPreview: false, settingsPanelWidth: 'wide',
  defaultConfig: { providers: [], defaultProviderId: '', rememberSearches: true, openInNewTab: true, localResultCount: 8 }, defaultData: {},
  settingsSchema: { type: 'object', properties: { providers: { type: 'array' }, defaultProviderId: { type: 'string' }, rememberSearches: { type: 'boolean' }, openInNewTab: { type: 'boolean' }, localResultCount: { type: 'number' } }, additionalProperties: false },
  capabilities: { localCache: { quotaBytes: 128 * 1024 } }, responsive: { minWidth: 240, preferredWidth: 600, compactBelow: 340 },
  migrate(widget) { widget.config = { ...this.defaultConfig, ...(widget.config || {}) }; widget.data = {}; _universalSearchProviders(widget); return widget; }, onSettingsCommit(widget) { _universalSearchProviders(widget); _universalSearchRuntime.delete(widget.id); }, cleanup(widget) { _universalSearchRuntime.delete(widget.id); }, render(widget, element, context) { _universalSearchRender(widget, element, context); }, renderSettings(widget, container) { _universalSearchRenderSettings(widget, container); }
};
