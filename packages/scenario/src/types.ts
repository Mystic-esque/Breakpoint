import type { AnalysisResult, PositionInput } from "../../core/dist";

export type ScenarioStage = "offline" | "ready" | "paused" | "patched" | "replayed";

export interface ScenarioSnapshot {
  schemaVersion: 1;
  runId: string;
  chainId: number;
  blockNumber: string;
  blockHash: string;
  observedAt: string;
  token: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    hasMonetaryValue: false;
  };
  positions: Array<PositionInput & {
    label: string;
    vaultAddress: string;
    depositor: string;
    withdrawalsPaused: boolean;
    currentAmountRaw: string;
    ownerLabels: Record<string, string>;
  }>;
  analysis: AnalysisResult;
  selectedCoalition: string[];
}

export interface ExecutionEvidence {
  runId: string;
  operationId: string;
  kind: "deploy" | "baseline" | "pause" | "owner-change" | "threshold-change" | "withdrawal-probe" | "reset";
  positionId?: string;
  requestedSignerLabels?: string[];
  signingSignerLabels?: string[];
  chainId: number;
  destination?: string;
  method: string;
  txHash?: string;
  blockNumber?: string;
  outerStatus: "success" | "reverted" | "not-broadcast";
  safeExecutionStatus?: "success" | "failure" | "not-applicable";
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  expectedOutcome: string;
  observedOutcome: string;
  error?: string;
  recordedAt: string;
}

export interface ScenarioStatus {
  mode: "local-rehearsal";
  readiness: "offline" | "ready";
  runId: string | null;
  stage: ScenarioStage;
  chainId: number;
  rpcHost: "127.0.0.1";
}
