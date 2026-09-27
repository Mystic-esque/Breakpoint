'use client';
import { useMemo, useState } from 'react';
import { formatEther } from 'ethers';
import { Background, Controls, ReactFlow, Position, type Node, type Edge } from '@xyflow/react';
import { analyzeOwnerThresholds, LIVE_NETWORKS, type LiveSafeSnapshot } from '../lib/liveSafe';

const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-4)}`;
const eth = (raw: string) => { const [whole, fraction] = formatEther(raw).split('.'); return `${whole}.${(fraction || '0').slice(0, 6)}`; };
export function LiveSafeView({ snapshot, onBack, onImport }: { snapshot: LiveSafeSnapshot; onBack: () => void; onImport: () => void }) {
  const analysis = useMemo(() => analyzeOwnerThresholds(snapshot.safes), [snapshot]);
  const [selected, setSelected] = useState<string[]>([]);
  const [view, setView] = useState<'graph' | 'table'>('graph');
  const label = (address: string) => `Key ${analysis.owners.indexOf(address) + 1}`;
  const toggle = (address: string) => setSelected(current => current.includes(address) ? current.filter(a => a !== address) : [...current, address]);
  const satisfied = snapshot.safes.filter(s => s.owners.filter(o => selected.includes(o)).length >= s.threshold);
  const nodes: Node[] = [
    ...snapshot.safes.map((s, i) => ({ id: s.address, position: { x: 0, y: i * 145 }, sourcePosition: Position.Right, targetPosition: Position.Left,
      data: { label: `Safe ${i + 1} · ${short(s.address)}\n${s.threshold} of ${s.owners.length} owners · ${eth(s.balanceRaw)} ETH` },
      className: `graph-node safe-node ${satisfied.includes(s) ? 'is-affected' : ''}` })),
    ...analysis.owners.map((owner, i) => ({ id: owner, position: { x: 430, y: i * 78 }, sourcePosition: Position.Right, targetPosition: Position.Left,
      data: { label: `${label(owner)} · ${short(owner)}${analysis.overlap.includes(owner) ? ' · shared' : ''}` },
      className: `graph-node signer-node ${selected.includes(owner) ? 'is-selected' : ''}` }))
  ];
  // Prefix node IDs: a Safe may itself be an owner of another imported Safe.
  nodes.forEach((node, i) => { node.id = `${i < snapshot.safes.length ? 'safe' : 'owner'}:${node.id}`; });
  const edges: Edge[] = snapshot.safes.flatMap(s => s.owners.map(owner => ({ id: `${s.address}:${owner}`, source: `safe:${s.address}`, target: `owner:${owner}`,
    className: selected.includes(owner) ? 'edge-selected' : '' })));
  function exportSnapshot() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...snapshot, selectedOwners: selected, model: 'owner-threshold-only', analysis }, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `breakpoint-readonly-${snapshot.chainId}-${snapshot.blockNumber}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <main className="shell live-shell" data-testid="live-safe-view">
    <header className="topbar"><div className="brand"><span className="brand-glyph">BP</span><div><strong>BREAKPOINT</strong><span>Safe owner review</span></div></div>
      <div className="chain-strip">READ ONLY · {LIVE_NETWORKS[snapshot.network].label} · {snapshot.chainId}</div>
      <div className="top-actions"><button className="button ghost" onClick={onImport}>Import Live Safes</button><button className="button ghost" onClick={exportSnapshot}>Export read-only snapshot</button><button className="button secondary" onClick={onBack}>Return to local rehearsal</button></div></header>
    <div className="live-banner"><strong>Live configuration imported in read-only mode.</strong> No transaction signing or execution is available here. Local rehearsal is a separate demo; importing does not fork these wallets.</div>
    <section className="live-workspace"><section className="canvas-panel">
      <div className="canvas-toolbar"><div><p className="eyebrow">BLOCK {snapshot.blockNumber} · {new Date(snapshot.observedAt).toLocaleString()}</p><h1>Which Safes share their owners?</h1></div>
        <div className="segmented"><button aria-pressed={view === 'graph'} onClick={() => setView('graph')}>Graph</button><button aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button></div></div>
      <p className="live-explanation">Select signer addresses to see which owner thresholds they meet. Shared connections indicate repeated addresses, not necessarily independent people.</p>
      {view === 'graph' ? <div className="live-graph" data-testid="live-graph"><ReactFlow nodes={nodes} edges={edges} fitView fitViewOptions={{ padding: .2 }} nodesDraggable={false} nodesConnectable={false}
        onNodeClick={(_, node) => { if (node.id.startsWith('owner:')) toggle(node.id.slice(6)); }}><Background color="#23313d" /><Controls showInteractive={false} /></ReactFlow></div>
        : <div className="control-table"><table><thead><tr><th>Safe address</th><th>Owners</th><th>Approvals</th><th>Native ETH</th></tr></thead><tbody>{snapshot.safes.map(s => <tr key={s.address}><td className="mono">{s.address}</td><td>{s.owners.map(o => <div key={o}>{label(o)} · <span className="mono">{short(o)}</span></div>)}</td><td>{s.owners.filter(o => selected.includes(o)).length} / {s.threshold} required</td><td title={formatEther(s.balanceRaw)}>{eth(s.balanceRaw)}</td></tr>)}</tbody></table></div>}
      <div className="canvas-callout"><p>{analysis.overlap.length} owner address{analysis.overlap.length === 1 ? '' : 'es'} appear in more than one imported Safe. Your group meets {satisfied.length} of {snapshot.safes.length} owner thresholds.</p></div>
    </section><aside className="live-inspector"><h2>Owner-threshold model</h2>
      <div className="metric-grid"><div><span>TOTAL NATIVE ETH</span><strong title={formatEther(analysis.totalBalanceRaw)}>{eth(analysis.totalBalanceRaw)}</strong></div><div><span>SHARED OWNER ADDRESSES</span><strong>{analysis.overlap.length}</strong></div>
        <div><span>MINIMUM ADDRESSES · ALL SAFES</span><strong>{analysis.minimumAll ?? 'Not calculated'}</strong></div><div><span>MINIMUM ADDRESSES · MAJORITY</span><strong>{analysis.minimumMajority ?? 'Not calculated'}</strong></div></div>
      <p>Minimums describe the owner-threshold model only. They do not establish complete transaction authority or withdrawal-pause permission. A majority means more than half the imported Safes, by count.</p>
      {snapshot.safes.some(s => s.modules.length || s.modulesTruncated || s.contractOwners.length || !/^0x0+$/.test(s.guard)) && <p className="live-warning">Additional controls detected: modules, a guard or contract owners. The threshold calculation excludes their behavior; inspect the configuration details before drawing conclusions.</p>}
      {!analysis.exact && <p className="live-warning">More than 12 distinct owners: exhaustive minimum calculation is unavailable. Shared-owner mapping and manual selection still work.</p>}
      <div className="live-actions"><button className="button secondary" disabled={!analysis.exact} onClick={() => setSelected(analysis.allWitness)}>Show group for all</button><button className="button ghost" disabled={!analysis.exact} onClick={() => setSelected(analysis.majorityWitness)}>Show majority group</button><button className="button ghost" onClick={() => setSelected([])}>Clear</button></div>
      <div className="live-owner-picker">{analysis.owners.map(owner => <button className={`signer-toggle ${selected.includes(owner) ? 'active' : ''}`} aria-pressed={selected.includes(owner)} title={owner} key={owner} onClick={() => toggle(owner)}>{label(owner)}<small>{short(owner)}{analysis.overlap.includes(owner) ? ' · shared' : ''}</small></button>)}</div>
      <details className="live-details"><summary>Configurations and model limits</summary><p>Balances include native ETH only; ERC20 holdings and assets in external vaults are excluded. A zero balance does not remove a wallet from the threshold calculation. Contract owners may have their own signing policies. Guards can restrict execution, and modules can provide other execution paths. No compromise probability or global security minimum is inferred.</p>
        {snapshot.safes.map((safe, i) => <div key={safe.address}><h3>Safe {i + 1} · v{safe.version}</h3><p className="mono">{safe.address}</p><p>{safe.threshold} of {safe.owners.length} · Nonce {safe.nonce} · {safe.modules.length}{safe.modulesTruncated ? '+' : ''} modules · {safe.contractOwners.length} contract owners · Guard {/^0x0+$/.test(safe.guard) ? 'none' : short(safe.guard)}</p><p>Exact native balance: {formatEther(safe.balanceRaw)} ETH</p>{safe.owners.map(owner => <p key={owner} className="mono">{label(owner)}: {owner}</p>)}</div>)}
        <p className="mono">Pinned block: {snapshot.blockHash}</p></details>
    </aside></section>
  </main>;
}
