.PHONY: dev build typecheck lint clean

dev:
	pnpm --filter @atlas/extension dev

build:
	pnpm run build

typecheck:
	pnpm run typecheck

lint:
	pnpm run lint

clean:
	rm -rf apps/extension/.output apps/extension/.wxt node_modules
