import { test, expect } from '@playwright/test';

test('catalog smoke mobile viewport without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.addInitScript(() => { (window as any).Telegram = { WebApp: { ready(){}, expand(){}, initData: '', initDataUnsafe: {}, BackButton: { show(){}, hide(){}, onClick(){}, offClick(){} }, openInvoice(){} } }; });
  await page.goto('/');
  await expect(page.getByText('Запускайте Telegram-автоматизацию')).toBeVisible();
  await expect(page.locator('body')).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  expect(width).toBeTruthy();
  expect(errors).toEqual([]);
});
