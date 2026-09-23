# Canvas Minimap Drag Navigation

## Scope

The minimap supports continuous mouse, pen and touch pointer navigation.
Grabbing inside the viewport keeps the initial offset without jumping. Clicking
outside still centers the view, and dragging continues beyond the map edge via
pointer capture. Release, cancellation, lost capture, window blur and unmount
end the gesture. Canvas zoom, node geometry and selection are preserved.

The world context is at least twice the viewport dimensions, reducing the white
viewport rectangle while preserving its true world-space mapping. Map bounds
stay frozen during a drag to avoid chasing a moving target. Only nodes receive
a minimum visible size; distant nodes cannot inflate the viewport's true size.
The opening animation is now opacity-only so the hit area does not move/scale.

Functional files: domain/minimap.ts, ui/CanvasMinimap.tsx, ui/CanvasStage.tsx,
controllers/stage-interaction/{controller,types}.ts, CanvasWorkspaceContent.tsx,
and the minimap selectors in canvas/styles.css. Unit and browser tests added.

Concurrent inspector, batch-download, node-toolbar, dashboard, image-footer and
lockfile changes were left intact. No commit, push, real generation or real
project mutation. The existing server at http://localhost:3100 remains running.

## Browser Verification

155-node mocked project in Chrome at 1920x945 and 390x945; touch at 390x844.

- Viewport rectangle occupies no more than half the map width/height.
- Off-center grab does not jump, successive drag movements map proportionally.
- Node markers stay fixed during dragging; outside-map capture keeps moving.
- Release stops movement; click-to-center still works at unchanged zoom.
- Selection stays intact, including nodes culled from the main viewport.
- A saved mocked snapshot retains all 155 original node positions and sizes.
- Touch cancellation releases capture; closing/reopening the map works.
- No page errors. All /api/ requests mocked; Vite source requests not intercepted.

Screenshots inspected:

- .tmp/canvas-minimap-qa/canvas-minimap-minimap-fol-df728-hout-moving-nodes-at-1920px/minimap-drag-1920.png
- .tmp/canvas-minimap-qa/canvas-minimap-minimap-fol-e83cc-thout-moving-nodes-at-390px/minimap-drag-390.png

Initial browser checks caught the opening scale animation interfering with drag
coordinates. Other test corrections account for non-scaling SVG stroke bounds
and main-canvas node culling; selection is checked against all minimap markers.

## Actual Verification Output

```text
pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio check
$ tsc --noEmit
exit_code: 0

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio test
Test Files  200 passed (200)
Tests       1349 passed (1349)
Duration    10.22s

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio build
Director Desk: built in 5.42s
Studio: built in 5.79s
exit_code: 0

node node_modules/.pnpm/@playwright+test@1.62.1/node_modules/@playwright/test/cli.js test --config .tmp/canvas-minimap.playwright.config.ts
3 passed (11.1s)

apps/api: go build ./... -> exit_code: 0
apps/api: go vet ./...   -> exit_code: 0
apps/api: go test ./...  -> exit_code: 0 (cached)

pnpm --config.verify-deps-before-run=warn --filter @basketikun/canvas-agent test
tests 4; pass 4; fail 0
duration_ms 74.9558

pnpm --config.verify-deps-before-run=warn --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests      686 passed (686)
Duration   106.96s

apps/worker: python -m compileall worker
Listing 'worker'...
exit_code: 0

apps/worker: python -m unittest discover -s tests
Ran 105 tests in 1.483s
FAILED (failures=9, errors=17, skipped=2)

git diff --check -> exit_code: 0
```

Go/Python used the existing .tmp/canvas-quality-qa toolchains. The Windows
Worker image-output validation and SIGKILL failures match the previous report;
Worker is unchanged. The entire repository is not claimed green. Existing pnpm
configuration and Vite chunk-size/static-dynamic-import warnings remain.

The isolated browser config uses testDir ../apps/studio/e2e, testMatch
canvas-minimap.spec.ts, one worker, baseURL http://localhost:3100, channel chrome,
headless true and hasTouch true. No production or shared test configuration was
changed for this request.
