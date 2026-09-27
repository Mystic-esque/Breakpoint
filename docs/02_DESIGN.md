# Design specification — an investigation workbench

## Direction
A precise, premium engineering instrument. The main visual is the control graph, not a marketing hero. The interface should feel calm before the shared dependency is revealed; use emphasis to direct attention, not nonstop motion.

## Visual tokens
Background #0B1015; surface #121B23; elevated #1A2631; border #2D3D4B; primary text #F1F5F8; secondary #A9B8C5. Accent teal #55DFC4; warning amber #F3BF66; danger coral #FF817B. Verify actual contrast and adjust if necessary. Never communicate outcomes through color alone.
Use system sans for copy and system monospace for addresses, times and amounts; no paid/download-dependent fonts. 8px spacing base, 12–16px card radii, 1px crisp borders. Numeric columns align with tabular figures. Restrained shadows. No background crypto coins, glass gradients, excessive glow or decorative charts.

## Desktop layout (target 1440x900)
Top bar: BREAKPOINT wordmark, local-chain mode badge, RPC status, snapshot block, Reset and Export.
Left rail around 260px: selected positions with amounts, custody/admin summary and coverage status.
Center flexible canvas: vault nodes -> Safe controllers -> shared signer nodes, arranged consistently. Display thresholds on controllers. Selected coalition highlights only the relevant satisfied paths. Keep pan/zoom/reset-view controls small and reachable.
Right inspector around 320px: selected node details, authority statement, controls considered/unsupported, coalition selection, primary stage action.
Bottom evidence drawer: human-readable transaction timeline; expandable hashes, method, Safe result, block and post-state checks. Avoid covering graph when collapsed.

## Main states
1 Empty/booting: explain that a local scenario is being prepared. No fake balances.
2 Ready: three position cards, trace-control action, baseline checks available.
3 Analyzed: shared keys emphasized; exact supported-model metrics and clear coverage.
4 Running: disable conflicting actions, show genuine stages from the coordinator.
5 Paused: withdrawal checks show blocked state for affected vaults.
6 Proposed change: side-by-side planned owner sets labeled hypothetical.
7 Applied change: new block/configuration observed, prior analysis marked stale until refreshed.
8 Replayed: comparison table and receipts, with Harbor withdrawal success.
9 Error/incomplete: useful next action; retain verified evidence without turning unknowns green.

## Microcopy
Use: "These two signer addresses can authorize withdrawal pauses in all three demo vaults."
Use: "65% pauseable under this scenario"; "Recorded run"; "Local rehearsal"; "Analysis incomplete".
Avoid: "100% of funds will be stolen", "four independent people", "unhackable", "AI-certified safe", "live" for stored fixtures.

## Interaction details
Hover focuses relevant edges; click pins inspector. Keyboard users get an equivalent table of all paths and coalition controls. Distinct icons + labels for satisfied threshold, failed authorization, unsupported and stale. Use short address labels but expose full address through copy/reveal. Tooltips must work on focus.
Transitions 150–250ms; graph reveal 400–700ms only when useful. Respect prefers-reduced-motion. No decorative loading delays. Do not animate receipt success until confirmed.

## Responsive behavior
At <=1024px move inspector into a panel/tab; at mobile stack positions and provide Graph/Table toggle. Preserve primary actions without horizontal page overflow. Graph itself may pan. Minimum touch targets 44px; visible focus rings; semantic buttons and accessible progress/status announcements.

## Screens to capture
Overview before discovery; highlighted A+B control; evidence after pause; Harbor rejected pause/working withdrawal after patch; comparison + coverage. Capture real application state only.

## Final review
Readable at 100% zoom on 1366x768 and 1440x900. No browser console errors. No stale green indicators after reset. System errors explain missing local node without requesting paid API credentials. Empty/unsupported/long-address states designed, not hidden.
