// Real-browser production smoke (added Phase A5, 7/20/2026, per Antonio).
// Drives the LIVE widget in headless Chromium exactly like a customer: open
// /embed, wait for session bootstrap, send one product query, wait for the
// AI reply (inline or sweep path), print the reply + rendered links, and
// save a screenshot.
//
// Usage:
//   node scripts/prod-browser-smoke.mjs
//   SMOKE_BASE_URL=https://<preview>.vercel.app node scripts/prod-browser-smoke.mjs
//   SMOKE_QUERY="do you carry michelin road 6" node scripts/prod-browser-smoke.mjs
//
// NOTE: this sends ONE real customer message to the target deployment (one
// Haiku call, one session row — self-closes via the stale sweep). Run it as
// the live-smoke step of a merge gate, not in a loop.
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const BASE = process.env.SMOKE_BASE_URL || "https://performance-chatbot-2.vercel.app";
const QUERY = process.env.SMOKE_QUERY || "looking for a blue street helmet under $300";
const SHOT = process.env.SMOKE_SCREENSHOT || path.join(os.tmpdir(), "prod-smoke-reply.png");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 800 } });

try {
  await page.goto(`${BASE}/embed`, { waitUntil: "domcontentloaded" });

  // Same readiness gate as e2e/helpers.ts waitForEmbedReady
  await page
    .locator('[data-testid="chat-input"][data-session-ready="true"]')
    .waitFor({ state: "visible", timeout: 20_000 });
  console.log(`widget ready on ${BASE}, session established`);

  const aiSelector = '[data-testid="message-ai"]';
  const before = await page.locator(aiSelector).count();

  await page.locator('[data-testid="chat-input"]').fill(QUERY);
  await page.locator('[data-testid="chat-send"]').click();
  console.log(`sent: "${QUERY}" — waiting for AI reply (up to 90s, sweep path possible)`);

  const t0 = Date.now();
  await page.locator(aiSelector).nth(before).waitFor({
    state: "visible",
    timeout: 90_000,
  });
  // let streaming settle
  await page.waitForTimeout(1500);
  const replySeconds = ((Date.now() - t0) / 1000).toFixed(1);

  const replyText = await page.locator(aiSelector).nth(before).innerText();
  const linkHrefs = await page
    .locator(`${aiSelector} a`)
    .evaluateAll((as) => as.map((a) => a.href));

  await page.screenshot({ path: SHOT, fullPage: true });

  console.log(`\n--- AI reply after ${replySeconds}s ---`);
  console.log(replyText);
  console.log(`\n--- links rendered in reply: ${linkHrefs.length} ---`);
  for (const h of linkHrefs) console.log(h);
  console.log(`\nscreenshot: ${SHOT}`);

  if (linkHrefs.length === 0) {
    console.warn(
      "\nWARN: no product link rendered — check ai.reply_link_audit in Vercel logs for this turn"
    );
    process.exitCode = 2;
  }
} finally {
  await browser.close();
}
