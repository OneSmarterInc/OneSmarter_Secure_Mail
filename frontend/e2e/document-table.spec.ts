import { test, expect } from "@playwright/test";
test("document table sorts and downloads original files", async ({ page }) => {
  let sort = "";
  let search = "";
  let release = () => {};
  let hold = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/auth/session"))
      return route.fulfill({
        json: {
          user: {
            id: 1,
            name: "Staff",
            role: "staff",
            organization: "Test",
            sender_addresses: [],
          },
          csrf: "test",
        },
      });
    if (url.pathname.endsWith("/evidence")) {
      sort = url.searchParams.get("sort") ?? "";
      search = url.searchParams.get("q") ?? "";
      if (hold) {
        hold = false;
        await gate;
      }
      return route.fulfill({
        json: {
          count: 1,
          page: 1,
          results: [
            {
              id: "doc-1",
              filename: "report.txt",
              conversation_id: "thread-1",
              conversation: "Document request",
              sender: "Sara",
              sender_email: "sara@example.com",
              uploaded_at: "2026-01-01T12:00:00Z",
            },
          ],
        },
      });
    }
    if (url.pathname.endsWith("/attachments/doc-1"))
      return route.fulfill({
        body: "original document",
        contentType: "application/octet-stream",
        headers: { "content-disposition": 'attachment; filename="report.txt"' },
      });
    return route.fulfill({ json: { ready: true } });
  });
  await page.goto("/staff/#/evidence");
  await expect(
    page.getByRole("table", { name: "Conversation documents" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Document request" }),
  ).toBeVisible();
  const inputBox = await page.getByRole("searchbox").boundingBox();
  const iconBox = await page.locator(".document-search > svg").boundingBox();
  expect(iconBox!.x).toBeGreaterThan(inputBox!.x + inputBox!.width / 2);
  expect(iconBox!.x + iconBox!.width).toBeLessThan(
    inputBox!.x + inputBox!.width,
  );
  expect(
    Math.abs(
      iconBox!.y + iconBox!.height / 2 - inputBox!.y - inputBox!.height / 2,
    ),
  ).toBeLessThan(1);
  for (const label of ["Sender", "Date / time"]) {
    await expect(
      page.getByRole("button", { name: new RegExp(`Sort ${label} `) }),
    ).toBeVisible();
  }
  const before = await page.getByRole("table").boundingBox();
  hold = true;
  await page.getByRole("button", { name: "Sort Sender ascending" }).click();
  await expect.poll(() => sort).toBe("sender");
  await expect(
    page.getByRole("cell", { name: "report.txt", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Updating�", { exact: true })).toBeVisible();
  expect(await page.getByRole("table").boundingBox()).toEqual(before);
  release();
  await expect(page.getByRole("table")).toHaveAttribute("aria-busy", "false");
  await page
    .getByRole("searchbox", { name: "Search all documents" })
    .fill("Sara");
  await expect.poll(() => search).toBe("Sara");
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download report.txt", exact: true })
    .click();
  expect((await event).suggestedFilename()).toBe("report.txt");
  await page.setViewportSize({ width: 360, height: 800 });
  await page
    .getByRole("cell", { name: "report.txt", exact: true })
    .evaluate((el) => {
      el.textContent =
        "Very-long-document-filename-without-spaces-".repeat(5) + ".pdf";
    });
  expect(
    await page
      .locator(".table-scroll")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: "test-results/document-table-mobile.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
