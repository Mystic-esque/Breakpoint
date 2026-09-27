'use client';
import { useEffect, useRef, useState } from 'react';
import { isAddress } from 'ethers';
import { LIVE_NETWORKS, type LiveNetwork, type LiveSafeSnapshot } from '../lib/liveSafe';

export function ImportSafeModal({ onClose, onImported, localAddresses = [] }: {
  onClose: () => void; onImported: (snapshot: LiveSafeSnapshot) => void; localAddresses?: string[];
}) {
  const [network, setNetwork] = useState<LiveNetwork>('sepolia');
  const [addresses, setAddresses] = useState(['', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLElement>(null);
  const controller = useRef<AbortController | null>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    root.current?.querySelector<HTMLElement>('select')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { controller.current?.abort(); close.current(); }
      if (event.key !== 'Tab') return;
      const items = [...root.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')];
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { controller.current?.abort(); document.removeEventListener('keydown', keydown); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  const duplicates = new Set(addresses.map(a => a.trim().toLowerCase())).size !== addresses.length;
  const valid = addresses.every(a => isAddress(a.trim())) && !duplicates;
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!valid || busy) return;
    setBusy(true); setError(''); controller.current = new AbortController();
    try {
      const response = await fetch('/api/live-safes', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ network, addresses: addresses.map(a => a.trim()) }), signal: controller.current.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Import failed. Please retry.');
      onImported(data);
    } catch (caught) { if (!controller.current?.signal.aborted) setError(caught instanceof Error ? caught.message : 'Unable to contact the import service.'); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop"><section ref={root} className="workshop-modal import-modal" role="dialog" aria-modal="true" aria-label="Import Live Safes">
    <div className="modal-heading"><div><p className="eyebrow">READ-ONLY DISCOVERY</p><h2>Import Live Safes</h2></div>
      <button className="button ghost" onClick={() => { controller.current?.abort(); onClose(); }}>Close</button></div>
    <p>Compare 2–5 Safe wallets on one network. Discover their shared owners and approval thresholds at a single block.</p>
    <form onSubmit={submit}>
      <label>Network<select aria-label="Import network" disabled={busy} value={network} onChange={e => { setNetwork(e.target.value as LiveNetwork); setError(''); }}>
        {Object.entries(LIVE_NETWORKS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
      <div className="import-addresses">{addresses.map((address, index) => <div key={index}>
        <label>Safe address {index + 1}<input aria-label={`Safe address ${index + 1}`} value={address} placeholder="0x…" autoComplete="off" spellCheck={false} disabled={busy}
          aria-invalid={Boolean(address && !isAddress(address.trim()))} onChange={e => setAddresses(current => current.map((a, i) => i === index ? e.target.value : a))} /></label>
        {addresses.length > 2 && <button type="button" className="button ghost" disabled={busy} aria-label={`Remove address ${index + 1}`} onClick={() => setAddresses(current => current.filter((_, i) => i !== index))}>Remove</button>}
        {address && !isAddress(address.trim()) && <p className="error-text">Enter a valid EVM address, including its 0x prefix.</p>}
      </div>)}</div>
      {duplicates && addresses.every(Boolean) && <p className="error-text">Enter different Safe addresses.</p>}
      <div className="live-actions"><button type="button" className="button secondary" disabled={busy || addresses.length >= 5} onClick={() => setAddresses(current => [...current, ''])}>Add Address</button>
        <button type="button" className="button ghost" disabled={busy} onClick={() => { setNetwork('sepolia'); setAddresses(['0x6e6dca4c188d33d643d44201189cc64576bd0c82', '0x01b0e211d4cb0615c5f5e8f83446bbcaeddc81c2']); setError(''); }}>Load Sepolia examples</button>
        <button type="button" className="button ghost" disabled={busy || localAddresses.length < 2} onClick={() => { setNetwork('local'); setAddresses(localAddresses.slice(0, 3)); setError(''); }}>Load local demo Safes</button></div>
      <p className="live-note">Native ETH balances only. This maps Safe owner thresholds; it does not discover which external vaults a Safe controls. Public networks use free RPC endpoints and may rate-limit requests. Local demo Safes hold no ETH by default; their vaults hold the DemoUSD.</p>
      <p className="live-note">Sepolia examples are existing public test wallets, read afresh on import. They may have zero ETH and no shared owners. Use the local preset to demonstrate shared owners.</p>
      {error && <p className="error-text" role="alert">{error}</p>}
      {busy && <p role="status">Reading contract identity, owners, thresholds and balances from the selected chain…</p>}
      <button className="button primary" type="submit" disabled={!valid || busy}>{busy ? 'Fetching configuration…' : 'Fetch & Map Architecture'}</button>
    </form>
  </section></div>;
}
