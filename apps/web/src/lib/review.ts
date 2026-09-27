export type ReviewQuestion = "shared" | "specific" | "change";

export const REVIEW_QUESTIONS: Record<ReviewQuestion, { title: string; description: string }> = {
  shared: { title: "Find shared control", description: "Find the largest amount a small signer group can pause. BREAKPOINT chooses a computed example for you." },
  specific: { title: "Investigate specific signers", description: "Choose addresses yourself and see which vaults their approvals can reach." },
  change: { title: "Compare a Safe change", description: "Try different owners or approval requirements, compare the tradeoffs, then verify locally." }
};

export type ResultEvidence = {
  txHash?: string; outerStatus: string; safeExecutionStatus?: string;
  before?: Record<string, unknown>; after?: Record<string, unknown>;
};

// An absent receipt or a transport failure is not evidence of rejected authorization.
export function interpretResult(expectedPaused: boolean, observedPaused: boolean,
  pause?: ResultEvidence, probe?: ResultEvidence) {
  const receipt = Boolean(pause?.txHash && ["success", "reverted"].includes(pause.outerStatus));
  const accepted = receipt && pause?.outerStatus === "success" && pause.safeExecutionStatus === "success";
  const rejected = receipt && pause?.outerStatus === "reverted" && pause.safeExecutionStatus === "failure";
  const stateRecorded = pause?.after?.withdrawalsPaused === observedPaused;
  let status: "matched" | "mismatch" | "inconclusive" = !receipt || !stateRecorded || (!accepted && !rejected)
    ? "inconclusive" : expectedPaused === observedPaused && expectedPaused === accepted ? "matched" : "mismatch";
  const withdrawal = !probe ? "Not attempted in this rehearsal"
    : probe.txHash && probe.outerStatus === "success" ? "Tested: withdrawal succeeded"
    : probe.txHash && probe.outerStatus === "reverted" ? "Tested: withdrawal failed" : "Withdrawal check inconclusive";
  if (probe && (!probe.txHash || !["success", "reverted"].includes(probe.outerStatus))) status = "inconclusive";
  else if (probe && (probe.outerStatus !== "success" || observedPaused)) status = "mismatch";
  return { status, authorization: accepted ? "Safe accepted the approvals" : rejected ? "Safe rejected the transaction"
    : "Safe outcome inconclusive", withdrawal };
}

export function interpretProposal(beforeRaw: string, afterRaw: string, complete: boolean) {
  if (!complete) return "The control model is incomplete. This comparison cannot establish a reduction in shared pause authority.";
  const before = BigInt(beforeRaw), after = BigInt(afterRaw);
  return after < before
    ? "This proposal reduces the largest amount a group within your key budget can pause. That supports the goal of reducing shared control."
    : after > before
      ? "This proposal increases the largest amount a group within your key budget can pause. It moves against the goal of reducing shared control."
      : "The largest amount a group within your key budget can pause is unchanged. A different group may retain the same reach, even if your selected group loses authority.";
}
