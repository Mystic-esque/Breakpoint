"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { analyzeCoalitions, evaluateCoalition } from "@breakpoint/core";
import { Background, Controls, MarkerType, Position as FlowPosition, ReactFlow, type Edge, type Node } from "@xyflow/react";
import { interpretProposal, interpretResult, REVIEW_QUESTIONS, type ReviewQuestion } from "../lib/review";
import { ImportSafeModal } from "./ImportSafeModal";
import { LiveSafeView } from "./LiveSafeView";
import type { LiveSafeSnapshot } from "../lib/liveSafe";

type Position = {
  id: string; label: string; token: string; amountRaw: string; currentAmountRaw: string;
  vaultAddress: string; withdrawalsPaused: boolean; ownerLabels: Record<string, string>;
  controller: { address: string; owners: string[]; threshold: number;
    supportStatus: "supported" | "incomplete" | "unsupported"; unsupportedReasons: string[] };
};
type Snapshot = {
  runId: string; chainId: number; blockNumber: string; blockHash: string;
  token: { address: string; symbol: string; decimals: number };
  positions: Position[]; selectedCoalition: string[];
  analysis: ReturnType<typeof analyzeCoalitions>;
};
type Evidence = {
  operationId: string; kind: string; positionId?: string; method: string; txHash?: string;
  blockNumber?: string; outerStatus: string; safeExecutionStatus?: string;
  observedOutcome: string; error?: string; requestedSignerLabels?: string[]; signingSignerLabels?: string[];
  before?: Record<string, unknown>; after?: Record<string, unknown>;
};
type Stage = "offline" | "ready" | "paused" | "patched" | "replayed";
type ScenarioResult = { status: { stage: Stage }; snapshot: Snapshot;
  evidence?: Evidence[]; sessionToken?: string };
type Focus = { kind: "position" | "safe" | "signer"; id: string } | null;
type Proposal = { positionId: string; ownerLabels: string[]; threshold: number };
type LocalConfig = { id: "atlas" | "harbor" | "grove"; label: string; amountUnits: number;
  owners: string[]; threshold: number };
type SavedReview = { id: string; name: string; savedAt: string; snapshot: Snapshot;
  stage: Stage; evidence: Evidence[]; includedIds: string[]; selectedSigners: string[]; note: string;
  schemaVersion: 2; question?: ReviewQuestion; keyBudget: number; baseline: Baseline | null; lastRun: RehearsalRecord | null; proposals: Proposal[] };
type RehearsalRecord = { operationId: string; snapshot: Snapshot; positionIds: string[]; signerAddresses: string[];
  affectedPositionIds: string[]; evidence: Evidence[] };
type Baseline = { run: RehearsalRecord; minimum: number | null };
const REFERENCE_CONFIG: LocalConfig[] = [
  { id: "atlas", label: "Atlas", amountUnits: 40_000, owners: ["A", "B", "C"], threshold: 2 },
  { id: "harbor", label: "Harbor", amountUnits: 35_000, owners: ["A", "B", "D"], threshold: 2 },
  { id: "grove", label: "Grove", amountUnits: 25_000, owners: ["A", "B", "E"], threshold: 2 }
];

const STEPS = [
  { title: "Separate vaults. Shared control?", body: "A vault holds tokens. Spreading holdings across vaults may still leave their withdrawals dependent on the same signer addresses." },
  { title: "Who can stop withdrawals?", body: "Each vault gives pause permission to a Safe: a wallet with several owners. Its threshold is the number of owner approvals required." },
  { title: "Follow the shared addresses", body: "A signer is an address that can approve a Safe transaction. An address may own several Safes; different addresses may belong to one person." },
  { title: "Understand the shared control", body: "A highlighted Safe has enough approvals from the selected group to pause withdrawals. The rehearsal checks this prediction on the local chain." }
];
const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
const units = (raw: string, decimals = 6) => new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0
}).format(Number(BigInt(raw) / 10n ** BigInt(decimals)));
const pct = (basisPoints: number | null) => basisPoints === null ? "N/A" : `${basisPoints / 100}%`;

function Dialog({ label, onClose, children, className = "" }: { label: string; onClose: () => void;
  children: ReactNode; className?: string }) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector<HTMLElement>("[data-dialog-focus]")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [data-dialog-focus], [tabindex]:not([tabindex='-1'])")];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" role="presentation"><section ref={dialogRef} className={`workshop-modal ${className}`} role="dialog" aria-modal="true" aria-label={label}>
    {children}</section></div>;
}

export function Workbench() {
  const [showImport, setShowImport] = useState(false);
  const [liveSnapshot, setLiveSnapshot] = useState<LiveSafeSnapshot | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [stage, setStage] = useState<Stage>("offline");
  const [sessionToken, setSessionToken] = useState("");
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [busy, setBusy] = useState("Preparing local scenario");
  const [progressEvents, setProgressEvents] = useState<Evidence[]>([]);
  const [error, setError] = useState("");
  const [reveal, setReveal] = useState(0);
  const [view, setView] = useState<"graph" | "table">("graph");
  const [selectedSigners, setSelectedSigners] = useState<string[]>([]);
  const [keyBudget, setKeyBudget] = useState(2);
  const [lastRun, setLastRun] = useState<RehearsalRecord | null>(null);
  const [inspectorTab, setInspectorTab] = useState<"explore" | "change" | "results">("explore");
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [presentation, setPresentation] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [includedIds, setIncludedIds] = useState<string[]>([]);
  const [focus, setFocus] = useState<Focus>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [savedProposals, setSavedProposals] = useState<Proposal[]>([]);
  const [builder, setBuilder] = useState<LocalConfig[] | null>(null);
  const [savedReviews, setSavedReviews] = useState<SavedReview[]>([]);
  const [showReviews, setShowReviews] = useState(false);
  const [openReview, setOpenReview] = useState<SavedReview | null>(null);
  const [reviewName, setReviewName] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [showIntro, setShowIntro] = useState(true);
  const [introPage, setIntroPage] = useState<"learn" | "choose">("learn");
  const [question, setQuestion] = useState<ReviewQuestion>("shared");
  const [introQuestion, setIntroQuestion] = useState<ReviewQuestion>("shared");

  const accept = useCallback((result: ScenarioResult, resetView = false) => {
    setSnapshot(result.snapshot);
    setStage(result.status.stage);
    if (result.sessionToken) setSessionToken(result.sessionToken);
    if (result.evidence) setEvidence(result.evidence);
    if (resetView) {
      setIncludedIds(result.snapshot.positions.map((position) => position.id));
      const discovered = analyzeCoalitions(result.snapshot.positions);
      setSelectedSigners(discovered.witnessesByKeyBudget[String(Math.min(2, discovered.signerUniverse.length))]?.signerAddresses ?? []);
      setKeyBudget(2);
      setReveal(0);
      setFocus(null);
      setProposal(null);
      setBaseline(null);
      setLastRun(null);
      setInspectorTab("explore");
    }
    setError("");
  }, []);

  useEffect(() => {
    try { setShowIntro(sessionStorage.getItem("breakpoint-introduction-v1") !== "seen"); } catch { /* The guide remains usable without storage. */ }
    try { setSavedReviews(JSON.parse(localStorage.getItem("breakpoint-reviews-v2") ?? "[]")); }
    catch { setSavedReviews([]); }
    try { setSavedProposals(JSON.parse(localStorage.getItem("breakpoint-proposals-v1") ?? "[]")); }
    catch { setSavedProposals([]); }
    const controller = new AbortController();
    fetch("/api/scenario/start", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ operationId: crypto.randomUUID() }), signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Unable to start local scenario");
        accept(result, true);
      })
      .catch((caught) => { if (caught.name !== "AbortError") setError(caught.message); })
      .finally(() => setBusy(""));
    return () => controller.abort();
  }, [accept]);

  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const mutate = useCallback(async (action: string, body: Record<string, unknown>, fresh = false) => {
    if (!snapshot) return false;
    setBusy(action === "reset" ? "Creating a fresh local run" : "Confirming Safe transactions and checking vault state");
    setProgressEvents([]);
    setError("");
    const operationId = crypto.randomUUID();
    let polling = true;
    const poll = async () => {
      try {
        const response = await fetch("/api/scenario/evidence", { cache: "no-store" });
        if (!response.ok || !polling) return;
        const events = await response.json() as Evidence[];
        setProgressEvents(events.filter((event) => event.operationId === operationId ||
          event.operationId.startsWith(`${operationId}:`)));
      } catch { /* The final mutation response remains authoritative if a progress read fails. */ }
    };
    const timer = window.setInterval(poll, 900);
    try {
      const response = await fetch(`/api/scenario/${action}`, {
        method: "POST", headers: { "content-type": "application/json", "x-breakpoint-session": sessionToken },
        body: JSON.stringify({ ...body, operationId })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Scenario action failed");
      accept(result, fresh);
      return { ...result, operationId } as ScenarioResult & { operationId: string };
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return null;
    } finally { polling = false; window.clearInterval(timer); setBusy(""); setProgressEvents([]); }
  }, [accept, sessionToken, snapshot]);

  const included = useMemo(() => snapshot?.positions.filter((position) => includedIds.includes(position.id)) ?? [], [snapshot, includedIds]);
  const analysis = useMemo(() => analyzeCoalitions(included), [included]);
  const finding = useMemo(() => evaluateCoalition(included, selectedSigners), [included, selectedSigners]);
  const allSigners = useMemo(() => Object.keys(snapshot?.positions[0]?.ownerLabels ?? {})
    .sort((left, right) => (snapshot?.positions[0]?.ownerLabels[left] ?? left).localeCompare(snapshot?.positions[0]?.ownerLabels[right] ?? right)), [snapshot]);
  const ownerLabels = snapshot?.positions[0]?.ownerLabels ?? {};
  const selectedLabels = selectedSigners.map((address) => ownerLabels[address] ?? short(address)).sort();
  const selectedTitle = selectedLabels.length ? selectedLabels.join(" + ") : "No keys selected";
  const affected = new Set(finding.affectedPositionIds);
  const budgetKey = String(Math.min(keyBudget, analysis.signerUniverse.length));
  const maxAmount = analysis.maxExposureRawByKeyBudget[budgetKey];
  const smallestWitnessBudget = Object.keys(analysis.witnessesByKeyBudget).map(Number)
    .filter((size) => size > 0 && size <= Number(budgetKey) && analysis.maxExposureRawByKeyBudget[String(size)] === maxAmount)
    .sort((left, right) => left - right)[0];
  const maxGroup = analysis.witnessesByKeyBudget[String(smallestWitnessBudget ?? budgetKey)];
  useEffect(() => {
    if (question === "shared") setSelectedSigners(maxGroup?.signerAddresses ?? []);
  }, [question, maxGroup]);
  const dismissIntro = () => {
    setShowIntro(false);
    setIntroPage("learn");
    try { sessionStorage.setItem("breakpoint-introduction-v1", "seen"); } catch { /* Optional preference. */ }
  };
  const chooseQuestion = (guided: boolean) => {
    setQuestion(introQuestion);
    setReveal(guided && introQuestion === "shared" ? 0 : 3);
    if (introQuestion === "shared") setSelectedSigners(maxGroup?.signerAddresses ?? []);
    if (introQuestion === "specific") setSelectedSigners([]);
    if (introQuestion === "change" && snapshot && stage === "ready") {
      openProposal(included[0] ?? snapshot.positions[0]); setInspectorTab("change");
    } else setInspectorTab(introQuestion === "change" ? "results" : "explore");
    dismissIntro();
  };
  useEffect(() => { document.getElementById("intro-title")?.focus(); }, [introPage]);
  const comparisonPositions = baseline ? snapshot?.positions.filter((position) => baseline.run.positionIds.includes(position.id)) ?? [] : [];
  const comparisonFinding = baseline ? evaluateCoalition(comparisonPositions, baseline.run.signerAddresses) : null;
  const comparisonAnalysis = baseline ? analyzeCoalitions(comparisonPositions) : null;
  const proposalTarget = snapshot?.positions.find((position) => position.id === proposal?.positionId);
  const proposalChanged = Boolean(proposal && proposalTarget &&
    (proposal.threshold !== proposalTarget.controller.threshold ||
      proposal.ownerLabels.slice().sort().join() !== proposalTarget.controller.owners.map((address) => ownerLabels[address]).sort().join()));
  const preview = useMemo(() => {
    if (!proposal || !snapshot) return null;
    const target = snapshot.positions.find((position) => position.id === proposal.positionId);
    if (!target || proposal.ownerLabels.length !== 3 || proposal.threshold < 1 || proposal.threshold > 3) return null;
    const owners = proposal.ownerLabels.map((label) => {
      const entry = Object.entries(ownerLabels).find(([, value]) => value === label);
      return entry?.[0] ?? "";
    });
    if (owners.some((owner) => !owner)) return null;
    const changed = included.map((position) => position.id === target.id ? {
      ...position, controller: { ...position.controller, owners, threshold: proposal.threshold }
    } : position);
    return { finding: evaluateCoalition(changed, selectedSigners), analysis: analyzeCoalitions(changed) };
  }, [proposal, snapshot, included, ownerLabels, selectedSigners]);

  const graph = useMemo(() => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    included.forEach((position, index) => {
      const y = index * 150;
      nodes.push({ id: `vault-${position.id}`, position: { x: 0, y }, draggable: false,
        sourcePosition: FlowPosition.Right, targetPosition: FlowPosition.Left,
        data: { label: `${position.label}  ${units(position.amountRaw, snapshot?.token.decimals)} ${snapshot?.token.symbol}` },
        className: `graph-node vault-node ${affected.has(position.id) ? "is-affected" : ""}` });
      if (reveal < 1) return;
      const approvals = position.controller.owners.filter((owner) => selectedSigners.includes(owner)).length;
      nodes.push({ id: `safe-${position.id}`, position: { x: 300, y }, draggable: false,
        sourcePosition: FlowPosition.Right, targetPosition: FlowPosition.Left,
        data: { label: reveal >= 3 ? `Safe ${approvals}/${position.controller.threshold} approvals`
          : `Safe · ${position.controller.threshold} approvals needed` },
        className: `graph-node safe-node ${reveal >= 3 && affected.has(position.id) ? "is-affected" : ""}` });
      edges.push({ id: `vault-safe-${position.id}`, source: `vault-${position.id}`, target: `safe-${position.id}`,
        markerEnd: { type: MarkerType.ArrowClosed }, className: affected.has(position.id) && reveal === 3 ? "edge-affected" : "" });
    });
    if (reveal >= 2) {
      allSigners.forEach((address, index) => nodes.push({
        id: `signer-${address}`, position: { x: 600, y: index * 78 - 42 }, draggable: false,
        sourcePosition: FlowPosition.Right, targetPosition: FlowPosition.Left,
        data: { label: `${ownerLabels[address] ?? "?"}  ${short(address)}` },
        className: `graph-node signer-node ${selectedSigners.includes(address) ? "is-selected" : ""}`
      }));
      included.forEach((position) => position.controller.owners.forEach((address) => edges.push({
        id: `safe-${position.id}-${address}`, source: `safe-${position.id}`, target: `signer-${address}`,
        markerEnd: { type: MarkerType.ArrowClosed },
        className: reveal === 3 && selectedSigners.includes(address) && affected.has(position.id) ? "edge-selected" : ""
      })));
    }
    return { nodes, edges };
  }, [included, reveal, allSigners, ownerLabels, selectedSigners, finding, snapshot]);

  const toggleSigner = (address: string) => {
    if (busy) return;
    setQuestion("specific");
    setSelectedSigners((current) => current.includes(address)
      ? current.filter((candidate) => candidate !== address) : [...current, address]);
  };
  const togglePosition = (id: string) => {
    if (busy) return;
    setIncludedIds((current) => current.includes(id)
      ? current.filter((candidate) => candidate !== id) : [...current, id]);
  };
  const openProposal = (position: Position) => setProposal({ positionId: position.id,
    ownerLabels: position.controller.owners.map((address) => ownerLabels[address]).sort(),
    threshold: position.controller.threshold });
  const openBuilder = () => {
    if (!snapshot) return;
    setBuilder(snapshot.positions.map((position) => ({
      id: position.id as LocalConfig["id"], label: position.label,
      amountUnits: Number(BigInt(position.amountRaw) / 10n ** BigInt(snapshot.token.decimals)),
      owners: position.controller.owners.map((address) => ownerLabels[address]).sort(),
      threshold: position.controller.threshold
    })));
  };
  const updateBuilder = (id: string, update: Partial<LocalConfig>) => setBuilder((current) =>
    current?.map((item) => item.id === id ? { ...item, ...update } : item) ?? null);
  const createScenario = async () => {
    if (!snapshot || !builder) return;
    const success = await mutate("create-scenario", { expectedRunId: snapshot.runId, positions: builder }, true);
    if (success) { setBuilder(null); setBaseline(null); }
  };
  const saveReview = () => {
    if (!snapshot) return;
    const review: SavedReview = { id: crypto.randomUUID(), name: reviewName.trim() || `Review ${new Date().toLocaleString()}`,
      savedAt: new Date().toISOString(), snapshot, stage, evidence, includedIds, selectedSigners,
      note: reviewNote.trim(), schemaVersion: 2, question, keyBudget, baseline, lastRun, proposals: savedProposals };
    const updated = [review, ...savedReviews];
    localStorage.setItem("breakpoint-reviews-v2", JSON.stringify(updated));
    setSavedReviews(updated);
    setShowReviews(true);
  };
  const saveProposal = () => {
    if (!proposal || !preview) return;
    const updated = [proposal, ...savedProposals.filter((item) => item.positionId !== proposal.positionId ||
      item.threshold !== proposal.threshold || item.ownerLabels.slice().sort().join() !== proposal.ownerLabels.slice().sort().join())];
    localStorage.setItem("breakpoint-proposals-v1", JSON.stringify(updated));
    setSavedProposals(updated);
  };
  const reset = async (preserveComparison = false) => {
    if (!snapshot) return;
    const previous: Baseline | null = lastRun ? { run: lastRun,
      minimum: analyzeCoalitions(lastRun.snapshot.positions.filter((position) => lastRun.positionIds.includes(position.id))).minimumKeysForAll } : null;
    const success = await mutate("reset", { expectedRunId: snapshot.runId }, true);
    if (success && preserveComparison && previous) {
      setQuestion("change");
      setSelectedSigners(previous.run.signerAddresses);
      setBaseline(previous);
      setReveal(3);
      setInspectorTab("change");
    }
  };
  const rehearse = async () => {
    if (!snapshot || !selectedSigners.length || !includedIds.length) return;
    const requestedPositions = [...includedIds];
    const requestedSigners = [...selectedSigners];
    const predicted = evaluateCoalition(snapshot.positions.filter((position) => requestedPositions.includes(position.id)), requestedSigners);
    const result = await mutate("rehearse", { expectedRunId: snapshot.runId, snapshotBlockHash: snapshot.blockHash,
      signerLabels: selectedLabels, positionIds: requestedPositions });
    if (result) {
      setLastRun({ operationId: result.operationId, snapshot: result.snapshot,
        positionIds: requestedPositions, signerAddresses: requestedSigners,
        affectedPositionIds: predicted.affectedPositionIds,
        evidence: (result.evidence ?? []).filter((event) => event.operationId === result.operationId) });
      setInspectorTab("results");
    }
  };
  const apply = async () => {
    if (!snapshot || !proposal || !preview || !proposalChanged) return;
    setQuestion("change");
    const success = await mutate("apply-configuration", { expectedRunId: snapshot.runId,
      snapshotBlockHash: snapshot.blockHash, ...proposal });
    if (success) { setProposal(null); setInspectorTab("results"); }
  };
  const exportEvidence = async () => {
    if (!snapshot) return;
    setBusy("Preparing evidence bundle");
    try {
      const response = await fetch("/api/scenario/export", { method: "POST", headers: {
        "content-type": "application/json", "x-breakpoint-session": sessionToken
      }, body: JSON.stringify({ expectedRunId: snapshot.runId, snapshotBlockHash: snapshot.blockHash }) });
      const bundle = await response.json();
      if (!response.ok) throw new Error(bundle.error ?? "Export failed");
      const canonical = JSON.parse(bundle.json) as { snapshot: Snapshot; evidence: Evidence[] };
      if (canonical.snapshot.runId !== snapshot.runId || canonical.snapshot.blockHash !== snapshot.blockHash) {
        throw new Error("Export no longer matches this review; reload the local scenario");
      }
      const download = (name: string, value: string, type: string) => {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(new Blob([value], { type }));
        link.download = name; link.click();
        window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      };
      {
        const selectedPositions = canonical.snapshot.positions.filter((position) => includedIds.includes(position.id));
        const exportedFinding = evaluateCoalition(selectedPositions, selectedSigners);
        const exportedAnalysis = analyzeCoalitions(selectedPositions);
        const names = exportedFinding.affectedPositionIds.map((id) => canonical.snapshot.positions.find((position) => position.id === id)?.label ?? id);
        const baselineAmount = baseline ? baseline.run.snapshot.positions.filter((position) => baseline.run.affectedPositionIds.includes(position.id))
          .reduce((sum, position) => sum + BigInt(position.amountRaw), 0n).toString() : null;
        const recordedInterpretation = lastRun ? lastRun.snapshot.positions.filter((position) => lastRun.positionIds.includes(position.id)).map((position) => {
          const result = interpretResult(lastRun.affectedPositionIds.includes(position.id), position.withdrawalsPaused,
            lastRun.evidence.find((event) => event.kind === "pause" && event.positionId === position.id),
            lastRun.evidence.find((event) => event.kind === "withdrawal-probe" && event.positionId === position.id));
          return `- ${position.label}: ${result.status}; ${result.authorization}; pause flag ${position.withdrawalsPaused ? "on" : "off"}; ${result.withdrawal}.`;
        }) : ["No rehearsal record is retained in this review."];
        const brief = ["# BREAKPOINT control review", "", `Run: ${snapshot.runId} · local chain ${snapshot.chainId} · block ${snapshot.blockNumber}`,
          `Snapshot: ${snapshot.blockHash}`, "", "## Decision summary", "",
          `Review question: ${REVIEW_QUESTIONS[question].title}.`,
          "Objective: examine dependence on a small signer group while keeping legitimate emergency response practical. Pausing can protect during an emergency and also prevents withdrawals; availability alone is not proof of safety.",
          `Selected positions: ${selectedPositions.map((position) => position.label).join(", ") || "None"}`,
          `Selected signer addresses: ${selectedSigners.map((address) => `${ownerLabels[address]} (${address})`).join(", ") || "None"}`,
          `This group can authorize a withdrawal pause for: ${names.join(", ") || "none of the selected positions"}.`,
          `Selected group exposure: ${units(exportedFinding.affectedAmountRaw, snapshot.token.decimals)} ${snapshot.token.symbol} of demo tokens.`,
          `Strongest group of up to ${keyBudget} keys: ${units(exportedAnalysis.maxExposureRawByKeyBudget[String(Math.min(keyBudget, exportedAnalysis.signerUniverse.length))] ?? "0", snapshot.token.decimals)} ${snapshot.token.symbol}.`,
          `Minimum signer keys for all selected positions: ${exportedAnalysis.minimumKeysForAll ?? "unknown"}.`,
          baselineAmount ? `Before/after exposure for the recorded baseline group and positions: ${units(baselineAmount, snapshot.token.decimals)} → ${units(comparisonFinding?.affectedAmountRaw ?? "0", snapshot.token.decimals)} ${snapshot.token.symbol}.` : "No before/after comparison retained in this review.",
          "", "## Review note", "", reviewNote.trim() || "No reviewer note entered.", "",
          "## Interpreting the recorded rehearsal", "", ...recordedInterpretation,
          "A matched pause result verifies the predicted authority for this local run. A pause-state observation is not itself a withdrawal transaction test. Inconclusive results require further evidence.", "",
          "## Observed events", "", ...(baseline ? [`Previous run ${baseline.run.snapshot.runId}:`, ...baseline.run.evidence.map((event) => `- ${event.kind} ${event.positionId ?? ""}: ${event.observedOutcome} ${event.txHash ?? ""}`), "", "Current run:"] : []),
          ...canonical.evidence.map((event) => `- ${event.kind} ${event.positionId ?? ""}: ${event.observedOutcome} ${event.txHash ?? ""}`),
          "", "## Scope", "", "This is a local, supported-model rehearsal of withdrawal-pause authority—not a safety certification, theft prediction, or identity attribution.",
          "The accompanying canonical evidence JSON and Markdown contain detailed receipts and assumptions."
        ].join("\n");
        const review = { schemaVersion: 2, kind: "breakpoint-local-review", canonicalEvidence: canonical,
          canonicalEvidenceSha256: bundle.sha256, selectedPositionIds: [...includedIds], selectedSignerAddresses: [...selectedSigners],
          question, keyBudget, note: reviewNote.trim(), baseline, lastRun, proposals: savedProposals, decisionBrief: brief };
        download(`breakpoint-${snapshot.runId}-review.json`, JSON.stringify(review, null, 2), "application/json");
        window.setTimeout(() => download(`breakpoint-${snapshot.runId}-decision-brief.md`, `${brief}\n\n---\n\n${bundle.markdown}`, "text/markdown"), 120);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(""); }
  };
  const exportSavedReview = (review: SavedReview) => {
    const positions = review.snapshot.positions.filter((position) => review.includedIds.includes(position.id));
    const measured = evaluateCoalition(positions, review.selectedSigners);
    const markdown = [`# ${review.name}`, "", `Saved ${review.savedAt}`, `Local run ${review.snapshot.runId} at block ${review.snapshot.blockNumber}`,
      `Positions: ${positions.map((position) => position.label).join(", ") || "None"}`,
      `Selected signer addresses: ${review.selectedSigners.join(", ") || "None"}`,
      `Pauseable demo amount at saved snapshot: ${units(measured.affectedAmountRaw, review.snapshot.token.decimals)} ${review.snapshot.token.symbol}`,
      `Note: ${review.note || "None"}`, "", "## Recorded events", "",
      ...review.evidence.map((event) => `- ${event.positionId ?? event.kind}: ${event.observedOutcome} ${event.txHash ?? ""}`),
      "", "This is a saved local review, not a fresh chain verification."].join("\n");
    const archive = { ...review, decisionBrief: markdown };
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([JSON.stringify(archive, null, 2)], { type: "application/json" }));
    link.download = `breakpoint-saved-${review.id}.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  const importDialog = showImport ? <ImportSafeModal onClose={() => setShowImport(false)}
    localAddresses={snapshot?.positions.map(position => position.controller.address)}
    onImported={result => { setLiveSnapshot(result); setShowImport(false); setShowIntro(false); }} /> : null;
  if (liveSnapshot) return <><LiveSafeView key={`${liveSnapshot.chainId}-${liveSnapshot.blockHash}-${liveSnapshot.observedAt}`} snapshot={liveSnapshot}
    onBack={() => setLiveSnapshot(null)} onImport={() => setShowImport(true)} />{importDialog}</>;

  if (!snapshot) return <main className="boot"><div className="boot-mark">BP</div>
    <p className="eyebrow">LOCAL CONTROL REVIEW</p><h1>Preparing the vaults</h1>
    <p>{error || busy}. No wallet or real crypto required.</p>
    {error && <button onClick={() => location.reload()}>Retry connection</button>}
    <button onClick={() => setShowImport(true)}>Import Live Safes</button>{importDialog}</main>;

  const focusPosition = focus && focus.kind !== "signer" ? snapshot.positions.find((position) => position.id === focus.id) : null;
  const focusSigner = focus?.kind === "signer" ? focus.id : null;
  const archivedPositions = openReview?.snapshot.positions.filter((position) => openReview.includedIds.includes(position.id)) ?? [];
  const archivedAnalysis = analyzeCoalitions(archivedPositions);
  const archivedFinding = evaluateCoalition(archivedPositions, openReview?.selectedSigners ?? []);
  const outcomes = lastRun?.snapshot.positions.filter((position) => lastRun.positionIds.includes(position.id)).map((position) => ({
    position, expected: lastRun.affectedPositionIds.includes(position.id),
    ...interpretResult(lastRun.affectedPositionIds.includes(position.id), position.withdrawalsPaused,
      lastRun.evidence.find((event) => event.kind === "pause" && event.positionId === position.id),
      lastRun.evidence.find((event) => event.kind === "withdrawal-probe" && event.positionId === position.id))
  })) ?? [];
  const matched = outcomes.filter((result) => result.status === "matched").length;
  const inconclusive = outcomes.filter((result) => result.status === "inconclusive").length;
  const explorationChanged = Boolean(lastRun && (lastRun.signerAddresses.slice().sort().join() !== selectedSigners.slice().sort().join()
    || lastRun.positionIds.slice().sort().join() !== includedIds.slice().sort().join()));
  const stageText = stage === "paused" ? "Baseline rehearsal complete" : stage === "patched" ? "Change applied and rediscovered" :
    stage === "replayed" ? "Replay verified" : "Ready to investigate";

  return <main className={`shell ${presentation ? "presentation" : ""}`}>
    <header className="topbar">
      <div className="brand"><span className="brand-glyph">BP</span><div><strong>BREAKPOINT</strong><span>Control review workbench</span></div></div>
      <div className="chain-strip" aria-label="Local chain status"><span className="status-dot" />LOCAL CHAIN <span>31337</span><span className="mono">BLOCK {snapshot.blockNumber}</span></div>
      <div className="top-actions"><button className="button ghost" onClick={() => setPresentation((current) => !current)} aria-pressed={presentation}>{presentation ? "Exit presentation" : "Present"}</button>
        <button className="button ghost" onClick={openBuilder} disabled={Boolean(busy)}>Build scenario</button>
        <button className="button ghost" onClick={() => { setShowIntro(false); setShowImport(true); }} disabled={Boolean(busy)}>Import Live Safes</button>
        <button className="button ghost" onClick={() => setShowReviews(true)} disabled={Boolean(busy)}>Saved reviews{savedReviews.length ? ` (${savedReviews.length})` : ""}</button>
        <button className="button ghost" onClick={() => reset()} disabled={Boolean(busy)}>Reset</button>
        <button className="button ghost" onClick={exportEvidence} disabled={Boolean(busy)}>Export evidence</button></div>
    </header>
    <div className="journey" aria-label="Review progress">
      <span className="journey-status">{stageText}</span>
      <button disabled={Boolean(busy)} onClick={() => setReveal(0)}>1 · Trace control</button><button disabled={Boolean(busy)} onClick={() => { setReveal(3); setInspectorTab("explore"); }}>2 · Choose signers</button>
      <button disabled={Boolean(busy)} onClick={() => { setReveal(3); setInspectorTab(stage === "ready" ? "explore" : "results"); }}>3 · Rehearse</button>
      <button disabled={Boolean(busy)} onClick={() => setInspectorTab(stage === "ready" ? "change" : "results")}>4 · Improve & verify</button>
      <button disabled={Boolean(busy)} onClick={() => { setIntroQuestion(question); setShowIntro(true); }}>Guide & terms</button>
    </div>
    <section className={`workspace ${railCollapsed ? "rail-collapsed" : ""} ${inspectorTab === "change" ? "changing" : ""}`}>
      <aside className={`position-rail ${railCollapsed ? "collapsed" : ""}`} aria-label="Selected positions">
        <button className="button ghost rail-toggle" onClick={() => setRailCollapsed((current) => !current)} aria-expanded={!railCollapsed}
          aria-label={railCollapsed ? "Expand positions" : "Collapse positions"}>{railCollapsed ? "☰" : "Collapse positions"}</button>
        <div className="section-heading"><span>POSITIONS IN THIS REVIEW</span><span className="count">{included.length}/{snapshot.positions.length}</span></div>
        {!railCollapsed && <>
        <p className="rail-help">Choose the vaults to include. Amounts are demo tokens, not money at risk.</p>
        {snapshot.positions.map((position) => <div className={`position-card ${includedIds.includes(position.id) ? "selected" : ""}`} key={position.id}>
          <label className="position-choice"><input type="checkbox" checked={includedIds.includes(position.id)} disabled={Boolean(busy)}
            onChange={() => togglePosition(position.id)} aria-label={`Include ${position.label}`} />
            <strong>{position.label}</strong><span className={position.withdrawalsPaused ? "state danger" : "state"}>{position.withdrawalsPaused ? "PAUSED" : "AVAILABLE"}</span></label>
          <span className="amount">{units(position.amountRaw, snapshot.token.decimals)} <small>{snapshot.token.symbol}</small></span>
          {position.currentAmountRaw !== position.amountRaw && <span className="current-amount">After withdrawal check: {units(position.currentAmountRaw, snapshot.token.decimals)} {snapshot.token.symbol}</span>}
          <button className="text-button" disabled={Boolean(busy)} onClick={() => setFocus({ kind: "position", id: position.id })}>Inspect vault and Safe →</button>
        </div>)}
        <details className="scope-note"><summary>Is paused good or bad?</summary><p>A pause can protect during an emergency, but prevents withdrawals. AVAILABLE means the pause flag is off; check Results to see whether a withdrawal was actually tested. Neither state certifies safety.</p>
          <p>These are demo tokens on a local blockchain. This review covers withdrawal-pause authority in the supported Safe model.</p></details></>}
      </aside>

      <section className="canvas-panel" aria-label="Control map">
        <div className="canvas-toolbar"><div><p className="eyebrow">AUTHORITY MAP · BLOCK {snapshot.blockNumber}</p>
          <h1>{reveal < 3 ? STEPS[reveal].title : "See who can pause withdrawals"}</h1></div>
          <div className="segmented" role="group" aria-label="Map view"><button aria-pressed={view === "graph"} onClick={() => setView("graph")}>Graph</button>
            <button aria-pressed={view === "table"} onClick={() => setView("table")}>Table</button></div></div>
        <div className="discovery-card" data-testid="discovery"><span className="discovery-step">STEP {Math.min(reveal + 1, 4)} OF 4</span>
          <p>{reveal < 3 ? STEPS[reveal].body : question === "shared"
            ? `What is the largest amount a group of up to ${keyBudget} signer ${keyBudget === 1 ? "address" : "addresses"} can pause? The selected group is computed from the current owners and thresholds.`
            : question === "change" ? "Can a different Safe configuration reduce shared pause authority while keeping emergency approvals practical? Preview the change, then verify its effects."
            : "Which vaults can your chosen addresses pause together? Click signer keys to explore; rehearse to check the prediction."}</p><div className="discovery-actions">
            {reveal > 0 && <button className="button ghost" disabled={Boolean(busy)} onClick={() => setReveal(reveal - 1)}>Previous</button>}
            {reveal < 3 ? <button className="button primary" disabled={Boolean(busy)} onClick={() => setReveal(reveal + 1)} data-testid="trace-next">{reveal === 0 ? "Trace withdrawal control" : reveal === 1 ? "Show Safe owners" : "Explore signer groups"}</button>
              : <button className="button secondary" disabled={Boolean(busy)} onClick={() => setReveal(0)}>Replay the reveal</button>}
            {reveal < 3 && <button className="button ghost" disabled={Boolean(busy)} onClick={() => setReveal(3)}>Show complete map</button>}
          </div></div>
        {view === "graph" ? <div className="graph-wrap" data-testid="control-graph"><div className="graph-labels" aria-hidden="true"><span>VAULTS</span><span>SAFE CONTROLLERS</span><span>SIGNER KEYS</span></div>
          <ReactFlow key={`${reveal}-${includedIds.join("-")}-${presentation}-${viewportWidth}-${railCollapsed}-${inspectorTab}`} nodes={graph.nodes} edges={graph.edges} fitView fitViewOptions={{ padding: .1 }}
            nodesConnectable={false} nodesDraggable={false} onNodeClick={(_, node) => {
              if (busy) return;
              const [kind, ...id] = node.id.split("-");
              if (kind === "signer") { toggleSigner(id.join("-")); setFocus({ kind: "signer", id: id.join("-") }); }
              else setFocus({ kind: kind === "safe" ? "safe" : "position", id: id.join("-") });
            }}><Background color="#23313d" gap={28} size={1} /><Controls showInteractive={false} /></ReactFlow>
        </div> : <div className="control-table" data-testid="control-table"><table><thead><tr><th>Vault</th><th>Safe</th><th>Owners</th><th>Your approvals</th><th>Result</th></tr></thead><tbody>
          {included.map((position) => { const approvals = position.controller.owners.filter((owner) => selectedSigners.includes(owner)).length;
            return <tr key={position.id}><td>{position.label}</td><td className="mono">{reveal >= 1 ? short(position.controller.address) : "Reveal controller"}</td>
              <td>{reveal >= 2 ? position.controller.owners.map((owner) => ownerLabels[owner] ?? short(owner)).join(", ") : "Reveal owners"}</td>
              <td>{reveal >= 3 ? `${approvals} of ${position.controller.threshold} required` : "Explore signers"}</td>
              <td>{reveal >= 3 ? affected.has(position.id) ? "Pause authorized" : "Insufficient approvals" : "Not evaluated yet"}</td></tr>; })}
        </tbody></table></div>}
        <div className="canvas-callout"><span className="coalition-chip">{reveal < 3 ? `STEP ${reveal + 1}` : selectedTitle}</span><p>{reveal < 3 ? STEPS[reveal].body : finding.affectedPositionIds.length === 0
          ? "This group cannot authorize a withdrawal pause for any selected vault."
          : `This group can authorize a withdrawal pause for ${finding.affectedPositionIds.map((id) => snapshot.positions.find((position) => position.id === id)?.label ?? id).join(", ")}.`}</p></div>
      </section>

      <aside className="inspector">
        <div className="section-heading"><span>INVESTIGATION</span><span className="support-mark">{analysis.completeForSupportedModel ? "EXACT MODEL" : "INCOMPLETE"}</span></div>
        {reveal < 3 ? <div className="focus-card"><h2>Follow the control path</h2><p>{STEPS[reveal].body}</p>
          <p><strong>Your objective:</strong> discover whether separate vaults depend on a small shared signer group.</p>
          <p>Follow the next step on the map. BREAKPOINT will calculate an example group for you.</p></div> : <>
          <div className="inspector-tabs" role="tablist" aria-label="Investigation stage">
            {(["explore", "change", "results"] as const).map((tab) => <button key={tab} role="tab" aria-selected={inspectorTab === tab}
              onClick={() => setInspectorTab(tab)}>{tab === "explore" ? "Explore" : tab === "change" ? "Change" : "Results"}</button>)}
          </div>
          <div className="inspector-content">
          {inspectorTab === "explore" && <><p className="rail-help">{question === "shared" ? "Computed example selected. You can change the group size below, or click keys to investigate a different group." : "Click keys to choose a group. It needs enough current owner approvals for each Safe separately."}</p>
            <div className="signer-picker" aria-label="Choose signer keys">{allSigners.map((address) => <button key={address}
              disabled={Boolean(busy)} className={`signer-toggle ${selectedSigners.includes(address) ? "active" : ""}`}
              aria-pressed={selectedSigners.includes(address)} onClick={() => toggleSigner(address)}
              title={address}>{ownerLabels[address] ?? short(address)}<small>{short(address)}</small></button>)}</div>
            <div className="budget-choice"><label>Group size to compare <select aria-label="Key budget" value={keyBudget} disabled={Boolean(busy)} onChange={(event) => setKeyBudget(Number(event.target.value))}>
              {Array.from({ length: allSigners.length }, (_, index) => index + 1).map((value) => <option key={value} value={value}>Up to {value} {value === 1 ? "key" : "keys"}</option>)}</select></label></div>
            <div className="quick-choice"><button className="text-button" disabled={Boolean(busy) || !included.length} onClick={() => { setQuestion("shared"); setSelectedSigners(maxGroup?.signerAddresses ?? []); }}>Find strongest group</button>
              <button className="text-button" disabled={Boolean(busy)} onClick={() => { setQuestion("specific"); setSelectedSigners([]); }}>Clear keys</button></div>
            <p className="authority-copy">{included.length === 0 ? "Select at least one vault to calculate exposure." : question === "shared" && analysis.completeForSupportedModel && BigInt(analysis.maxExposureRawByKeyBudget[budgetKey] ?? "0") === 0n
              ? `No group of up to ${keyBudget} ${keyBudget === 1 ? "key" : "keys"} can authorize a pause for these selected vaults in the supported model.` : selectedSigners.length === 0 ? "Select one or more keys to see which Safe thresholds they satisfy." :
              `${selectedTitle} supplies enough approvals for ${finding.affectedPositionIds.length} of ${included.length} selected vaults.`}</p>
            <div className="metric-grid" data-testid="analysis-metrics"><div><span>AMOUNT THIS GROUP CAN PAUSE</span><strong>{units(finding.affectedAmountRaw, snapshot.token.decimals)} {snapshot.token.symbol}</strong></div>
              <div><span>SHARE OF SELECTED HOLDINGS</span><strong>{pct(finding.coverageBasisPoints)}</strong></div>
              <div><span>MAXIMUM WITH UP TO {keyBudget} {keyBudget === 1 ? "KEY" : "KEYS"}</span><strong>{units(analysis.maxExposureRawByKeyBudget[budgetKey] ?? "0", snapshot.token.decimals)} {snapshot.token.symbol}</strong></div>
              <div><span>MINIMUM KEYS FOR ALL</span><strong>{analysis.minimumKeysForAll === null ? "Unknown" : `${analysis.minimumKeysForAll} keys`}</strong></div></div>
            <details className="learn-more" data-testid="finding-guide"><summary>What should I do with this finding?</summary>
              <p>{included.length === 0 ? "Choose at least one vault first." : finding.affectedPositionIds.length > 1
                ? "These vaults share a control dependency: this group can approve a pause across them. Separate vaults do not necessarily mean separate authority."
                : "This selected group does not span several vaults. Use Find strongest group to check whether another group within your budget reaches further."}</p>
              <p>To reduce dependence on a small group, aim to lower the maximum pauseable amount for the same group size and the same holdings. There is no universal safe percentage.</p>
              <p>More required approvals can make emergency coordination harder. Compare that tradeoff before deciding on a change.</p>
              <p>The percentage describes holdings whose withdrawals this group can pause. It is not a probability of loss. Minimum keys for all counts addresses, not independent people.</p>
              <p><strong>Next:</strong> rehearse this group to check the prediction, then compare a Safe change.</p></details>
            {focus && <div className="focus-card" data-testid="node-inspector"><p className="eyebrow">SELECTED {focus.kind.toUpperCase()}</p>
              {focusSigner ? <><h2>Signer {ownerLabels[focusSigner] ?? short(focusSigner)}</h2><p className="mono">{focusSigner}</p>
                <p>Owns {included.filter((position) => position.controller.owners.includes(focusSigner)).map((position) => position.label).join(", ") || "no selected Safe"}.</p></>
                : focusPosition && <><h2>{focus.kind === "safe" ? `${focusPosition.label} Safe` : focusPosition.label}</h2>
                  <p>{focus.kind === "safe" ? `Requires ${focusPosition.controller.threshold} of ${focusPosition.controller.owners.length} owners. Your group supplies ${focusPosition.controller.owners.filter((owner) => selectedSigners.includes(owner)).length}.` : `Holds ${units(focusPosition.amountRaw, snapshot.token.decimals)} demo ${snapshot.token.symbol}. Its Safe can pause withdrawals.`}</p>
                  <p className="mono">{focus.kind === "safe" ? focusPosition.controller.address : focusPosition.vaultAddress}</p></>}</div>}</>}
          {inspectorTab === "change" && (stage === "ready" ? proposal ? <div className="proposal" data-testid="proposal"><p className="eyebrow">PROPOSED · NOT APPLIED</p>
            <h2>Change a local Safe</h2><label>Vault<select value={proposal.positionId} disabled={Boolean(busy)} onChange={(event) => {
              const position = snapshot.positions.find((candidate) => candidate.id === event.target.value)!; openProposal(position);
            }}>{snapshot.positions.map((position) => <option value={position.id} key={position.id}>{position.label}</option>)}</select></label>
            <p>Current owners: {proposalTarget?.controller.owners.map((address) => ownerLabels[address]).sort().join(" + ")} · {proposalTarget?.controller.threshold} approvals</p>
            <p>Proposed owners · choose exactly three:</p><div className="proposal-owners">{allSigners.map((address) => { const label = ownerLabels[address];
              return <label key={address}><input type="checkbox" disabled={Boolean(busy)} checked={proposal.ownerLabels.includes(label)}
                onChange={() => setProposal({ ...proposal, ownerLabels: proposal.ownerLabels.includes(label)
                  ? proposal.ownerLabels.filter((value) => value !== label) : [...proposal.ownerLabels, label] })} />{label}</label>; })}</div>
            <label>Approvals required<select value={proposal.threshold} disabled={Boolean(busy)} onChange={(event) => setProposal({ ...proposal, threshold: Number(event.target.value) })}>
              {[1, 2, 3].map((value) => <option value={value} key={value}>{value} of 3</option>)}</select></label>
            <button className="text-button" disabled={Boolean(busy)} onClick={() => setProposal({ positionId: "harbor", ownerLabels: ["C", "D", "F"], threshold: 2 })}>Load guided Harbor example</button>
            <div className="proposal-library"><button className="text-button" onClick={saveProposal} disabled={Boolean(busy) || !preview || !proposalChanged}>Save this proposal locally</button>
              {savedProposals.length > 0 && <label>Open a saved proposal<select value="" disabled={Boolean(busy)} onChange={(event) => {
                const item = savedProposals[Number(event.target.value)]; if (item) setProposal(item);
              }}><option value="">Choose proposal</option>{savedProposals.map((item, index) => <option key={`${item.positionId}-${item.threshold}-${item.ownerLabels.join("-")}`} value={index}>
                {snapshot.positions.find((position) => position.id === item.positionId)?.label ?? item.positionId}: {item.ownerLabels.join("+")} · {item.threshold} of 3
              </option>)}</select></label>}</div>
            {preview ? <div className="proposal-delta"><span>Selected group: {units(finding.affectedAmountRaw, snapshot.token.decimals)} → {units(preview.finding.affectedAmountRaw, snapshot.token.decimals)} {snapshot.token.symbol}</span>
              <span>Strongest group of up to {keyBudget}: {units(analysis.maxExposureRawByKeyBudget[budgetKey] ?? "0", snapshot.token.decimals)} → {units(preview.analysis.maxExposureRawByKeyBudget[String(Math.min(keyBudget, preview.analysis.signerUniverse.length))] ?? "0", snapshot.token.decimals)} {snapshot.token.symbol}</span>
              <span>Keys needed for all: {analysis.minimumKeysForAll ?? "?"} → {preview.analysis.minimumKeysForAll ?? "?"}</span>
              <p className="proposal-meaning" data-testid="proposal-meaning">{included.length === 0 ? "Choose positions to compare the effect of this proposal." : interpretProposal(
                analysis.maxExposureRawByKeyBudget[budgetKey] ?? "0",
                preview.analysis.maxExposureRawByKeyBudget[String(Math.min(keyBudget, preview.analysis.signerUniverse.length))] ?? "0",
                analysis.completeForSupportedModel && preview.analysis.completeForSupportedModel)}</p>
              <p>Emergency approvals for this Safe: {proposalTarget?.controller.threshold} → {proposal.threshold}.
                {proposal.threshold > (proposalTarget?.controller.threshold ?? 0) ? " More owners must coordinate; action may be harder or slower."
                  : proposal.threshold < (proposalTarget?.controller.threshold ?? 0) ? " Fewer approvals make emergency action easier, but give smaller groups more authority."
                  : " The approval count stays the same; confirm the proposed owners can coordinate when needed."}</p>
              {!includedIds.includes(proposal.positionId) && <span>This vault is outside the selected review scope; include it to see an exposure change.</span>}</div>
              : <p className="error-text">Choose exactly three owners to preview the result.</p>}
            {!proposalChanged && <p className="action-note">Change an owner or threshold before applying.</p>}</div>
            : <div className="focus-card"><h2>Design a Safe change</h2><p>Choose a vault, adjust its owners or approval threshold, and compare the predicted authority before execution.</p></div>
            : <div className="focus-card"><h2>Change already recorded</h2><p>Reset to a clean local baseline before proposing another Safe configuration.</p></div>)}
          {inspectorTab === "results" && <>
            {outcomes.length > 0 && <div className="result-verdict" data-testid="result-verdict" role="status">
              <strong>{matched === outcomes.length ? `Pause results matched the prediction for all ${outcomes.length} selected vaults.`
                : inconclusive > 0 ? `${inconclusive} vault result${inconclusive === 1 ? " is" : "s are"} inconclusive. Inspect the evidence before drawing a conclusion.`
                : "An observed result differs from the prediction. Investigate before relying on this configuration."}</strong>
              <p>{outcomes.filter((result) => result.withdrawal === "Tested: withdrawal succeeded").length} successful withdrawal tests recorded in this rehearsal. Pause-state observations and withdrawal tests are shown separately below.</p>
              <p>{stage === "paused" ? "Next: reset for a clean comparison, keeping this baseline record, then design a change."
                : "Next: review the fixed-group comparison and export the evidence for your team."}</p></div>}
            {explorationChanged && <p className="record-notice" data-testid="record-notice">The map now shows a different exploratory selection. These results still describe the recorded keys and vaults below.
              <button className="text-button" disabled={Boolean(busy)} onClick={() => { if (lastRun) { setQuestion("specific"); setSelectedSigners(lastRun.signerAddresses); setIncludedIds(lastRun.positionIds); } }}>Show recorded selection on map</button></p>}
            {baseline && comparisonFinding && comparisonAnalysis && <div className="comparison" data-testid="comparison"><p className="eyebrow">BEFORE → CURRENT · SAME GROUP AND POSITIONS</p>
              <strong>{units(baseline.run.snapshot.positions.filter((position) => baseline.run.affectedPositionIds.includes(position.id)).reduce((sum, position) => sum + BigInt(position.amountRaw), 0n).toString(), snapshot.token.decimals)} → {units(comparisonFinding.affectedAmountRaw, snapshot.token.decimals)} {snapshot.token.symbol}</strong>
              <span>{baseline.run.signerAddresses.map((address) => ownerLabels[address] ?? short(address)).join(" + ")} across {baseline.run.positionIds.join(", ")}</span>
              <small>Keys needed for all: {baseline.minimum ?? "?"} → {comparisonAnalysis.minimumKeysForAll ?? "?"}</small>
              <details><summary>Previous run evidence ({baseline.run.evidence.length} events)</summary><p>Run {baseline.run.snapshot.runId}</p>
                {baseline.run.evidence.map((event, index) => <p key={`${event.operationId}-${index}`}>{event.positionId ?? event.kind}: {event.observedOutcome}</p>)}</details></div>}
            {lastRun ? <div className="outcome-panel" data-testid="outcome-panel"><p className="eyebrow">RECORDED PREDICTION → OBSERVATION</p>
              <p>Keys: {lastRun.signerAddresses.map((address) => ownerLabels[address] ?? short(address)).join(" + ")}. This record stays fixed while you explore other keys.</p>
              {outcomes.map((result) => <div className={`outcome-row ${result.status}`} key={result.position.id}>
                <strong>{result.position.label} · {result.status === "matched" ? "Matched" : result.status === "mismatch" ? "Unexpected result" : "Inconclusive"}</strong>
                <span>Expected: {result.expected ? "pause authorized" : "pause rejected"}</span>
                <span>Approvals: {result.authorization}</span>
                <span>Observed: {result.position.withdrawalsPaused ? "withdrawals paused" : "withdrawals available"} (pause flag {result.position.withdrawalsPaused ? "on" : "off"})</span>
                <span>Withdrawal: {result.withdrawal}</span>
                <details><summary>What this means</summary><p>{result.status === "inconclusive" ? "The available evidence does not establish a confirmed authorization outcome. A missing receipt or failed request is not proof that the Safe rejected these keys."
                  : result.status === "mismatch" ? "The recorded outcome does not match the expected control behavior. Review the receipts and state before treating this rehearsal as verified."
                  : result.position.withdrawalsPaused ? "This signer group successfully exercised pause authority. A pause can be useful in an emergency, and it prevents withdrawals while active. This rehearsal observed the pause state; a blocked withdrawal was not attempted here."
                  : result.withdrawal === "Tested: withdrawal succeeded" ? "This group could not execute the pause, and a real local withdrawal succeeded afterward. Other authorized groups may still pause this vault; this is not a certification of safety."
                  : "The pause was rejected and the pause flag stayed off. This rehearsal did not attempt a withdrawal, so availability is a state observation rather than a tested transaction."}</p></details>
              </div>)}</div>
              : <div className="focus-card"><h2>No recorded rehearsal in this run</h2><p>Explore a signer group, then rehearse it to see observed Safe and withdrawal results here.</p></div>}</>}
          </div>
          <div className="inspector-footer">
            {stage === "ready" && !proposal && <div className="primary-actions"><button className="button primary" onClick={rehearse}
              disabled={Boolean(busy) || selectedSigners.length === 0 || includedIds.length === 0} data-testid="rehearse">Rehearse {selectedTitle} pause</button>
              <button className="button secondary" onClick={() => { setQuestion("change"); openProposal(snapshot.positions.find((position) => includedIds.includes(position.id)) ?? snapshot.positions[0]); setInspectorTab("change"); }} disabled={Boolean(busy)}>Design a Safe change</button>
              <small>Check the prediction with real local Safe approvals. This can pause the checked demo vaults.</small></div>}
            {stage === "ready" && proposal && <div className="primary-actions"><button className="button primary" onClick={apply}
              disabled={Boolean(busy) || !preview || !proposalChanged} data-testid="apply-patch">Apply through Safe</button>
              <button className="button ghost" onClick={() => { setProposal(null); setInspectorTab("explore"); }} disabled={Boolean(busy)}>Cancel proposal</button></div>}
            {stage === "paused" && <div className="primary-actions"><button className="button primary" onClick={() => reset(true)} disabled={Boolean(busy)} data-testid="reset-after-base">Reset for improvement</button></div>}
            {stage === "patched" && <div className="primary-actions"><button className="button primary" onClick={rehearse} disabled={Boolean(busy) || !selectedSigners.length || !includedIds.length} data-testid="replay">Replay {selectedTitle}</button></div>}
            {stage === "replayed" && <div className="primary-actions"><button className="button secondary" onClick={() => reset()} disabled={Boolean(busy)}>Start a fresh run</button></div>}
            <p className="action-note">This model evaluates withdrawal-pause authority. It makes no claim about theft, intent, or compromise likelihood.</p>
          </div></>}
      </aside>
    </section>
    <section className={`evidence-drawer ${evidenceOpen ? "open" : ""}`} aria-label="Execution evidence" data-testid="evidence"><div className="evidence-head"><div><span className="eyebrow">TRANSACTION EVIDENCE</span>
      <strong>{evidence.length} recorded events in this run</strong></div><button className="button ghost evidence-toggle" onClick={() => setEvidenceOpen((current) => !current)} aria-expanded={evidenceOpen}>
        {evidenceOpen ? "Hide technical evidence" : "Show receipts and save review"}</button><span className="run-id mono">RUN {snapshot.runId.slice(0, 8)}</span></div>
      {evidenceOpen && <>
      <div className="review-save"><input aria-label="Review name" placeholder="Name this review" value={reviewName} onChange={(event) => setReviewName(event.target.value)} />
        <input aria-label="Review note" placeholder="Optional note for your team" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} />
        <button className="button secondary" onClick={saveReview} disabled={Boolean(busy)}>Save review locally</button></div>
      <div className="timeline">{evidence.length === 0 ? <p className="empty-evidence">No chain evidence yet.</p> : evidence.slice().reverse().map((event, index) => <details
        key={event.txHash ?? `${event.operationId}-${event.kind}-${event.positionId ?? index}-${index}`} className="event-row"><summary>
          <span className={`event-icon ${event.outerStatus === "reverted" ? "failed" : ""}`}>{event.outerStatus === "reverted" ? "!" : "OK"}</span>
          <span><strong>{event.positionId ? event.positionId.toUpperCase() : event.kind.toUpperCase()}</strong><small>{event.observedOutcome}</small></span>
          <span className="event-method mono">{event.method}</span><span className="event-block">#{event.blockNumber ?? "-"}</span></summary>
          <div className="event-details"><p><span>Outer status</span>{event.outerStatus}</p><p><span>Safe result</span>{event.safeExecutionStatus ?? "n/a"}</p>
            {event.requestedSignerLabels && <p><span>Selected keys</span>{event.requestedSignerLabels.join(" + ")}</p>}
            {event.signingSignerLabels && <p><span>Signed for this Safe</span>{event.signingSignerLabels.join(" + ") || "None"}</p>}
            <p className="mono"><span>Transaction</span>{event.txHash ?? "No receipt"}</p>{event.error && <p className="error-text"><span>Error</span>{event.error}</p>}</div></details>)}</div>
      </>}
    </section>
    {importDialog}
    {showIntro && <Dialog label="Understand BREAKPOINT" className="intro-modal" onClose={dismissIntro}>
      <div className="modal-heading"><div><p className="eyebrow">{introPage === "learn" ? "1 OF 2 · UNDERSTAND THE PROBLEM" : "2 OF 2 · CHOOSE YOUR QUESTION"}</p><h2 id="intro-title" tabIndex={-1} data-dialog-focus>{introPage === "learn" ? "Separate vaults can share the same control." : "What would you like to investigate?"}</h2></div>
        <button className="button ghost" onClick={dismissIntro}>Skip introduction</button></div>
      {introPage === "learn" ? <>
      <p className="intro-lead">Your holdings may be spread across several vaults, yet the same small set of signer addresses may be able to stop withdrawals from all of them. BREAKPOINT makes that dependency visible and lets you test a proposed change.</p>
      <div className="concept-path" aria-label="How pause authority works">
        <div><span>01 · VAULT</span><strong>Holds the tokens</strong><p>Users withdraw from it. A pause temporarily blocks those withdrawals.</p></div>
        <div><span>02 · SAFE</span><strong>Controls the pause</strong><p>A wallet with several owners. Its threshold is how many approvals are needed: for example, two of three.</p></div>
        <div><span>03 · SIGNER GROUP</span><strong>Supplies the approvals</strong><p>Owner addresses approve together. Repeated owners can create shared control across vaults.</p></div>
      </div>
      <div className="intro-purpose"><strong>The objective: understand dependence on a small group.</strong>
        <p>For a treasury seeking more separate control, lower shared pause authority can be useful. More required approvals can also make emergency response harder. Compare both effects.</p>
        <p>A pause can protect during an emergency and also stops users withdrawing. Availability alone is not proof of safety.</p>
        <details className="learn-more"><summary>Is paused good or bad? What does available mean?</summary>
          <p>A pause can protect during an emergency, but prevents withdrawals. AVAILABLE means the pause flag is off. Results tells you whether a withdrawal transaction was tested. Neither state alone proves safety.</p>
          <p>A signer key represents an address, not an identified person. One person may control multiple addresses. A prediction comes from discovered owners and thresholds; an observation comes from the local rehearsal.</p></details>
      </div></> : <>
      <p className="intro-lead">Start with a calculated example, investigate addresses you choose, or compare a new configuration. You can change your question through Guide & terms at any time.</p>
      <fieldset className="question-options"><legend>What would you like to investigate?</legend>
        {(Object.keys(REVIEW_QUESTIONS) as ReviewQuestion[]).map((item) => <label key={item} className={introQuestion === item ? "chosen" : ""}>
          <input type="radio" name="review-question" value={item} checked={introQuestion === item} onChange={() => setIntroQuestion(item)} />
          <span><strong>{REVIEW_QUESTIONS[item].title}{item === "shared" ? " · Start here" : ""}</strong><small>{REVIEW_QUESTIONS[item].description}</small></span></label>)}
      </fieldset></>}
      <div className="intro-footer"><p>Uses demo tokens on a local blockchain. No wallet or real cryptocurrency required.</p>
        {introPage === "learn" ? <button className="button primary" onClick={() => setIntroPage("choose")}>Continue to review question</button> : <div className="intro-actions">
          <button className="button ghost" onClick={() => setIntroPage("learn")}>Back</button>
          <button className="button primary" disabled={Boolean(busy)} onClick={() => chooseQuestion(true)}>{introQuestion === "shared" ? "Start guided review" : "Open this investigation"}</button></div>}</div>
    </Dialog>}
    {builder && <Dialog label="Build local scenario" onClose={() => { if (!busy) setBuilder(null); }}>
      <div data-testid="scenario-builder">
      <div className="modal-heading"><div><p className="eyebrow">LOCAL SCENARIO BUILDER</p><h2>Make your own control arrangement</h2></div>
        <button className="button ghost" data-dialog-focus onClick={() => setBuilder(null)} disabled={Boolean(busy)}>Close</button></div>
      <p>Choose demo allocations and three signer keys for each Safe. Deploying creates real Safe and vault contracts on the isolated local chain.</p>
      <div className="builder-grid">{builder.map((item) => <div className="builder-card" key={item.id}><h3>{item.id.toUpperCase()}</h3>
        <label>Vault name<input value={item.label} maxLength={24} disabled={Boolean(busy)} onChange={(event) => updateBuilder(item.id, { label: event.target.value })} /></label>
        <label>DemoUSD units<input type="number" min="1" max="1000000" value={item.amountUnits} disabled={Boolean(busy)} onChange={(event) => updateBuilder(item.id, { amountUnits: Number(event.target.value) })} /></label>
        <span>Safe owners · select three</span><div className="proposal-owners">{["A", "B", "C", "D", "E", "F"].map((label) => <label key={label}>
          <input type="checkbox" checked={item.owners.includes(label)} disabled={Boolean(busy)} onChange={() => updateBuilder(item.id, { owners: item.owners.includes(label)
            ? item.owners.filter((owner) => owner !== label) : [...item.owners, label] })} />{label}</label>)}</div>
        <label>Approvals required<select value={item.threshold} disabled={Boolean(busy)} onChange={(event) => updateBuilder(item.id, { threshold: Number(event.target.value) })}>
          {[1, 2, 3].map((value) => <option value={value} key={value}>{value} of 3</option>)}</select></label>
        {item.owners.length !== 3 && <p className="error-text">Select exactly three owners ({item.owners.length} chosen).</p>}
        {(!Number.isSafeInteger(item.amountUnits) || item.amountUnits < 1 || item.amountUnits > 1_000_000) && <p className="error-text">Enter 1 to 1,000,000 whole units.</p>}</div>)}</div>
      {error && <p className="error-text" role="alert">{error}</p>}{busy && <p role="status">{busy}</p>}
      <div className="modal-actions"><button className="button secondary" disabled={Boolean(busy)} onClick={() => setBuilder(REFERENCE_CONFIG.map((item) => ({ ...item, owners: [...item.owners] })))}>Load guided example</button>
        <button className="button ghost" onClick={() => setBuilder(null)} disabled={Boolean(busy)}>Cancel</button>
        <button className="button primary" onClick={createScenario} disabled={Boolean(busy) || builder.some((item) => item.owners.length !== 3 ||
          !Number.isSafeInteger(item.amountUnits) || item.amountUnits < 1 || item.amountUnits > 1_000_000 || !/^[a-zA-Z0-9 -]{1,24}$/.test(item.label.trim()))}
          data-testid="deploy-scenario">Deploy local scenario</button></div></div></Dialog>}
    {showReviews && <Dialog label="Saved reviews" className="reviews-modal" onClose={() => { setShowReviews(false); setOpenReview(null); }}>
      <div className="modal-heading"><div><p className="eyebrow">ON THIS DEVICE</p><h2>Saved reviews</h2></div>
        <button className="button ghost" data-dialog-focus onClick={() => { setShowReviews(false); setOpenReview(null); }}>Close</button></div>
      {openReview ? <div className="saved-detail"><button className="text-button" onClick={() => setOpenReview(null)}>← All reviews</button><h3>{openReview.name}</h3>
        <p>{new Date(openReview.savedAt).toLocaleString()} · Block {openReview.snapshot.blockNumber} · Run {openReview.snapshot.runId.slice(0, 8)}</p>
        <p className="archive-warning">Historical local snapshot · {openReview.stage} · opening this record does not query or change the current chain.</p>
        {openReview.question && <p>Review question: {REVIEW_QUESTIONS[openReview.question].title}</p>}
        <p>{openReview.note || "No reviewer note."}</p><p>Selected positions: {archivedPositions.map((position) => position.label).join(", ") || "None"}</p>
        <strong>Selected keys: {openReview.selectedSigners.map((address) => openReview.snapshot.positions[0]?.ownerLabels[address] ?? short(address)).join(" + ") || "None"}</strong>
        <div className="metric-grid"><div><span>GROUP EXPOSURE</span><strong>{units(archivedFinding.affectedAmountRaw, openReview.snapshot.token.decimals)} {openReview.snapshot.token.symbol}</strong></div>
          <div><span>STRONGEST UP TO {openReview.keyBudget}</span><strong>{units(archivedAnalysis.maxExposureRawByKeyBudget[String(Math.min(openReview.keyBudget, archivedAnalysis.signerUniverse.length))] ?? "0", openReview.snapshot.token.decimals)} {openReview.snapshot.token.symbol}</strong></div></div>
        <details className="archive-section" open><summary>Discovered control at the saved snapshot</summary><div className="control-table"><table><thead><tr><th>Vault</th><th>Safe approvals</th><th>Safe owners</th><th>Selected keys</th></tr></thead><tbody>
          {archivedPositions.map((position) => <tr key={position.id}><td>{position.label}</td><td>{position.controller.threshold} of {position.controller.owners.length}</td>
            <td>{position.controller.owners.map((address) => openReview.snapshot.positions[0]?.ownerLabels[address] ?? short(address)).join(" + ")}</td>
            <td>{position.controller.owners.filter((address) => openReview.selectedSigners.includes(address)).length} supplied</td></tr>)}
        </tbody></table></div></details>
        {openReview.baseline && <details className="archive-section" open><summary>Baseline comparison</summary>
          <p>Fixed group: {openReview.baseline.run.signerAddresses.map((address) => openReview.snapshot.positions[0]?.ownerLabels[address] ?? short(address)).join(" + ")}.</p>
          <p>Position scope: {openReview.baseline.run.positionIds.join(", ")}. Baseline reached {openReview.baseline.run.affectedPositionIds.length} vaults; current saved snapshot reaches {evaluateCoalition(openReview.snapshot.positions.filter((position) => openReview.baseline?.run.positionIds.includes(position.id)), openReview.baseline.run.signerAddresses).affectedPositionIds.length}.</p>
          <p>{openReview.baseline.run.evidence.length} baseline events are retained in the export.</p></details>}
        {openReview.lastRun && <div className="saved-events">{openReview.lastRun.snapshot.positions.filter((position) => openReview.lastRun?.positionIds.includes(position.id)).map((position) => <p key={position.id}>
          {position.label}: expected {openReview.lastRun?.affectedPositionIds.includes(position.id) ? "pause" : "rejection"}; observed {position.withdrawalsPaused ? "paused" : "available"}.
        </p>)}</div>}
        <details className="archive-section"><summary>{openReview.proposals.length} saved proposal variants</summary>
          {openReview.proposals.length ? openReview.proposals.map((item, index) => <p key={`${item.positionId}-${index}`}>{openReview.snapshot.positions.find((position) => position.id === item.positionId)?.label ?? item.positionId}: {item.ownerLabels.join(" + ")} · {item.threshold} of 3 approvals</p>) : <p>No saved proposals in this review.</p>}</details>
        <p>{openReview.evidence.length} recorded events</p>
        <button className="button secondary" onClick={() => exportSavedReview(openReview)}>Export this saved review</button>
        <div className="saved-events">{openReview.evidence.map((event, index) => <details key={`${event.operationId}-${index}`}><summary>{event.positionId ?? event.kind}: {event.observedOutcome}</summary>
          <p className="mono">{event.txHash ?? "No transaction receipt"}</p></details>)}</div></div>
        : savedReviews.length ? <div className="saved-list">{savedReviews.map((review) => <button key={review.id} onClick={() => setOpenReview(review)}>
          <strong>{review.name}</strong><span>{new Date(review.savedAt).toLocaleString()} · {review.evidence.length} events</span></button>)}</div>
          : <p>No reviews saved yet. Name a run below its evidence and save it here.</p>}</Dialog>}
    {(busy || error) && <div className={`toast ${error ? "error" : ""}`} role="status" aria-live="polite">
      <strong>{error || busy}</strong>{!error && progressEvents.length > 0 && <span className="progress-copy">
        {progressEvents.length} on-chain event{progressEvents.length === 1 ? "" : "s"} recorded · {progressEvents.at(-1)?.positionId ?? progressEvents.at(-1)?.kind}: {progressEvents.at(-1)?.observedOutcome}
      </span>}</div>}
  </main>;
}
