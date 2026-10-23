# Atlas implementation state

This file tracks work against the specifications in `implementation/`. Work is delivered in reviewable feature branches; each branch is reviewed before requesting approval to push. No branch is pushed until the user approves that push.

## Agreed implementation order

1. Build the optional self-hosted backend first, while preserving the product rule that direct BYOK mode never depends on or sends credentials through the backend.
2. Review and request approval to push each completed backend increment on a descriptive branch.
3. Build the browser extension frontend and its client integration after the backend foundation.
4. Continue through the documented implementation phases, updating this tracker as acceptance criteria are met.

## Current state

| Area | State | Evidence / next work |
|---|---|---|
| Repository baseline | Established | The repo now has a tracked implementation state file, shared contracts, backend foundation, extension workspace, and architecture/security documentation; phase-specific completion is tracked separately. |
| Backend: local companion foundation | Pushed for review | The reviewed commits are on GitHub as `local-companion-api` (renamed from `codex/local-companion-api` at the user's request). No changes were pushed to `main`. |
| Frontend: Chrome extension foundation | In progress | GitHub confirms branch `extension-foundation` contains `529ce89`. The current local follow-up adds a repository recreation test for persisted settings and task recovery. Direct Node tests pass 22/22; contracts and full extension TypeScript checks pass. The current WXT production build stalled silently and was stopped after several minutes. Earlier unpacked Chrome testing showed active-tab inspection and reload persistence, but current code still needs a fresh unpacked load and actual service-worker termination/restart check. The `TRUSTED_CONTEXTS` setting is unit-tested, but direct content-context proof that stored credentials are inaccessible remains outstanding. Tests use Node's built-in runner rather than the specified Vitest. |
| Phase 0 contracts/docs/evals | Foundation complete; runtime acceptance continues with later phases | Zod contracts and architecture/security documents are present. All 25 blueprint tasks now resolve to local HTML fixtures. `node evals/run-fixtures.mjs --check` validates IDs, task metadata, fixture paths, required scenario markers, and blocks external scripts, network calls, and external form submissions. End-to-end agent behavior for these cases will be exercised as the browser tools and agent loop land. |
| Phase 1 acceptance | In progress | Stop control and strict TypeScript checks pass; current automated suite passes 22 tests. Remaining acceptance work: complete a current WXT production build, load that build in Chrome and recheck active-tab inspection, terminate/restart the MV3 worker and verify settings/tasks, and prove a page content context cannot access keys. The blueprint specifies Vitest; tests currently use Node's built-in runner. |
| Phases 2–9 | Not started | Track against each phase blueprint; do not mark complete until its stated exit criteria have evidence. |

## Push gate

Before every GitHub push, present the specific branch, commit/change summary, and review findings and ask the user to approve that push. Push only the approved feature branch; never push this work to `main`.

## Backend review notes

- The listener address is fixed to IPv4 loopback; startup fails when the local bearer token is absent or shorter than 32 characters.
- Search input is authenticated, bounded, and schema constrained. The Brave credential comes only from the companion environment, redirects are refused to prevent credential forwarding, and provider errors do not log user query URLs.
- CORS allows extension origins for the browser client integration; other origins do not receive cross-origin permission.
- Build and static analysis passed. No automated test suite has been added or run.

## Frontend foundation review

- WXT generated a Manifest V3 Chrome extension with the side panel at `sidepanel.html` and the required active-tab, storage, tabs, scripting, alarms, and side-panel permissions.
- Side-panel tasks and settings use the background message router. Task data is stored in `chrome.storage.local`; provider keys use `chrome.storage.session` unless the user opts into local persistence. Both storage areas are restricted to trusted extension contexts.
- The task controls currently persist UI state only. Browser-agent execution is intentionally not represented as working until the agent-loop phase is implemented.
- The direct Node test command now passes 22 tests, covering message validation, active-tab content action validation/injection, task stop status, storage access levels, key storage/clearing and serialized settings updates, migrations, serialized task updates, repository recreation recovery, and recovery alarm setup. Contracts and full extension TypeScript checks pass using local compilers. The current WXT production build stalled without diagnostics for several minutes and was stopped; the earlier successful build predates the latest content-action changes. Vitest remains unverified. Earlier Chrome testing confirmed active-tab inspection, side-panel rendering, and persistence through an extension reload; current build load, actual worker termination/restart, and direct content-context credential isolation remain outstanding.
