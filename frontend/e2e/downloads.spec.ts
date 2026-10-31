import { test, expect } from "@playwright/test";

for (const portal of ["staff", "recipient"]) {
  for (const result of ["200", "401", "403", "404", "503", "network"]) {
    test(`${portal} download ${result} never navigates to the file endpoint`, async ({
      page,
    }) => {
      let downloads = 0;
      page.on("download", () => downloads++);
      await page.route("**/*api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/auth/session"))
          return route.fulfill({
            json: {
              csrf: "test",
              user:
                portal === "recipient"
                  ? null
                  : {
                      id: 1,
                      name: "Staff",
                      role: "staff",
                      organization: "Test",
                      sender_addresses: [],
                    },
            },
          });
        if (path.endsWith("/attachments/file-1")) {
          if (result === "network") return route.abort("failed");
          if (result !== "200")
            return route.fulfill({
              status: Number(result),
              json: { error: { message: "Download denied" } },
            });
          return route.fulfill({
            contentType: "text/plain",
            body: "Synthetic document bytes",
          });
        }
        if (path.endsWith("/landing"))
          return route.fulfill({
            json: { organization: "Test", recipient: "s***@example.test" },
          });
        if (path.endsWith("/conversation") || path.includes("/conversations/"))
          return route.fulfill({
            json: {
              id: "thread-1",
              subject: "Download test",
              protected: true,
              routing_reason: "secure_request",
              created_at: "2026-01-01T00:00:00Z",
              expires_at: "2099-01-01T00:00:00Z",
              recipients: [],
              delivery: [],
              messages: [
                {
                  id: "message-1",
                  author: "Staff",
                  author_type: "staff",
                  created_at: "2026-01-01T00:00:00Z",
                  body: "Document",
                  attachments: [
                    {
                      id: "file-1",
                      name: "sample.txt",
                      size: 24,
                      state: "available",
                      scan_method: "clamav",
                    },
                  ],
                },
              ],
            },
          });
        return route.fulfill({ json: { ready: true } });
      });
      await page.goto(
        portal === "recipient"
          ? "/recipient/#/invite/synthetic-token"
          : "/staff/#/messages/thread-1",
      );
      if (portal === "recipient") {
        await page.getByRole("button", { name: "Email me a code" }).click();
        await page.getByLabel("Verification code").fill("123456");
        await page.getByRole("button", { name: "Verify & open" }).click();
      }
      const button = page.getByRole("button", { name: "Download sample.txt" });
      await expect(button).toBeVisible();
      const url = page.url();
      if (result === "200") {
        const pending = page.waitForEvent("download");
        await button.click();
        const download = await pending;
        expect(download.suggestedFilename()).toBe("sample.txt");
        const stream = await download.createReadStream();
        const chunks: Buffer[] = [];
        for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
        expect(Buffer.concat(chunks).toString()).toBe(
          "Synthetic document bytes",
        );
      } else {
        await button.click();
        if (result === "401") {
          if (portal === "recipient") {
            await expect(
              page.getByRole("button", { name: "Email me a code" }),
            ).toBeVisible();
            await expect(
              page.getByRole("heading", { name: "Open your invitation email" }),
            ).toHaveCount(0);
          } else
            await expect(
              page.getByRole("heading", { name: "Welcome back" }),
            ).toBeVisible();
        } else {
          await expect(page.getByRole("alert")).toContainText(
            result === "network" ? "fetch" : "Download denied",
          );
        }
        expect(downloads).toBe(0);
      }
      expect(page.url()).toBe(url);
    });
  }
}
