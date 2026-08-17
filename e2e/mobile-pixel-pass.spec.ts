import { test, expect, type Page, type Route } from '@playwright/test';

const BASE = process.env.E2E_BASE ?? 'http://localhost:3081';
const SHOT_DIR = process.env.SHOT_DIR ?? '/tmp/mobile-shots';
const SESSION_KEY = process.env.E2E_SESSION_KEY ?? '';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const PROVIDERS: Record<string, string[]> = {
  OpenAI: ['GPT-4.1', 'GPT-4o'],
  Anthropic: [
    'Claude Sonnet 5',
    'Claude Sonnet 4.6',
    'Claude Opus 5',
    'Claude Opus 4.8',
    'Claude Haiku 4.5',
  ],
  Google: ['Gemini 3 Pro'],
  xAI: ['Grok 4'],
  Meta: ['Llama 4 Maverick'],
  Cohere: ['Command A'],
  Cerebras: ['Qwen 3 Coder'],
};

function endpointsPayload() {
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
  return out;
}

async function bootChat(page: Page, theme: 'dark' | 'light') {
  await page.route('**/api/endpoints', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(endpointsPayload()) }),
  );
  await page.route('**/api/models', (route: Route) => {
    const out: Record<string, string[]> = {};
    Object.entries(PROVIDERS).forEach(([name, models]) => (out[name] = models));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
  });
  await page.context().addCookies([{ name: 'session_key', value: SESSION_KEY, url: BASE }]);
  await page.addInitScript((t) => {
    localStorage.setItem('color-theme', t);
    localStorage.setItem('navVisible', 'false');
    localStorage.setItem(
      'nash_cookie_consent',
      JSON.stringify({ status: 'accepted', at: new Date().toISOString() }),
    );
  }, theme);
  await page.goto(BASE + '/c/new', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);
}

async function bootAuth(page: Page, path: string, theme: 'dark' | 'light') {
  await page.addInitScript((t) => {
    localStorage.setItem('color-theme', t);
  }, theme);
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
}

for (const theme of ['dark', 'light'] as const) {
  test(`mobile chat empty — ${theme}`, async ({ page }) => {
    await bootChat(page, theme);
    await page.screenshot({ path: `${SHOT_DIR}/chat-empty-${theme}.png` });
    expect(true).toBe(true);
  });

  test(`mobile drawer open — ${theme}`, async ({ page }) => {
    await bootChat(page, theme);
    await page.getByTestId('mobile-header-new-chat-button').click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOT_DIR}/drawer-${theme}.png` });
  });

  test(`mobile tools sheet — ${theme}`, async ({ page }) => {
    await bootChat(page, theme);
    await page.locator('form button:has(svg)').first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${SHOT_DIR}/tools-sheet-${theme}.png` });
  });

  test(`mobile model fullscreen — ${theme}`, async ({ page }) => {
    await bootChat(page, theme);
    await page.getByTestId('model-selector-trigger').first().click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${SHOT_DIR}/model-l1-${theme}.png` });
    const anthropic = page.getByText('Anthropic', { exact: true }).first();
    if (await anthropic.count()) {
      await anthropic.click();
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${SHOT_DIR}/model-l2-${theme}.png` });
    }
  });

  test(`auth login — ${theme}`, async ({ page }) => {
    await bootAuth(page, '/login', theme);
    await page.screenshot({ path: `${SHOT_DIR}/login-${theme}.png` });
  });
}
