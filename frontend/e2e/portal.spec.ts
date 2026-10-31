import { test, expect, type Page } from "@playwright/test";
import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";

const artifactDir = resolve(
  process.env.E2E_ARTIFACT_DIR || "../.runtime/browser-artifacts",
);
const stateFile = resolve(artifactDir, "staff-session.json");
test.use({ storageState: existsSync(stateFile) ? stateFile : undefined });

async function accessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      targets: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replace(/=+$/, "")]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((v) => parseInt(v, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[19] & 15;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}

async function enroll(page: Page) {
  await expect(
    page.getByRole("heading", { name: /Protect your account|Verify it’s you/ }),
  ).toBeVisible();
  const credentialPath = resolve(artifactDir, "test-credentials.json");
  const saved = JSON.parse(readFileSync(credentialPath, "utf8"));
  const newEnrollment = await page
    .getByText("Enter the key manually")
    .isVisible();
  if (newEnrollment) await page.getByText("Enter the key manually").click();
  const secret = newEnrollment
    ? await page.locator(".secret").innerText()
    : saved.totpSecret;
  writeFileSync(
    credentialPath,
    JSON.stringify({ ...saved, totpSecret: secret }),
    { mode: 0o600 },
  );
  await page.getByLabel("Authenticator or recovery code").fill(totp(secret));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  if (newEnrollment)
    await page
      .getByRole("button", { name: "I saved my recovery codes" })
      .click();
  await expect(
    page.getByRole("heading", { name: "Conversations", exact: true }),
  ).toBeVisible();
}

test("staff request → recipient upload → staff read; accounts and immutable audit UI", async ({
  page,
  browser,
}) => {
  mkdirSync(artifactDir, { recursive: true });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /^(Conversations|Welcome back|Set up your workspace)$/,
    }),
  ).toBeVisible();
  if (await page.getByLabel("Company email").isVisible()) {
    const credentialsFile = resolve(artifactDir, "test-credentials.json");
    const credentials = existsSync(credentialsFile)
      ? JSON.parse(readFileSync(credentialsFile, "utf8"))
      : {
          email: "browser.admin@onesmarter.com",
          password: randomBytes(24).toString("base64url"),
        };
    writeFileSync(credentialsFile, JSON.stringify(credentials), {
      mode: 0o600,
    });
    await page.getByLabel("Company email").fill(credentials.email);
    await page
      .getByLabel("Password", { exact: true })
      .fill(credentials.password);
    const setupToken = page.getByLabel("One-time setup token");
    if (await setupToken.isVisible())
      await setupToken.fill(process.env.E2E_SETUP_TOKEN || "");
    await page
      .getByRole("button", { name: /Create administrator account|Sign in/ })
      .click();
    await enroll(page);
    await page.context().storageState({ path: stateFile });
  }
  await expect(
    page.getByRole("heading", { name: "Conversations", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(artifactDir, "dashboard.png"),
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "New conversation", exact: true })
    .first()
    .click();
  const recipientEmail = `sara.${Date.now()}@example.test`;
  await page.getByLabel("To *", { exact: true }).fill(recipientEmail);
  await page.getByLabel("To *", { exact: true }).press("Enter");
  await page
    .getByLabel("Subject (optional)")
    .fill("Sara’s confidential application");
  await page
    .getByLabel("Message or document request (optional)")
    .fill("Please upload your fictional application document.");
  await page.getByRole("button", { name: "Start secure conversation" }).click();
  await expect(
    page.getByRole("heading", { name: "Sara’s confidential application" }),
  ).toBeVisible();
  const conversationUrl = page.url();
  await accessible(page);
  let invitation = "";
  await expect
    .poll(async () => {
      const response = await page.request.get("/api/dev/inbox", {
        headers: { "X-Dev-Inbox-Token": process.env.E2E_DEV_INBOX_TOKEN || "" },
      });
      const inbox = await response.json();
      invitation =
        inbox.results?.find(
          (m: { to: string; link?: string }) =>
            m.to === recipientEmail && m.link,
        )?.link || "";
      return !!invitation;
    })
    .toBe(true);
  const recipientContext = await browser.newContext({
    viewport: { width: 360, height: 800 },
    storageState: { cookies: [], origins: [] },
  });
  const sara = await recipientContext.newPage();
  sara.on("pageerror", (error) => errors.push(error.message));
  await sara.goto(invitation);
  await expect(
    sara.getByRole("button", { name: "Email me a code" }),
  ).toBeEnabled();
  // Exercise a cookie change after the response-token cache was populated.
  // The header must follow the current cookie rather than a stale response.
  await recipientContext.addCookies([
    {
      name: "csrftoken",
      value: "A".repeat(32),
      url: new URL(invitation).origin,
    },
  ]);
  await sara.getByRole("button", { name: "Email me a code" }).click();
  let code = "";
  await expect
    .poll(async () => {
      const response = await page.request.get("/api/dev/inbox", {
        headers: { "X-Dev-Inbox-Token": process.env.E2E_DEV_INBOX_TOKEN || "" },
      });
      const inbox = await response.json();
      const body =
        inbox.results?.find(
          (m: { to: string; subject: string }) =>
            m.to === recipientEmail && m.subject.includes("verification code"),
        )?.body || "";
      code = body.match(/\b\d{6}\b/)?.[0] || "";
      return !!code;
    })
    .toBe(true);
  await sara.getByLabel("Verification code", { exact: true }).fill(code);
  await sara.getByRole("button", { name: "Verify & open" }).click();
  await expect(
    sara.getByRole("heading", { name: "Sara’s confidential application" }),
  ).toBeVisible();
  const fileText =
    "Fictional application for Sara. This document contains no real confidential data.";
  await sara.getByRole("button", { name: "New message", exact: true }).click();
  await sara.getByRole("button", { name: "Attach files", exact: true }).click();
  await sara.getByLabel("Upload attachments").setInputFiles({
    name: "sara-application.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(fileText),
  });
  await expect(
    sara.getByRole("button", { name: "Remove sara-application.txt" }),
  ).toBeVisible();
  await sara
    .getByLabel("Message", { exact: true })
    .fill("Here is my fictional application document.");
  await sara.getByRole("button", { name: "Submit reply" }).click();
  await expect(
    sara.getByText("Here is my fictional application document.", {
      exact: true,
    }),
  ).toBeVisible();
  await sara.screenshot({
    path: resolve(artifactDir, "recipient.png"),
    fullPage: true,
  });
  await accessible(sara);
  await page.goto(conversationUrl);
  await page.reload();
  await expect(
    page.getByText("Here is my fictional application document.", {
      exact: true,
    }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download sara-application.txt", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("sara-application.txt");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe(fileText);
  await page.screenshot({
    path: resolve(artifactDir, "staff-conversation.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: /Access/ }).click();
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await accessible(page);
  const createButton = page.getByRole("button", {
    name: "Create account",
    exact: true,
  });
  await createButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await accessible(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(createButton).toBeFocused();
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  const staffName = `Test Staff ${Date.now()}`;
  await page.getByLabel("Full name").fill(staffName);
  await page
    .getByLabel("Company email")
    .fill(`staff.${Date.now()}@onesmarter.com`);
  const creationResponse = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/admin/accounts") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Create account & queue invitation" })
    .click();
  if ((await creationResponse).status() === 403) {
    const saved = JSON.parse(
      readFileSync(resolve(artifactDir, "test-credentials.json"), "utf8"),
    );
    await page
      .getByLabel("Authenticator code", { exact: true })
      .fill(totp(saved.totpSecret));
    await page.getByRole("button", { name: "Verify identity" }).click();
    await page
      .getByRole("button", { name: "Create account & queue invitation" })
      .click();
  }
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search accounts" }).fill(staffName);
  await expect(
    page.getByRole("button", { name: `Manage ${staffName}` }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Sort Name/ }).click();
  await page.screenshot({
    path: resolve(artifactDir, "accounts.png"),
    fullPage: true,
  });
  await page.getByRole("link", { name: "Audit logs", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Search audit events" })
    .fill("attachment.downloaded");
  await expect(page.locator("tbody .event-action").first()).toHaveText(
    "attachment.downloaded",
  );
  await page.getByRole("button", { name: "Details →" }).first().click();
  await expect(
    page.getByRole("heading", { name: "Audit event details" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: /delete|edit/i }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await accessible(page);
  await page.screenshot({
    path: resolve(artifactDir, "audit.png"),
    fullPage: true,
  });
  await page.goto("/#/settings");
  await expect(
    page.getByRole("heading", { name: "Connections", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Not sending email", { exact: true }),
  ).toBeVisible();
  // This disposable browser stack uses synthetic scanning; the separate
  // scanner job verifies actual ClamAV, current signatures and EICAR rejection.
  await expect(
    page.getByRole("button", { name: "Check scanner health" }),
  ).toBeDisabled();
  await expect(
    page.getByText("Antivirus disabled", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Your notification activity" }),
  ).toBeVisible();
  await accessible(page);
  await page.screenshot({
    path: resolve(artifactDir, "connections.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 360, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await accessible(page);
  await page.screenshot({
    path: resolve(artifactDir, "connections-mobile.png"),
    fullPage: true,
  });

  await page.goto("/#/messages");
  await expect(
    page.getByText("Sara’s confidential application", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Conversations", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: resolve(artifactDir, "mobile.png"),
    fullPage: true,
  });
  await accessible(page);
  const skip = page.getByRole("link", { name: "Skip to content" });
  await skip.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  expect(errors).toEqual([]);
  await recipientContext.close();
});
