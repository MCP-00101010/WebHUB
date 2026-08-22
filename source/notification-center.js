const NOTIFICATION_CENTER_STORAGE_KEY = 'morpheus-notification-center-events:v1';
const NOTIFICATION_CENTER_MAX_EVENTS = 200;
const _notificationCenterFallbackTimers = new Map();
let _notificationCenterEvents = [];
let _notificationCenterPendingAction = null;

function _notificationCenterId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function _notificationCenterSanitize(value) {
  if (!value || typeof value !== 'object') return null;
  const title = String(value.title || 'Morpheus WebHub').trim().slice(0, 100) || 'Morpheus WebHub';
  const message = String(value.message || '').trim().slice(0, 500);
  if (!message) return null;
  const source = value.source && typeof value.source === 'object' ? value.source : {};
  return {
    id: String(value.id || _notificationCenterId()).slice(0, 160),
    jobId: String(value.jobId || '').slice(0, 160),
    title, message,
    createdAt: Number(value.createdAt) || Date.now(),
    read: value.read === true,
    dedupeKey: String(value.dedupeKey || value.jobId || value.id || `${title}:${message}`).slice(0, 180),
    source: { widgetType: String(source.widgetType || '').slice(0, 80), widgetId: String(source.widgetId || '').slice(0, 120), label: String(source.label || '').slice(0, 120) }
  };
}

function _notificationCenterLoadLocal() {
  try {
    const parsed = JSON.parse(localStorage.getItem(NOTIFICATION_CENTER_STORAGE_KEY) || '[]');
    _notificationCenterEvents = (Array.isArray(parsed) ? parsed : []).map(_notificationCenterSanitize).filter(Boolean).slice(0, NOTIFICATION_CENTER_MAX_EVENTS);
  } catch { _notificationCenterEvents = []; }
}

function _notificationCenterSaveLocal() {
  try { localStorage.setItem(NOTIFICATION_CENTER_STORAGE_KEY, JSON.stringify(_notificationCenterEvents.slice(0, NOTIFICATION_CENTER_MAX_EVENTS))); } catch {}
}

function _notificationCenterMerge(events) {
  const merged = [..._notificationCenterEvents];
  for (const value of Array.isArray(events) ? events : [events]) {
    const event = _notificationCenterSanitize(value); if (!event) continue;
    const index = merged.findIndex(item => item.dedupeKey === event.dedupeKey || item.id === event.id);
    if (index >= 0) merged[index] = { ...merged[index], ...event, read: merged[index].read || event.read };
    else merged.push(event);
  }
  _notificationCenterEvents = merged.sort((a, b) => b.createdAt - a.createdAt).slice(0, NOTIFICATION_CENTER_MAX_EVENTS);
  _notificationCenterSaveLocal();
  _notificationCenterRender();
}

function _notificationCenterUnreadCount() { return _notificationCenterEvents.filter(event => !event.read).length; }
function _notificationCenterRelativeTime(timestamp) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return new Date(timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function _notificationCenterRender() {
  const badge = document.getElementById('quickNotificationsBadge');
  const unread = _notificationCenterUnreadCount();
  if (badge) { badge.textContent = String(Math.min(99, unread)); badge.classList.toggle('hidden', unread === 0); }
  const list = document.getElementById('notificationCenterList'); if (!list) return;
  list.innerHTML = '';
  if (!_notificationCenterEvents.length) { const empty = document.createElement('div'); empty.className = 'notification-center-empty'; empty.textContent = 'No notifications yet. Countdown and Focus Session alerts will appear here.'; list.appendChild(empty); return; }
  _notificationCenterEvents.forEach(event => {
    const button = document.createElement('button'); button.type = 'button'; button.className = `notification-center-item${event.read ? '' : ' is-unread'}`;
    const dot = document.createElement('span'); dot.className = 'notification-center-item-dot';
    const copy = document.createElement('span'); copy.className = 'notification-center-item-copy'; const title = document.createElement('strong'); title.textContent = event.title; const message = document.createElement('span'); message.textContent = event.message; copy.append(title, message);
    const time = document.createElement('span'); time.className = 'notification-center-item-time'; time.textContent = _notificationCenterRelativeTime(event.createdAt); time.title = new Date(event.createdAt).toLocaleString();
    button.append(dot, copy, time); button.addEventListener('click', () => { event.read = true; _notificationCenterSaveLocal(); _notificationCenterRender(); void bridge?.markNotificationsRead?.([event.id]); _notificationCenterOpenTarget(event); }); list.appendChild(button);
  });
}

function _notificationCenterOpenTarget(event) {
  const widgetId = event?.source?.widgetId; if (!widgetId) return;
  if (typeof _commandPaletteStoredWidgets !== 'function' || typeof _commandPaletteOpenWidget !== 'function') return;
  const entry = _commandPaletteStoredWidgets().find(candidate => candidate.item?.id === widgetId);
  if (entry) { hideNotificationCenter(); _commandPaletteOpenWidget(entry); }
}

async function _notificationCenterSyncExtension() {
  if (typeof bridge === 'undefined' || typeof bridge.listNotifications !== 'function') return;
  try {
    const result = await bridge.listNotifications();
    if (result?.ok) _notificationCenterMerge(result.events || []);
    const status = document.getElementById('notificationCenterStatus');
    if (status) status.textContent = result?.ok ? 'OS alerts enabled while Firefox is running' : 'Hub alerts only while this page is open';
    if (result?.pendingAction) {
      _notificationCenterPendingAction = result.pendingAction;
      if (document.readyState === 'complete') { _notificationCenterOpenTarget(_notificationCenterPendingAction); _notificationCenterPendingAction = null; }
    }
  } catch {}
}

function showNotificationCenter() {
  const panel = document.getElementById('notificationCenterPanel'); if (!panel) return;
  document.getElementById('modalCard')?.classList.add('hidden');
  document.getElementById('modalOverlay')?.classList.remove('hidden'); panel.classList.remove('hidden');
  if (!panel.dataset.positioned && typeof centerPanel === 'function') { centerPanel(panel); panel.dataset.positioned = 'true'; }
  if (!panel.dataset.draggable && typeof makeDraggable === 'function') { makeDraggable(panel, document.getElementById('notificationCenterHeader')); panel.dataset.draggable = 'true'; }
  _notificationCenterRender(); void _notificationCenterSyncExtension();
}

function hideNotificationCenter() {
  const panel = document.getElementById('notificationCenterPanel'); if (!panel) return;
  panel.classList.add('hidden');
  if (typeof shouldKeepModalOverlayVisible !== 'function' || !shouldKeepModalOverlayVisible()) document.getElementById('modalOverlay')?.classList.add('hidden');
}

async function notificationCenterPublish(value, options = {}) {
  const event = _notificationCenterSanitize(value); if (!event) return null;
  _notificationCenterMerge([event]);
  if (typeof showNotice === 'function' && options.toast !== false) showNotice(`${event.title}: ${event.message}`);
  const extensionScheduled = typeof bridge !== 'undefined' && bridge?.supports?.('notificationScheduler') === true;
  if (options.system !== false && !extensionScheduled && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(event.title, { body: event.message });
  return event;
}

function notificationCenterScheduleFallback(value) {
  let job;
  try { job = { ...value, when: Number(value?.when) }; if (!job.id || !Number.isFinite(job.when)) return false; } catch { return false; }
  notificationCenterCancelFallback(job.id);
  const scheduleChunk = () => {
    const remaining = job.when - Date.now();
    if (remaining <= 0) { _notificationCenterFallbackTimers.delete(job.id); void notificationCenterPublish({ ...job, createdAt: Date.now() }, { system: true }); return; }
    _notificationCenterFallbackTimers.set(job.id, setTimeout(scheduleChunk, Math.min(remaining, 2147483647)));
  };
  scheduleChunk(); return true;
}

function notificationCenterCancelFallback(id) {
  const timer = _notificationCenterFallbackTimers.get(id); if (timer) clearTimeout(timer);
  _notificationCenterFallbackTimers.delete(id); return true;
}

function initializeNotificationCenter() {
  _notificationCenterLoadLocal(); _notificationCenterRender();
  document.getElementById('quickNotificationsBtn')?.addEventListener('click', showNotificationCenter);
  document.getElementById('notificationCenterDoneBtn')?.addEventListener('click', hideNotificationCenter);
  document.getElementById('notificationCenterMarkReadBtn')?.addEventListener('click', () => { _notificationCenterEvents.forEach(event => { event.read = true; }); _notificationCenterSaveLocal(); _notificationCenterRender(); void bridge?.markNotificationsRead?.([]); });
  document.getElementById('notificationCenterClearBtn')?.addEventListener('click', () => { _notificationCenterEvents = []; _notificationCenterSaveLocal(); _notificationCenterRender(); void bridge?.clearNotifications?.(); });
  const panel = document.getElementById('notificationCenterPanel'); if (panel && typeof makeDraggable === 'function') makeDraggable(panel, document.getElementById('notificationCenterHeader'));
  window.addEventListener('morpheus:notification-event', event => { _notificationCenterMerge([event.detail?.event]); bridge?.respondToPush?.(event.detail?.pushRequestId, { ok: true }); });
  window.addEventListener('morpheus:open-notification-target', event => { _notificationCenterMerge([event.detail?.event]); _notificationCenterOpenTarget(event.detail?.event); bridge?.respondToPush?.(event.detail?.pushRequestId, { ok: true }); });
  window.addEventListener('morpheus:bridge-ready', () => { void _notificationCenterSyncExtension(); });
  window.addEventListener('load', () => { if (_notificationCenterPendingAction) { _notificationCenterOpenTarget(_notificationCenterPendingAction); _notificationCenterPendingAction = null; } }, { once: true });
  if (typeof bridge !== 'undefined') void bridge.whenReady.then(_notificationCenterSyncExtension);
}

initializeNotificationCenter();
