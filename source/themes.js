const BUILTIN_THEMES = [
  {
    id: 'default-dark',
    name: 'Default Dark',
    builtin: true,
    colorScheme: 'dark',
    colors: {
      bg: '#111213', panel: '#18191c', panelStrong: '#212226', panelMuted: '#1a1c20',
      border: '#2a2c31', text: '#e5e7eb', textMuted: '#9ca3af',
      accent: '#6d7cff', accentStrong: '#4f5bff', danger: '#ef4444',
      radius: '18px', shadow: '0 20px 40px rgba(0,0,0,0.35)'
    }
  },
  {
    id: 'light',
    name: 'Light',
    builtin: true,
    colorScheme: 'light',
    colors: {
      bg: '#f5f6fa', panel: '#ffffff', panelStrong: '#eef0f5', panelMuted: '#f0f1f7',
      border: '#d1d5db', text: '#111213', textMuted: '#6b7280',
      accent: '#4f5bff', accentStrong: '#3748ff', danger: '#ef4444',
      radius: '18px', shadow: '0 10px 30px rgba(0,0,0,0.12)'
    }
  },
  {
    id: 'dracula',
    name: 'Dracula',
    builtin: true,
    colorScheme: 'dark',
    colors: {
      bg: '#282a36', panel: '#21222c', panelStrong: '#343746', panelMuted: '#2a2c3a',
      border: '#44475a', text: '#f8f8f2', textMuted: '#6272a4',
      accent: '#bd93f9', accentStrong: '#9d79d9', danger: '#ff5555',
      radius: '18px', shadow: '0 20px 40px rgba(0,0,0,0.5)'
    }
  },
  {
    id: 'midnight',
    name: 'Midnight',
    builtin: true,
    colorScheme: 'dark',
    colors: {
      bg: '#0d1117', panel: '#161b22', panelStrong: '#21262d', panelMuted: '#1a2030',
      border: '#30363d', text: '#e6edf3', textMuted: '#8b949e',
      accent: '#58a6ff', accentStrong: '#1f6feb', danger: '#f85149',
      radius: '18px', shadow: '0 20px 40px rgba(0,0,0,0.5)'
    }
  },
  {
    id: 'crimson',
    name: 'Crimson',
    builtin: true,
    colorScheme: 'dark',
    colors: {
      bg: '#120a0a', panel: '#1c1010', panelStrong: '#261414', panelMuted: '#1e1212',
      border: '#3a1f1f', text: '#f0e0e0', textMuted: '#9e7070',
      accent: '#e05454', accentStrong: '#c43a3a', danger: '#ff4444',
      radius: '18px', shadow: '0 20px 40px rgba(0,0,0,0.5)'
    }
  },
  {
    id: 'nebula',
    name: 'Nebula',
    builtin: true,
    colorScheme: 'dark',
    colors: {
      bg: '#0f0e1a', panel: '#17162a', panelStrong: '#211f36', panelMuted: '#1a1930',
      border: '#2e2b4a', text: '#e8e6f5', textMuted: '#7c78a8',
      accent: '#9d75f5', accentStrong: '#7c55d5', danger: '#f06060',
      radius: '18px', shadow: '0 20px 40px rgba(0,0,0,0.5)'
    }
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    builtin: true,
    colorScheme: 'dark',
    colors: {
      bg: '#1e1e2e', panel: '#181825', panelStrong: '#313244', panelMuted: '#1e1e2e',
      border: '#45475a', text: '#cdd6f4', textMuted: '#6c7086',
      accent: '#cba6f7', accentStrong: '#b4a0f5', danger: '#f38ba8',
      radius: '18px', shadow: '0 20px 40px rgba(0,0,0,0.5)'
    }
  }
];

function _hexComponents(hex) {
  try {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  } catch { return [109, 124, 255]; }
}

function _themeHexToRgba(hex, alpha) {
  const [r, g, b] = _hexComponents(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function applyTheme(theme) {
  if (!theme?.colors) return;
  const r = document.documentElement.style;
  const c = theme.colors;
  const [pr, pg, pb] = _hexComponents(c.panel);
  r.setProperty('--panel-r', pr);
  r.setProperty('--panel-g', pg);
  r.setProperty('--panel-b', pb);
  r.setProperty('--bg',            c.bg);
  r.setProperty('--panel',         c.panel);
  r.setProperty('--panel-strong',  c.panelStrong);
  r.setProperty('--panel-muted',   c.panelMuted);
  r.setProperty('--border',        c.border);
  r.setProperty('--text',          c.text);
  r.setProperty('--text-muted',    c.textMuted);
  r.setProperty('--accent',        c.accent);
  r.setProperty('--accent-strong', c.accentStrong);
  r.setProperty('--danger',        c.danger);
  r.setProperty('--radius',        c.radius  || '18px');
  r.setProperty('--shadow',        c.shadow  || '0 20px 40px rgba(0,0,0,0.35)');
  const dark = (theme.colorScheme || 'dark') === 'dark';
  r.setProperty('--surface-1', dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)');
  r.setProperty('--surface-2', dark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)');
  r.setProperty('--accent-glow',           _themeHexToRgba(c.accent, 0.2));
  r.setProperty('--accent-chip',           _themeHexToRgba(c.accent, 0.15));
  r.setProperty('--accent-hover',          _themeHexToRgba(c.accent, 0.08));
  r.setProperty('--accent-selected',       _themeHexToRgba(c.accent, 0.1));
  r.setProperty('--accent-selected-border',_themeHexToRgba(c.accent, 0.35));
  document.documentElement.style.colorScheme = theme.colorScheme || 'dark';
}

function getThemeById(id) {
  const custom = (typeof state !== 'undefined' && state?.settings?.customThemes) || [];
  return BUILTIN_THEMES.find(t => t.id === id)
    || custom.find(t => t.id === id)
    || BUILTIN_THEMES[0];
}

function getAllThemes() {
  const custom = (typeof state !== 'undefined' && state?.settings?.customThemes) || [];
  return [...BUILTIN_THEMES, ...custom];
}
