# Atlas local companion

The Go companion is an optional self-hosted service for local search integrations. The extension's direct BYOK mode does not require this service and must never send provider credentials to it.

## Run locally

1. Copy `.env.example` to `.env` and set `ATLAS_COMPANION_TOKEN` to a random value with at least 32 characters.
2. Optionally set `ATLAS_BRAVE_SEARCH_API_KEY` to enable Brave Search.
3. Export those variables in the shell, then run `go run ./cmd/api` from this directory.

The service binds only to `127.0.0.1:8080`. `GET /healthz` is unauthenticated. `POST /v1/search` requires `Authorization: Bearer <ATLAS_COMPANION_TOKEN>` and a JSON body such as `{"query":"Chrome extension service worker","limit":5}`. Result limits are restricted to 1–10. The API key for Brave stays in this local process and is never accepted in request bodies.

Without `ATLAS_BRAVE_SEARCH_API_KEY`, search returns `503 search_unconfigured` while the health endpoint remains available.
