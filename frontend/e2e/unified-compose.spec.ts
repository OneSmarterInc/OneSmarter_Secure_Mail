import { test, expect } from "@playwright/test";

for (const normal of [false, true]) {
  test(`unified composer sends ${normal ? "explicit normal email" : "secure invitation"}`, async ({
    page,
  }) => {
    let sent: Record<string, unknown> | undefined;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/auth/session"))
        return route.fulfill({
          json: {
            csrf: "test",
            user: {
              id: 1,
              name: "Test staff",
              role: "staff",
              organization: "OneSmarter",
              sender_addresses: ["staff@onesmarter.com"],
              can_nophi: true,
            },
          },
        });
      if (path.endsWith("/routing/preview")) {
        const payload = route.request().postDataJSON();
        return route.fulfill({
          json: {
            protected: !payload.nophi_override,
            reason: payload.nophi_override
              ? "explicit_nophi_override"
              : "secure_conversation",
          },
        });
      }
      if (
        path.endsWith("/conversations") &&
        route.request().method() === "POST"
      ) {
        sent = route.request().postDataJSON();
        return route.fulfill({
          status: 400,
          json: {
            error: {
              code: "test_complete",
              message: "Test submission captured",
            },
          },
        });
      }
      return route.fulfill({ json: { ready: true } });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/staff/#/compose");
    await expect(page.locator(".compose-address-row select")).toBeVisible();
    const from = await page
      .locator(".compose-address-row select")
      .boundingBox();
    const to = await page
      .locator(".compose-address-row .recipient-input")
      .boundingBox();
    expect(Math.abs(from!.y - to!.y)).toBeLessThan(1);
    expect(Math.abs(from!.height - to!.height)).toBeLessThan(1);
    await page.screenshot({
      path: `test-results/compose-aligned-${normal}.png`,
    });
    await page.setViewportSize({ width: 360, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(
      page.getByRole("heading", { name: "New conversation", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Request information", exact: true }),
    ).toHaveCount(0);
    await page
      .getByLabel("To *", { exact: true })
      .fill("recipient@example.com");
    await page.getByLabel("To *", { exact: true }).press("Enter");
    await page.getByRole("button", { name: "Add Cc / Bcc" }).click();
    await page.getByLabel("Cc", { exact: true }).fill("copy@example.com");
    await page.getByLabel("Cc", { exact: true }).press("Enter");
    if (normal) {
      await page.getByLabel("Use Nophi: send as normal email").check();
      await page.getByLabel("Subject", { exact: true }).fill("Ordinary update");
      await page
        .getByLabel("Message", { exact: true })
        .fill("Non-sensitive update");
      await page
        .getByLabel(
          "I understand that the content and attachments will be emailed",
        )
        .check();
    }
    const button = page.getByRole("button", {
      name: normal ? "Send normal email" : "Start secure conversation",
      exact: true,
    });
    await expect(button).toBeEnabled();
    await button.click();
    await expect.poll(() => sent).toBeTruthy();
    expect(sent?.mode).toBe(normal ? "ordinary" : "secure_request");
    expect(sent?.nophi_override).toBe(normal);
    expect(sent?.cc).toEqual(["copy@example.com"]);
    expect((sent?.expected_route as { protected: boolean }).protected).toBe(
      !normal,
    );
  });
}
