#!/usr/bin/env node
/**
 * Recomputes the WCAG 2.1 contrast ratio of every foreground/background pair
 * the app actually renders, in both colour schemes.
 *
 * This exists because the previous version of theme.ts asserted its contrast
 * ratios in a comment. A comment cannot fail. Adding a dark scheme doubled the
 * number of pairs and made hand-checking them a guarantee of error, so the
 * ratios are derived here from the same palettes the app imports.
 *
 * The pair list is maintained by hand and is the weak point: a pair the app
 * renders but that is missing below is simply not checked. Each entry names
 * the component it comes from so the list can be audited against the UI.
 */
const fs = require('fs');
const path = require('path');

const THEME = path.join(__dirname, '..', 'src', 'ui', 'theme.ts');

/** Pulls the two palette literals out of theme.ts without a TS toolchain. */
function readPalette(src, name) {
  const start = src.indexOf(`export const ${name}: Palette = {`);
  if (start < 0) throw new Error(`palette ${name} not found in theme.ts`);
  const open = src.indexOf('{', start);
  const end = src.indexOf('\n};', open);
  const body = src.slice(open + 1, end);
  const out = {};
  for (const m of body.matchAll(/(\w+):\s*'(#[0-9A-Fa-f]{6})'/g)) out[m[1]] = m[2];
  return out;
}

function luminance(hex) {
  const v = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

function ratio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** [foreground, background, where it is rendered] */
const PAIRS = [
  ['text', 'bg', 'Screen body text'],
  ['textMuted', 'bg', 'ghost Button label, caption on Screen'],
  ['textFaint', 'bg', 'caption on Screen'],
  ['text', 'surface', 'Card body, secondary Button label'],
  ['textMuted', 'surface', 'Card label'],
  ['textFaint', 'surface', 'Card caption, inactive tab label, TextInput placeholder'],
  ['text', 'surfaceAlt', 'Card tone=alt, EmptyState title'],
  ['textMuted', 'surfaceAlt', 'neutral Chip label'],
  ['textFaint', 'surfaceAlt', 'EmptyState body'],
  ['text', 'amberSoft', 'Card tone=warn body'],
  ['textMuted', 'amberSoft', 'Card tone=warn label'],
  ['textFaint', 'amberSoft', 'Card tone=warn caption'],
  ['text', 'infoSoft', 'Card tone=info body'],
  ['textFaint', 'infoSoft', 'Card tone=info caption'],
  ['sage', 'bg', 'ActivityIndicator, accent text on Screen'],
  ['sage', 'surface', 'active tab label and icon'],
  ['onAccent', 'sage', 'primary Button label, selected Chip label'],
  ['onAccent', 'terracotta', 'global quick-record + button'],
  ['terracotta', 'bg', 'accent text on Screen'],
  ['terracotta', 'surface', 'accent text in Card'],
  ['amber', 'amberSoft', 'UnknownNotice text, warn Chip label'],
  ['amber', 'surface', 'warn text in Card'],
  ['danger', 'dangerSoft', 'danger Button label, danger Chip label'],
  ['danger', 'surface', 'ErrorState title, Field error text'],
  ['danger', 'bg', 'error text on Screen'],
  ['info', 'infoSoft', 'SyntheticBanner text, info Chip label'],
  ['info', 'surface', 'info text in Card'],
];

const MIN = 4.5;

function check() {
  const src = fs.readFileSync(THEME, 'utf8');
  const schemes = { light: readPalette(src, 'lightColors'), dark: readPalette(src, 'darkColors') };

  const lightKeys = Object.keys(schemes.light).sort().join(',');
  const darkKeys = Object.keys(schemes.dark).sort().join(',');
  const failures = [];
  if (lightKeys !== darkKeys) {
    failures.push(`palettes have different keys:\n  light: ${lightKeys}\n  dark:  ${darkKeys}`);
  }

  const rows = [];
  for (const [scheme, palette] of Object.entries(schemes)) {
    for (const [fg, bg, where] of PAIRS) {
      if (!palette[fg] || !palette[bg]) {
        failures.push(`${scheme}: unknown colour in pair ${fg}/${bg}`);
        continue;
      }
      const r = ratio(palette[fg], palette[bg]);
      rows.push({ scheme, fg, bg, where, r });
      if (r < MIN) failures.push(`${scheme}: ${fg} on ${bg} is ${r.toFixed(2)}:1, below ${MIN}:1 (${where})`);
    }
  }
  return { rows, failures };
}

module.exports = { check, ratio, PAIRS, MIN };

if (require.main === module) {
  const { rows, failures } = check();
  const byScheme = {};
  for (const row of rows) {
    if (!byScheme[row.scheme] || row.r < byScheme[row.scheme].r) byScheme[row.scheme] = row;
  }
  for (const [scheme, worst] of Object.entries(byScheme)) {
    console.log(`${scheme}: ${rows.filter((r) => r.scheme === scheme).length} pairs checked, worst ${worst.r.toFixed(2)}:1 (${worst.fg} on ${worst.bg} — ${worst.where})`);
  }
  if (failures.length) {
    console.error('\nCONTRAST FAILURES:');
    for (const f of failures) console.error('  - ' + f);
    process.exit(1);
  }
  console.log('All pairs meet WCAG AA (>= 4.5:1) in both schemes.');
}
