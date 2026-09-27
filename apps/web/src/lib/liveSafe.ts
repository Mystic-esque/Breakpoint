export const LIVE_NETWORKS = {
  sepolia: { label: 'Sepolia', chainId: 11155111 },
  ethereum: { label: 'Ethereum', chainId: 1 },
  base: { label: 'Base', chainId: 8453 },
  optimism: { label: 'Optimism', chainId: 10 },
  arbitrum: { label: 'Arbitrum', chainId: 42161 },
  local: { label: 'Local demo · read only', chainId: 31337 }
} as const;
export type LiveNetwork = keyof typeof LIVE_NETWORKS;
export type ImportedSafe = {
  address: string; owners: string[]; threshold: number; nonce: string;
  balanceRaw: string; version: string; singleton: string;
  modules: string[]; modulesTruncated: boolean; guard: string; contractOwners: string[];
};
export type LiveSafeSnapshot = {
  mode: 'read-only'; network: LiveNetwork; chainId: number;
  blockNumber: string; blockHash: string; observedAt: string;
  safes: ImportedSafe[];
};

// These are conditional owner-threshold calculations, not vault pause analysis.
// Count Safes directly, so zero-balance wallets still require approvals.
export function analyzeOwnerThresholds(safes: ImportedSafe[]) {
  const owners = [...new Set(safes.flatMap(s => s.owners))].sort();
  const overlap = owners.filter(owner => safes.filter(s => s.owners.includes(owner)).length > 1);
  const totalBalanceRaw = safes.reduce((n, s) => n + BigInt(s.balanceRaw), 0n).toString();
  if (owners.length > 12) return { owners, overlap, totalBalanceRaw, exact: false, minimumAll: null, minimumMajority: null, allWitness: [] as string[], majorityWitness: [] as string[] };
  let minimumAll: number | null = null, minimumMajority: number | null = null;
  let allWitness: string[] = [], majorityWitness: string[] = [];
  for (let mask = 0; mask < 2 ** owners.length; mask++) {
    const group = owners.filter((_, i) => (mask & (1 << i)) !== 0);
    const count = safes.filter(s => s.owners.filter(o => group.includes(o)).length >= s.threshold).length;
    if (count === safes.length && (minimumAll === null || group.length < minimumAll)) { minimumAll = group.length; allWitness = group; }
    if (count >= Math.floor(safes.length / 2) + 1 && (minimumMajority === null || group.length < minimumMajority)) { minimumMajority = group.length; majorityWitness = group; }
  }
  return { owners, overlap, totalBalanceRaw, exact: true, minimumAll, minimumMajority, allWitness, majorityWitness };
}
