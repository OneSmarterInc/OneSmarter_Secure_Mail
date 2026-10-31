import { test, expect } from "@playwright/test";

for (const status of [401, 404, 503]) {
  test(`recipient reload with ${status} never sends an OTP`, async ({
    page,
  }) => {
    let codes = 0;
    await page.route("**/recipient-api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/code")) codes++;
      if (path.endsWith("/auth/session"))
        return route.fulfill({ json: { user: null, csrf: "test" } });
      return route.fulfill({
        status,
        json: { error: { message: "Request failed" } },
      });
    });
    await page.goto("/recipient/#/conversation");
    const title =
      status === 401
        ? "Open your invitation email"
        : status === 404
          ? "This message is unavailable"
          : "Unable to load your conversation";
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    if (status === 503) {
      await page.getByRole("button", { name: "Try again" }).click();
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
    }
    await expect(
      page.getByRole("button", { name: "Email me a code" }),
    ).toHaveCount(0);
    expect(codes).toBe(0);
  });
}

test("expiry with a retained invitation waits for an explicit code request", async ({
  page,
}) => {
  await page.clock.install();
  let codes = 0;
  await page.route("**/recipient-api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/code")) {
      expect(route.request().postDataJSON().token).toBe("synthetic-invitation");
      codes++;
    }
    const body = path.endsWith("/auth/session")
      ? { user: null, csrf: "test" }
      : path.endsWith("/landing")
        ? { organization: "Example", recipient: "s***@example.test" }
        : path.endsWith("/conversation")
          ? {
              id: "test",
              subject: "Test conversation",
              messages: [],
              recipients: [],
            }
          : { ready: true };
    await route.fulfill({ json: body });
  });
  await page.goto("/recipient/#/invite/synthetic-invitation");
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("Verification code").fill("123456");
  await page.getByRole("button", { name: "Verify & open" }).click();
  await expect(
    page.getByRole("heading", { name: "Test conversation" }),
  ).toBeVisible();
  await page.clock.runFor(31000);
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("session-expired")),
  );
  await expect(
    page.getByRole("button", { name: "Email me a code" }),
  ).toBeVisible();
  expect(codes).toBe(1);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  expect(codes).toBe(2);
});
