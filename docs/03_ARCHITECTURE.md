# Architecture and data contracts

## Layers
1 Contracts: mock ERC20, DemoVault, actual Safe deployment artifacts.
2 Local coordinator: lifecycle, seed/reset, fixture signing, Safe execution, receipt collection. Bind loopback only.
3 Discovery: read known contracts at a pinned block, validate supported account profile, produce normalized state.
4 Pure analysis: state -> coalition findings. No RPC, AI, floating point or UI dependencies.
5 UI: state machine + graph + evidence. Never calculate authority from display labels.
6 Export/replay: portable snapshot and commands backed by the actual implementation.

## Repository target
apps/web (Next.js app and loopback-only handlers if used); packages/core (types/discovery/analysis); packages/scenario (coordinator and deployment); contracts (Solidity + tests); fixtures (reference oracle); docs; scripts. Choose npm workspaces to avoid extra orchestration dependencies. Agent can simplify physical layout if boundaries remain testable.

## Chain/runtime
Default Anvil, dedicated loopback port, chain id 31337. Node LTS compatible with selected dependencies. Run environment diagnostics before installation. Foundry may require WSL on Windows; if unsuitable use Hardhat local node with compatible pinned versions and identical security/authorization guarantees. Pick once, document it, and avoid maintaining two full backends.
No external API at runtime for core scenario. Initial dependency downloads require internet. No Postgres, Supabase, Docker or paid simulation provider required. Use local memory and run output files for ephemeral records.

## Target commands to implement and document
`npm install`; `npm run demo` (orchestrates only owned local processes); `npm run demo:reset`; `npm run test`; `npm run test:contracts`; `npm run test:e2e`; `npm run typecheck`; `npm run build`. Include troubleshooting and exact supported versions after implementation. Do not claim these commands exist before creating them.
Shutdown kills only processes started by this coordinator. Do not terminate arbitrary processes on occupied ports; report conflict or use a configured alternative.

## Normalized domain types
Address: chain-qualified normalized hex string. Signer label is presentation metadata only.
Snapshot: schemaVersion, runId, chainId, blockNumber(string), blockHash, observedAt, contracts, token, positions, controllers, coverage, provenance.
Position: vault address, depositor, token address, decimals, amountRaw(string), administrator, permission="pauseWithdrawals".
Controller: Safe address, known runtime/version evidence, owner addresses, threshold, module enumeration, guard/handler inspection, supportStatus, unsupportedReasons.
CoalitionFinding: action, signer addresses, affected position IDs, affectedAmountRaw, totalSelectedAmountRaw, analyzedAmountRaw, completeForSupportedModel, caveats, snapshot identity.
ExecutionEvidence: runId, operationId, chainId, sender, destination, method, txHash, block, outerStatus, safeExecutionStatus, before/after state, expected/observed outcome, errors.
All raw token amounts and block/nonce values serialized as decimal strings. Render BigInt safely. Same token only in MVP; mixed-token totals rejected, not added together.

## API/event contract (target)
GET /api/scenario/status -> mode, readiness, runId, current stage, chain identity.
POST /api/scenario/start -> fresh run or existing run; idempotency key.
GET /api/scenario/snapshot -> discovery result pinned to one block.
POST /api/scenario/rehearse -> explicit coalition, expectedRunId, snapshotBlockHash, operationId; only seeded fixtures.
POST /api/scenario/patch-harbor -> named supported patch; requires clean baseline, applies real Safe transactions.
POST /api/scenario/reset -> invalidates old run and creates/reseeds owned local state.
GET /api/scenario/evidence -> structured events or server-sent event stream.
GET /api/scenario/export -> versioned JSON plus readable Markdown evidence if generated.
Do not expose arbitrary target, calldata, shell command, private key, RPC endpoint or source file execution in any public request.

## State consistency
One writer mutex per run. Reject stale run IDs and in-progress conflicting actions. Record lifecycle transitions and check actual chain state on reconnect. Wait for receipts and verify Safe execution event plus target state before advancing. Reset invalidates all cached analysis and receipts. Pin reads to one block; do not combine owners from one block with threshold from another.

## Snapshot/rehearsal protocol
Create canonical funded baseline. Run baseline withdrawal probes on a disposable branch/snapshot; restore before computing or performing the main scenario so amounts remain 40k/35k/25k. Rehearse base branch; export it before reset. Restore/reseed canonical baseline, apply Harbor patch, rediscover, rehearse A+B, then probe Harbor withdrawal. Comparison denominator uses the declared pre-probe snapshot; actual current balances remain separately labeled.
Anvil snapshots are ephemeral and single-use semantics must be handled correctly. Fresh deterministic reseeding is the recovery path. Do not depend on a snapshot after restarting the node.

## Public read-only extension
Separate transport and no signer access. Explicit supported list; never send transactions. Show analysis coverage and block age. Arbitrary contract behavior is not discoverable by merely calling owner(). Cut this feature before compromising the local core.
