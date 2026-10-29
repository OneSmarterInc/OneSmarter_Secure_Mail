// Synthetic browser regression. Credentials arrive through stdin, never argv or logs.
import { chromium } from '../frontend/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const config = JSON.parse(input);
input = '';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true, // Ephemeral synthetic CA only.
    clientCertificates: config.cert ? [{ origin: config.origin, certPath: config.cert, keyPath: config.key }] : [],
  });
  const page = await context.newPage();
  await page.goto(config.origin);
  await page.locator('#username').fill('custodian');
  await page.locator('#password').fill(config.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('#state').filter({ hasText: 'Sealed' }).waitFor();
  await page.locator('#recovery').fill(config.secret);
  await page.getByRole('button', { name: 'Unseal key service', exact: true }).click();
  await page.locator('#state').filter({ hasText: 'Ready' }).waitFor();
  assert.equal(await page.locator('#recovery').inputValue(), '');
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  await page.screenshot({ path: config.screenshot, fullPage: true });
  await page.locator('#seal-confirm').check();
  await page.getByRole('button', { name: 'Seal key service', exact: true }).click();
  await page.locator('#state').filter({ hasText: 'Sealed' }).waitFor();
  await page.locator('#logout').click();
  await page.locator('#signin').waitFor({ state: 'visible' });
  console.log('Custodian browser login, unseal, cleared input, seal, logout passed.');
} finally {
  await browser.close();
}
