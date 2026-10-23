# Browser evaluation fixtures

The 25 benchmark tasks in `tasks/benchmarks.json` point to deterministic pages in `fixtures/`. Run the integrity check with:

```sh
node evals/run-fixtures.mjs --check
```

Serve the fixtures locally for manual browser work with:

```sh
node evals/run-fixtures.mjs --serve
```

Open `http://127.0.0.1:4173/` to browse the scenarios. The server binds only to loopback, serves fixture files without directory listings, and makes no external requests. Set `ATLAS_FIXTURE_PORT` to choose another local port.

The current runner checks benchmark structure, fixture coverage, scenario markers, and the absence of external scripts, network calls, or external form submission targets. It does not claim that Atlas completes the tasks; task outcome assertions will be connected to the browser tools and agent loop in their implementation phases.
