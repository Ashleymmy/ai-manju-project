# Canvas Retry Feedback

## Request and Cause

Canvas retry appeared unresponsive while image reference files or video mentions
and reference media loaded. Image/video running state was registered only after
those awaits. Text/audio retries also waited for snapshot persistence before
registering a request. Preparation did not participate in the visible running
state, duplicate-click guard or stop action.

## Changes

- Register a cancellable retry preparation before the first asynchronous step
  for image, video, text and audio. Existing node overlay and inspector show
  immediate feedback; the previous node/inspector error and retry box are hidden
  during the run.
- Keep the lock until the real request takes ownership. Ignore duplicate retry
  or generate clicks for the same target. Batch preparations also mark their root.
- Stop reference preparation and pending saves without subsequently submitting
  generation. Removed nodes and project changes invalidate the old preparation.
  Late completion of a canceled preparation cannot clear a newer retry's state.
- Use saved image references even if the original source node has been deleted.
  Reference-loading errors are displayed and persisted, then release the lock.
- Prevent delayed mention lookup from merging assets into a different project.
- Preserve existing generation parameters, reference files, batch success results,
  video history, API paths and backend behavior. No claim of faster model inference.

## Verification

Controller and component tests cover all four kinds, duplicate entry points,
slow references, slow saves, cancellation, late completion, project switch,
removed nodes, retryable errors and batch-root feedback with completed children.
Existing generation, history and reference tests also pass.

Browser tests use the real canvas UI at 1440x945 with intercepted APIs. Both
node and inspector retry buttons are exercised. Reference responses are held
until the test releases them; preparation feedback and cancel controls must
appear within one second, before any generation request. Cancellation submits
no job, while released references submit one job, display real mocked progress,
and allow cancellation. No live model requests or user project writes.

Screenshots inspected in `.tmp/canvas-retry-feedback-qa/`, including
`canvas-retry-feedback-vide-3222c-w-references-and-can-submit/retry-preparing.png`.

## Actual Output

```text
pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio check
$ tsc --noEmit
exit_code: 0

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio test
Test Files  205 passed (205)
Tests       1418 passed (1418)
Duration    9.89s

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio build
Director Desk: built in 4.74s
Studio: built in 5.56s
exit_code: 0

node node_modules/.pnpm/@playwright+test@1.62.1/node_modules/@playwright/test/cli.js test --config .tmp/canvas-retry-feedback.playwright.config.ts
4 passed (10.3s)

apps/api: go build ./... -> exit_code: 0
apps/api: go vet ./...   -> exit_code: 0
apps/api: go test ./...  -> exit_code: 0 (cached)

pnpm --config.verify-deps-before-run=warn --filter @basketikun/canvas-agent test
tests 4; pass 4; fail 0; duration_ms 62.5387

pnpm --config.verify-deps-before-run=warn --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests      689 passed (689)
Duration   87.92s

apps/worker: python -m compileall worker
Listing 'worker'...
exit_code: 0

apps/worker: python -m unittest discover -s tests
Ran 113 tests in 1.348s
FAILED (failures=9, errors=17, skipped=2)

git diff --check -> exit_code: 0
```

Go used `.tmp/canvas-quality-qa/go-runtime/go/bin/go.exe`; vet/test used
`.tmp/canvas-quality-qa/gomodcache`. Python used the existing
`.tmp/canvas-quality-qa/worker-venv/Scripts/python.exe` environment.

Worker failures match the previously recorded image-output validation and
Windows `signal.SIGKILL` categories. Worker was not changed. Existing pnpm
override/module-sync and Vite chunk warnings remain. No repository-wide green
claim. Earlier document-import and concurrent node-naming changes were retained.

Existing dev server remains available at http://localhost:3100. No commit/push.
