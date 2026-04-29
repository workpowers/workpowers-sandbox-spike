import { expect, test } from "@playwright/test";

test("seeded user can inspect and mutate projects", async ({ page }) => {
  const projectName = `Playwright proof ${Date.now()}`;

  await page.goto("/login");
  await page.getByRole("button", { name: "Enter session" }).click();
  await expect(page.getByRole("heading", { name: "Session Dashboard" })).toBeVisible();

  await page.getByRole("button", { name: "Projects" }).click();
  await expect(page.getByRole("heading", { name: "Incident replay" })).toBeVisible();

  await page.getByLabel("New project name").fill(projectName);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: projectName })).toBeVisible();
});
