// --- NASA Astronomy Picture of the Day widget ------------------------------

const _apodRuntime = new Map();
const APOD_CACHE_KEY = 'daily';
const APOD_VIEW_CACHE_KEY = 'view';

function _getApodView(widgetId) {
  let stored = null;
  try { stored = WidgetSDK.cache.get('nasaApod', widgetId, APOD_VIEW_CACHE_KEY); } catch {}
  return { explanationOpen: stored?.explanationOpen === true };
}

function _setApodView(widgetId, updates = {}) {
  const view = { ..._getApodView(widgetId), ...updates, explanationOpen: updates.explanationOpen === true };
  try { WidgetSDK.cache.set('nasaApod', widgetId, APOD_VIEW_CACHE_KEY, view); } catch {}
  return view;
}

function _todayIsoKey() {
  return new Date().toISOString().slice(0, 10);
}

function _getServiceApiKey(serviceName) {
  if (typeof getServiceSecret === 'function') return getServiceSecret(serviceName);
  return '';
}

function _getApodCache(widget) {
  const runtime = _getApodRuntime(widget);
  return runtime.cache;
}

function _getApodRuntime(widget) {
  let runtime = _apodRuntime.get(widget.id);
  if (runtime) return runtime;
  let cache = WidgetSDK.cache.get('nasaApod', widget.id, APOD_CACHE_KEY);
  if (!cache && widget.data?.apodCache) {
    cache = widget.data.apodCache;
    try { WidgetSDK.cache.set('nasaApod', widget.id, APOD_CACHE_KEY, cache); } catch {}
  }
  runtime = { cache, status: cache ? 'ready' : 'idle', error: '' };
  _apodRuntime.set(widget.id, runtime);
  return runtime;
}

function _isApodCacheFresh(widget) {
  const cache = _getApodCache(widget);
  const apiKey = _getServiceApiKey('nasa');
  return !!(cache && apiKey && cache.fetchedOn === _todayIsoKey());
}

function _normalizeApodPayload(payload) {
  return {
    fetchedOn: _todayIsoKey(),
    date: payload?.date || '',
    title: payload?.title || 'Astronomy Picture of the Day',
    explanation: payload?.explanation || '',
    mediaType: payload?.media_type || 'image',
    url: payload?.url || '',
    hdurl: payload?.hdurl || '',
    thumbnailUrl: payload?.thumbnail_url || '',
    copyright: payload?.copyright || '',
    serviceVersion: payload?.service_version || '',
    pageUrl: payload?.date ? `https://apod.nasa.gov/apod/ap${payload.date.replaceAll('-', '').slice(2)}.html` : 'https://apod.nasa.gov/apod/'
  };
}

function _ensureApodData(widget) {
  const apiKey = _getServiceApiKey('nasa');
  if (!apiKey || _isApodCacheFresh(widget)) return;

  const fetchKey = `apod:${widget.id}`;
  if (_widgetFetches.has(fetchKey)) return;

  const runtime = _getApodRuntime(widget);
  runtime.status = 'loading';
  runtime.error = '';

  const request = _fetchWithTimeout(`https://api.nasa.gov/planetary/apod?api_key=${encodeURIComponent(apiKey)}&thumbs=true`, { widgetFetchKey: fetchKey, widgetType: 'nasaApod' })
    .then(async response => {
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (!response.ok) {
        throw new Error(payload?.msg || `NASA API returned ${response.status}`);
      }
      if (!payload?.url) {
        throw new Error('NASA APOD response did not include media.');
      }
      if (document.hidden) return;
      runtime.cache = _normalizeApodPayload(payload);
      runtime.status = 'ready';
      runtime.error = '';
      try { WidgetSDK.cache.set('nasaApod', widget.id, APOD_CACHE_KEY, runtime.cache); } catch {}
    })
    .catch(error => {
      if (error?.name === 'AbortError') return;
      if (document.hidden) return;
      runtime.status = 'error';
      runtime.error = error?.message || 'Unable to load the NASA APOD feed.';
    })
    .finally(() => {
      _widgetFetches.delete(fetchKey);
      _refreshWidget(widget.id, 'column');
    });

  _widgetFetches.set(fetchKey, request);
}

// ---- NASA APOD widget ----

WIDGET_REGISTRY['nasaApod'] = {
  name: 'NASA APOD',
  category: 'Space & Astronomy',
  description: 'Show NASA Astronomy Picture of the Day',
  allowedIn: ['column'],
  defaultConfig: { preferHd: false, showDate: true, showExplanation: true },
  defaultData: {},

  migrate(widget) {
    if (widget.data?.apodCache) {
      try { WidgetSDK.cache.set('nasaApod', widget.id, APOD_CACHE_KEY, widget.data.apodCache); } catch {}
    }
    widget.data = {};
    return widget;
  },

  dispose(widget) {
    _apodRuntime.delete(widget.id);
    WidgetSDK.cache.remove('nasaApod', widget.id, APOD_CACHE_KEY);
    WidgetSDK.cache.remove('nasaApod', widget.id, APOD_VIEW_CACHE_KEY);
  },

  render(widget, el, context) {
    const c = widget.config;
    const runtime = _getApodRuntime(widget);
    const cache = _getApodCache(widget);
    const hasApiKey = !!_getServiceApiKey('nasa');
    const isFresh = _isApodCacheFresh(widget);

    _setWidgetRefresher(widget.id, context, () => {
      if (!el.isConnected) {
        _widgetRefreshers.delete(`${widget.id}:${context}`);
        return;
      }
      el.innerHTML = '';
      WIDGET_REGISTRY.nasaApod.render(widget, el, context);
    });

    el.className = 'widget-apod';

    if (!hasApiKey) {
      const ph = document.createElement('div');
      ph.className = 'widget-apod-placeholder';
      ph.textContent = 'Add your NASA API key in Settings > API Keys to load Astronomy Picture of the Day.';
      el.appendChild(ph);
      return;
    }

    if (!isFresh) _ensureApodData(widget);
    const status = runtime.status || (isFresh ? 'ready' : 'idle');

    if (!cache) {
      if (status === 'error') {
        _setWidgetStatusText(el, runtime.error || 'Unable to load NASA APOD.', 'is-error');
      } else {
        const ph = document.createElement('div');
        ph.className = 'widget-apod-placeholder';
        ph.textContent = 'Loading today\'s NASA APOD...';
        el.appendChild(ph);
      }
      return;
    }

    const header = document.createElement('div');
    header.className = 'widget-apod-header';

    const title = document.createElement('div');
    title.className = 'widget-apod-title';
    title.textContent = cache.title || 'Astronomy Picture of the Day';
    header.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'widget-apod-meta';
    if (c.showDate && cache.date) {
      const date = document.createElement('span');
      date.textContent = cache.date;
      meta.appendChild(date);
    }
    if (cache.mediaType && cache.mediaType !== 'image') {
      const badge = document.createElement('span');
      badge.className = 'widget-apod-badge';
      badge.textContent = cache.mediaType;
      meta.appendChild(badge);
    }
    if (cache.copyright) {
      const credit = document.createElement('span');
      credit.textContent = `Copyright ${cache.copyright}`;
      meta.appendChild(credit);
    }
    if (meta.childNodes.length) header.appendChild(meta);
    el.appendChild(header);

    const previewUrl = cache.mediaType === 'image'
      ? ((c.preferHd && cache.hdurl) ? cache.hdurl : cache.url)
      : (cache.thumbnailUrl || cache.url);
    const openUrl = cache.mediaType === 'image'
      ? (cache.hdurl || cache.url)
      : (cache.url || cache.pageUrl);

    if (previewUrl) {
      const figure = document.createElement('div');
      figure.className = 'widget-apod-figure';

      const link = document.createElement('a');
      link.className = 'widget-apod-preview-link';
      link.href = openUrl || previewUrl;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      link.title = cache.title || 'Open NASA APOD';
      link.addEventListener('mousedown', event => event.stopPropagation());

      const img = document.createElement('img');
      img.className = 'widget-apod-preview';
      img.src = previewUrl;
      img.alt = cache.title || 'NASA APOD';
      img.loading = 'lazy';
      link.appendChild(img);

      figure.appendChild(link);
      el.appendChild(figure);
    }

    const actions = document.createElement('div');
    actions.className = 'widget-apod-actions';

    const mediaLink = document.createElement('a');
    mediaLink.className = 'widget-apod-action';
    mediaLink.href = openUrl || cache.url || cache.pageUrl;
    mediaLink.target = '_blank';
    mediaLink.rel = 'noreferrer noopener';
    mediaLink.textContent = cache.mediaType === 'image' ? 'Open full media' : 'Open NASA media';
    mediaLink.addEventListener('mousedown', event => event.stopPropagation());
    actions.appendChild(mediaLink);

    if (cache.pageUrl) {
      const pageLink = document.createElement('a');
      pageLink.className = 'widget-apod-action';
      pageLink.href = cache.pageUrl;
      pageLink.target = '_blank';
      pageLink.rel = 'noreferrer noopener';
      pageLink.textContent = 'View APOD page';
      pageLink.addEventListener('mousedown', event => event.stopPropagation());
      actions.appendChild(pageLink);
    }

    el.appendChild(actions);

    if (c.showExplanation && cache.explanation) {
      const details = document.createElement('details');
      details.className = 'widget-apod-details';
      details.open = _getApodView(widget.id).explanationOpen;
      details.addEventListener('toggle', () => _setApodView(widget.id, { explanationOpen: details.open }));
      const summary = document.createElement('summary');
      summary.textContent = 'About this image';
      const text = document.createElement('div');
      text.className = 'widget-apod-summary';
      text.textContent = cache.explanation;
      details.appendChild(summary);
      details.appendChild(text);
      el.appendChild(details);
    }

    if (status === 'loading' && !isFresh) {
      _setWidgetStatusText(el, 'Refreshing from NASA...');
    } else if (status === 'error') {
      _setWidgetStatusText(el, runtime.error || 'Unable to refresh NASA APOD.', 'is-error');
    }
  },

  renderSettings(widget, container) {
    const c = widget.config;
    container.innerHTML = `
      <div class="settings-row settings-row--top">
        <span>NASA API key</span>
        <div class="tz-picker-group">
          <span class="settings-muted">Managed globally in Settings &gt; API Keys.</span>
        </div>
      </div>
      <div class="settings-row">
        <span>Prefer HD image</span>
        <label class="settings-toggle"><input type="checkbox" data-cfg="preferHd" ${c.preferHd ? 'checked' : ''}/><span class="toggle-track"></span></label>
      </div>
      <div class="settings-row">
        <span>Show date</span>
        <label class="settings-toggle"><input type="checkbox" data-cfg="showDate" ${c.showDate !== false ? 'checked' : ''}/><span class="toggle-track"></span></label>
      </div>
      <div class="settings-row">
        <span>Show explanation</span>
        <label class="settings-toggle"><input type="checkbox" data-cfg="showExplanation" ${c.showExplanation !== false ? 'checked' : ''}/><span class="toggle-track"></span></label>
      </div>`;
  }
};
