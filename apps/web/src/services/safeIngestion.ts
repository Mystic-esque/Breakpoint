import { getAddress, Interface, isAddress, keccak256, toUtf8Bytes } from 'ethers';
import { LIVE_NETWORKS, type LiveNetwork, type LiveSafeSnapshot, type ImportedSafe } from '../lib/liveSafe';

const RPCS: Record<LiveNetwork, string[]> = {
  sepolia: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://rpc.sepolia.org'],
  ethereum: ['https://ethereum-rpc.publicnode.com'],
  base: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'],
  optimism: ['https://mainnet.optimism.io'],
  arbitrum: ['https://arb1.arbitrum.io/rpc'],
  local: ['http://127.0.0.1:8545']
};
// Published runtime hashes from safe-global/safe-deployments (canonical EVM
// singleton versions 1.3.0, 1.4.1, 1.5.0). Verify bytecode, not ABI shape alone.
const SINGLETON_HASHES = new Set([
  '0xbba688fbdb21ad2bb58bc320638b43d94e7d100f6f3ebaab0a4e4de6304b1c2e',
  '0x21842597390c4c6e3c1239e434a682b054bd9548eee5e9b1d6a4482731023c0f',
  '0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4',
  '0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff',
  '0xdda019cbd7c867a533a2a86e5c53434fdc50b13122b5a5ddb4a8df61b31c20f2',
  '0x180193227186ccb85316c94db1f0d156ed932b14712cfaac78901899178572dc'
]);
const SAFE = new Interface([
  'function getOwners() view returns (address[])', 'function getThreshold() view returns (uint256)',
  'function nonce() view returns (uint256)', 'function VERSION() view returns (string)',
  'function getModulesPaginated(address,uint256) view returns (address[],address)'
]);
const SENTINEL = '0x0000000000000000000000000000000000000001';
export type ReadRpc = (method: string, params: unknown[]) => Promise<any>;
const READ_METHODS = new Set(['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_getStorageAt', 'eth_getBalance', 'eth_call']);

export function validateImport(network: unknown, addresses: unknown): { network: LiveNetwork; addresses: string[] } {
  if (typeof network !== 'string' || !Object.hasOwn(LIVE_NETWORKS, network)) throw new Error('Choose a supported network.');
  if (!Array.isArray(addresses) || addresses.length < 2 || addresses.length > 5) throw new Error('Enter between 2 and 5 Safe addresses.');
  const normalized = addresses.map((address, i) => {
    if (typeof address !== 'string' || !isAddress(address.trim())) throw new Error(`Address ${i + 1} is not a valid EVM address.`);
    return getAddress(address.trim()).toLowerCase();
  });
  if (new Set(normalized).size !== normalized.length) throw new Error('Each Safe address must be different.');
  return { network: network as LiveNetwork, addresses: normalized };
}

function transport(url: string, signal: AbortSignal): ReadRpc {
  let id = 0;
  return async (method, params) => {
    if (!READ_METHODS.has(method)) throw new Error('Only read-only RPC methods are permitted.');
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }), cache: 'no-store',
      signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) });
    if (!response.ok) throw new Error(`Public RPC returned HTTP ${response.status}. Try again shortly.`);
    const result = await response.json();
    if (result.error || result.result === undefined) throw new Error('The RPC could not read this contract at the selected block. Check the network and address.');
    return result.result;
  };
}

// Standard SafeProxy executable code is verified separately below. Solidity's
// metadata trailer is not executed; hashes include the executable bytes only.
export function proxyExecutable(code: string) {
  const length = parseInt(code.slice(-4), 16);
  return Number.isFinite(length) && length > 0 && (length + 2) * 2 < code.length - 2
    ? code.slice(0, -(length + 2) * 2) : code;
}
const PROXY_EXECUTABLE_HASHES = new Set([
  keccak256('0x608060405260005463a619486e60003560e01c14156024578060601b606c5260206060f35b3660008037600080366000845af43d6000803e806040573d6000fd5b3d6000f3fe'),
  keccak256('0x608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fe')
]);
const PROXY_FULL_HASHES = new Set(['0xb89c1b3bdf2cf8827818646bce9a8f6e372885f8c55e5c07acbd307cb133b000']);

export async function readSafeSnapshot(network: LiveNetwork, addresses: string[], rpc: ReadRpc): Promise<LiveSafeSnapshot> {
  if (Number(BigInt(await rpc('eth_chainId', []))) !== LIVE_NETWORKS[network].chainId) throw new Error('RPC returned the wrong chain. Import stopped.');
  const block = await rpc('eth_getBlockByNumber', ['latest', false]);
  if (!block?.hash || !block?.number) throw new Error('Could not pin a block for this review.');
  const tag = block.number;
  const call = async (address: string, method: string, args: unknown[] = []) => SAFE.decodeFunctionResult(method,
    await rpc('eth_call', [{ to: address, data: SAFE.encodeFunctionData(method, args) }, tag]));
  const safes: ImportedSafe[] = [];
  for (const address of addresses) {
    try {
      const code = await rpc('eth_getCode', [address, tag]);
      if (code === '0x' || (!PROXY_FULL_HASHES.has(keccak256(code)) && !PROXY_EXECUTABLE_HASHES.has(keccak256(proxyExecutable(code))))) throw new Error('Not a recognized Safe proxy (supported versions: 1.3–1.5).');
      const slot = await rpc('eth_getStorageAt', [address, '0x0', tag]);
      const singleton = getAddress('0x' + slot.slice(-40)).toLowerCase();
      const implementation = await rpc('eth_getCode', [singleton, tag]);
      if (!SINGLETON_HASHES.has(keccak256(implementation))) throw new Error('Unrecognized Safe implementation; no authority claims made.');
      const [ownerResult, thresholdResult, nonceResult, versionResult, balance, moduleResult, guardSlot] = await Promise.all([
        call(address, 'getOwners'), call(address, 'getThreshold'), call(address, 'nonce'), call(address, 'VERSION'),
        rpc('eth_getBalance', [address, tag]), call(address, 'getModulesPaginated', [SENTINEL, 25]),
        rpc('eth_getStorageAt', [address, keccak256(toUtf8Bytes('guard_manager.guard.address')), tag])
      ]);
      const owners = [...ownerResult[0]].map((o: string) => getAddress(o).toLowerCase());
      const threshold = Number(thresholdResult[0]);
      if (!owners.length || owners.length > 50 || new Set(owners).size !== owners.length || !Number.isInteger(threshold) || threshold < 1 || threshold > owners.length) throw new Error('Invalid or too-large owner configuration (maximum 50 owners).');
      const contractOwners: string[] = [];
      for (const owner of owners) if (await rpc('eth_getCode', [owner, tag]) !== '0x') contractOwners.push(owner);
      safes.push({ address, owners, threshold, nonce: nonceResult[0].toString(), version: versionResult[0],
        balanceRaw: BigInt(balance).toString(), singleton, modules: [...moduleResult[0]].map((s: string) => s.toLowerCase()),
        modulesTruncated: moduleResult[1].toLowerCase() !== SENTINEL, guard: '0x' + guardSlot.slice(-40), contractOwners });
    } catch (error) { throw new Error(`${address.slice(0, 8)}…${address.slice(-4)}: ${error instanceof Error ? error.message : 'Read failed.'}`); }
  }
  if (new Set(safes.flatMap(s => s.owners)).size > 50) throw new Error('This map supports at most 50 distinct owners. Import fewer Safes.');
  const confirmed = await rpc('eth_getBlockByNumber', [tag, false]);
  if (confirmed?.hash !== block.hash) throw new Error('The chain changed during import. Fetch again for a consistent snapshot.');
  return { mode: 'read-only', network, chainId: LIVE_NETWORKS[network].chainId,
    blockNumber: BigInt(tag).toString(), blockHash: block.hash, observedAt: new Date().toISOString(), safes };
}

export async function ingestSafes(networkInput: unknown, addressInput: unknown) {
  const { network, addresses } = validateImport(networkInput, addressInput);
  const signal = AbortSignal.timeout(60000);
  let lastError: unknown;
  for (const url of RPCS[network]) {
    try { return await readSafeSnapshot(network, addresses, transport(url, signal)); }
    catch (error) { lastError = error; if (signal.aborted) break; }
  }
  throw new Error(lastError instanceof Error && !/abort|timeout/i.test(lastError.message) ? lastError.message : 'The RPC timed out. Try again or use the local demo Safes.');
}
