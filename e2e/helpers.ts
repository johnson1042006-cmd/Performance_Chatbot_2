import { expect, Page } from "@playwright/test";

/**
 * Wait until the embed widget finished session bootstrap.
 * Do not use `networkidle` here — Pusher keeps a WebSocket open indefinitely.
 */
export async function waitForEmbedReady(
  page: Page,
  timeout = 15_000
): Promise<void> {
  await expect(page.getByTestId("chat-input")).toBeVisible({ timeout });
}
