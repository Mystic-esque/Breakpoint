# Analysis semantics and reference algorithm

## Core model
Inputs are verified supported positions at one block. Each position has a withdrawal-pause permission controlled by a known Safe with unique EOA owners and threshold t. A coalition S can authorize that pause iff |S intersect owners| >= t. No claim about stealing keys, social independence, likelihood of collusion or permanent loss.

Let amount(v) be snapshot amountRaw in the single selected mock token.
Exposure(S) = sum(amount(v) for each unique selected position v whose pause permission S satisfies).
MaxExposure(k) = max Exposure(S) over signer subsets of cardinality <=k.
MinimumAll = minimum |S| with Exposure(S) equal to total analyzed amount, only when every selected position is completely supported and the model has no unknown bypass/control paths.
Use integer arithmetic. Percentage = affected * 10000 / total as basis points, rounded explicitly for display. Zero total -> N/A, not a division error. Don't double count a position reached through multiple graph edges.

## Algorithm
Normalize addresses, deduplicate owner/position inputs, validate thresholds and decimals, enumerate subsets of up to 12 distinct EOA signers, calculate masks for each controller, evaluate satisfied thresholds, accumulate amounts, retain best witnesses with deterministic address-lexicographic tie-breaking. Complexity bounded by O(2^n * positions). Cache by snapshot hash + action + input set; invalidate on change. A web worker is optional if required for responsiveness.
For incomplete discovery show known sufficient coalitions only where validated, and coverage separately. Do not assert a global minimum across an incomplete model. Distinguish an upper bound on required keys supplied by a witnessed path from proof that no smaller alternative path exists.

## Canonical expected results
Base:
Atlas=ABC/2, amount40000; Harbor=ABD/2, amount35000; Grove=ABE/2, amount25000.
A alone=0. A+B=100000. C+D=0. Fewest for all=2.
After Harbor=CDF/2:
A+B=65000. C+D=35000. A+C+D=75000. A+B+C+D=100000.
MaxExposure(1)=0; MaxExposure(2)=65000; MaxExposure(3)=75000; MaxExposure(4)=100000. Fewest for all=4.
Raw amounts multiply these token units by 10^6.

## Interpretation and limits
A pause may be a legitimate emergency capability. Label it authority, not an accusation. Different addresses may be controlled by one person; identical addresses identify the same onchain signer but say nothing about intent. Modules/guards/fallbacks/nested signers, alternate pausers, upgrade routes or timelocks can invalidate this simple model. Reject unsupported profiles; don't guess.

## Extensibility
Future control graph needs AND/OR/threshold nodes, action types, delays and alternate paths. Do not replace it with a naïve shortest-path graph: thresholds are not ordinary edges. Don't implement that general solver in this MVP. Keep types extensible and claims narrow.
