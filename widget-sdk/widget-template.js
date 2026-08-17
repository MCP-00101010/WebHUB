// Copy this file for a local widget package. It is intentionally not loaded by
// the Hub. Open fixture.html to exercise it behind the local-package opt-in.
(function registerExampleWidget() {
  const descriptor = {
    id: 'local-example',
    name: 'Local Example',
    category: 'Other',
    description: 'Minimal local widget package template',
    allowedIn: ['column'],
    defaultConfig: { greeting: 'Hello from a local widget' },
    defaultData: {},
    settingsSchema: {
      type: 'object',
      properties: { greeting: { type: 'string' } },
      additionalProperties: false
    },
    capabilities: { timers: true, localCache: { quotaBytes: 32768 } },
    responsive: { minWidth: 180, preferredWidth: 320, compactBelow: 220 },

    render(widget, element, context) {
      element.className = 'local-example-widget';
      const message = document.createElement('p');
      message.textContent = widget.config.greeting;
      const status = document.createElement('small');
      status.textContent = `Rendered in ${context}`;
      element.append(message, status);
    },

    renderSettings(widget, container) {
      const row = document.createElement('label');
      row.textContent = 'Greeting';
      const input = document.createElement('input');
      input.type = 'text';
      input.dataset.cfg = 'greeting';
      input.value = widget.config.greeting;
      row.appendChild(input);
      container.appendChild(row);
    },

    reload(widget) {
      WidgetSDK.cache.set('local-example', widget.id, 'lastReload', Date.now(), { ttlMs: 60000 });
    },

    migrate(widget) {
      if (widget.config.message && !widget.config.greeting) widget.config.greeting = widget.config.message;
      delete widget.config.message;
      return widget;
    },

    cleanup() {}
  };

  WidgetSDK.registry.register(descriptor, { source: 'local' });
})();
