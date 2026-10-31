import { test, expect } from "@playwright/test";

test("staff idle deadline warns and locks without activity polling", async ({
  page,
}) => {
  let activityCalls = 0;
  const now = Date.now();
  await page.clock.install({ time: now });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/activity")) activityCalls++;
    if (path.endsWith("/auth/session"))
      return route.fulfill({
        json: {
          user: {
            id: 1,
            name: "Staff",
            email: "staff@onesmarter.com",
            role: "staff",
            organization: "Test",
            sender_addresses: ["staff@onesmarter.com"],
            mfa_confirmed: true,
          },
          csrf: "test",
          setup_required: false,
          idle_expires_at: now / 1000 + 65,
          absolute_expires_at: now / 1000 + 3600,
        },
      });
    return route.fulfill({
      json: { results: [], count: 0, page: 1, ready: true },
    });
  });
  await page.goto("/staff/#/compose");
  await expect(
    page.getByRole("heading", { name: "New conversation" }),
  ).toBeVisible();
  await page.clock.fastForward(6000);
  await expect(
    page.getByText("Your session will lock soon", { exact: false }),
  ).toBeVisible();
  await page.clock.fastForward(60000);
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  expect(activityCalls).toBe(0);
});
