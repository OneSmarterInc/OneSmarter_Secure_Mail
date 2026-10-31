import { test, expect } from "@playwright/test";

for (const status of [200, 503, 403, 404]) {
  test(`reply draft survives background refresh unless access is denied (${status})`, async ({
    page,
  }) => {
    let holdRefresh = false;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/auth/session"))
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
      if (path.endsWith("/attachments"))
        return route.fulfill({
          json: {
            id: "file-1",
            name: "draft.txt",
            size: 4,
            state: "available",
            scan_method: "clamav",
          },
        });
      if (path.endsWith("/messages"))
        return route.fulfill({ status: 201, json: { id: "reply-1" } });
      if (path.includes("/conversations/")) {
        if (holdRefresh) {
          holdRefresh = false;
          await gate;
          if (status !== 200)
            return route.fulfill({
              status,
              json: { error: { message: "Refresh failed" } },
            });
        }
        return route.fulfill({
          json: {
            id: "thread-1",
            subject: "Test thread",
            protected: true,
            routing_reason: "secure_request",
            created_at: "2026-01-01T00:00:00Z",
            expires_at: "2099-01-01T00:00:00Z",
            recipients: [],
            messages: [],
            delivery: [],
          },
        });
      }
      return route.fulfill({ json: { ready: true } });
    });
    await page.goto("/staff/#/messages/thread-1");
    await page
      .getByRole("button", { name: "New message", exact: true })
      .click();
    await page.getByLabel("Message", { exact: true }).fill("Keep this reply");
    await page
      .getByRole("button", { name: "Attach files", exact: true })
      .click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "draft.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("test"),
    });
    await expect(
      page.getByRole("button", { name: "Remove draft.txt" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Conversation actions", exact: true })
      .click();
    holdRefresh = true;
    await page
      .getByRole("button", { name: "Refresh status", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Refreshing status…" }),
    ).toBeDisabled();
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
      "Keep this reply",
    );
    await expect(
      page.getByRole("button", { name: "Remove draft.txt" }),
    ).toBeVisible();
    release();
    if (status === 403 || status === 404) {
      await expect(
        page.getByText("Refresh failed", { exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("Message", { exact: true })).toHaveCount(0);
      return;
    }
    await expect(
      page.getByRole("button", { name: "Refresh status", exact: true }),
    ).toBeEnabled();
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
      "Keep this reply",
    );
    await expect(
      page.getByRole("button", { name: "Remove draft.txt" }),
    ).toBeVisible();
    if (status === 503)
      await expect(
        page.getByText("Refresh failed", { exact: true }),
      ).toBeVisible();
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page.getByRole("button", { name: "Submit reply" }).click();
    await expect(
      page.getByText("Reply saved. Notification queued.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue("");
    await page
      .getByRole("button", { name: "Conversation actions", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Refresh status", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(
      page.getByText("Reply saved. Notification queued.", { exact: true }),
    ).toBeVisible();
  });
}
