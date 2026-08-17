import { test, expect } from '@playwright/test';

const BASE = process.env.E2E_BASE ?? 'http://localhost:3080';
const SHOT_DIR = process.env.SHOT_DIR ?? '/tmp/auth-desktop-shots';

test.use({ viewport: { width: 1160, height: 674 } });

for (const theme of ['dark', 'light'] as const) {
  for (const [name, path] of [
    ['login', '/login'],
  ] as const) {
    test(`${name} desktop — ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('color-theme', t), theme);
      await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${SHOT_DIR}/${name}-${theme}.png` });
      expect(true).toBe(true);
    });
  }
}
