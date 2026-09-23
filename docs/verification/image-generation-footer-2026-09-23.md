# Image Generation Footer

## Change

The image generation page now has an independently scrolling settings region
and a non-scrolling submission footer. The generate button, progress indicator,
stop action and credit estimate remain in the middle pane's footer.

Desktop panes fit below the existing fixed topbar so the button is visible
without first scrolling down the page. On mobile, the composer retains a
bounded settings scroller; the overall stacked page can still scroll between
history, settings and results. The footer leaves room for the floating Agent
control on narrow screens. Scroll anchoring is disabled within the workbench
to prevent reference additions and generation state transitions moving the
outer page. Credit text keeps its layout space during generation.

Only ImagePage.tsx, image/styles.css and the new image-generation-footer.spec.ts
are functional changes for this request. Shared generation APIs, pricing,
reference submission and cancellation behavior are unchanged. Unrelated
dashboard changes in the working tree were left intact. No backend restart,
commit or push was performed.

## Browser Verification

Chrome at 1920x945, 1440x900, 1280x720 and 390x844:

- Scroll settings to bottom and back using the mouse wheel; footer position
  and height stay within one pixel, with no settings/footer overlap.
- The final aspect-ratio option remains reachable and settings do not overflow
  horizontally.
- Submit from the top of settings; the real frontend submission path includes
  the entered prompt, model, dimensions and count.
- Progress, disabled generation and the stop action work without moving the
  footer. The longer automatic-specification credit label is included.
- Upload 11 reference files; all thumbnails decode. Scroll again and submit
  an edit; the multipart request includes all 11 references.
- No browser runtime errors. All /api/ requests are mocked: no real jobs,
  paid generation, uploads or user data changes were made by these tests.

Initial test failures were fixed: the fixture first intercepted Vite source
URLs containing /api/, then used an incorrect accessible name for the existing
AUTO pseudo-element. The mobile test subsequently caught a genuine scroll
anchoring jump after reference additions, which was corrected in CSS.

Desktop, mobile, generation-state and reference screenshots were inspected.
Examples:

- .tmp/image-footer-qa/image-generation-footer-ge-a7c19-e-settings-scroll-at-1920px/footer-top-1920.png
- .tmp/image-footer-qa/image-generation-footer-ge-a7c19-e-settings-scroll-at-1920px/footer-bottom-1920.png
- .tmp/image-footer-qa/image-generation-footer-ge-ecb80-le-settings-scroll-at-390px/footer-top-390.png
- .tmp/image-footer-qa/image-generation-footer-ge-ecb80-le-settings-scroll-at-390px/footer-generating-390.png

## Actual Command Output

```text
pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio check
tsc --noEmit
exit_code: 0

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio test
Test Files 198 passed (198)
Tests      1327 passed (1327)
Duration   10.45s

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio build
built in 10.50s
exit_code: 0

node node_modules/.pnpm/@playwright+test@1.62.1/node_modules/@playwright/test/cli.js test --config .tmp/image-footer.playwright.config.ts
4 passed (27.4s)

apps/api: go build ./... -> exit_code: 0
apps/api: go vet ./...   -> exit_code: 0
apps/api: go test ./...  -> exit_code: 0 (cached)

pnpm --config.verify-deps-before-run=warn --filter @basketikun/canvas-agent test
tests 4; pass 4; fail 0

pnpm --config.verify-deps-before-run=warn --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests      686 passed (686)
Duration   119.34s

apps/worker: python -m compileall worker -> exit_code: 0
apps/worker: python -m unittest discover -s tests
Ran 105 tests in 1.405s
FAILED (failures=9, errors=17, skipped=2)

git diff --check -> exit_code: 0
http://localhost:3100/image -> HTTP 200
```

Go and Python used the existing .tmp/canvas-quality-qa toolchains. The Windows
Worker image-output validation and SIGKILL failures are unchanged from previous
verification; Worker was not modified. The entire repository is not reported
as green. Existing pnpm dependency-sync warnings and large-chunk build warnings
remain; no dependency installation was performed. The existing Vite server is
still available at http://localhost:3100/image.
