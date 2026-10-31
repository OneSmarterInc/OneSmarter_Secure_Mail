import { test, expect } from "@playwright/test";

test("capture catalog distinguishes declared provenance, local storage and pending timestamps", async ({
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
    if (path.endsWith("/export"))
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
              capture_id: "capture-1",
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
    page.getByRole("heading", { name: "Archive" }),
  ).toBeVisible();
  await expect(
    page.getByText("Uploader-declared; not independently verified"),
  ).toBeVisible();
  await expect(
    page.getByText("Pending — no trusted timestamp claimed"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Download verified evidence package" })
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
  await expect(
    page.getByRole("button", { name: "Try again" }),
  ).toBeVisible({ timeout: 12000 });
});
