# Codex app-server support

`codex-bridge` provides a Web UI and CLI for continuing Codex sessions across devices. The
[official App Server documentation](https://learn.chatgpt.com/docs/app-server) describes the
underlying protocol. Available features depend on the Codex version connected to Bridge.

## Pinned compatibility

`codex-bridge` v0.3.14 is pinned to Codex CLI/app-server `0.164.0`. A managed app-server startup
checks both `codex --version` and Unix WebSocket listener support before spawning the child. A
different version fails closed with an actionable message; update the constant and record a new
compatibility audit rather than silently accepting protocol drift.

Run the real-CLI gate with:

```sh
CARGO_INCREMENTAL=0 cargo test -p codex-bridge --test app_server_compat -- --ignored
```

The gate verifies the generated experimental schema contains the methods Bridge uses, then starts an
isolated app-server under a temporary `CODEX_HOME` and exercises `initialize`, `thread/list`,
`project/list`, and `model/list`.

The `0.164.0` audit additionally verified:

- `thread/start`, `turn/start`, streaming completion events, and account rate-limit events against a
  real API-key provider;
- command approval via `item/commandExecution/requestApproval`, including the accepted decision and
  completed turn;
- schema definitions for `thread/read`, `thread/resume`, `thread/queue/add`, `turn/steer`,
  `turn/interrupt`, file-change approval, command approval, and user-input requests.

Codex `0.164.0` rejects `approval_policy = "untrusted"` in `CODEX_HOME/config.toml` even though the
protocol schema still contains that enum value. Use `on-request` or `never` in the CLI configuration.
Approval requests themselves continue to use the typed app-server method above.

## Protocol boundaries

- Bridge connects to app-server over a same-user Unix WebSocket; app-server never listens publicly.
- Rollout JSONL remains the durable read model and is not copied into a second session format.
- A Bridge-managed app-server remains alive across a Bridge-only restart.
- Explicit managed app-server restart is rejected while any loaded thread is active or has queued
  input. Finish, interrupt, withdraw, or deliver that work first.
- A per-thread writer is never stolen implicitly. External or released ownership stays readable and
  queueable, while direct mutation requires explicit writer acquisition.
- App-server requests are delivered on the authenticated WebSocket event stream. The Web UI keeps
  command, file-change, and permission approvals in a fixed card and sends the typed response over
  that same socket. The former one-shot CLI approval commands were removed because they had no
  backend and could not route to a live request.

## Available in this project

- Browse projects and sessions, read long histories, inspect tool activity, and follow live work.
- Create, rename, pin, and archive sessions; choose a model and view account usage.
- Send and queue prompts, steer a running turn, withdraw queued prompts, and stop work.
- View and edit a Goal in a floating panel.
- Answer asynchronous clarification questions in a floating, nonblocking card. A reply joins the
  originating running turn; after that turn ends, the UI explicitly offers a new turn.
- Review diffs and local files, use editable voice transcription when a supported backend is
  available, and inspect managed-service status.

See the [installation guide](install.md), [Web UI streaming behavior](web-ui-streaming.md), and
[release notes](releases/) for user-facing details.
