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
| Repository baseline | In progress | Repository initially contained only ignored implementation blueprints; no `state.md`, source tree, or project guidance was present. |
| Backend: local companion foundation | Ready for push approval | `apps/backend/` contains an authenticated loopback-only Go HTTP server, health endpoint, bounded Brave Search endpoint, and environment template. `go build ./...`, `go vet ./...`, `gofmt`, and diff whitespace review succeeded. |
| Frontend: Chrome extension | Not started | Begin after backend foundation has been reviewed and approved for push. |
| Phase 0 contracts/docs/evals | In progress | Zod contracts are drafted in `packages/contracts/src/`; architecture and threat documents are drafted. Permission document and benchmark data remain, and the contracts need integration into the root workspace. |
| Phases 1–9 | Not started | Track against each phase blueprint; do not mark complete until its stated exit criteria have evidence. |

## Push gate

Before every GitHub push, present the specific branch, commit/change summary, and review findings and ask the user to approve that push. Push only the approved feature branch; never push this work to `main`.

## Backend review notes

- The listener address is fixed to IPv4 loopback; startup fails when the local bearer token is absent or shorter than 32 characters.
- Search input is authenticated, bounded, and schema constrained. The Brave credential comes only from the companion environment, redirects are refused to prevent credential forwarding, and provider errors do not log user query URLs.
- CORS allows extension origins for the browser client integration; other origins do not receive cross-origin permission.
- Build and static analysis passed. No automated test suite has been added or run.
