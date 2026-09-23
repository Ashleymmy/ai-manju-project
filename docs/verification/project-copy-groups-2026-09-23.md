# Project Copy and Groups Verification

## Delivered

- Project cards expose a copy action; selected projects can be copied in bulk.
- Copies receive a new project ID and an available copy title. Graph content,
  references, media, cover and generation history are preserved. Active jobs,
  local text-asset write targets and director runtime identity are detached.
- Copying from a filtered group switches to All and selects the new copies.
- Groups support creation with or without selected projects, rename, moving
  projects, filtering and dissolution without deleting projects.
- Groups persist in authenticated user preferences, separately by workspace
  scope. This is personal organization, not a new shared-folder permission model.
- Preference writes validate input and merge atomically. Stale group writes
  return 409; failed saves do not display fake success. Memory and PostgreSQL
  implementations have parity coverage.
- Existing routes, authentication and response envelopes are unchanged. Project
  creation accepts an optional cover_asset_id to create a complete copy at once.

## Actual Verification Output

Go commands ran from apps/api using the existing local Go toolchain in
.tmp/canvas-quality-qa. pnpm used --config.verify-deps-before-run=warn because
the existing dependency installation and lockfile are not fully synchronized.
No dependency installation was performed.

```text
go build ./...
exit_code: 0
go vet ./...
exit_code: 0
go test ./...
exit_code: 0
handler     14.825s
repository   0.168s
router       1.527s
service      8.767s

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio check
tsc --noEmit
exit_code: 0

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio test
Test Files  196 passed (196)
Tests       1308 passed (1308)
Duration    9.41s

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio build
vite v7.3.6: 2272 modules transformed
built in 3.29s
exit_code: 0

pnpm --config.verify-deps-before-run=warn --filter @basketikun/canvas-agent test
tests 4; pass 4; fail 0

pnpm --config.verify-deps-before-run=warn --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests      686 passed (686)

python -m compileall worker
exit_code: 0
python -m unittest discover -s tests
Ran 105 tests in 1.346s
FAILED (failures=9, errors=17, skipped=2)

node node_modules/.pnpm/@playwright+test@1.62.1/node_modules/@playwright/test/cli.js test --config .tmp/project-tools.playwright.config.ts
3 passed (9.6s)

git diff --check
exit_code: 0
```

The Windows Worker suite still reports image-output validation and SIGKILL
compatibility failures. Worker code was not changed by this task; this report
does not claim that the entire repository is green. Existing build warnings
include large Director Desk chunks and ignored workspace overrides.

## Database and Browser Coverage

A disposable PostgreSQL 15 container on 127.0.0.1:55434 was used for repository
tests. It was removed afterward; the user's database was not used for fixtures.

```text
go test ./internal/repository -run 'Test(Gorm|Memory)PreferenceModify' -v
TestMemoryPreferenceModify PASS
TestGormPreferenceModify PASS (0.84s)

go test ./internal/service -run TestCopiedProjectIndependenceParity -v
memory PASS
postgres PASS
```

Browser tests isolate all API requests with fixtures. They cover independent
copy content, source preservation, opening a copied canvas, persisted groups
after reload, moving projects, renaming/dissolving groups, failed saves,
copy selection from a filtered group, and 390px control wrapping. Browser
fixtures do not prove live end-to-end database behavior; the tests above cover
the real PostgreSQL persistence separately. No generation requests were made.

Desktop and mobile screenshots were inspected:

- .tmp/project-tools-qa/project-organization-copie-41a19-estores-groups-after-reload/project-groups-desktop.png
- .tmp/project-tools-qa/project-organization-proje-d7010-t-overlap-on-narrow-screens/project-groups-mobile.png

## Local Runtime and Handoff

The existing Vite server remains at http://localhost:3100/projects. The local
API container was rebuilt to include the new preference field and atomic save
behavior; otherwise an older API would ignore group persistence.

- API image: ai-manju-project-tools-local:20260923.
- Container: ai-manju-40-api-1, healthy after replacement.
- Existing database and asset volumes retained; no worker restart.
- Billing environment retained from the prior running container.
- Health probe http://127.0.0.1:3101/health: HTTP 200.
- Project page http://localhost:3100/projects: HTTP 200.
- Local runtime overlay: .tmp/project-tools-runtime/compose.override.json.
- Prior image remains available: ai-manju-comic-analysis-fix:7495216.

Concurrent working-tree edits were preserved. Type, architecture-import and
card-action test failures noted by the typography task have been fixed. No
commit or push was performed.

## Follow-up: Dashboard Copy Entry

The recent-canvas cards on /dashboard now expose the same copy tool as the
archive. DashboardPage wires the existing duplicateProjects, copyingIds and
disabled state into ProjectCardTools. No new copy implementation, backend
change or service restart was necessary. Copy completion refreshes the recent
list and dashboard count without navigating away.

Shared card-action tests now exercise copying from both pages, snapshot/cover
preservation, failure recovery, disabled controls during an in-flight request,
duplicate-click protection and dashboard count refresh. Browser tests cover
the new dashboard entry at 1440px and 390px and verify that the copied project
appears in All Projects. Browser API requests remain isolated test fixtures.

Actual follow-up verification output:

```text
pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio check
tsc --noEmit -> exit_code: 0

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio test -- client/src/features/projects/ProjectCardActions.test.tsx
vitest run "--" "client/src/features/projects/ProjectCardActions.test.tsx"
Test Files 196 passed (196)
Tests      1313 passed (1313)
ProjectCardActions.test.tsx: 23 tests passed
Duration   9.44s

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio build
built in 3.34s -> exit_code: 0

node node_modules/.pnpm/@playwright+test@1.62.1/node_modules/@playwright/test/cli.js test --config .tmp/project-tools.playwright.config.ts
5 passed (15.3s)

go build ./... -> exit_code: 0
go vet ./...   -> exit_code: 0
go test ./...  -> exit_code: 0
handler 14.711s; router 1.525s; service 8.816s; storage 0.469s

pnpm --config.verify-deps-before-run=warn --filter @basketikun/canvas-agent test
tests 4; pass 4; fail 0

pnpm --config.verify-deps-before-run=warn --filter @ai-manju/director-desk test
Test Files 87 passed (87)
Tests      686 passed (686)
Duration   90.85s

python -m compileall worker -> exit_code: 0
python -m unittest discover -s tests
Ran 105 tests in 1.413s
FAILED (failures=9, errors=17, skipped=2)

git diff --check -> exit_code: 0
http://localhost:3100/dashboard -> HTTP 200
```

The test command's extra separator ran the full Studio suite, not just the
named file. Windows Worker failures remain the same as above; no Worker edits
were made. The inspected final dashboard screenshots are:

- .tmp/project-tools-qa/project-organization-dashb-82cb8-ithout-navigating-at-1440px/dashboard-copy-1440.png
- .tmp/project-tools-qa/project-organization-dashb-665b1-without-navigating-at-390px/dashboard-copy-390.png

The existing dev server was retained. No commit or push was performed.
