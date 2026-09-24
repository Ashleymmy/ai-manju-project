# Agent Document Import

## Scope and Behavior

Replaced the filename-only attachment placeholder with real document extraction
and model-request content. Available in both the canvas Agent and standalone
Studio Agent via the existing plus menu / upload attachment action, or by
dropping files onto the composer.

Supported: DOCX, XLSX, XLS, TXT, MD, CSV, TSV, JSON and LOG. Legacy Word DOC is
explicitly rejected with instructions to save as DOCX. Images inside documents,
OCR, PDFs, macros, document formatting and formula recalculation are not part
of this feature. Word paragraphs/tables and all populated Excel worksheets are
read as text. Excel uses formatted cell values and cached formula results; a
formula without a cached value is retained as source, never executed. TXT
decoding supports UTF-8, BOM-marked UTF-16 and legacy Chinese GB18030.

Mammoth 1.12.3 and SheetJS-compatible @e965/xlsx 0.20.3 are exact-version
dependencies, loaded inside a terminable module worker. ZIP index validation
uses the existing @zip.js/zip.js dependency. Original files are read locally;
extracted text is sent to the selected model only when the user sends a message.
Existing image/video references and generation/tool APIs are unchanged.

Limits: 5 files per message, 10 MiB per file, 60,000 characters per file,
120,000 combined characters, 20-second worker timeout, 2,048 ZIP entries,
50 MiB declared expanded size and 100,000 spreadsheet range cells. Oversized,
empty, corrupt and protected files are rejected, not silently truncated. Pending
or failed attachments block submission until they are ready or removed.

The composer shows filenames, status, character counts, expandable plaintext
previews and remove actions. Files are frozen into each sent message and included
in the existing recent-message context. They persist in the existing local
conversation store, not a new shared server file library. Storage quota failure
now warns instead of silently losing persisted content. Conversation/project
switch and unmount cancel outstanding reads; project switching cannot save the
old project's messages into the new project.

Welcome content shares the message scroller so the composer remains visible on
narrow screens, including when multiple document previews are open.

## Verification

Real generated DOCX, XLSX, XLS, TXT and CSV fixtures pass through browser file
selection/drop, worker parsing, message UI, persistence and the real frontend
API serializer. The API is intercepted, with no paid generation, external model
calls, real uploads or user project writes. Verified canvas and standalone
Agent at 1440x945 and 390x844, on both Vite dev and a production build preview.

- Every Word marker, table text and both Excel sheet names/values appear in the
  outgoing request body, not just filenames.
- Import alone sends no AI request. Removed XLS content is absent on send.
- CSV drop works; a sixth file does not exceed the five-file limit.
- Follow-up requests retain document content. Reload/history selection restores
  sent files. Corrupt DOCX produces an error and disables submission.
- Previews remain plain text. Send stays onscreen, with no horizontal overflow.
- No browser page errors. Desktop/mobile screenshots inspected under
  `.tmp/agent-documents-qa/` (`attachments-preview.png`, `attachments-error.png`).
- Focused unit coverage verifies decoding, all supported formats, bounds,
  cancellation, worker timeout, removal, project/conversation isolation,
  document-only sending, persistence and unchanged media reference behavior.

Initial verification found and fixed: module worker code-splitting required ES
worker output; the welcome section pushed the composer outside short panels.
The browser fixture was also updated to dismiss the asynchronous release notice.

## Actual Output

```text
pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio check
$ tsc --noEmit
exit_code: 0

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio test
Test Files  204 passed (204)
Tests       1387 passed (1387)
Duration    9.52s

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio build
Director Desk: built in 3.86s
Studio: built in 5.42s
exit_code: 0

Focused document/parser/storage tests
Test Files 4 passed (4)
Tests      30 passed (30)
Duration   1.64s

Playwright: .tmp/agent-documents.playwright.config.ts
Dev (including drop/count): 4 passed (23.0s)
Production preview (including drop/count): 4 passed (21.6s)

apps/api: go build ./... -> exit_code: 0
apps/api: go vet ./...   -> exit_code: 0
apps/api: go test ./...  -> exit_code: 0 (cached)

pnpm --filter @basketikun/canvas-agent test
tests 4; pass 4; fail 0; duration_ms 65.5773

pnpm --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests      689 passed (689)
Duration   87.49s

apps/worker: python -m compileall worker -> exit_code: 0
apps/worker: python -m unittest discover -s tests
Ran 113 tests in 1.377s
FAILED (failures=9, errors=17, skipped=2)

git diff --check -> exit_code: 0
http://127.0.0.1:3100/canvas/proj_4ef6e1850465272f -> HTTP 200
```

Worker's Windows image-output validation/SIGKILL failures match the preexisting
failure categories; Worker was not changed. Existing pnpm override/module-sync
and Vite chunk warnings remain. The prior lockfile override and package ordering
were preserved after dependency installation. No repository-wide green claim.

Existing dev server at http://localhost:3100 remains available. The isolated
production preview on 33108 was stopped after tests. Concurrent node-title and
generation changes were left untouched. No commit or push.
