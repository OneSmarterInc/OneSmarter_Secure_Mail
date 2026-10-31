import { test, expect } from "@playwright/test";

const status = 200;
test("paperclip uploads multiple message files without source details", async ({
  page,
}) => {
  const uploads: string[] = [];
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
    if (path.endsWith("/attachments")) {
      uploads.push(route.request().postData() ?? "");
      return route.fulfill({
        json: {
          id: `file-${uploads.length}`,
          name: "draft.txt",
          size: 4,
          state: "available",
          scan_method: "clamav",
        },
      });
    }
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
  await page.getByRole("button", { name: "New message", exact: true }).click();
  await expect(page.getByLabel("Upload attachments")).toHaveCount(0);
  await page.getByRole("button", { name: "Attach files", exact: true }).click();
  await page.getByLabel("Upload attachments").setInputFiles([
    { name: "one.txt", mimeType: "text/plain", buffer: Buffer.from("one") },
    { name: "two.txt", mimeType: "text/plain", buffer: Buffer.from("two") },
  ]);
  await expect.poll(() => uploads.length).toBe(2);
  await expect(page.getByLabel("Source document URL")).toHaveCount(0);
  for (const upload of uploads) {
    expect(upload).not.toContain('name="source_url"');
    expect(upload).not.toContain('name="downloaded_at"');
  }
  await expect(page.locator(".uploads .attachment")).toHaveCount(2);
});
