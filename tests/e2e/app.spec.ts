import { expect, test } from '@playwright/test';
import { headline, open, setClock, settled, wallboardCell } from './helpers';

test.describe('first load', () => {
  test('sizes the default desk to the contract aim, with no errors', async ({ page }) => {
    const errors = await open(page);
    await settled(page);
    await expect(headline(page)).toHaveText('68');
    await expect(page.locator('#sizing')).toContainText('99.0%');
    await expect(page.locator('#sizing')).toContainText('at most 1 missed month in 84');
    await expect(page.locator('#sizing')).toContainText('Matched to the recommendation');
    expect(errors).toEqual([]);
  });

  test('the welcome splash has two tabs and can be turned off', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#splash')).toBeVisible();
    await page.locator('#spTabs button[data-v="how"]').click();
    await expect(page.locator('#spHow')).toContainText('500 simulated weeks');
    await page.locator('#spHide').check();
    await page.locator('#spGo').click();
    await page.reload();
    await expect(page.locator('#splash')).toBeHidden();
    await page.locator('#openHelp').click();
    await expect(page.locator('#splash')).toBeVisible();
  });
});

test.describe('wallboard', () => {
  test('counts whole contacts, and rates match the counts', async ({ page }) => {
    await open(page);
    await settled(page);
    await setClock(page, 14 * 60);
    const calls = wallboardCell(page, 'Calls today');
    await expect(calls).toContainText('offered');
    const nums = (await calls.locator('.wb-val').allTextContents()).map((t) => Number(t.replace(/,/g, '')));
    const [offered, handled, inSl, abandoned] = nums;
    expect(offered).toBeGreaterThan(100);
    expect(handled + abandoned).toBe(offered);
    const sl = await wallboardCell(page, /^Calls SL today/).locator('.wb-val').textContent();
    expect(Number(sl!.replace('%', ''))).toBeCloseTo((inSl / offered) * 100, 1);
  });

  test('shows month to date, starting on day 1', async ({ page }) => {
    await open(page);
    await expect(wallboardCell(page, 'Calls SL month to date')).toContainText('Day 1 of 30');
  });

  test('major incident: start, wind down, cancel', async ({ page }) => {
    await open(page);
    await settled(page);
    await setClock(page, 11 * 60);
    const btn = page.locator('#incBtn');
    await btn.click();
    await expect(btn).toHaveText('End incident');
    await expect(page.locator('#wb')).toContainText('MAJOR INCIDENT');
    await btn.click();
    await expect(btn).toHaveText('Ends at 11:30');
    await btn.click();
    await expect(btn).toHaveText('End incident');
  });
});

test.describe('demand and targets', () => {
  test('changing call volume resizes the desk', async ({ page }) => {
    await open(page);
    await settled(page);
    await page.locator('#openDemand').click();
    await page.locator('#vVol').fill('16800');
    await page.keyboard.press('Escape');
    await expect.poll(async () => Number(await headline(page).textContent()), { timeout: 30_000 }).toBeGreaterThan(90);
  });

  test('opening hours chosen from the dropdowns keep the volumes (the old NaN bug)', async ({ page }) => {
    await open(page);
    await page.locator('#openDemand').click();
    await page.locator('#h24').uncheck();
    await page.locator('#openFrom').selectOption('9');
    await page.locator('#openTo').selectOption('17');
    await page.keyboard.press('Escape');
    await settled(page);
    await expect(page.locator('#ticker')).toContainText('1,530 CALLS');
    expect(Number(await headline(page).textContent())).toBeGreaterThan(40);
  });

  test('Erlang C needs more agents than Erlang A', async ({ page }) => {
    await open(page);
    await settled(page);
    const a = Number(await headline(page).textContent());
    await page.locator('#openTargets').click();
    await page.locator('#modelSeg button[data-v="C"]').click();
    await page.keyboard.press('Escape');
    await settled(page);
    expect(Number(await headline(page).textContent())).toBeGreaterThan(a);
    await expect(page.locator('.brand')).toContainText('Erlang C');
  });

  test('the contract aim converts to a per-month probability', async ({ page }) => {
    await open(page);
    await page.locator('#openTargets').click();
    await expect(page.locator('#confOut')).toContainText('98.8%');
    await page.locator('input[name="confMode"][value="clean"]').check();
    await page.locator('#cleanChance').fill('50');
    await expect(page.locator('#confOut')).toContainText('99.2%');
  });
});

test.describe('desk set-up', () => {
  test('calling someone in sick shows on the wallboard', async ({ page }) => {
    await open(page);
    await settled(page);
    await setClock(page, 10 * 60);
    const before = Number((await wallboardCell(page, 'Agents').textContent())!.match(/SICK\s*(\d+)/)![1]);
    await page.locator('#sickBtn').click();
    await expect(page.locator('#sickList')).toContainText('off sick');
    await expect(wallboardCell(page, 'Agents')).toContainText(`SICK${before + 1}`);
  });

  test('minimum staffing: a tiny 9-to-5 desk still needs 3 per team', async ({ page }) => {
    await open(page);
    await page.locator('#openDemand').click();
    for (const id of ['#vVol', '#cVol', '#eVol', '#tVol']) await page.locator(id).fill('14');
    await page.locator('#h24').uncheck();
    await page.locator('#openFrom').selectOption('8');
    await page.locator('#openTo').selectOption('17');
    await page.keyboard.press('Escape');
    await settled(page);
    await expect(page.locator('#szTeams')).toContainText('French');
    const frenchRow = page.locator('#szTeams tr').filter({ hasText: 'French' });
    expect(Number((await frenchRow.locator('td').nth(1).textContent())!.trim().split(/\s/)[0])).toBeGreaterThanOrEqual(3);
  });
});

test.describe('flow', () => {
  test('the brief summarises the inputs and opens the matching drawer', async ({ page }) => {
    await open(page);
    await expect(page.locator('#brief')).toContainText('8,400 a week');
    await expect(page.locator('#brief')).toContainText('80% in 30s');
    await page.locator('#openSetup').click();
    await expect(page.locator('#setup')).toHaveClass(/open/);
    await page.locator('#weLong').check();
    await page.keyboard.press('Escape');
    await expect(page.locator('#brief')).toContainText('12-hour weekend shifts');
  });

  test('blocking night starts removes them from the rota', async ({ page }) => {
    await open(page);
    await settled(page);
    await page.locator('#openSetup').click();
    await page.locator('#blockNights').click();
    await expect(page.locator('#noStartSummary')).toContainText('No shift starts 23:00–06:00');
    await page.keyboard.press('Escape');
    await expect(page.locator('#brief')).toContainText('no starts in 7h of the day');
    await settled(page);
    await expect(page.locator('#shFacts .fact').filter({ hasText: 'night starts' }).locator('b')).toHaveText('0');
  });

  test('the step bar shows the headcount and jumps to each step', async ({ page }) => {
    await open(page);
    await settled(page);
    await expect(page.locator('.steps')).toContainText('68 FTE');
    await page.locator('.steps button', { hasText: 'Live floor' }).click();
    await expect(page.locator('#live')).toBeInViewport();
    await expect(page.locator('.steps button[aria-current]')).toContainText('Live floor');
  });
});

test.describe('report and schedule', () => {
  test('the weekly report scores five SLA metrics', async ({ page }) => {
    await open(page);
    await settled(page);
    await page.locator('#repSeg button[data-v="week"]').click();
    await expect(page.locator('#scorecard')).toContainText('SLA metrics', { timeout: 30_000 });
    await expect(page.locator('#cards .mcard')).toHaveCount(5);
  });

  test('long weekend shifts show as 12-hour shifts on Saturday only', async ({ page }) => {
    await open(page);
    await settled(page);
    await page.locator('#openSetup').click();
    await page.locator('#weLong').check();
    await page.keyboard.press('Escape');
    await settled(page);
    await page.locator('#shDay button[data-v="5"]').click();
    await expect(page.locator('#shSub')).toContainText('12-hour (L) shifts');
    await expect(page.locator('#shGantt')).toContainText(' L');
    await page.locator('#shDay button[data-v="0"]').click();
    await expect(page.locator('#shSub')).toContainText('1-hour lunch');
  });

  test('the shift schedule shows the optimised rota', async ({ page }) => {
    await open(page);
    await settled(page);
    await page.locator('.steps button', { hasText: 'Rota' }).click();
    await expect(page.locator('#rota')).toBeInViewport();
    await expect(page.locator('#shFacts')).toContainText('distinct start times');
    await expect(page.locator('#shGantt svg')).toBeVisible();
    await expect(page.locator('#shSub')).toContainText('Night starts (23:00–05:30) are avoided');
    await expect(page.locator('#shFacts')).toContainText('night starts');
  });
});

test.describe('scenarios', () => {
  test('a share link carries the whole scenario', async ({ page, context }) => {
    await open(page);
    await page.locator('#openDemand').click();
    await page.locator('#vVol').fill('12345');
    await page.keyboard.press('Escape');
    await page.locator('#scName').fill('Acme bid');
    await page.locator('#scShare').click();
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/^#cfg-/);
    const hash = await page.evaluate(() => location.hash);
    const p2 = await context.newPage();
    await p2.goto('/' + hash);
    await expect(p2.locator('#splash')).toBeHidden();
    await expect(p2.locator('#live')).toBeInViewport();
    await expect(p2.locator('#scName')).toHaveValue('Acme bid');
    await expect(p2.locator('#vVol')).toHaveValue('12345');
  });

  test('reset asks for a second click, then restores the defaults', async ({ page }) => {
    await open(page);
    await page.locator('#openDemand').click();
    await page.locator('#vVol').fill('9999');
    await page.keyboard.press('Escape');
    await page.locator('#scOpen').click();
    await page.locator('#scReset').click();
    await expect(page.locator('#scReset')).toHaveText('Confirm reset');
    await page.locator('#scReset').click();
    await expect(page.locator('#vVol')).toHaveValue('8400');
    await expect(page.locator('#scName')).toHaveValue('Untitled scenario');
  });

  test('a saved scenario reopens from the list', async ({ page }) => {
    await open(page);
    await page.locator('#scName').fill('Saved one');
    await page.locator('#scSave').click();
    await expect(page.locator('#scSave')).toHaveText('Saved');
    await page.locator('#scOpen').click();
    await expect(page.locator('#scPanel')).toContainText('Saved one');
  });
});

test.describe('floor', () => {
  test('clicking an agent shows their shift', async ({ page }) => {
    await open(page);
    await settled(page);
    await setClock(page, 12 * 60);
    const canvas = page.locator('#cv');
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    // try a grid of points until one lands on an agent
    let shown = false;
    for (let y = 0.35; y < 0.9 && !shown; y += 0.05) for (let x = 0.25; x < 0.85 && !shown; x += 0.04) {
      await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
      shown = await page.locator('#pop').isVisible();
    }
    expect(shown).toBe(true);
    await expect(page.locator('#pop')).toContainText(/team/);
  });

  test('zoom buttons zoom and Fit resets', async ({ page }) => {
    await open(page);
    await page.locator('#zIn').click();
    await expect(page.locator('#zFit')).toBeEnabled();
    await page.locator('#zFit').click();
    await expect(page.locator('#zFit')).toBeDisabled();
  });
});
