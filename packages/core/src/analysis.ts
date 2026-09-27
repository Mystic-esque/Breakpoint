import type {
  Address,
  AnalysisResult,
  CoalitionFinding,
  PositionInput
} from "./types";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function normalizeAddress(address: string): Address {
  if (!ADDRESS.test(address)) throw new Error(`Invalid address: ${address}`);
  return address.toLowerCase();
}

function normalizePosition(position: PositionInput): PositionInput {
  if (!position.id.trim()) throw new Error("Position id is required");
  const amount = BigInt(position.amountRaw);
  if (amount < 0n) throw new Error(`Negative amount for ${position.id}`);
  const owners = position.controller.owners.map(normalizeAddress);
  if (new Set(owners).size !== owners.length) {
    throw new Error(`Duplicate owners for ${position.id}`);
  }
  if (!Number.isInteger(position.controller.threshold) ||
      position.controller.threshold < 1 ||
      position.controller.threshold > owners.length) {
    throw new Error(`Invalid threshold for ${position.id}`);
  }
  return {
    ...position,
    token: normalizeAddress(position.token),
    controller: {
      ...position.controller,
      address: normalizeAddress(position.controller.address),
      owners: owners.sort()
    }
  };
}

function countBits(value: number): number {
  let count = 0;
  while (value) {
    value &= value - 1;
    count += 1;
  }
  return count;
}

function findingFor(
  positions: PositionInput[],
  coalition: Address[],
  total: bigint,
  analyzed: bigint,
  complete: boolean,
  caveats: string[]
): CoalitionFinding {
  const selected = new Set(coalition);
  const affected = positions.filter((position) => {
    let matches = 0;
    for (const owner of position.controller.owners) {
      if (selected.has(owner)) matches += 1;
    }
    return matches >= position.controller.threshold;
  });
  const affectedAmount = affected.reduce((sum, position) => sum + BigInt(position.amountRaw), 0n);
  return {
    signerAddresses: coalition,
    affectedPositionIds: affected.map((position) => position.id).sort(),
    affectedAmountRaw: affectedAmount.toString(),
    totalSelectedAmountRaw: total.toString(),
    analyzedAmountRaw: analyzed.toString(),
    coverageBasisPoints: total === 0n ? null : Number((affectedAmount * 10_000n) / total),
    completeForSupportedModel: complete,
    caveats
  };
}

export function evaluateCoalition(
  positionsInput: PositionInput[],
  coalitionInput: Address[]
): CoalitionFinding {
  const positions = positionsInput.map(normalizePosition);
  const ids = positions.map((position) => position.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate position id");
  const tokens = new Set(positions.map((position) => position.token));
  if (tokens.size > 1) throw new Error("Mixed-token totals are unsupported");
  const coalition = [...new Set(coalitionInput.map(normalizeAddress))].sort();
  const supported = positions.filter((position) => position.controller.supportStatus === "supported");
  const total = positions.reduce((sum, position) => sum + BigInt(position.amountRaw), 0n);
  const analyzed = supported.reduce((sum, position) => sum + BigInt(position.amountRaw), 0n);
  const incomplete = supported.length !== positions.length;
  const caveats = positions.flatMap((position) =>
    position.controller.supportStatus === "supported"
      ? []
      : position.controller.unsupportedReasons ?? [`${position.id} is not supported`]
  );
  return findingFor(supported, coalition, total, analyzed, !incomplete, caveats);
}

export function analyzeCoalitions(
  positionsInput: PositionInput[],
  maxDistinctOwners = 12
): AnalysisResult {
  const positions = positionsInput.map(normalizePosition);
  const ids = positions.map((position) => position.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate position id");
  const tokens = new Set(positions.map((position) => position.token));
  if (tokens.size > 1) throw new Error("Mixed-token totals are unsupported");

  const supported = positions.filter((position) => position.controller.supportStatus === "supported");
  const unsupportedReasons = positions.flatMap((position) =>
    position.controller.supportStatus === "supported"
      ? []
      : position.controller.unsupportedReasons ?? [`${position.id} is not supported`]
  );
  const universe = [...new Set(supported.flatMap((position) => position.controller.owners))].sort();
  if (universe.length > maxDistinctOwners) {
    throw new Error(`Exact analysis supports at most ${maxDistinctOwners} distinct owners`);
  }

  const total = positions.reduce((sum, position) => sum + BigInt(position.amountRaw), 0n);
  const analyzed = supported.reduce((sum, position) => sum + BigInt(position.amountRaw), 0n);
  const complete = unsupportedReasons.length === 0;
  const bestExact = new Map<number, CoalitionFinding>();

  for (let mask = 0; mask < 2 ** universe.length; mask += 1) {
    const coalition = universe.filter((_, index) => (mask & (1 << index)) !== 0);
    const finding = findingFor(supported, coalition, total, analyzed, complete, unsupportedReasons);
    const size = countBits(mask);
    const current = bestExact.get(size);
    if (!current ||
        BigInt(finding.affectedAmountRaw) > BigInt(current.affectedAmountRaw) ||
        (finding.affectedAmountRaw === current.affectedAmountRaw &&
         finding.signerAddresses.join(",") < current.signerAddresses.join(","))) {
      bestExact.set(size, finding);
    }
  }

  const maxExposureRawByKeyBudget: Record<string, string> = {};
  const witnessesByKeyBudget: Record<string, CoalitionFinding> = {};
  let best = bestExact.get(0)!;
  let minimumKeysForAll: number | null = null;
  for (let budget = 0; budget <= universe.length; budget += 1) {
    const candidate = bestExact.get(budget);
    if (candidate &&
        (BigInt(candidate.affectedAmountRaw) > BigInt(best.affectedAmountRaw) ||
         (candidate.affectedAmountRaw === best.affectedAmountRaw &&
          candidate.signerAddresses.join(",") < best.signerAddresses.join(",")))) {
      best = candidate;
    }
    maxExposureRawByKeyBudget[String(budget)] = best.affectedAmountRaw;
    witnessesByKeyBudget[String(budget)] = best;
    if (complete && minimumKeysForAll === null && BigInt(best.affectedAmountRaw) === total) {
      minimumKeysForAll = budget;
    }
  }

  return {
    signerUniverse: universe,
    totalSelectedAmountRaw: total.toString(),
    analyzedAmountRaw: analyzed.toString(),
    completeForSupportedModel: complete,
    unsupportedReasons,
    minimumKeysForAll,
    maxExposureRawByKeyBudget,
    witnessesByKeyBudget
  };
}
