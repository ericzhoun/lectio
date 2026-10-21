# Evolution Proposal: User explicitly set a standing rule that all model/API evaluation calls must use OAuth proxied through opencodex and never use OPENAI_API_KEY or GEMINI_API_KEY from the environment.

- Proposal-ID: evo-2026-10-19-opencodex-oauth-only
- Status: approved
- Signature: opencodex-oauth-only
- Created-At: 2026-10-19 23:35
- Last-Seen-At: 2026-10-19 23:35
- Target-File: MEMORY.md
- Trigger-Type: preference
- Confidence: medium
- Payload-Hash: d67aa1ef6ba862030c2e8a786eb127644118c9db76c0f55b76b850d47b56cc01
- Content-Hash: 6e74951208735480eb80277a723158116af8194f474ea1e1542e1b3eba88fa00

## Why This Matters
- User explicitly set a standing rule that all model/API evaluation calls must use OAuth proxied through opencodex and never use OPENAI_API_KEY or GEMINI_API_KEY from the environment.

## Evidence
- Interactive proposal card was present in the session UI.
- Main recorded this pending draft before any approval action.
- Approval and rejection use the Main-owned proposal record, not a later renderer payload.

## Duplicate Check
- Checked: Main-owned proposal signature and immutable payload hash
- Result: pending authority record created
- Decision: only the recorded payload may transition this proposal

## Proposed Change
### MEMORY.md

# MEMORY.md - Long-Term Memory

## Standing User Rules

- Always use the OAuth proxied through opencodex for model/API evaluation calls; never use the OPENAI_API_KEY or GEMINI_API_KEY in the environment.

## Apply Plan
1. Keep this Main-owned draft as the approval artifact.
2. Apply exactly the payload bound to this draft after user approval.
3. Append an audit note after approval or rejection.

## User Approval
- Approve: 批准 evo-2026-10-19-opencodex-oauth-only
- Reject: 拒绝 evo-2026-10-19-opencodex-oauth-only

## Applied
- Resolved-At: 2026-10-20T06:44:39.295Z
- Payload-Hash: d67aa1ef6ba862030c2e8a786eb127644118c9db76c0f55b76b850d47b56cc01
- Content-Hash: 6e74951208735480eb80277a723158116af8194f474ea1e1542e1b3eba88fa00
- Transaction-ID: hermes_approval_mvgbiwov_s1lh3j
