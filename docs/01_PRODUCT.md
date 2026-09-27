# Product requirements

## Pitch
BREAKPOINT makes shared control across DeFi positions visible, rehearses its consequences, and verifies configuration improvements. A user sees three independent-looking vaults collapse to the same controlling signer pair. The pair pauses withdrawals through real multisig authorization. After changing one vault's owners, that pair cannot pause it.

## User and value
A protocol security reviewer wants to inspect authority before adopting a configuration. A DAO treasury operator wants to understand correlated administrative exposure across supported positions. Value: evidence-backed dependency awareness and a way to test a proposed remedy. No guarantee of safety or attack prevention.

## Required journeys
P1 Launch without signup or wallet extension, start/reconnect to the dedicated local scenario, and see its mode and health.
P2 Inspect three positions, amounts, chain/block and discovered administrator addresses. Show normalized signer addresses alongside friendly demo labels.
P3 Trace control: highlight repeated signers and 2-of-3 thresholds. Explain a selected path in plain English.
P4 Select a coalition manually or choose an automatically discovered maximum-exposure pair. Display pauseable amount, unaffected amount and coverage. Differentiate pause from withdrawal or upgrade permissions.
P5 Rehearse: baseline withdrawability check; fresh real Safe transactions to pause; post-action withdrawal checks. Show accepted/rejected execution and actual state results.
P6 Review proposed Harbor owner change; show planned comparison separately from applied state. Apply the fixture-only authorized update; rediscover blockchain state.
P7 Repeat the A+B scenario. Harbor remains withdrawable. Show measured before/after results.
P8 Reset safely to a new seeded run and export evidence, including failed attempts and unsupported findings.

## Acceptance headline
A technically literate judge can reproduce the complete scenario from the repository without buying crypto, acquiring API credentials, or trusting an animation. A non-specialist can explain why three protocol names do not necessarily represent three independent control groups.

## Scope tiers
Must: known Safe profile, mock token, three vaults, pause/withdraw, discovery, exhaustive analysis, real signatures, patch/replay, graph, reset, evidence export, tests and README.
Should: keyboard graph alternative, mobile inspector layout, recorded evidence viewer, screenshots and video script.
Could: curated real-chain read-only example, supported timelock delay, additional permission type, public testnet deployment if truly no cost and approved.
Cut: arbitrary address auditing, source-code AI classification, all-chain portfolio discovery, nested contract signers, onchain report registry, tokenomics, alerts infrastructure, paid dashboards, risk probabilities, automatic production reconfiguration.

## Observable success
- Seed and reset are repeatable.
- Results change when contracts change.
- Base coalition A+B affects 100%; after patch 65%.
- Fewest keys to affect all supported positions changes from 2 to 4.
- An unauthorized local attempt fails through real authorization or is blocked with a clearly labeled preflight result; never manufacture an onchain receipt.
- Unknown input remains unknown.
- UI has no unexplained metric, fake incident or placeholder evidence.

## Submission positioning
Innovation is the discover/calculate/rehearse/change/reverify workflow. Prior art includes DeFiScan, Safe inspection, Forta and transaction simulation. Describe the contribution without claiming invention of multisig analysis or guaranteed first place.
