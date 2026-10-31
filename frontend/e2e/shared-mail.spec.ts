import { test, expect } from "@playwright/test";

test("email details expand and reply actions select the intended audience", async ({
  page,
}) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/session"))
      return route.fulfill({
        json: {
          user: {
            id: 1,
            name: "Ammar",
            role: "staff",
            organization: "OneSmarter",
            sender_addresses: ["ammar@onesmarter.com"],
          },
          csrf: "test",
        },
      });
    if (path.endsWith("/messages")) {
      submitted = route.request().postDataJSON();
      return route.fulfill({ status: 201, json: { id: "reply-2" } });
    }
    if (path.includes("/conversations/"))
      return route.fulfill({
        json: {
          id: "group-1",
          subject: "Shared secure discussion",
          protected: true,
          routing_reason: "secure_request",
          created_at: "2026-10-31T10:00:00Z",
          expires_at: "2099-01-01T00:00:00Z",
          can_reply_all: true,
          viewer_email: "ammar@onesmarter.com",
          delivery: [],
          recipients: [
            { id: "a", email: "sara@example.com", kind: "to" },
            { id: "b", email: "bob@example.com", kind: "cc" },
          ],
          messages: [
            {
              id: "message-1",
              author: "Sara",
              author_type: "recipient",
              created_at: "2026-10-31T10:01:00Z",
              body: "Here is my response.",
              attachments: [],
              shared: true,
              headers: {
                from_name: "Sara",
                from_email: "sara@example.com",
                to: ["ammar@onesmarter.com"],
                cc: ["bob@example.com"],
                bcc: [],
              },
            },
          ],
        },
      });
    return route.fulfill({ json: { ready: true } });
  });
  await page.goto("/staff/#/messages/group-1");
  await page.locator("summary").filter({ hasText: "Message details" }).click();
  await expect(
    page.locator(".mail-details dd").filter({ hasText: "bob@example.com" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reply to sender", exact: true })
    .click();
  await expect(page.getByLabel("Reply mode")).toHaveValue("sender");
  await page
    .getByLabel("Message", { exact: true })
    .fill("Private response for Sara");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByLabel("Message", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "New message", exact: true }).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    "Private response for Sara",
  );
  await page
    .getByRole("button", { name: "Back to conversation", exact: true })
    .click();
  await expect(page.getByLabel("Message", { exact: true })).not.toBeVisible();
  await page.getByRole("button", { name: "New message", exact: true }).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    "Private response for Sara",
  );
  await expect(page.getByLabel("Reply mode")).toHaveValue("sender");
  await page.getByRole("button", { name: "Submit reply", exact: true }).click();
  await expect.poll(() => submitted?.reply_mode).toBe("sender");
  expect(submitted?.reply_to).toBe("message-1");
  await page.getByRole("button", { name: "Reply all", exact: true }).click();
  await expect(page.getByLabel("Reply mode")).toHaveValue("all");
  await page.screenshot({
    path: "test-results/shared-mail-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 360, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
