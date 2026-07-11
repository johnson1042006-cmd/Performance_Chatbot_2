import { expect, Page } from "@playwright/test";

/**
 * Wait until the embed widget finished session bootstrap — input rendered AND
 * the widget's DB session established (data-session-ready flips to "true"
 * once POST /api/sessions resolves). Typing before that point used to race
 * the mount-time session create and split the conversation across two
 * sessions. Do not use `networkidle` here — Pusher keeps a WebSocket open
 * indefinitely.
 */
export async function waitForEmbedReady(
  page: Page,
  timeout = 15_000
): Promise<void> {
  await expect(page.getByTestId("chat-input")).toBeVisible({ timeout });
  await expect(
    page.locator('[data-testid="chat-input"][data-session-ready="true"]')
  ).toBeVisible({ timeout });
}
