import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const user = {
  id: 1,
  name: "Alex Morgan",
  email: "alex@example.com",
  role: "admin",
  organization: "OneSmarter",
  sender_addresses: ["alex@example.com"],
  can_nophi: true,
  can_manage_privileges: true,
  can_export_audit: true,
  mfa_confirmed: true,
};
const now = "2026-10-31T09:00:00Z";
const conversation = {
  id: "review",
  subject: "Documents for your application",
  mode: "secure_request",
  protected: true,
  routing_reason: "secure_request",
  state: "replied",
  created_at: now,
  updated_at: now,
  expires_at: "2026-11-07T09:00:00Z",
  revoked: false,
  unread: true,
  recipients: [
    {
      id: "r1",
      email: "sara@example.com",
      kind: "to",
      revoked: false,
      last_opened: now,
    },
  ],
  messages: [
    {
      id: "m1",
      author: "Sara Miller",
      author_type: "recipient",
      body: "Please find the requested documents attached. Let me know if you need anything else.",
      created_at: now,
      attachments: [],
      audience: null,
    },
  ],
  delivery: [
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `accepted-${i}`,
      state: "provider_accepted",
      attempts: 1,
      error_code: "",
    })),
    {
      id: "failed-1",
      state: "failed",
      attempts: 1,
      error_code: "sender_not_configured",
    },
  ],
};

test("workspace screens remain usable on desktop and mobile", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = { ready: true };
    if (path.endsWith("/auth/session"))
      data = { user, csrf: "test", synthetic_mode: false };
    else if (path.endsWith("/dashboard"))
      data = {
        conversations: 12,
        awaiting: 4,
        replied: 8,
        active: 10,
        delivery_attention: 0,
      };
    else if (path.endsWith("/conversations/review")) data = conversation;
    else if (path.endsWith("/conversations"))
      data = { results: [conversation], count: 1, page: 1, page_size: 25 };
    else if (path.includes("route"))
      data = { protected: true, route: "protected", reason: "secure_request" };
    else if (path.endsWith("/settings/smtp"))
      data = {
        can_manage: true,
        organization: {
          host: "smtp.example.com",
          sender_name: "OneSmarter",
          port: 587,
          security: "starttls",
          enabled: true,
        },
        personal: {
          email: user.email,
          password_set: true,
          needs_password: false,
        },
        approved_senders: user.sender_addresses,
      };
    else if (path.endsWith("/settings"))
      data = {
        mail: "smtp",
        smtp_configured: true,
        storage_configured: true,
        storage: "local",
        document_encryption: "AES-256-GCM",
        key_service_ready: true,
        antivirus_enabled: true,
        scanner: "clamav",
        key_protector: "key-service",
        sender_addresses: user.sender_addresses,
        checked_at: now,
        delivery_counts: { provider_accepted: 12 },
        max_upload_bytes: 26214400,
        signature_max_age_hours: 48,
      };
    else if (path.endsWith("/evidence"))
      data = {
        results: [
          {
            capture_id: "sample-capture",
            filename: "application-documents.pdf",
            sha256: "a".repeat(64),
            source_url: "https://example.com/document.pdf",
            downloaded_at: now,
            portal_uploaded_at: now,
            catalogued_at: now,
            provenance: "uploader_declared",
            timestamp_state: "pending",
          },
        ],
        count: 1,
        page: 1,
        tsa_configured: false,
      };
    else if (path.includes("/admin/"))
      data = {
        results: [],
        count: 0,
        page: 1,
        page_size: 25,
        updated_at: now,
        snapshot: "1",
        actions: [],
        actors: [],
      };
    return route.fulfill({ json: data });
  });
  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of [
      "messages",
      "request",
      "compose",
      "messages/review",
      "access/accounts",
      "access/audit",
      "settings",
      "evidence",
    ]) {
      await page.goto(`/staff/#/${path}`);
      await expect(page.locator("main h1")).toBeVisible();
      if (path === "messages/review") {
        if (width === 1440)
          expect(
            (await page.locator(".conversation-header").boundingBox())!.height,
          ).toBeLessThanOrEqual(64);
        await expect(page.getByLabel("Notification summary")).toContainText(
          "6",
        );
        await expect(
          page.getByRole("button", { name: "Retry notification" }),
        ).toBeVisible();
        await expect(page.locator(".delivery-history")).not.toHaveAttribute(
          "open",
          "",
        );
        await page
          .getByText("Notification history (6)", { exact: true })
          .click();
        await expect(page.locator(".delivery-history li")).toHaveCount(6);
        await page
          .getByText("Notification history (6)", { exact: true })
          .click();
      }
      if (width === 1440) {
        const header = page.locator(".page-header, .conversation-header");
        if (await header.count())
          expect((await header.boundingBox())!.height).toBeLessThan(90);
      }
      await expect(
        page.getByText("Loading workspace…", { exact: true }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (width === 1440) {
        const scan = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(
          scan.violations.map((v) => ({
            id: v.id,
            targets: v.nodes.map((n) => n.target),
          })),
        ).toEqual([]);
      }
      await page.screenshot({
        path: `test-results/design-${path.replaceAll("/", "-")}-${width}.png`,
        fullPage: true,
      });
    }
  }
  expect(errors).toEqual([]);
});

test("sign-in and recipient entry reflow without horizontal scrolling", async ({
  page,
}) => {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      json: { user: null, csrf: "test", setup_required: false },
    }),
  );
  await page.route("**/recipient-api/**", (route) =>
    route.fulfill({
      json: { organization: "OneSmarter", recipient: "s***@example.com" },
    }),
  );
  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const [name, url] of [
      ["login", "/staff/"],
      ["recipient", "/recipient/#/invite/sample"],
    ]) {
      await page.goto(url);
      await expect(page.locator("main h1")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (width === 1440) {
        const scan = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze();
        expect(
          scan.violations.map((v) => ({
            id: v.id,
            targets: v.nodes.map((n) => n.target),
          })),
        ).toEqual([]);
      }
      await page.screenshot({
        path: `test-results/design-${name}-${width}.png`,
        fullPage: true,
      });
    }
  }
});
