import { expect, test } from "@playwright/test";
import path from "node:path";

const screenshot = (name: string) => path.resolve("docs", "screenshots", name);

test("layout, presentation, dialogs, and archived review stay usable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Local chain status")).toBeVisible();
  const intro = page.getByRole("dialog", { name: "Understand BREAKPOINT" });
  await expect(intro).toContainText("same small set of signer addresses");
  await page.setViewportSize({ width: 1366, height: 768 });
  await expect(intro.getByRole("heading", { name: "Separate vaults can share the same control." })).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await intro.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 1440, height: 900 });
  await intro.getByRole("button", { name: "Continue to review question" }).click();
  await expect(intro.getByRole("heading", { name: "What would you like to investigate?" })).toBeFocused();
  await intro.getByRole("button", { name: "Start guided review" }).click();
  await page.getByRole("button", { name: "Guide & terms" }).click();
  await intro.getByRole("button", { name: "Continue to review question" }).click();
  await intro.getByRole("radio", { name: /Investigate specific signers/ }).check();
  await intro.getByRole("button", { name: "Open this investigation" }).click();
  await expect(page.getByTestId("rehearse")).toBeDisabled();
  await page.getByRole("button", { name: "Guide & terms" }).click();
  await intro.getByRole("button", { name: "Continue to review question" }).click();
  await intro.getByRole("radio", { name: /Find shared control/ }).check();
  await intro.getByRole("button", { name: "Start guided review" }).click();

  const builderButton = page.getByRole("button", { name: "Build scenario" });
  await builderButton.click();
  const builder = page.getByRole("dialog", { name: "Build local scenario" });
  await expect(builder.getByRole("button", { name: "Close" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(builder).toBeHidden();
  await expect(builderButton).toBeFocused();

  await page.getByRole("button", { name: "Show complete map" }).click();
  await page.getByTestId("finding-guide").getByText("What should I do with this finding?").click();
  await expect(page.getByTestId("finding-guide")).toContainText("There is no universal safe percentage");
  await page.getByTestId("finding-guide").getByText("What should I do with this finding?").click();
  for (const size of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    const layout = await page.evaluate(() => {
      const workspace = document.querySelector(".workspace")!.getBoundingClientRect();
      const evidence = document.querySelector(".evidence-drawer")!.getBoundingClientRect();
      const callout = document.querySelector(".canvas-callout")!.getBoundingClientRect();
      const canvas = document.querySelector(".canvas-panel")!.getBoundingClientRect();
      return { workspaceBottom: workspace.bottom, evidenceTop: evidence.top, calloutBottom: callout.bottom,
        canvasBottom: canvas.bottom, horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth };
    });
    expect(layout.evidenceTop, `evidence overlap at ${size.width}px`).toBeGreaterThanOrEqual(layout.workspaceBottom - 1);
    expect(layout.calloutBottom, `graph conclusion clipped at ${size.width}px`).toBeLessThanOrEqual(layout.canvasBottom + 1);
    expect(layout.horizontalOverflow, `page overflow at ${size.width}px`).toBeLessThanOrEqual(1);
  }

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.getByRole("button", { name: "Present", exact: true }).click();
  await expect(page.locator(".position-rail")).toBeHidden();
  const graphFont = await page.locator(".safe-node").first().evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return parseFloat(getComputedStyle(node).fontSize) * rect.width / (node as HTMLElement).offsetWidth;
  });
  expect(graphFont).toBeGreaterThanOrEqual(14);
  const presentationLayout = await page.evaluate(() => ({
    calloutBottom: document.querySelector(".canvas-callout")!.getBoundingClientRect().bottom,
    inspectorHeight: document.querySelector(".inspector")!.getBoundingClientRect().height,
    metricBottom: document.querySelector(".metric-grid > div:last-child")!.getBoundingClientRect().bottom,
    actionTop: document.querySelector(".inspector-footer")!.getBoundingClientRect().top,
    visibleHeight: window.innerHeight
  }));
  expect(presentationLayout.calloutBottom).toBeLessThanOrEqual(presentationLayout.visibleHeight + 1);
  expect(presentationLayout.inspectorHeight).toBeLessThanOrEqual(presentationLayout.visibleHeight);
  expect(presentationLayout.metricBottom).toBeLessThanOrEqual(presentationLayout.actionTop + 1);
  await page.screenshot({ path: screenshot("06-presentation-1366.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Exit presentation" }).click();
  await page.getByRole("button", { name: "Guide & terms" }).click();
  await intro.getByRole("button", { name: "Continue to review question" }).click();
  await intro.getByRole("radio", { name: /Compare a Safe change/ }).check();
  await intro.getByRole("button", { name: "Open this investigation" }).click();
  await page.getByRole("button", { name: "Load guided Harbor example" }).click();
  const proposalLayout = await page.evaluate(() => {
    const owners = document.querySelector(".proposal-owners")!;
    return { ownerOverflow: owners.scrollWidth - owners.clientWidth,
      contentBottom: document.querySelector(".inspector-content")!.getBoundingClientRect().bottom,
      actionTop: document.querySelector(".inspector-footer")!.getBoundingClientRect().top,
      inspectorWidth: document.querySelector(".inspector")!.getBoundingClientRect().width,
      graphRight: document.querySelector(".graph-wrap")!.getBoundingClientRect().right,
      signerRight: [...document.querySelectorAll(".signer-node")].at(-1)!.getBoundingClientRect().right };
  });
  expect(proposalLayout.ownerOverflow).toBeLessThanOrEqual(1);
  expect(proposalLayout.contentBottom).toBeLessThanOrEqual(proposalLayout.actionTop + 1);
  expect(proposalLayout.inspectorWidth).toBeGreaterThanOrEqual(375);
  expect(proposalLayout.signerRight).toBeLessThanOrEqual(proposalLayout.graphRight + 1);
  await page.locator(".proposal-delta").scrollIntoViewIfNeeded();
  await expect(page.locator(".proposal-delta")).toBeInViewport();
  await page.screenshot({ path: screenshot("07-change-editor-1366.png"), animations: "disabled" });
  await page.getByRole("button", { name: "Cancel proposal" }).click();

  await page.getByRole("button", { name: "Show receipts and save review" }).click();
  await page.getByRole("textbox", { name: "Review name" }).fill("Layout audit");
  await page.getByRole("textbox", { name: "Review note" }).fill("Recorded state remains inspectable.");
  await page.getByRole("button", { name: "Save review locally" }).click();
  const saved = page.getByRole("dialog", { name: "Saved reviews" });
  await saved.getByRole("button", { name: /Layout audit/ }).click();
  await expect(saved).toContainText("Recorded state remains inspectable.");
  await expect(saved).toContainText("Discovered control at the saved snapshot");
  await expect(saved.locator(".archive-section table tbody tr")).toHaveCount(3);
  const downloadPromise = page.waitForEvent("download");
  await saved.getByRole("button", { name: "Export this saved review" }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/breakpoint-saved-.*\.json/);
  await saved.getByRole("button", { name: "Close" }).click();
  await page.reload();
  await expect(page.getByLabel("Local chain status")).toBeVisible();
  await page.getByRole("button", { name: /Saved reviews/ }).click();
  await page.getByRole("dialog", { name: "Saved reviews" }).getByRole("button", { name: /Layout audit/ }).click();
  await expect(page.getByRole("dialog", { name: "Saved reviews" })).toContainText("Recorded state remains inspectable.");
});
