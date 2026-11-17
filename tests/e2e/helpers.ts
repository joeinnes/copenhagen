import { expect, type Page } from '@playwright/test';

/** Open the page fresh, fail the test on any page error, and dismiss the welcome splash. */
export async function open(page: Page, hash = '') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/' + hash);
  await expect(page.locator('#splash')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#splash')).toBeHidden();
  return errors;
}

/** Wait until the confidence search has finished and the sizing strip shows the result. */
export async function settled(page: Page) {
  await expect(page.locator('#sizing')).toContainText('hit every target (aim', { timeout: 30_000 });
}

export const headline = (page: Page) => page.locator('#sizing .n');
export const wallboardCell = (page: Page, label: string | RegExp) => page.locator('#wb .wb-cell').filter({ hasText: label });

/** Pause the simulation and jump the clock (minutes after midnight) via the time slider. */
export async function setClock(page: Page, minutes: number) {
  if ((await page.locator('#playBtn').textContent())?.trim() === 'Pause') await page.locator('#playBtn').click();
  await page.locator('#scrub').evaluate((el: HTMLInputElement, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, minutes);
}
