import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("recipient chat matches staff layout and preserves collapsed drafts", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/recipient-api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/session"))
      return route.fulfill({ json: { user: null, csrf: "test" } });
    if (path.endsWith("/conversation"))
      return route.fulfill({
        json: {
          id: "thread",
          subject: "Shared documents",
          protected: true,
          can_reply_all: true,
          viewer_email: "sara@example.com",
          recipients: [],
          messages: Array.from({ length: 12 }, (_, i) => ({
            id: `m${i}`,
            author: i % 2 ? "You" : "Staff",
            author_type: i % 2 ? "recipient" : "staff",
            body: `Message ${i}`,
            created_at: `2026-01-01T12:${String(i).padStart(2, "0")}:00Z`,
            attachments:
              i === 11
                ? [
                    {
                      id: "visible-file",
                      name: "Shared.pdf",
                      state: "available",
                      size: 100,
                    },
                  ]
                : [],
            headers: {
              from_name: i % 2 ? "Sara" : "Staff",
              from_email: i % 2 ? "sara@example.com" : "staff@example.com",
              to: ["sara@example.com"],
              cc: [],
              bcc: [],
            },
          })),
        },
      });
    return route.fulfill({ json: { ready: true } });
  });
  await page.goto("/recipient/#/conversation");
  await expect(
    page.locator('.recipient-sidebar button[aria-current="page"]'),
  ).toBeVisible();
  const accessibility = await new AxeBuilder({ page })
    .include(".recipient-sidebar")
    .analyze();
  expect(accessibility.violations).toEqual([]);
  const header = page.locator(".recipient-conversation-header");
  await expect(
    header.getByRole("button", { name: "New message" }),
  ).toBeVisible();
  await expect(page.locator(".thread article").first()).toContainText(
    "Message 11",
  );
  await expect(page.locator(".thread article").first()).toHaveClass(
    /message-own/,
  );
  await expect(page.getByLabel("Message", { exact: true })).not.toBeVisible();
  const stream = page.getByRole("region", {
    name: "Conversation messages and reply",
  });
  expect(await stream.evaluate((el) => el.scrollTop)).toBe(0);
  await header.getByRole("button", { name: "New message" }).click();
  await page
    .getByLabel("Message", { exact: true })
    .fill("Keep my recipient draft");
  const composer = await page.locator(".reply-composer").boundingBox();
  const messages = await page.locator(".thread").boundingBox();
  expect(composer!.y).toBeLessThan(messages!.y);
  await page.getByRole("button", { name: "Back to conversation" }).click();
  await header.getByRole("button", { name: "New message" }).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    "Keep my recipient draft",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Reply to staff", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Reply mode")).toHaveValue("sender");
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    "Keep my recipient draft",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await stream.evaluate((el) => {
    el.scrollTop = 0;
  });
  const nav = page.getByRole("navigation", { name: "Recipient navigation" });
  await expect(nav.getByRole("button")).toHaveCount(2);
  await nav.getByRole("button", { name: "Archive" }).click();
  await expect(
    page.getByRole("table", { name: "Conversation documents" }),
  ).toContainText("Shared.pdf");
  await expect(header).not.toBeVisible();
  await page.getByRole("textbox", { name: "Search documents" }).fill("missing");
  await expect(page.getByText("No documents match your search.")).toBeVisible();
  await nav.getByRole("button", { name: "Conversations", exact: true }).click();
  await header.getByRole("button", { name: "New message" }).click();
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    "Keep my recipient draft",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.screenshot({ path: "test-results/recipient-chat-desktop.png" });
  await page.setViewportSize({ width: 360, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    header.getByRole("button", { name: "New message" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Conversation actions" }),
  ).toHaveCount(0);
});
