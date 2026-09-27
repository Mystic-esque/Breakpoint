# Threat model and trust boundaries

## Purpose
This is a research prototype for supported authorization configurations, not a production audit or incident-response service. Its integrity depends on faithful discovery, honest coverage and real execution evidence.

## Assets to protect
User machine, local files, any real wallet secrets, demo correctness, published claims, and public networks. The core requires no real keys or wallet connection.

## Local write boundary
Use dedicated loopback RPC and chain31337 plus a seeded deployment identity/known bytecode set. Chain ID alone is insufficient: verify URL host, run identity and allowlisted fixture contract addresses. Refuse any write outside the fixture scenario. No arbitrary RPC URLs or calldata on write endpoints.
Bind coordinator and dev node to localhost only. Guard mutation endpoints with same-origin checks and an unpredictable local session token; reject cross-origin requests, unexpected Host headers and stale operation IDs. Do not expose the coordinator through a public tunnel or hosted website. Redact secrets from logs and reports.

## Analysis boundary
Known ABI is not proof of behavior. Restrict adapters to known implementations/code identity and validated action semantics. Read owners, threshold, modules and guard data from the chain, not manually supplied labels. Distinguish unsupported profile, failed RPC, stale snapshot and valid zero exposure. False certainty is a product defect.

## Execution boundary
Validate destination/method/chain/run. Real approvals must traverse actual Safe authorization. Read target state and decode Safe results. Make replay attempts idempotent at the API level and nonce-aware. Prevent concurrent reset/patch/rehearse operations from producing mixed evidence.

## Evidence boundary
JSON/Markdown exports contain source block, inspected contracts, role model, selected coalition, assumptions, receipts, success/failure and coverage. Export no keys, auth tokens, local secrets or environment contents. A report hash establishes file integrity only; it does not certify truth. Recorded runs are clearly labeled with date and source mode.

## Known exclusions
No prediction of compromise probability; no identification of humans behind keys; no comprehensive smart-contract audit; no hidden source-level backdoor detection; no insolvency/liquidity/market-loss model; no guarantee a public RPC is truthful; no assertion that passing the supported tests proves safety.

## Review checklist
Server never exposes signing secrets to client. Local write guard rejects external host even with chain31337. Unsupported controls block minimum claims. All reads share a block. Receipts have correct run IDs. Repeated clicks do not double-apply changes. Public deployment is viewer-only unless a separate safe architecture is explicitly approved. No arbitrary shell execution from UI.
