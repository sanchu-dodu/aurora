import {
  expect,
  test,
  type Page,
} from "@playwright/test";

const errorText =
  /Application error|Internal Server Error|This page could not be found/i;

async function openRoute(
  page: Page,
  path: string
): Promise<void> {
  const response = await page.goto(path, {
    waitUntil: "domcontentloaded",
  });

  expect(
    response,
    `Expected ${path} to return a response.`
  ).not.toBeNull();

  expect(
    response?.status(),
    `Expected ${path} to return a successful status.`
  ).toBeLessThan(400);

  await expect(page.locator("body")).toBeVisible();

  await expect(page.locator("body")).not.toContainText(
    errorText
  );
}

test.describe("Aurora smoke tests", () => {
  test("core application routes load", async ({ page }) => {
    const routes = [
      "/",
      "/movies",
      "/tv-shows",
      "/search",
      "/my-list",
      "/profiles",
      "/profile",
      "/signin",
      "/signup",
      "/forgot-password",
    ];

    for (const route of routes) {
      await test.step(`Open ${route}`, async () => {
        await openRoute(page, route);
      });
    }
  });

  test("homepage exposes primary navigation", async ({
    page,
  }) => {
    await openRoute(page, "/");

    const destinations = [
      "/movies",
      "/tv-shows",
      "/search",
      "/my-list",
    ];

    for (const destination of destinations) {
      await expect(
        page.locator(`a[href="${destination}"]`).first()
      ).toBeAttached();
    }
  });

  test("search accepts a query", async ({ page }) => {
    await openRoute(page, "/search");

    const searchInput =
      page.getByRole("textbox").first();

    await expect(searchInput).toBeVisible();

    await searchInput.fill("Aurora smoke test");

    await expect(searchInput).toHaveValue(
      "Aurora smoke test"
    );
  });

  test("My List restores a stored movie", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const movie = {
        id: 999001,
        title: "Aurora Smoke Test Movie",
        poster_path: null,
        vote_average: 8.5,
        release_date: "2026-08-04",
        overview: "Stored movie used by the smoke test.",
      };

      window.localStorage.setItem(
        "aurora-list",
        JSON.stringify([movie])
      );
    });

    await openRoute(page, "/my-list");

    await expect(
      page.getByText(
        "Aurora Smoke Test Movie",
        { exact: true }
      )
    ).toBeVisible();
  });

  test("movie detail route loads", async ({ page }) => {
    await openRoute(page, "/movies/969681");
  });
});