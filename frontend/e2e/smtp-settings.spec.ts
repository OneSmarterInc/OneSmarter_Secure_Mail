import { test, expect } from "@playwright/test";
for (const role of ["admin", "staff"]) {
  test(`${role} SMTP screen keeps passwords write-only and scopes settings`, async ({
    page,
  }) => {
    const initial = {
      can_manage: role === "admin",
      organization: {
        host: "smtp.example.com",
        port: 587,
        security: "starttls",
        enabled: true,
      },
      personal: {
        email: "staff@onesmarter.com",
        password_set: false,
        needs_password: true,
      },
      approved_senders: ["staff@onesmarter.com"],
    };
    let saved = false;
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/auth/session"))
        return route.fulfill({
          json: {
            user: {
              id: 1,
              name: "Test",
              role,
              organization: "OneSmarter",
              sender_addresses: ["staff@onesmarter.com"],
            },
            csrf: "test",
          },
        });
      if (path.endsWith("/smtp/personal")) {
        expect(route.request().postDataJSON()).toEqual({
          email: "staff@onesmarter.com",
          password: "private-test-password",
        });
        saved = true;
        initial.personal.password_set = true;
        initial.personal.needs_password = false;
        return route.fulfill({ json: initial });
      }
      if (path.endsWith("/smtp")) return route.fulfill({ json: initial });
      if (path.endsWith("/settings"))
        return route.fulfill({
          json: {
            mail: "smtp",
            smtp_configured: false,
            delivery_counts: {},
            sender_addresses: [],
            checked_at: new Date().toISOString(),
            max_upload_bytes: 26214400,
            signature_max_age_hours: 48,
          },
        });
      return route.fulfill({ json: { ready: true } });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/staff/#/settings");
    await expect(
      page.getByRole("heading", { name: "SMTP setup", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("SMTP hostname")).toHaveCount(
      role === "admin" ? 1 : 0,
    );
    if (role === "admin") {
      const first = await page
        .getByLabel("Sender name", { exact: true })
        .boundingBox();
      const second = await page
        .locator(".compact-smtp .settings-grid > section:nth-child(2) select")
        .boundingBox();
      expect(Math.abs(first!.y - second!.y)).toBeLessThan(1);
      await page.screenshot({ path: "test-results/smtp-compact-desktop.png" });
    }
    await page
      .getByLabel("SMTP password", { exact: true })
      .fill("private-test-password");
    await page
      .getByRole("button", { name: "Save my sender", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "saved securely" }),
    ).toContainText("saved securely");
    expect(saved).toBe(true);
    await expect(page.getByLabel("SMTP password", { exact: true })).toHaveValue(
      "",
    );
    await page.setViewportSize({ width: 360, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

