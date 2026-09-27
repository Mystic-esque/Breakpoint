const assert = require("node:assert/strict");
const { scenarioCoordinator: coordinator } = require("../packages/scenario/dist");

async function main() {
  const started = await coordinator.start("integration:start");
  const before = started.snapshot;
  assert.equal(before.analysis.maxExposureRawByKeyBudget["2"], "100000000000");
  assert.equal(before.analysis.minimumKeysForAll, 2);
  assert.equal(before.positions.every((position) => !position.withdrawalsPaused), true);
  await assert.rejects(() => coordinator.rehearse(before.runId, before.blockHash,
    ["A", "B"], [], "integration:empty-scope"), /position/i);

  const rehearsed = await coordinator.rehearse(
    before.runId,
    before.blockHash,
    ["A", "B"],
    ["atlas", "harbor", "grove"],
    "integration:base-rehearsal"
  );
  assert.equal(rehearsed.snapshot.positions.every((position) => position.withdrawalsPaused), true);

  const reset = await coordinator.reset(before.runId, "integration:reset");
  const clean = reset.snapshot;
  assert.notEqual(clean.runId, before.runId);
  assert.equal(clean.positions.every((position) => !position.withdrawalsPaused), true);

  const scoped = await coordinator.rehearse(clean.runId, clean.blockHash,
    ["A", "B", "F"], ["atlas"], "integration:scoped-superset");
  assert.equal(scoped.snapshot.positions[0].withdrawalsPaused, true);
  assert.equal(scoped.snapshot.positions[1].withdrawalsPaused, false);
  assert.equal(scoped.snapshot.positions[2].withdrawalsPaused, false);
  const scopedPause = scoped.evidence.find((event) => event.operationId === "integration:scoped-superset" && event.kind === "pause");
  assert.deepEqual(scopedPause.requestedSignerLabels, ["A", "B", "F"]);
  assert.deepEqual(scopedPause.signingSignerLabels.slice().sort(), ["A", "B"]);
  const cleanAgain = (await coordinator.reset(clean.runId, "integration:reset-after-scoped")).snapshot;

  const patched = await coordinator.patchHarbor(cleanAgain.runId, "integration:patch");
  assert.equal(patched.snapshot.analysis.maxExposureRawByKeyBudget["2"], "65000000000");
  assert.equal(patched.snapshot.analysis.minimumKeysForAll, 4);
  const harborOwners = patched.snapshot.positions
    .find((position) => position.id === "harbor")
    .controller.owners.map((owner) =>
      patched.snapshot.positions[0].ownerLabels[owner]
    ).sort();
  assert.deepEqual(harborOwners, ["C", "D", "F"]);

  const replayed = await coordinator.rehearse(
    patched.snapshot.runId,
    patched.snapshot.blockHash,
    ["A", "B"],
    ["atlas", "harbor", "grove"],
    "integration:replay"
  );
  const byId = Object.fromEntries(replayed.snapshot.positions.map((position) => [position.id, position]));
  assert.equal(byId.atlas.withdrawalsPaused, true);
  assert.equal(byId.grove.withdrawalsPaused, true);
  assert.equal(byId.harbor.withdrawalsPaused, false);
  assert.equal(byId.harbor.currentAmountRaw, "34999000000");
  assert.equal(replayed.snapshot.analysis.totalSelectedAmountRaw, "100000000000");
  assert.equal(replayed.snapshot.analysis.maxExposureRawByKeyBudget["2"], "65000000000");
  const harborPause = replayed.evidence.find(
    (event) => event.kind === "pause" && event.positionId === "harbor"
  );
  assert.equal(harborPause.safeExecutionStatus, "failure");
  assert.equal(harborPause.outerStatus, "reverted");
  assert.ok(harborPause.txHash);
  const bundle = await coordinator.exportBundle();
  assert.equal(bundle.sha256.length, 64);
  assert.equal(bundle.json.includes("privateKey"), false);
  assert.equal(bundle.markdown.includes("not a certification of safety"), true);
  await assert.rejects(() => coordinator.exportBundle(replayed.snapshot.runId, before.blockHash), /Stale snapshot/);
  const custom = await coordinator.createScenario(replayed.snapshot.runId, [
    { id: "atlas", label: "Reserve", amountUnits: 10000, owners: ["A", "C", "E"], threshold: 2 },
    { id: "harbor", label: "Bridge", amountUnits: 20000, owners: ["B", "D", "F"], threshold: 2 },
    { id: "grove", label: "Grants", amountUnits: 30000, owners: ["A", "B", "C"], threshold: 3 }
  ], "integration:custom");
  await assert.rejects(() => coordinator.exportBundle(replayed.snapshot.runId, replayed.snapshot.blockHash), /Stale run id/);
  assert.equal(custom.snapshot.analysis.totalSelectedAmountRaw, "60000000000");
  assert.equal(custom.snapshot.analysis.maxExposureRawByKeyBudget["2"], "20000000000");
  assert.equal(custom.snapshot.analysis.minimumKeysForAll, 4);
  assert.deepEqual(custom.snapshot.positions.map((position) => position.controller.threshold), [2, 2, 3]);
  const changed = await coordinator.applyConfiguration(custom.snapshot.runId, custom.snapshot.blockHash,
    "atlas", ["A", "C", "E"], 1, "integration:custom-threshold");
  assert.equal(changed.snapshot.positions[0].controller.threshold, 1);
  assert.ok(changed.evidence.some((event) => event.kind === "threshold-change" && event.safeExecutionStatus === "success"));
  const customReplay = await coordinator.rehearse(changed.snapshot.runId, changed.snapshot.blockHash,
    ["A"], ["atlas", "harbor", "grove"], "integration:custom-replay");
  assert.equal(customReplay.snapshot.positions[0].withdrawalsPaused, true);
  assert.equal(customReplay.snapshot.positions[1].withdrawalsPaused, false);
  assert.equal(customReplay.snapshot.positions[2].withdrawalsPaused, false);
  assert.equal(customReplay.evidence.filter((event) => event.kind === "withdrawal-probe").length, 2);
  console.log(JSON.stringify({
    runId: replayed.snapshot.runId,
    before: { maxTwo: "100000000000", minimumAll: 2 },
    after: {
      maxTwo: replayed.snapshot.analysis.maxExposureRawByKeyBudget["2"],
      minimumAll: replayed.snapshot.analysis.minimumKeysForAll
    },
    evidenceEvents: replayed.evidence.length,
    custom: { maxTwo: custom.snapshot.analysis.maxExposureRawByKeyBudget["2"],
      thresholdChangeVerified: changed.snapshot.positions[0].controller.threshold,
      withdrawalProbes: customReplay.evidence.filter((event) => event.kind === "withdrawal-probe").length },
    exportSha256: bundle.sha256
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
