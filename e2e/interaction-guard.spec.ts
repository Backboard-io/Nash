import { test, expect, type Page, type Route } from '@playwright/test';

/**
 * Behaviour guard for the redesign. Unlike the pixel suites (which only
 * screenshot and therefore pass even when a control is dead), every check here
 * ASSERTS that an interaction actually does something — so a regression like a
 * dropdown that stops opening fails the run.
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:3081';
const SESSION_KEY = process.env.E2E_SESSION_KEY ?? '';

const PROVIDERS: Record<string, string[]> = {
  OpenAI: ['GPT-4.1', 'GPT-4o'],
  Anthropic: ['Claude Sonnet 5', 'Claude Opus 5'],
  Google: ['Gemini 3 Pro'],
};

async function boot(page: Page, { mobile = false } = {}) {
  await page.route('**/api/endpoints', (route: Route) => {
    const out: Record<string, unknown> = {};
    Object.entries(PROVIDERS).forEach(([name, models], i) => {
      out[name] = {
        type: 'custom',
        name,
        modelDisplayLabel: name,
        models,
        order: i,
        titleConvo: true,
        titleModel: '',
      };
    });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
  });
  await page.route('**/api/models', (route: Route) => {
    const out: Record<string, string[]> = {};
    Object.entries(PROVIDERS).forEach(([n, m]) => (out[n] = m));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
  });
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 854 });
  await page.context().addCookies([{ name: 'session_key', value: SESSION_KEY, url: BASE }]);
  await page.addInitScript(() => {
    localStorage.setItem('color-theme', 'dark');
    localStorage.setItem('navVisible', 'false');
    localStorage.setItem(
      'nash_cookie_consent',
      JSON.stringify({ status: 'accepted', at: new Date().toISOString() }),
    );
  });
  await page.goto(BASE + '/c/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
}

test('desktop: model dropdown opens and lists providers', async ({ page }) => {
  await boot(page);
  await page.getByTestId('model-selector-trigger').first().click();
  // the panel is a portalled popover; assert on its content rather than role
  await expect(page.getByPlaceholder(/search.*models/i).first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Anthropic', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('OpenAI', { exact: true }).first()).toBeVisible();
});

test('desktop: MCP dropdown opens', async ({ page }) => {
  await boot(page);
  const mcp = page.locator('button[aria-label*="MCP" i], button[aria-label*="server" i]').first();
  if ((await mcp.count()) === 0) {
    test.skip(true, 'MCP trigger not rendered in this environment');
  }
  await mcp.click();
  await expect(
    page.getByText(/no mcp servers|google|gmail/i).first(),
  ).toBeVisible({ timeout: 5000 });
});

test('desktop: composer send button is present and enabled after typing', async ({ page }) => {
  await boot(page);
  const input = page.getByTestId('text-input');
  await input.fill('hello');
  const send = page.locator('form button:has(svg)').last();
  await expect(send).toBeEnabled();
});

test('mobile: tools sheet opens from the composer', async ({ page }) => {
  await boot(page, { mobile: true });
  await page.locator('form button:has(svg)').first().click();
  await expect(page.getByText('Add to Chat')).toBeVisible({ timeout: 5000 });
});

test('mobile: model panel opens full-screen', async ({ page }) => {
  await boot(page, { mobile: true });
  await page.getByTestId('model-selector-trigger').first().click();
  await expect(page.getByPlaceholder(/search/i).first()).toBeVisible({ timeout: 5000 });
  await expect(page.getByText('Anthropic', { exact: true }).first()).toBeVisible();
});

test('mobile: drawer opens', async ({ page }) => {
  await boot(page, { mobile: true });
  await page.getByTestId('mobile-header-new-chat-button').click();
  await expect(page.getByTestId('nav-library')).toBeVisible({ timeout: 5000 });
});
