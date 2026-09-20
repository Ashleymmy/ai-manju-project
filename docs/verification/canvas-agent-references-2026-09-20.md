# Canvas Agent References Verification

Date: 2026-09-20

## Scope

- With Agent open, successive ordinary node clicks accumulate references above the composer without modifier keys. Image/video references show thumbnails only, with an individual remove button and an accessible name/tooltip.
- References retain insertion order, are deduplicated, and survive blank-canvas clicks. Removed nodes can be added again by clicking them, even when still selected. Deleting a node or starting a new conversation clears its reference. Opening Agent seeds the current selection.
- Only user-driven canvas selections accumulate references; programmatic selection of generation results cannot pollute the draft. The canvas picker also adds real references.
- Online Agent requests include image bytes, titles and node IDs. Private asset URLs are not sent as model image URLs.
- Generation operations receive the same standard `@[node:...]` tokens as the node editor, including when the model omits `referenceNodeIds`.
- References are captured at send time and retained across tool confirmation and tool-loop steps. Missing or overwritten media blocks generation instead of silently using a different image.
- Reference sources are protected from self-referencing generation; the Agent is instructed to generate on new nodes.
- Read failures and timeouts are reported. Interruptions and project changes abort reference loading. Existing interruption behavior is preserved.
- History stores reference descriptors, not base64 image bytes. Local Agent generation tools receive the reference tokens; local bridge visual analysis is not covered by this change.
- Agent panel width is constrained on narrow screens.

## Automated Results

Commands below were run from the repository root unless otherwise indicated. Output excerpts are from the actual runs.

```text
pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio check
$ tsc --noEmit
Exit code: 0

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio test
Test Files  172 passed (172)
     Tests  1071 passed (1071)
Exit code: 0

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio build
vite v6.4.3 building for production...
2294 modules transformed.
vite v7.3.6 building client environment for production...
built in 3.02s
Exit code: 0

pnpm --config.verify-deps-before-run=warn --filter @basketikun/canvas-agent test
tests 4
pass 4
fail 0
Exit code: 0

pnpm --config.verify-deps-before-run=warn --filter @ai-manju/director-desk test
Test Files  87 passed (87)
     Tests  686 passed (686)
Exit code: 0

node node_modules/.pnpm/@playwright+test@1.62.1/node_modules/@playwright/test/cli.js test --config .tmp/agent-references.playwright.config.ts
4 passed (11.1s)
Exit code: 0
```

The build required approved access to the existing pnpm tool cache. Existing lockfile/dependency-sync and Director Desk chunk-size warnings remain; no dependency installation or lockfile changes were made for this task.

## Browser Coverage

Chrome against the existing localhost:3100 development server, in isolated browser contexts with all application API endpoints mocked. No real user project or billable provider was modified or invoked.

1. Click two image nodes normally, without Shift/Ctrl; check both nameless thumbnails persist even after a blank-canvas click. Verify the Agent request includes two matching base64 images. Change the draft while awaiting approval, then confirm; verify the actual multipart image-edit request still contains both original image files and the generated prompt. Generated results are not automatically added to draft references.
2. Remove one reference and verify only one image reaches the request. Check panel/reference/composer bounds at 390x844.
3. Fail the reference-image endpoint and verify a visible error, no Agent request, and no generation request.
4. Click two images and two videos successively. Verify four nameless thumbnails, including loaded video posters. Remove the currently selected video and click it again to restore it. Send and confirm generation; verify the request reaches the mocked Seedance provider boundary with two image inputs and two original video data URLs. The provider endpoint deliberately returns a test error after capturing the payload; no paid generation runs.

Desktop 1440x1000 and narrow 390x844 screenshots were visually inspected. The initial narrow-screen test exposed the panel's fixed inline width; this was corrected and the final browser suite passed.

Screenshots:

- `.tmp/agent-references-qa/canvas-agent-references-or-cc76a-ss-both-files-to-generation/agent-references-desktop.png`
- `.tmp/agent-references-qa/canvas-agent-references-re-9db4d-yout-fits-a-narrow-viewport/agent-references-mobile.png`
- `.tmp/agent-references-qa/canvas-agent-references-im-32f4c-both-clips-reach-generation/accumulated-image-video-references.png`

## Environment Limitations

In `apps/api`, each of `go build ./...`, `go vet ./...`, and `go test ./...` returned exit code 1:

```text
The term 'go' is not recognized as a name of a cmdlet, function, script file, or executable program.
```

In `apps/worker`, using the bundled Python runtime:

```text
python -m compileall worker
Listing 'worker'...
Exit code: 0

python -m unittest discover -s tests
Ran 22 tests in 0.024s
FAILED (errors=10, skipped=1)
Exit code: 1
```

Worker errors are missing `psycopg`, `billiard`, `fastapi`, `requests`, `redis`, `httpx`, and `celery`, plus Windows lacking `signal.SIGKILL`. No backend or Worker source was changed for this task.

All pre-existing workspace modifications were retained. No commit, push, or deployment was performed.
