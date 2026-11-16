# Product

<!-- impeccable:product-schema 1 -->

> Inferred from the repository, docs/ and the contest brief, not from an interview: the owner asked for work to proceed without questions (2026-11-16). Facts marked (inferred) await confirmation.

## Platform

web

## Users
- Hackathon judges of MetaEarth Hackathon 2026 BEACON (Taiwan): open the demo URL, have 3–5 minutes, want to see the ME Network mechanism working, not read about it.
- (inferred) The product's real users: a worker who found that the payslip pays fewer hours than the attendance record, and the employer (or its HR) who must answer.

## Product Purpose
A worker registers the SHA-256 fingerprint of a "attendance vs payslip" comparison report on ME Network testnet and names the employer. The named employer must confirm or dispute before a deadline; past the deadline anyone can mark it expired. Success: the first step of a wage dispute ("does the employer accept the gap?") becomes a timestamped, tamper-evident record both sides can point to.

## Positioning
The CosmWasm contract itself queries the ME ID module and refuses an employer address without at least real-person (KYC level one) verification, and stores the level found at registration in the record. The server cannot override this rule. Only the report fingerprint goes on chain; the report stays with the worker.

## Operating Context
- Online demo: the server signs with two testnet-only demo accounts (worker, employer), so judges need no wallet and no test coins. Rate limited.
- Reads come straight from the ME testnet Hub REST from the browser; writes go through /api/demo.
- Chain: ME Network testnet, chain-id mechain_400-1, contract code 21. Blocks take about 5–10 seconds.

## Capabilities and Constraints
- Actions: submit (report hash, deadline 30 s / 60 s / 1 h, employer verified or unverified), confirm, dispute (reason fingerprint), markExpired.
- Contract errors are named (EmployerNotVerified, NotEmployer, NotPending, DeadlinePassed, DeadlineNotPassed, …) and shown to users in plain Chinese.
- Every status on screen comes from the contract (effective_status), never decided by the page.
- Interface language: Traditional Chinese; brand names (ME Network, ME ID, CosmWasm) stay as they are.

## Evidence on Hand
- Two synthetic reports: demo/synthetic-report.json, demo/synthetic-report-2.json (names, companies and amounts are fictional and must stay labelled as such).
- Real on-chain records on the testnet contract (16+), including one transaction where the contract refused an employer without ME ID.
- No real users, testimonials, legal opinions or usage statistics exist; none may be invented.

## Product Principles
1. Show the chain, don't describe it: every state on screen links to the transaction or query that proves it.
2. The rule lives in the contract; the interface only reports what the contract decided.
3. Nothing personal goes on chain; the screen says what was uploaded (a fingerprint) and what was not.
4. A judge must finish register → employer answer in under a minute without instructions.

## Accessibility & Inclusion
Status is never shown by colour alone (icon shape plus text). Works at 390 px wide.
