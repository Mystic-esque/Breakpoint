# Contracts and execution specification

## Contracts
MockToken: standard fixed-decimal ERC20, 6 decimals, visibly named DemoUSD/test token with no monetary value. Minting is fixture setup only. Do not describe it as real USDC or redeemable money.
DemoVault: fixed token, Safe administrator, depositor balances, deposit, withdraw, pauseWithdrawals, unpauseWithdrawals and events. Prefer simple independent balances rather than yield/share accounting; this is a control-risk demonstration, not an ERC4626 implementation claim.
- deposit transfers mock tokens in and updates correct sender balance.
- withdraw decreases only caller's balance and transfers to caller, uses safe token handling and reentrancy protection.
- paused state blocks withdrawals; deposits may also be disallowed while paused if documented, but analysis measures withdrawal effect only.
- only configured Safe can pause/unpause.
- administrator is immutable in the MVP; mitigation changes Safe owners, not arbitrary vault owner replacement.
- no emergency drain, hidden recovery owner, backdoor fixture setter or arbitrary execute function.

## Safe deployment
Use pinned official Safe contracts/factory deployment, not a hand-written multisig lookalike. Deploy/initialize three actual Safe proxies. Set threshold two, owners as the reference fixture. Confirm setup is one-time; no modules or guards; inspect any fallback handler against an explicit supported profile. Distinct EOA owners and correct sorted/unique signature handling.
Signer accounts A-F are locally generated fixture accounts funded with local ETH. Keep signing server-side within the local scenario process. Never bundle keys into the browser or export them. They have no authority on external networks and must never be reused there.

## Main execution path
For each pause, form the Safe transaction for that vault and current Safe nonce; hash with correct chain/Safe domain; collect required fixture signatures; execute through Safe.execTransaction (or official SDK's verified equivalent). Decode execution result and verify paused state by reading the vault.
A receipt with outer status=success can contain Safe ExecutionFailure for the inner call. Do not treat it as target success. Threshold failure may revert the outer transaction. Handle both and collect useful evidence.

## Harbor mitigation
Before: owners A,B,D threshold2. After: owners C,D,F threshold2. Use correctly authorized Safe owner-management calls; e.g. swap A->C and B->F with correct linked-list predecessor and fresh nonce, or a carefully tested atomic batch. This is a configured operator action using valid fixture owner approvals, not something arbitrary users can perform against a real protocol.
Rediscover state after execution. Never substitute edited JSON for applied onchain change.

## Rehearsal after patch
Use A+B for Atlas and Grove. Attempt A+B against Harbor only in local controlled fixture: real signature authorization should fail. A preflight rejection is not an onchain rejection; if displaying it, label it clearly. Core demo should include an actual locally broadcast rejected authorization attempt when practical, followed by successful Harbor withdrawal and unchanged Harbor pause flag.

## Forbidden shortcuts
No impersonating the Safe address to call pause. No direct storage writes, special test bypass that exists in shipped contracts, replacing live discovery with fixture JSON, or simulated receipts. Fork testing may assume control of EOA keys in clearly labeled experiments, but does not establish key theft. Default live demo uses real fixture signatures instead.

## Verification
Check conservation of total mock tokens across users/vaults; depositor accounting; insufficient balance; unauthorized pause/unpause; exact-threshold success; below-threshold failure; repeated signature failure; nonce replay; owner replacement; and post-patch A+B rejection. Check that enabling an unsupported module changes discovery to incomplete rather than preserving the old score.
