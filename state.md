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
| Frontend: Chrome extension foundation | In progress | `extension-foundation` contains WXT MV3 setup, side panel, typed message routing, active-tab summary, local storage, provider settings, and startup recovery-alarm recreation. TypeScript check passes; 14 built-in Node tests pass, including recovery-alarm setup and persisted pending-task inspection. WXT production build passes and the generated MV3 manifest includes the side panel and alarm permission. The unpacked extension was reloaded in Chrome; the existing task remained visible after the service worker was inactive, and a tab switch refreshed the active-page summary. The tests use Node's built-in runner rather than the specified Vitest, and lint remains unverified because the `typescript-eslint` package payload is missing locally and registry access previously returned `ECONNRESET`. |
| Phase 0 contracts/docs/evals | In progress | Zod contracts are integrated into the root workspace; architecture, threat, and permission documents are present. `evals/tasks/benchmarks.json` now contains the 25 blueprint tasks and passes JSON/count/unique-ID checks. Fixture pages, an eval runner, and the remaining Phase 0 exit evidence still need to be implemented/verified. |
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
- `pnpm run typecheck` and the WXT production build pass. The unpacked extension loaded in Chrome and its side panel displayed the active-page summary and settings screen. The 11 Node tests pass, covering message validation, task stop status, storage access levels, key storage/clearing, migrations, and serialized task updates. `pnpm run lint` currently fails before source analysis because the `typescript-eslint` package payload is absent from the local pnpm store despite being declared and locked; registry fetch attempts returned `ECONNRESET`. Worker-restart validation remains outstanding.
