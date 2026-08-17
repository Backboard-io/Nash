import { test, expect, type Page, type Route } from '@playwright/test';

const BASE = process.env.E2E_BASE ?? 'http://localhost:3080';
const SHOT_DIR = process.env.SHOT_DIR ?? '/tmp/memories-shots';
const SESSION_KEY = process.env.E2E_SESSION_KEY ?? '';

test.use({ viewport: { width: 1440, height: 854 } });

const MEMORY = {
  value:
    'The user prefers Prometheus + Grafana for monitoring. They use alertmanager for routing and have a custom dashboard for SLO tracking.',
  tokenCount: 20,
  updated_at: '2026-04-07T12:00:00.000Z',
};

function memoriesPayload(count: number) {
  return {
    memories: Array.from({ length: count }, (_, i) => ({
      key: `mem-${i}`,
      ...MEMORY,
    })),
  };
}

type MemoriesMode = 'default' | 'empty' | 'loading' | 'fail' | 'stale' | 'pagination';

async function boot(page: Page, theme: 'dark' | 'light', mode: MemoriesMode) {
  let calls = 0;
  await page.route('**/api/memories**', (route: Route) => {
    const method = route.request().method();
    if (method === 'DELETE') {
      // stale flow needs a successful delete (invalidation -> failing refetch);
      // rowerror needs the delete itself to fail
      const status = mode === 'stale' ? 200 : 500;
      return route.fulfill({ status, contentType: 'application/json', body: '{}' });
    }
    if (method !== 'GET') {
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    }
    calls += 1;
    if (mode === 'fail') {
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    }
    if (mode === 'loading') {
      return new Promise(() => {}); // never resolve — page stays in loading state
    }
    if (mode === 'stale' && calls > 1) {
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    }
    const count = mode === 'empty' ? 0 : mode === 'pagination' ? 13 : 3;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(memoriesPayload(count)),
    });
  });
  await page.context().addCookies([{ name: 'session_key', value: SESSION_KEY, url: BASE }]);
  await page.addInitScript((t) => {
    localStorage.setItem('color-theme', t);
    localStorage.setItem(
      'nash_cookie_consent',
      JSON.stringify({ status: 'accepted', at: new Date().toISOString() }),
    );
  }, theme);
  await page.goto(BASE + '/memories', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(mode === 'loading' ? 1200 : 1800);
}

for (const theme of ['dark', 'light'] as const) {
  test(`memories default — ${theme}`, async ({ page }) => {
    await boot(page, theme, 'default');
    await page.screenshot({ path: `${SHOT_DIR}/default-${theme}.png` });
    expect(true).toBe(true);
  });

  test(`memories empty — ${theme}`, async ({ page }) => {
    await boot(page, theme, 'empty');
    await page.screenshot({ path: `${SHOT_DIR}/empty-${theme}.png` });
  });

  test(`memories loading — ${theme}`, async ({ page }) => {
    await boot(page, theme, 'loading');
    await page.screenshot({ path: `${SHOT_DIR}/loading-${theme}.png` });
  });

  test(`memories load failed — ${theme}`, async ({ page }) => {
    await boot(page, theme, 'fail');
    await page.screenshot({ path: `${SHOT_DIR}/loadfailed-${theme}.png` });
  });

  test(`memories stale — ${theme}`, async ({ page }) => {
    await boot(page, theme, 'stale');
    // successful delete invalidates the query; the refetch 500s -> stale banner
    await page
      .locator('[role="listitem"]')
      .first()
      .locator('button[aria-label*="elete" i]')
      .first()
      .click();
    await page.getByRole('button', { name: /^delete$/i }).last().click();
    await page.getByText(/cached memories/i).waitFor({ timeout: 20000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOT_DIR}/stale-${theme}.png` });
  });

  test(`memories row error — ${theme}`, async ({ page }) => {
    await boot(page, theme, 'default');
    const trash = page
      .locator('[role="listitem"]')
      .first()
      .locator('button[aria-label*="elete" i]')
      .first();
    await trash.click();
    const confirm = page.getByRole('button', { name: /^delete$/i }).last();
    await confirm.click();
    await page.getByText(/delete this memory/i).waitFor({ timeout: 20000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOT_DIR}/rowerror-${theme}.png` });
  });
}

test('memories pagination — dark', async ({ page }) => {
  await boot(page, 'dark', 'pagination');
  await page.screenshot({ path: `${SHOT_DIR}/pagination-dark.png` });
});
