import { test, expect, type Page } from '@playwright/test';

const BASE = process.env.E2E_BASE ?? 'http://localhost:3081';
const SESSION_KEY = process.env.E2E_SESSION_KEY ?? '';

type Probe = { label: string; sel: string; want: Record<string, string | number> };

async function boot(page: Page, path: string, mobile = false) {
  await page.context().addCookies([{ name: 'session_key', value: SESSION_KEY, url: BASE }]);
  await page.addInitScript(() => {
    localStorage.setItem('color-theme', 'dark');
    localStorage.setItem('navVisible', 'true');
    localStorage.setItem(
      'nash_cookie_consent',
      JSON.stringify({ status: 'accepted', at: new Date().toISOString() }),
    );
  });
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
}

async function measure(page: Page, probes: Probe[]) {
  return page.evaluate((ps) => {
    const rgb = (v: string) => {
      const m = v.match(/\d+/g);
      if (!m) return v;
      const [r, g, b] = m.map(Number);
      return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    };
    return ps.map((p) => {
      let el: HTMLElement | null = null;
      if (p.sel.startsWith('class:')) {
        const needle = p.sel.slice(6);
        el = ([...document.querySelectorAll<HTMLElement>('*')].find(
          (n) => typeof n.className === 'string' && n.className.includes(needle),
        ) ?? null) as HTMLElement | null;
      } else if (p.sel.startsWith('text:')) {
        const needle = p.sel.slice(5);
        el = ([...document.querySelectorAll<HTMLElement>('*')].find(
          (n) => n.children.length === 0 && (n.textContent ?? '').trim().startsWith(needle),
        ) ?? null) as HTMLElement | null;
      } else {
        el = document.querySelector(p.sel) as HTMLElement | null;
      }
      if (!el) return { label: p.label, missing: true, deltas: [] as string[] };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const got: Record<string, string> = {
        h: String(Math.round(r.height)),
        w: String(Math.round(r.width)),
        radius: cs.borderTopLeftRadius,
        bg: rgb(cs.backgroundColor),
        color: rgb(cs.color),
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
        borderColor: rgb(cs.borderTopColor),
        padTop: cs.paddingTop,
        padLeft: cs.paddingLeft,
        gap: cs.gap,
      };
      const deltas: string[] = [];
      for (const [k, want] of Object.entries(p.want)) {
        const g = got[k];
        if (g == null) continue;
        const norm = (x: string) => String(x).replace(/px$/, '');
        if (norm(g) !== norm(String(want))) deltas.push(`${k}: want ${want}, got ${g}`);
      }
      return { label: p.label, missing: false, deltas };
    });
  }, probes as any);
}

function report(name: string, rows: any[]) {
  const bad = rows.filter((r) => r.missing || r.deltas.length);
  console.log(`\n===== ${name} =====`);
  if (!bad.length) console.log('  ALL MATCH');
  for (const r of bad) {
    if (r.missing) console.log(`  [MISSING] ${r.label}`);
    else console.log(`  [${r.label}] ${r.deltas.join(' | ')}`);
  }
}

test('desktop chat spec', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 854 });
  await boot(page, '/c/new');
  const rows = await measure(page, [
    { label: 'sidebar bg', sel: 'class:bg-surface-primary-alt', want: { bg: '#0D0F12' } },
    { label: 'nav row Bookmarks', sel: '[data-testid="nav-library"]', want: { h: 34, radius: '8px', fontSize: '13.5px' } },
    { label: 'greeting', sel: 'text:Good', want: { fontSize: '32px', fontWeight: '600', lineHeight: '48px' } },
    { label: 'composer card', sel: 'class:rounded-[22px]', want: { radius: '22px', bg: '#131517', h: 152 } },
    { label: 'search field', sel: 'class:rounded-[9px]', want: { h: 36, radius: '9px' } },
  ]);
  report('DESKTOP CHAT', rows);
  expect(true).toBe(true);
});

test('memories spec', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 854 });
  await page.route('**/api/memories**', (r) =>
    r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        memories: [
          { key: 'a', value: 'Sample memory value for spec audit.', tokenCount: 20, updated_at: '2026-04-07T12:00:00Z' },
        ],
      }),
    }),
  );
  await boot(page, '/memories');
  const rows = await measure(page, [
    { label: 'title', sel: 'h2', want: { fontSize: '28px', fontWeight: '600', lineHeight: '42px' } },
    { label: 'add memory btn', sel: 'button[aria-label*="memory" i]', want: { h: 41, radius: '10px', bg: '#635BFF' } },
    { label: 'search input', sel: 'input[type="text"]', want: { h: 42, radius: '10px' } },
    { label: 'tab All', sel: '[role="tab"]', want: { h: 33, radius: '8px' } },
    { label: 'memory card', sel: '[role="listitem"] > div', want: { radius: '12px', bg: '#131517' } },
  ]);
  report('MEMORIES', rows);
});

test('mobile chat spec', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page, '/c/new', true);
  const rows = await measure(page, [
    { label: 'top bar', sel: '.sticky.top-0', want: { h: 48 } },
    { label: 'composer card', sel: 'class:rounded-[18px]', want: { radius: '18px', bg: '#131517' } },
    { label: 'greeting', sel: 'text:Good', want: { fontSize: '24px', lineHeight: '36px' } },
  ]);
  report('MOBILE CHAT', rows);
});
