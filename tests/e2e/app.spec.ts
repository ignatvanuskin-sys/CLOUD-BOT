import { test, expect } from '@playwright/test';

test('catalog smoke mobile viewport without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.route('https://telegram.org/js/telegram-web-app.js', (route) => route.fulfill({ contentType: 'application/javascript', body: '' }));
  await page.addInitScript(() => { (window as any).Telegram = { WebApp: { ready(){}, expand(){}, initData: 'development-test-init-data', initDataUnsafe: {}, BackButton: { show(){}, hide(){}, onClick(){}, offClick(){} }, openInvoice(){} } }; });
  await page.goto('/');
  await expect(page.getByText('Запускайте Telegram-автоматизацию')).toBeVisible();
  await expect(page.locator('body')).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(width).toBeTruthy();
  expect(errors).toEqual([]);
});
