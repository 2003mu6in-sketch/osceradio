import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// WCAG 2.1 contrast of the theme's text colours against its backgrounds, in both themes.
const css = readFileSync("src/ui/styles.css", "utf8");
const block = (sel: string) => css.slice(css.indexOf(sel), css.indexOf("}", css.indexOf(sel)));
const tok = (b: string, name: string) => (new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i").exec(b) ?? [])[1];
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

for (const [theme, sel] of [["dark", ":root {"], ["light", ':root[data-theme="light"] {']] as const) {
  const b = block(sel);
  test(`${theme} theme: body and muted text meet WCAG AA (4.5:1) on page and panels`, () => {
    for (const bg of ["bg", "surface"]) {
      for (const fg of ["fg", "muted"]) {
        const r = ratio(tok(b, fg), tok(b, bg));
        assert.ok(r >= 4.5, `${fg} on ${bg}: ${r.toFixed(2)}:1`);
      }
    }
  });
  test(`${theme} theme: accent, right and wrong colours meet 3:1 for large text and controls`, () => {
    for (const fg of ["accent", "right", "wrong", "warn"]) {
      const r = ratio(tok(b, fg), tok(b, "surface"));
      assert.ok(r >= 3, `${fg} on surface: ${r.toFixed(2)}:1`);
    }
  });
}

for (const [theme, sel] of [["dark", ":root {"], ["light", ':root[data-theme="light"] {']] as const) {
  test(`${theme} theme: labels on Right / Wrong / Delete buttons meet 4.5:1`, () => {
    const b = block(sel);
    assert.ok(ratio(tok(b, "right-ink"), tok(b, "right")) >= 4.5, `right-ink ${ratio(tok(b, "right-ink"), tok(b, "right")).toFixed(2)}`);
    assert.ok(ratio(tok(b, "wrong-ink"), tok(b, "wrong")) >= 4.5, `wrong-ink ${ratio(tok(b, "wrong-ink"), tok(b, "wrong")).toFixed(2)}`);
  });
}
