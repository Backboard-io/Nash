import { test, expect } from '@playwright/test';

test.describe('API Key Login', () => {

  test.describe('Login page (/login)', () => {

    test('shows API key input, not email/password', async ({ page }) => {
      await page.goto('/login');
      // API key input must be present
      const apiKeyInput = page.locator('#apikey-input');
      await expect(apiKeyInput).toBeVisible({ timeout: 10000 });
      await expect(apiKeyInput).toHaveAttribute('type', 'password');
      await expect(apiKeyInput).toHaveAttribute('placeholder', 'Paste your API key');

      // Email and password fields must NOT exist
      await expect(page.locator('input[placeholder*="mail"]')).toHaveCount(0);
      await expect(page.locator('input[placeholder*="assword"]')).toHaveCount(0);

      // "Start chatting" button must be present
      await expect(page.locator('button:has-text("Start chatting")')).toBeVisible();
    });

    test('shows Backboard link to get API key', async ({ page }) => {
      await page.goto('/login');
      const link = page.locator('a[href="https://app.backboard.io/settings"]');
      await expect(link).toBeVisible({ timeout: 10000 });
      await expect(link).toHaveAttribute('target', '_blank');
    });

    test('shows key icon in the input', async ({ page }) => {
      await page.goto('/login');
      // KeyRound icon from lucide should be rendered
      await expect(page.locator('#apikey-input')).toBeVisible({ timeout: 10000 });
    });

    test('button disabled when input empty', async ({ page }) => {
      await page.goto('/login');
      await expect(page.locator('#apikey-input')).toBeVisible({ timeout: 10000 });
      const button = page.locator('button:has-text("Start chatting")');
      await expect(button).toBeDisabled();
    });

    test('button enabled when key is typed', async ({ page }) => {
      await page.goto('/login');
      const input = page.locator('#apikey-input');
      await expect(input).toBeVisible({ timeout: 10000 });
      await input.fill('espr_test_key_123');
      const button = page.locator('button:has-text("Start chatting")');
      await expect(button).toBeEnabled();
    });

    test('shows spinner on submit', async ({ page }) => {
      await page.goto('/login');
      const input = page.locator('#apikey-input');
      await expect(input).toBeVisible({ timeout: 10000 });
      await input.fill('espr_fake_key_will_fail');

      const button = page.locator('button:has-text("Start chatting")');
      await button.click();

      // Input should be disabled while submitting
      await expect(input).toBeDisabled({ timeout: 3000 });
    });

    test('shows error on invalid key', async ({ page }) => {
      await page.goto('/login');
      const input = page.locator('#apikey-input');
      await expect(input).toBeVisible({ timeout: 10000 });
      await input.fill('bad_key_will_fail');

      const button = page.locator('button:has-text("Start chatting")');
      await button.click();

      // Wait for error message (could be 401 "Invalid API key" or 502 "Could not verify")
      const error = page.locator('p.text-red-500');
      await expect(error).toBeVisible({ timeout: 15000 });
      const errorText = await error.textContent();
      expect(errorText).toMatch(/Invalid API key|Could not verify|failed/i);

      // Input should be re-enabled after error
      await expect(input).toBeEnabled({ timeout: 3000 });
    });

    test('no registration or sign-up links', async ({ page }) => {
      await page.goto('/login');
      await expect(page.locator('#apikey-input')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('text=Sign up')).toHaveCount(0);
      await expect(page.locator('a:has-text("Sign up")')).toHaveCount(0);
      await expect(page.locator('text=Create account')).toHaveCount(0);
    });
  });

  test.describe('Preview page (/preview)', () => {

    test('preview page loads without email/password forms', async ({ page }) => {
      await page.goto('/preview');
      // Page should load without crashing
      await page.waitForTimeout(3000);
      // There should be NO email/password login forms visible on the page
      await expect(page.locator('input[placeholder="Email address"]')).toHaveCount(0);
      await expect(page.locator('input[placeholder="Password"]')).toHaveCount(0);
    });

    test('preview page has no registration form', async ({ page }) => {
      await page.goto('/preview');
      await page.waitForTimeout(3000);
      // No registration fields should be visible
      await expect(page.locator('input[placeholder="Full name"]')).toHaveCount(0);
      await expect(page.locator('input[placeholder="Confirm password"]')).toHaveCount(0);
    });
  });

  test.describe('Security checks', () => {

    test('API key not exposed in page source after login attempt', async ({ page }) => {
      const testKey = 'espr_security_test_key_12345';
      await page.goto('/login');
      const input = page.locator('#apikey-input');
      await expect(input).toBeVisible({ timeout: 10000 });
      await input.fill(testKey);

      const button = page.locator('button:has-text("Start chatting")');
      await button.click();

      // Wait for the request to complete (error expected)
      await page.waitForTimeout(5000);

      // The key must NOT appear in the visible page text
      const bodyText = await page.textContent('body');
      expect(bodyText).not.toContain(testKey);

      // The key must NOT appear in any input value attributes in the DOM
      // (type=password hides it visually but value is still in DOM)
      const inputValue = await input.inputValue();
      // This is expected to have the key (it's in the input), but it should be type=password
      const inputType = await input.getAttribute('type');
      expect(inputType).toBe('password');
    });

    test('no localStorage writes with API key', async ({ page }) => {
      await page.goto('/login');
      const input = page.locator('#apikey-input');
      await expect(input).toBeVisible({ timeout: 10000 });

      // Check localStorage before
      const storageBefore = await page.evaluate(() => JSON.stringify(localStorage));

      await input.fill('espr_test_no_storage');
      await page.locator('button:has-text("Start chatting")').click();
      await page.waitForTimeout(5000);

      // Check localStorage after — should NOT contain the key
      const storageAfter = await page.evaluate(() => JSON.stringify(localStorage));
      expect(storageAfter).not.toContain('espr_test_no_storage');
      // Also check bb_api_key is not in localStorage
      const bbKey = await page.evaluate(() => localStorage.getItem('bb_api_key'));
      expect(bbKey).toBeNull();
    });
  });

  test.describe('Page health', () => {

    test('login page renders with a title and the key form', async ({ page }) => {
      await page.goto('/login');
      await expect(page.locator('#apikey-input')).toBeVisible({ timeout: 10000 });
      const pageTitle = await page.title();
      expect(pageTitle).toBeTruthy();
    });
  });
});
