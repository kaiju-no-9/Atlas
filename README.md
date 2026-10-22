# Atlas Browser Agent

Atlas is a local-first Chrome extension foundation for grounded, user-controlled browser assistance. It is built as a pnpm workspace with a Go companion that remains optional.

## Prerequisites

- Node.js 22 or newer and pnpm 11
- Go 1.22 or newer for the optional companion service
- Chrome with Manifest V3 support

## Extension

```sh
pnpm install
pnpm dev
```

For a production build, run `pnpm build`, then load `apps/extension/.output/chrome-mv3` from `chrome://extensions` using **Load unpacked**.

The current extension foundation opens a side panel, inspects the active page after the user opens Atlas, stores task drafts locally, and manages provider settings. Browser-agent execution is added by later phases; the current Run control updates task state but does not yet perform page actions.

## Optional local companion

The self-hosted Go service is documented in [apps/backend/README.md](apps/backend/README.md). Direct BYOK model requests must continue to go from the extension to the selected model provider, never through the companion.

## Implementation status

See [state.md](state.md) for phase progress and acceptance evidence. Design specifications are in the ignored local `implementation/` folder.
