// Theme presets. Each preset only defines base colours; borders, hover states,
// panels and accent tints are derived from them in style.css with color-mix().

export const LIGHT = {
  paper: { name: 'Paper', bg: '#f7f7f5', surface: '#ffffff', surface2: '#f1f1ee', text: '#1b1c1f', text2: '#3d4047', muted: '#7a7e87', faint: '#a8abb2', code: '#f4f3f0' },
  snow: { name: 'Snow', bg: '#ffffff', surface: '#ffffff', surface2: '#f3f4f6', text: '#15171c', text2: '#383d47', muted: '#737985', faint: '#a5aab4', code: '#f6f7f9' },
  sepia: { name: 'Sepia', bg: '#f5eedf', surface: '#fbf6ea', surface2: '#ede2cd', text: '#2d2418', text2: '#4a3f30', muted: '#877862', faint: '#b3a58d', code: '#eee4d2' },
  mist: { name: 'Mist', bg: '#edf1f6', surface: '#f8fafc', surface2: '#e2e8f0', text: '#162031', text2: '#35425a', muted: '#6a788f', faint: '#9eabbd', code: '#e6ecf3' },
};

export const DARK = {
  graphite: { name: 'Graphite', bg: '#121215', surface: '#1b1b20', surface2: '#232329', text: '#ececef', text2: '#c9cad0', muted: '#8d909a', faint: '#5e616b', code: '#18181d' },
  midnight: { name: 'Midnight', bg: '#0d1117', surface: '#151b24', surface2: '#1c2430', text: '#e6edf3', text2: '#c2cbd6', muted: '#8591a1', faint: '#566173', code: '#111821' },
  nord: { name: 'Nord', bg: '#2b303b', surface: '#323845', surface2: '#3b4252', text: '#eceff4', text2: '#d8dee9', muted: '#9aa5b8', faint: '#6b7588', code: '#2f3541' },
  ember: { name: 'Ember', bg: '#1a1614', surface: '#231e1b', surface2: '#2d2622', text: '#f1e9e1', text2: '#d6cbbf', muted: '#9c8f82', faint: '#665b51', code: '#1f1a17' },
  black: { name: 'Black', bg: '#000000', surface: '#0e0e10', surface2: '#18181b', text: '#f2f2f3', text2: '#cfcfd4', muted: '#8b8b94', faint: '#55555c', code: '#0b0b0d' },
};

// [light-mode shade, dark-mode shade]
export const ACCENTS = {
  violet: ['#6750f2', '#9b85ff'],
  blue: ['#2563eb', '#6ea8ff'],
  teal: ['#0f8f84', '#4fd1c5'],
  green: ['#16a34a', '#5bd68a'],
  amber: ['#c76a00', '#f5b94a'],
  rose: ['#e11d48', '#ff7a9a'],
  slate: ['#4b5568', '#a3b1c6'],
};

// Content width presets in CSS pixels (0 = use all available space).
export const WIDTHS = [
  ['narrow', 'Narrow', 680],
  ['comfort', 'Comfort', 880],
  ['wide', 'Wide', 1120],
  ['full', 'Full', 0],
];
export const WIDTH_MIN = 560;
export const WIDTH_MAX = 1600;

const VARS = { bg: '--bg', surface: '--surface', surface2: '--surface-2', text: '--text', text2: '--text-2', muted: '--muted', faint: '--faint', code: '--code-bg' };

/** Writes a preset and accent onto :root and returns the window background colour. */
export function applyPalette(root, dark, preset, accent) {
  const p = (dark ? DARK : LIGHT)[preset] ?? (dark ? DARK.graphite : LIGHT.paper);
  for (const [k, v] of Object.entries(VARS)) root.style.setProperty(v, p[k]);
  root.style.setProperty('--accent', accent);
  root.dataset.theme = dark ? 'dark' : 'light';
  return p.bg;
}

export function accentColor(name, custom, dark) {
  if (name === 'custom' && /^#[0-9a-f]{6}$/i.test(custom)) return custom;
  return (ACCENTS[name] ?? ACCENTS.violet)[dark ? 1 : 0];
}
