import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3080';
const SHOT_DIR = process.env.SHOT_DIR ?? '/tmp/redesign-shots';
const SESSION_KEY = process.env.E2E_SESSION_KEY ?? '';

test.use({ viewport: { width: 1440, height: 854 } });

const PROVIDERS: Record<string, string[]> = {
  OpenAI: ['GPT-4.1', 'GPT-4o', 'o3'],
  Anthropic: [
    'Claude Sonnet 5',
    'Claude Sonnet 4.6',
    'Claude Opus 5',
    'Claude Opus 4.8',
    'Claude Opus 4.7',
    'Claude Haiku 4.5',
  ],
  Google: ['Gemini 3 Pro', 'Gemini 3 Flash'],
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

function modelsPayload() {
  const out: Record<string, string[]> = {};
  Object.entries(PROVIDERS).forEach(([name, models]) => (out[name] = models));
  return out;
}

async function boot(page, theme: 'dark' | 'light') {
  await page.route('**/api/endpoints', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(endpointsPayload()) }),
  );
  await page.route('**/api/models', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(modelsPayload()) }),
  );
  await page.context().addCookies([{ name: 'session_key', value: SESSION_KEY, url: BASE }]);
  await page.addInitScript((t) => {
    localStorage.setItem('color-theme', t);
    localStorage.setItem(
      'nash_cookie_consent',
      JSON.stringify({ status: 'accepted', at: new Date().toISOString() }),
    );
  }, theme);
  await page.goto(BASE + '/c/new', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
}

for (const theme of ['dark', 'light'] as const) {
  test(`empty state — ${theme}`, async ({ page }) => {
    await boot(page, theme);
    await page.screenshot({ path: `${SHOT_DIR}/empty-${theme}.png` });
    expect(true).toBe(true);
  });

  test(`model panel — ${theme}`, async ({ page }) => {
    await boot(page, theme);
    await page.getByTestId('model-selector-trigger').first().click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOT_DIR}/model-panel-${theme}.png` });
  });

  test(`model sub panel — ${theme}`, async ({ page }) => {
    await boot(page, theme);
    await page.getByTestId('model-selector-trigger').first().click();
    await page.waitForTimeout(500);
    const anthropic = page.getByText('Anthropic', { exact: true }).first();
    if (await anthropic.count()) {
      await anthropic.hover();
      await page.waitForTimeout(700);
    }
    await page.screenshot({ path: `${SHOT_DIR}/model-subpanel-${theme}.png` });
  });
}
