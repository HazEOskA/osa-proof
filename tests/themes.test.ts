import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILTIN_THEMES, MAX_THEME_BYTES, TOKEN_KEYS, contrast, parseTheme, restoreThemes, themeRgb } from '../dashboard-src/src/theme';
const palette = () => JSON.parse(JSON.stringify(BUILTIN_THEMES.find(t => t.id === 'porcelain')!));
test('eleven complete palettes include Vercel black and preserve five light themes', () => {
 assert.equal(BUILTIN_THEMES.length, 11);
 assert.equal(BUILTIN_THEMES.filter(t => t.mode === 'light').length, 5);
 assert.equal(new Set(BUILTIN_THEMES.map(t => t.id)).size, 11);
 assert.equal(new Set(BUILTIN_THEMES.map(t => t.tokens.void)).size, 11);
 for (const theme of BUILTIN_THEMES) {
  assert.deepEqual(Object.keys(theme.tokens).sort(), [...TOKEN_KEYS].sort());
  assert.doesNotThrow(() => parseTheme(JSON.stringify(theme)), theme.name);
  for (const surface of ['void', 'ink', 'panel', 'raise'] as const) {
   assert.ok(contrast(theme.tokens.fg, theme.tokens[surface]) >= 4.5);
   assert.ok(contrast(theme.tokens.dim, theme.tokens[surface]) >= 4.5);
  }
 }
});
test('community import/export round trip preserves colors and cannot replace a built-in ID', () => {
 const source = palette(); source.name = 'Community Sky'; source.author = 'OSA community';
 const imported = parseTheme(JSON.stringify(source));
 assert.equal(imported.id, 'community:porcelain');
 assert.deepEqual(parseTheme(JSON.stringify(imported)), imported);
 const restored = restoreThemes(JSON.stringify({ theme: imported.id, communityThemes: [imported] }));
 assert.equal(restored.theme, imported.id);
 assert.deepEqual(restored.communityThemes, [imported]);
 assert.equal(themeRgb('#1234ab'), '18 52 171');
});
test('untrusted themes reject CSS injection, unexpected tokens and metadata, incomplete or oversized payloads', () => {
 for (const value of ['url(https://example.com)', '#fff;display:none', '#fff', 'rgb(1 2 3)', 42, null]) {
  const source = palette(); source.tokens.void = value;
  assert.throws(() => parseTheme(JSON.stringify(source)));
 }
 const extra = palette(); extra.tokens['__proto__'] = '#ffffff'; extra.tokens['evil'] = '#ffffff';
 assert.throws(() => parseTheme(JSON.stringify(extra)));
 const css = palette(); css.css = '*{display:none}'; assert.throws(() => parseTheme(JSON.stringify(css)));
 const missing = palette(); delete missing.tokens.fg; assert.throws(() => parseTheme(JSON.stringify(missing)));
 const wrong = palette(); wrong.mode = 'auto'; assert.throws(() => parseTheme(JSON.stringify(wrong)));
 assert.throws(() => parseTheme('{'));
 assert.throws(() => parseTheme(' '.repeat(MAX_THEME_BYTES + 1)));
});
test('unreadable palettes are rejected before they reach the UI', () => {
 const text = palette(); text.tokens.fg = text.tokens.panel;
 assert.throws(() => parseTheme(JSON.stringify(text)), /contrast/);
 const accent = palette(); accent.tokens.onbrand = accent.tokens.brand;
 assert.throws(() => parseTheme(JSON.stringify(accent)), /contrast/);
});
test('corrupted, duplicated, excessive or unsupported browser storage safely restores Proof', () => {
 const theme = parseTheme(JSON.stringify(palette()));
 for (const storage of [null, '{', '{}', JSON.stringify({theme: theme.id, communityThemes: [theme, theme]}), JSON.stringify({theme: theme.id, communityThemes: Array(21).fill(theme)})]) {
  assert.deepEqual(restoreThemes(storage), {theme: 'proof', communityThemes: []});
 }
 assert.equal(restoreThemes(JSON.stringify({theme: 'unknown', communityThemes: [theme]})).theme, 'proof');
});
