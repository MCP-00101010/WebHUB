// Shared network and location-search helpers used by data-backed widgets.

async function _fetchWithTimeout(input, options = {}, timeoutMs = 15000) {
  const { widgetFetchKey = '', ...fetchOptions } = options;
  const controller = new AbortController();
  const parentSignal = fetchOptions.signal;
  const abortFromParent = () => controller.abort(parentSignal?.reason);
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);
  if (widgetFetchKey && typeof _widgetFetchControllers !== 'undefined') {
    _widgetFetchControllers.set(widgetFetchKey, controller);
  }
  try {
    return await fetch(input, { ...fetchOptions, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (
      widgetFetchKey && typeof _widgetFetchControllers !== 'undefined'
      && _widgetFetchControllers.get(widgetFetchKey) === controller
    ) _widgetFetchControllers.delete(widgetFetchKey);
    parentSignal?.removeEventListener?.('abort', abortFromParent);
  }
}

async function _searchOpenMeteoLocations(query, signal) {
  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', query);
  url.searchParams.set('count', '6');
  url.searchParams.set('language', (navigator.language || 'en').split('-')[0]);
  url.searchParams.set('format', 'json');
  const response = await _fetchWithTimeout(url, { signal });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.reason || `Location search returned ${response.status}`);
  return Array.isArray(payload?.results) ? payload.results : [];
}

function _openMeteoLocationLabel(location) {
  return [...new Set([location?.name, location?.admin1, location?.country].filter(Boolean))].join(', ');
}

function _bindOpenMeteoLocationSearch(options = {}) {
  const { input, button, results, signal, onSelect, disabledAfter } = options;
  let generation = 0;
  const showMessage = (message, isError = false) => {
    results.innerHTML = '';
    const row = document.createElement('div');
    row.className = `weather-location-message${isError ? ' is-error' : ''}`;
    row.textContent = message;
    results.appendChild(row);
  };
  const run = async () => {
    const query = input.value.trim();
    if (query.length < 2) return showMessage('Enter at least two characters.', true);
    const requestGeneration = ++generation;
    button.disabled = true;
    showMessage('Searching...');
    try {
      const locations = await _searchOpenMeteoLocations(query, signal);
      if (requestGeneration !== generation) return;
      results.innerHTML = '';
      if (!locations.length) return showMessage('No matching locations found.');
      locations.forEach(location => {
        const resultButton = document.createElement('button');
        resultButton.type = 'button';
        resultButton.className = 'weather-location-result';
        resultButton.textContent = _openMeteoLocationLabel(location);
        resultButton.addEventListener('click', () => {
          onSelect?.(location, resultButton.textContent);
          results.innerHTML = '';
        });
        results.appendChild(resultButton);
      });
    } catch (error) {
      if (requestGeneration === generation && error?.name !== 'AbortError') {
        showMessage(error?.message || 'Location search failed.', true);
      }
    } finally {
      if (requestGeneration === generation) button.disabled = disabledAfter?.() === true;
    }
  };
  button.addEventListener('click', run);
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void run();
  });
  signal?.addEventListener('abort', () => { generation += 1; }, { once: true });
  return run;
}
