import { test, expect } from "@playwright/test";

test("archive lists scoped documents and keeps failed downloads inside the portal", async ({
  page,
}) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/session"))
      return route.fulfill({
        json: {
          user: {
            id: 1,
            name: "Test staff",
            role: "staff",
            organization: "OneSmarter",
            sender_addresses: [],
          },
          csrf: "test",
        },
      });
    if (path.endsWith("/attachments/file-1"))
      return route.fulfill({
        status: 503,
        json: {
          error: {
            code: "evidence_integrity_failed",
            message: "Evidence verification failed.",
          },
        },
      });
    if (path.endsWith("/evidence"))
      return route.fulfill({
        json: {
          count: 1,
          page: 1,
          tsa_configured: false,
          results: [
            {
              id: "file-1",
              conversation_id: "thread-1",
              conversation: "Test conversation",
              sender: "Test staff",
              sender_email: "staff@example.com",
              uploaded_at: "2026-01-01T10:00:00Z",
              filename: "example.txt",
              sha256: "a".repeat(64),
              source_url: "https://example.com/example.txt",
              downloaded_at: null,
              portal_uploaded_at: "2026-01-01T10:00:00Z",
              catalogued_at: "2026-01-02T10:00:00Z",
              provenance: "uploader_declared",
              timestamp_state: "pending",
            },
          ],
        },
      });
    return route.fulfill({ json: { ready: true } });
  });
  await page.goto("/staff/#/evidence");

  await expect(
    page.getByRole("table", { name: "Conversation documents" }),
  ).toContainText("example.txt");
  await page
    .getByRole("button", { name: "Download example.txt", exact: true })
    .click();
  await expect(page.getByText("Evidence verification failed.")).toBeVisible();
  await expect(page).toHaveURL(/#\/evidence$/);
  await page.screenshot({
    path: "test-results/evidence-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 360, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("initial session timeout offers retry instead of an endless workspace spinner", async ({
  page,
}) => {
  await page.route("**/api/auth/session", () => new Promise<void>(() => {}));
  await page.goto("/staff/");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible({
    timeout: 12000,
  });
});
