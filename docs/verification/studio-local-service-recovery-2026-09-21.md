# Local Studio Service Recovery

## Evidence and Scope

- On inspection, TCP 3100 had no listener and the previous Vite PID 14816 no longer existed. TCP 3101 and the API container remained healthy.
- The previous Vite logs contained only a successful startup, with no application exception or shutdown cause. The exact external cause of the original process disappearance is not established.
- A plain background process had no recovery mechanism. This task configures local Windows process supervision; it does not change frontend business logic, restart the API/Worker, modify project data, commit, push or deploy remotely.
- The host clock is UTC+08:00 (2026-09-22); this report uses the thread's America/Chicago date (2026-09-21).

## Local Configuration

- Windows task: `AI-Manju-Studio-Local`, running as the current interactive user with limited privileges, without a stored password.
- Runtime script: `D:/AImanju4.0/.tmp/studio-service/run-studio.ps1`.
- Logs: `D:/AImanju4.0/.tmp/studio-service/service-events.log` and per-start `managed-*.out.log` / `managed-*.err.log`.
- Task Scheduler, not the assistant's terminal, owns the supervisor process. No visible terminal window is opened.
- Vite listens only on `127.0.0.1:3100`, uses `--strictPort`, and never kills another listener.
- The supervisor restarts an exited child after a five-second delay. A one-minute task trigger recovers a stopped supervisor; `IgnoreNew` prevents duplicate task instances. User logon also starts it. There is no task execution time limit.
- Recovery requires the user to be logged in and the repository/runtime paths to remain available. It is not an uptime guarantee for machine shutdown, disabled tasks or deleted dependencies.

The initial Task Scheduler restart-on-failure setting alone did not restart a manually launched failed task in this environment. The final configuration uses the supervisor loop and periodic task trigger instead.

## Fault Injection Results

Only newly created, command-line-verified local frontend processes were terminated for these tests. Backend services were not stopped.

```text
Child recovery:
PreviousPid     : 2304
RecoveredPid    : 900
RecoverySeconds : 6.7
Recovered canvas HTTP 200

Supervisor recovery:
PreviousManagerPid  : 44400
RecoveredManagerPid : 48400
RecoverySeconds    : 60.1
LocalAddress       : 127.0.0.1
LocalPort          : 3100
OwningProcess      : 900
Canvas after supervisor recovery HTTP 200

TaskName           : AI-Manju-Studio-Local
State              : Running
MultipleInstances  : IgnoreNew
ExecutionTimeLimit : PT0S
```

The existing frontend child survived the supervisor recovery and was not duplicated or replaced. The recovered supervisor's parent was Windows `svchost.exe` PID 3236, independent of the assistant command launcher.

```text
Refresh runtime HTTP 200
Login HTTP 200
/health: success=true, db=ok, storage=postgres
```

## Required Project Checks

No application source files were edited by this task. These checks ran against the shared working tree, which contains concurrent changes.

```text
pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio check
$ tsc --noEmit
Exit code: 0

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio test
Test Files  189 passed (189)
     Tests  1188 passed (1188)
  Duration  9.28s

pnpm --config.verify-deps-before-run=warn --filter ai-manhua-studio build
vite v7.3.6 building client environment for production...
built in 3.60s
Exit code: 0

pnpm --config.verify-deps-before-run=warn --filter @basketikun/canvas-agent test
tests 4
pass 4
fail 0

pnpm --config.verify-deps-before-run=warn --filter @ai-manju/director-desk test
Test Files  87 passed (87)
     Tests  686 passed (686)
  Duration  97.65s
```

pnpm reported existing override and lockfile/module-sync warnings. The dependency build reported the existing large-chunk warning. No package installation or lockfile update was performed.

API used the local Go runtime and cache under `.tmp/canvas-quality-qa`:

```text
go build ./... : exit 0, no output
go vet ./...   : exit 0, no output
go test ./...  : exit 0
ok github.com/ai-manju/api/internal/handler 14.419s
ok github.com/ai-manju/api/internal/repository 0.184s
ok github.com/ai-manju/api/internal/router 1.522s
ok github.com/ai-manju/api/internal/service 2.544s
All remaining tested packages passed.
```

Worker used `.tmp/canvas-quality-qa/worker-venv/Scripts/python.exe`:

```text
python -m compileall worker
Listing 'worker'...
Compiling 'worker\\image_output_validation.py'...
Exit code: 0

python -m unittest discover -s tests
Ran 92 tests in 0.657s
FAILED (failures=5, errors=8, skipped=2)
```

Worker failures are in the concurrent image-output validation work (`image_output_unreadable` vs `image_output_size_mismatch` and unreadable-image exceptions) and the known Windows runtime test (`signal.SIGKILL` unavailable). These are unrelated to the local frontend service and were not modified or hidden.

## Operation and Removal

Inspect with `Get-ScheduledTask -TaskName AI-Manju-Studio-Local` and the local service log. To intentionally stop automatic recovery, first disable the task, then stop it:

```powershell
Disable-ScheduledTask -TaskName AI-Manju-Studio-Local
Stop-ScheduledTask -TaskName AI-Manju-Studio-Local
```

If a frontend child survived an earlier supervisor termination, inspect the current 3100 listener and its Vite command line before stopping that specific process. Do not kill unrelated Node processes.

To resume:

```powershell
Enable-ScheduledTask -TaskName AI-Manju-Studio-Local
Start-ScheduledTask -TaskName AI-Manju-Studio-Local
```

To remove supervision permanently, disable/stop it first and then use `Unregister-ScheduledTask -TaskName AI-Manju-Studio-Local`. The ignored runtime script and logs are local to this machine; preserve them while the task is enabled.
