import { expect, test } from "@playwright/test";
import { interpretResult, interpretProposal } from "../../apps/web/src/lib/review";

test("results distinguish receipts, missing evidence, observed state, and tested withdrawals", () => {
  const accepted = { txHash: "0xreceipt", outerStatus: "success", safeExecutionStatus: "success", after: { withdrawalsPaused: true } };
  const rejected = { txHash: "0xreceipt", outerStatus: "reverted", safeExecutionStatus: "failure", after: { withdrawalsPaused: false } };
  expect(interpretResult(true, true, accepted)).toMatchObject({ status: "matched", withdrawal: "Not attempted in this rehearsal" });
  expect(interpretResult(false, false, rejected, { txHash: "0xprobe", outerStatus: "success" })).toMatchObject({ status: "matched", withdrawal: "Tested: withdrawal succeeded" });
  expect(interpretResult(false, false, { outerStatus: "not-broadcast", safeExecutionStatus: "failure", after: { withdrawalsPaused: false } }).status).toBe("inconclusive");
  expect(interpretResult(false, false).authorization).toBe("Safe outcome inconclusive");
  expect(interpretResult(true, false, rejected).status).toBe("mismatch");
  expect(interpretResult(true, false, accepted).status).toBe("inconclusive");
  expect(interpretResult(false, false, rejected, { txHash: "0xprobe", outerStatus: "reverted" }).status).toBe("mismatch");
});

test("proposal interpretation uses maximum group reach and withholds conclusions for incomplete models", () => {
  expect(interpretProposal("100000000000", "65000000000", true)).toContain("reduces the largest amount");
  expect(interpretProposal("100000000000", "100000000000", true)).toContain("different group may retain the same reach");
  expect(interpretProposal("65000000000", "100000000000", true)).toContain("moves against the goal");
  expect(interpretProposal("100000000000", "0", false)).toContain("cannot establish a reduction");
});
