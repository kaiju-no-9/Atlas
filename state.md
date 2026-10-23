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
| Frontend: Chrome extension foundation | In progress | GitHub confirms branch `extension-foundation` contains `473585d` (WXT MV3 foundation, local benchmark fixtures, and activeTab permission clarification). The current local work adds a schema-validated isolated DOM action injector; it is under review and not yet committed. The direct Node test suite passes 19/19, and contract package typecheck passes with the local TypeScript compiler. The WXT production build passed earlier. Full extension typecheck and ESLint stalled without diagnostics in this environment; pnpm also attempts package fetches while registry DNS is unavailable. Chrome reload/inactive-worker observations showed task data remained visible, but explicit worker termination and state recovery still need verification. Tests use Node's built-in runner rather than the specified Vitest. |
| Phase 0 contracts/docs/evals | Foundation complete; runtime acceptance continues with later phases | Zod contracts and architecture/security documents are present. All 25 blueprint tasks now resolve to local HTML fixtures. `node evals/run-fixtures.mjs --check` validates IDs, task metadata, fixture paths, required scenario markers, and blocks external scripts, network calls, and external form submissions. End-to-end agent behavior for these cases will be exercised as the browser tools and agent loop land. |
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
- The WXT production build passed earlier. The direct Node test command now passes 19 tests, covering message validation, active-tab content action validation/injection, task stop status, storage access levels, key storage/clearing, migrations, serialized task updates, and recovery alarm setup. The contracts package typecheck passes using the local TypeScript compiler. Full extension typecheck and ESLint both stalled without diagnostics in this environment; pnpm package fetches fail while registry DNS is unavailable. Vitest remains unverified. The unpacked extension loaded in Chrome and its side panel displayed the active-page summary and settings screen. Data persisted through an extension reload and while the worker was inactive; explicit worker termination and recovery verification remain outstanding.
