const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const center = fs.readFileSync(path.join(root, 'source', 'notification-center.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'source', 'bridge.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'extension', 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'extension', 'content.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension', 'manifest.json'), 'utf8'));

test('Hub exposes a local notification inbox with unread controls', () => {
  assert.match(html, /id="quickNotificationsBtn"/);
  assert.match(html, /id="quickNotificationsBadge"/);
  assert.match(html, /id="notificationCenterPanel"/);
  assert.match(center, /NOTIFICATION_CENTER_MAX_EVENTS = 200/);
  assert.match(center, /notificationCenterPublish/);
  assert.match(center, /markNotificationsRead/);
});

test('notification scheduler is authenticated through the existing Hub relay', () => {
  for (const type of ['MW_NOTIFICATION_SCHEDULE', 'MW_NOTIFICATION_CANCEL', 'MW_NOTIFICATION_LIST', 'MW_NOTIFICATION_MARK_READ', 'MW_NOTIFICATION_CLEAR']) {
    assert.match(background, new RegExp(`'${type}'`));
  }
  assert.match(bridge, /scheduleNotification\(job\)/);
  assert.match(bridge, /listNotifications\(\)/);
  assert.match(content, /MW_NOTIFICATION_EVENT/);
  assert.match(content, /MW_OPEN_NOTIFICATION_TARGET/);
});

test('extension declares alarms and notifications and rehydrates jobs at startup', () => {
  assert.ok(manifest.permissions.includes('alarms'));
  assert.ok(manifest.permissions.includes('notifications'));
  assert.match(background, /rehydrateNotificationAlarms/);
  assert.match(background, /browser\.alarms\.onAlarm/);
  assert.match(background, /browser\.notifications\.onClicked/);
  assert.match(background, /LAST_HUB_URL_KEY/);
});

test('Countdown and Focus route alerts through WidgetSDK notifications', () => {
  const widgets = fs.readFileSync(path.join(root, 'source', 'widgets.js'), 'utf8');
  const focus = fs.readFileSync(path.join(root, 'source', 'focus-session-widget.js'), 'utf8');
  assert.match(widgets, /_countdownSyncNotification/);
  assert.match(widgets, /Notify when complete/);
  assert.match(focus, /_focusSyncNotification/);
  assert.doesNotMatch(focus, /new Notification/);
});
