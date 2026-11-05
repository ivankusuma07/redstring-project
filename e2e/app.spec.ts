import { expect, test } from "@playwright/test";

// All flows run against the built-in $EXAMPLE token, so they need no API keys or network.

test("landing: search → example map renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Who really");
  await page.getByTestId("hero-search").fill("example");
  await page.getByRole("option").first().click();
  await expect(page).toHaveURL(/\/robinhood\/example/);
  const canvas = page.getByTestId("graph-canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("data-nodes", "250");
});

test("map: clicking a node opens the side panel", async ({ page }) => {
  await page.goto("/robinhood/example");
  await expect(page.getByTestId("graph-canvas")).toBeVisible();
  await page.waitForTimeout(2500); // let the layout settle
  // find the on-screen position of the biggest Group 1 wallet via the graph's test hook
  const pos = await page.evaluate(async () => {
    const res = await fetch("/api/snapshot/robinhood/example");
    const { snapshot } = await res.json();
    const n = snapshot.nodes.find((x: { cluster: number | null }) => x.cluster === 1);
    const g = (window as unknown as { __rsGraph: { screenPos: (id: string) => { x: number; y: number } | null } }).__rsGraph;
    return g.screenPos(n.id);
  });
  expect(pos).not.toBeNull();
  await page.mouse.click(pos!.x, pos!.y);
  const panel = page.getByTestId("node-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Selected · Group 1");
  await expect(panel).toContainText("Why it's linked");
});

test("holders tab: filter, then row click selects on map", async ({ page }) => {
  await page.goto("/robinhood/example?tab=holders");
  await expect(page.getByRole("heading", { name: /Top 250 holders/ })).toBeVisible();
  await page.getByRole("button", { name: "Linked only" }).click();
  const rows = page.getByTestId("holder-row");
  await expect(rows.first()).toContainText("Group");
  await rows.first().click();
  await expect(page.getByTestId("node-panel")).toBeVisible();
});

test("risk audit shows the score breakdown", async ({ page }) => {
  await page.goto("/robinhood/example?tab=audit");
  await expect(page.getByRole("heading", { name: "How the score is built" })).toBeVisible();
  await expect(page.getByText("Largest linked group").first()).toBeVisible();
  const score = await page.getByTestId("audit-score").textContent();
  expect(Number(score)).toBeGreaterThan(0);
});

test("share card: OG image is a 1200×630 PNG", async ({ page, request }) => {
  await page.goto("/robinhood/example");
  await page.getByRole("button", { name: "Share card" }).click();
  await expect(page.getByRole("img", { name: /Share card for \$EXAMPLE/ })).toBeVisible();
  const res = await request.get("/robinhood/example/opengraph-image");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("image/png");
  const buf = await res.body();
  expect(buf.readUInt32BE(16)).toBe(1200);
  expect(buf.readUInt32BE(20)).toBe(630);
});

test("seal tab: snapshot JSON hash matches", async ({ page, request }) => {
  await page.goto("/robinhood/example?tab=seal");
  await expect(page.getByRole("heading", { name: "Example." })).toBeVisible();
  const res = await request.get("/api/snapshot/robinhood/example");
  const { snapshot, seal } = await res.json();
  expect(snapshot.token.symbol).toBe("EXAMPLE");
  expect(seal.snapshotHash).toMatch(/^0x[0-9a-f]{64}$/);
});

test("explore lists the example token", async ({ page }) => {
  await page.goto("/explore");
  await expect(page.getByRole("link", { name: "$EXAMPLE" })).toBeVisible();
  await expect(page.getByText("PINNED · OFFICIAL")).toBeVisible();
});

test("404 page", async ({ page }) => {
  await page.goto("/nowhere/at-all");
  await expect(page.getByRole("heading", { name: "This string leads nowhere." })).toBeVisible();
});

test("mobile overview with bottom tabs @mobile", async ({ page }) => {
  await page.goto("/robinhood/example");
  await expect(page.getByRole("heading", { name: "Supply split" })).toBeVisible();
  await page.getByRole("button", { name: /Holders/ }).last().click();
  await expect(page.getByRole("heading", { name: /Top 250 holders/ })).toBeVisible();
});
