export type Address = string;
export type SupportStatus = "supported" | "incomplete" | "unsupported";

export interface ControllerInput {
  address: Address;
  owners: Address[];
  threshold: number;
  supportStatus: SupportStatus;
  unsupportedReasons?: string[];
}

export interface PositionInput {
  id: string;
  amountRaw: string;
  token: Address;
  controller: ControllerInput;
}

export interface CoalitionFinding {
  signerAddresses: Address[];
  affectedPositionIds: string[];
  affectedAmountRaw: string;
  totalSelectedAmountRaw: string;
  analyzedAmountRaw: string;
  coverageBasisPoints: number | null;
  completeForSupportedModel: boolean;
  caveats: string[];
}

export interface AnalysisResult {
  signerUniverse: Address[];
  totalSelectedAmountRaw: string;
  analyzedAmountRaw: string;
  completeForSupportedModel: boolean;
  unsupportedReasons: string[];
  minimumKeysForAll: number | null;
  maxExposureRawByKeyBudget: Record<string, string>;
  witnessesByKeyBudget: Record<string, CoalitionFinding>;
}
