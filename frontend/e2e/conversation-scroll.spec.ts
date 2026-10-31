import { test, expect } from "@playwright/test";

test("conversation actions popup preserves panels, confirmation, and keyboard access", async ({
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
          delivery: Array.from({ length: 4 }, (_, i) => ({
            id: `failed-${i}`,
            state: "failed",
            attempts: 1,
            last_error: "sender_not_configured",
          })),
          recipients: [
            { id: "a", email: "sara@example.com", kind: "to" },
            { id: "b", email: "bob@example.com", kind: "cc" },
          ],
          messages: Array.from({ length: 20 }, (_, index) => ({
            id: `message-${index}`,
            author: "Sara",
            author_type: "recipient",
            created_at: "2026-10-31T10:01:00Z",
            body: `Message ${index}`,
            attachments: [],
            shared: true,
            headers: {
              from_name: "Sara",
              from_email:
                index % 2 === 0 ? "ammar@onesmarter.com" : "sara@example.com",
              to: ["ammar@onesmarter.com"],
              cc: ["bob@example.com"],
              bcc: [],
            },
          })),
        },
      });
    return route.fulfill({ json: { ready: true } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/staff/#/messages/group-1");
  const stream = page.getByRole("region", {
    name: "Conversation messages and reply",
  });
  await expect(page.locator(".thread article").first()).toContainText(
    "Message 19",
  );
  await expect.poll(() => stream.evaluate((el) => el.scrollTop)).toBe(0);
  expect(
    await stream.evaluate((el) => getComputedStyle(el).scrollbarWidth),
  ).toBe("none");
  await stream.hover();
  await page.mouse.wheel(0, 400);
  await expect
    .poll(() => stream.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await stream.evaluate((el) => {
    el.scrollTop = 0;
  });
  const own = await page.locator(".message-own").first().boundingBox();
  const other = await page.locator(".message-other").first().boundingBox();
  expect(own!.x).toBeGreaterThan(other!.x);
  const action = page.getByRole("button", {
    name: "Conversation actions",
    exact: true,
  });
  await expect(
    page.getByRole("heading", { name: "Access details" }),
  ).toHaveCount(0);
  await action.click();
  const dialog = page.getByRole("dialog", {
    name: "Conversation actions",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  const panels = dialog.locator(".conversation-actions-grid > section");
  await expect(panels).toHaveCount(3);
  const bounds = await panels.evaluateAll((nodes) =>
    nodes.map((node) => ({
      x: node.getBoundingClientRect().x,
      y: node.getBoundingClientRect().y,
      bottom: node.getBoundingClientRect().bottom,
    })),
  );
  expect(bounds[0].x).toBe(bounds[1].x);
  expect(bounds[1].y).toBeGreaterThan(bounds[0].y);
  expect(bounds[2].y).toBe(bounds[0].y);
  expect(bounds[2].x).toBeGreaterThan(bounds[0].x);
  expect(Math.abs(bounds[2].bottom - bounds[1].bottom)).toBeLessThan(1);
  expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(860);
  expect(
    await dialog
      .locator(".delivery-attention")
      .evaluate((el) => getComputedStyle(el).overflowY),
  ).toBe("visible");
  expect((await dialog.boundingBox())!.height).toBeLessThan(900);
  await page.screenshot({
    path: "test-results/conversation-actions-desktop.png",
  });
  await dialog
    .getByRole("button", { name: "Revoke all recipient access" })
    .click();
  const confirm = page.getByRole("dialog", {
    name: "Revoke recipient access?",
    exact: true,
  });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(action).toBeFocused();
  await page.setViewportSize({ width: 360, height: 800 });
  await action.click();
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: "test-results/conversation-actions-mobile.png",
  });
});
