# Temporary Selection Connection Ports

## Scope

- Temporary marquee selections now reuse the confirmed group's left/right ports and hide member-node ports.
- Preview paths, completed paths and drop targets use the selection frame. Parallel member edges are displayed as one group connection without losing their underlying references.
- Shared ports connect all visible members in either direction, including when creating a node on blank canvas. Invalid, internal and duplicate connections remain excluded.
- Click-to-connect preserves the temporary selection until the connection completes.
- Group ports remain above existing edge hit areas, so another drag can start after a connection is present.
- Cancelling restores individual ports. Confirming retains the same port placement. Temporary groups remain excluded from saved snapshots.
- Existing Ctrl/Shift multi-selection fan-out is preserved; unrelated selections are not added to a different source's connection.
- No commit, push, deployment, real generation or real project writes were performed.

## Browser Verification

Reused the existing server at http://localhost:3100. Playwright used a separate browser context with all application API traffic mocked.

```text
node node_modules/.pnpm/@playwright+test@1.62.1/node_modules/@playwright/test/cli.js test --config .tmp/selection-connections.playwright.config.ts

7 passed (39.1s)
```

Coverage includes 50%, 80% and 100% zoom, desktop 1440x1000, narrow viewport 390x844, both port directions, existing/new nodes, repeated confirmed-group connections, click-connect, incoming connections, cancel/confirm, snapshot persistence and Ctrl multi-selection. No browser page errors were observed.

Screenshots inspected under `.tmp/selection-connections-qa/`:

- `canvas-selection-connectio-f5c0e--individual-ports-on-cancel/temporary-selection.png`
- `canvas-selection-connectio-f5c0e--individual-ports-on-cancel/confirmed-group.png`
- `canvas-selection-connectio-d6b1f--individual-ports-on-cancel/temporary-selection-mobile.png`
- `canvas-selection-connectio-d73ba-ting-node-and-to-a-new-node/selection-connections.png`

The first browser run exposed an existing edge hit area covering a group port; the stacking-context fix was applied and the final full run passed. The Ctrl regression test closes the first node's inspector before selecting the second node, matching an unobstructed user interaction.

## Required Checks

pnpm commands used `--config.verify-deps-before-run=warn`. pnpm printed its existing warning about `pnpm.overrides`; no dependency or lockfile changes were made for this task.

### Studio

```text
pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio check
$ tsc --noEmit
Exit code: 0

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio test
Test Files  184 passed (184)
     Tests  1172 passed (1172)
  Duration  8.55s

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio build
vite v7.3.6 building client environment for production...
2166 modules transformed.
built in 3.04s
Exit code: 0
```

The dependency Director Desk build also succeeded, with its existing large-chunk warning.

### API

Used `.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe` with `GOMODCACHE=D:/AImanju4.0/.tmp/canvas-quality-qa/gomodcache` in `apps/api`.

```text
go build ./...
Exit code: 0 (no output)
go vet ./...
Exit code: 0 (no output)
go test ./...
ok github.com/ai-manju/api/internal/handler (cached)
ok github.com/ai-manju/api/internal/repository (cached)
ok github.com/ai-manju/api/internal/router (cached)
ok github.com/ai-manju/api/internal/service (cached)
Exit code: 0 (all tested packages passed)
```

### Canvas Agent / Director Desk

```text
pnpm --config.verify-deps-before-run=warn --filter @basketikun/canvas-agent test
tests 4
pass 4
fail 0

pnpm --config.verify-deps-before-run=warn --filter @ai-manju/director-desk test
Test Files  87 passed (87)
     Tests  686 passed (686)
  Duration  89.85s
```

### Worker

Used `.tmp/canvas-quality-qa/worker-venv/Scripts/python.exe` in `apps/worker`. Worker files were not changed for this task.

```text
python -m compileall worker
Listing 'worker'...
Compiling 'worker\\provider.py'...
Exit code: 0

python -m unittest discover -s tests
ERROR: test_shutdown_has_shared_deadline_and_kills_stuck_pool
  File "worker/runtime.py", line 50, in stop_children
    os.killpg(child.pid, signal.SIGKILL)
AttributeError: module 'signal' has no attribute 'SIGKILL'. Did you mean: 'SIGILL'?
Ran 90 tests in 0.603s
FAILED (errors=1, skipped=2)
```

This pre-existing Windows-specific runtime test failure is unrelated to canvas connection ports. It was not silently skipped or changed.

```text
git diff --check
Exit code: 0 (no output)
```
