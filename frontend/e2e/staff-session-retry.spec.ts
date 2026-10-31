import { test, expect } from "@playwright/test";

for (const failure of ["network", "503", "401", "signed-out"]) {
  test(`staff session poll handles ${failure} without confusing expiry and outage`, async ({
    page,
  }) => {
    let mode = "ready";
    let uploadStarted = false;
    let releaseUpload = () => {};
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    const user = {
      id: 1,
      name: "Test Staff",
      email: "staff@onesmarter.com",
      role: "staff",
      organization: "Test",
      sender_addresses: ["staff@onesmarter.com"],
      mfa_confirmed: true,
    };
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/auth/session")) {
        if (mode === "network") return route.abort("failed");
        if (mode === "503" || mode === "401")
          return route.fulfill({
            status: Number(mode),
            json: { error: { message: "Unavailable" } },
          });
        return route.fulfill({
          json: {
            user: mode === "signed-out" ? null : user,
            csrf: "test",
            setup_required: false,
          },
        });
      }
      if (path.endsWith("/attachments")) {
        uploadStarted = true;
        await uploadGate;
        return route.fulfill({
          json: {
            id: "file-1",
            name: "draft.txt",
            size: 4,
            state: "available",
            scan_method: "clamav",
          },
        });
      }
      return route.fulfill({ json: { ready: true, protected: true } });
    });
    await page.goto("/staff/#/request");
    await page
      .getByLabel("Message or document request (optional)")
      .fill("Keep my unsent draft");
    if (failure === "network" || failure === "503") {
      await page
        .getByText("Document source details (required for attachments)", {
          exact: true,
        })
        .click();
      await page
        .getByLabel("Source document URL")
        .fill("https://example.com/draft.txt");
      await page
        .getByLabel("Original download time (your local time)")
        .fill("2026-01-01T12:00");
      await page.locator('input[type="file"]').setInputFiles({
        name: "draft.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("test"),
      });
      await expect.poll(() => uploadStarted).toBe(true);
    }
    mode = failure;
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    if (failure === "401" || failure === "signed-out") {
      await expect(
        page.getByRole("heading", { name: "Welcome back" }),
      ).toBeVisible();
      await expect(
        page.getByLabel("Message or document request (optional)"),
      ).toHaveCount(0);
      releaseUpload();
      return;
    }
    await expect(
      page.getByRole("button", { name: "Retry session check" }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Message or document request (optional)"),
    ).toHaveValue("Keep my unsent draft");
    releaseUpload();
    await expect(
      page.getByRole("button", { name: "Remove draft.txt" }),
    ).toBeVisible();
    mode = "ready";
    await page.getByRole("button", { name: "Retry session check" }).click();
    await expect(
      page.getByRole("button", { name: "Retry session check" }),
    ).toHaveCount(0);
    await expect(
      page.getByLabel("Message or document request (optional)"),
    ).toHaveValue("Keep my unsent draft");
    await expect(
      page.getByRole("button", { name: "Remove draft.txt" }),
    ).toBeVisible();
  });
}
