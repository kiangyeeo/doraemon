# Coding Activity Integrations

This folder connects the desktop pet to **real coding activity** — you typing in
VS Code / Cursor, and AI agents (Claude Code, Codex, Copilot, …) thinking,
answering, asking, finishing, or erroring. Each event drives one of the pet's
coding animation states.

## How it works

```text
editor / agent  ──HTTP POST──▶  127.0.0.1:53118/activity  ──IPC──▶  renderer state machine ──▶ animation
   (adapter)                    (Electron main process)            (useMascotState.signalActivity)
```

The pet runs a **loopback-only** HTTP server (started automatically with the
app). Anything that can send an HTTP POST to `localhost` can drive the mascot —
no plugin required.

## The HTTP contract

`POST http://127.0.0.1:53118/activity`

```json
{ "kind": "thinking", "source": "my-tool" }
```

- `kind` (required) — one of the activity kinds in the table below.
- `source` (optional) — free-form label, shown in the pet's debug log.

`GET http://127.0.0.1:53118/health` → `{ "ok": true, ... }`.

Quick test (PowerShell):

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:53118/activity -Method Post `
  -ContentType 'application/json' -Body '{"kind":"thinking","source":"test"}'
```

curl:

```bash
curl -s 127.0.0.1:53118/activity -d '{"kind":"done","source":"test"}'
```

## Activity kinds → what the pet does

| `kind`     | When to send it                                   | What the pet does                            |
| ---------- | ------------------------------------------------- | -------------------------------------------- |
| `editing`  | You are typing / editing code                     | Random drift through four coding clips (~3s) |
| `prompt`   | You sent a question/prompt to an agent            | Fixed 6-frame question/think cycle (1.5s)    |
| `thinking` | The agent is reasoning / generating               | Continuous **working timeline**              |
| `tool`     | The agent is running tools / editing / shell      | Continuous **working timeline**              |
| `research` | The agent is reading files / searching / browsing | Continuous **working timeline**              |
| `answer`   | The agent produced a reply                        | Scripted celebration, then ambient           |
| `done`     | A task finished successfully                      | Scripted celebration, then ambient           |
| `ask`      | The agent needs input / raised a doubt            | Held puzzled pose (pauses the timeline)      |
| `error`    | A task failed (error / test / build)              | Worried one-shot reaction                    |
| `idle`     | Nothing happening — stand down                    | Resumes the ambient routine                  |

`thinking`/`tool`/`research` all drive **one continuous working timeline**: a
fixed sequence of coding poses (~3s each) that advances on its own timer and
**latches on its final intense pose**. Intermittent work events never restart it,
so a turn's stop-start tool calls read as one unbroken run. `prompt` opens a new
turn (resetting the timeline), `answer`/`done` end it with the celebration, `ask`
only pauses it, and a mouse click or `idle` drops back to the ambient routine.

The kind→director map lives in [`src/shared/activity.ts`](../src/shared/activity.ts);
the concrete frame clips, ordering, and per-step timings live in
[`src/renderer/animation/codingScenes.ts`](../src/renderer/animation/codingScenes.ts).

---

## Adapters in this folder

### `pet-notify.mjs` — universal CLI poster

Fire-and-forget Node script. Never blocks the caller, always exits 0.

```bash
node integrations/pet-notify.mjs thinking my-agent
```

Wire it into anything: git hooks, npm scripts, CI watchers, a `done`/`error`
ping at the end of a build, etc. Override the target with `PET_HOST` / `PET_PORT`
env vars.

### `claude-code/` — Claude Code hooks (recommended for agent moods)

`claude-code/settings.hooks.json` maps Claude Code's lifecycle hooks onto pet
states via `pet-notify.mjs`:

| Claude Code hook   | Sent kind | Pet shows           |
| ------------------ | --------- | ------------------- |
| `UserPromptSubmit` | `prompt`  | poses your question |
| `PreToolUse`       | `tool`*   | intense coding      |
| `Notification`     | `ask`     | puzzled / needs you |
| `Stop`             | `answer`  | presenting answer   |
| `SessionEnd`       | `idle`    | back to routine     |

\*`pet-notify.mjs` auto-downgrades read-only tools (Read/Grep/Glob/WebFetch/…)
to `research`.

**Install:** merge the `hooks` block into your Claude Code `settings.json`
(`.claude/settings.json` for this project, or `~/.claude/settings.json` for all
projects) and replace `ABSOLUTE_PATH` with the path to this repo. Restart Claude
Code so it reloads hooks.

### `vscode-extension/` — VS Code **and** Cursor companion

One extension covers **both editors** — Cursor is a VS Code fork and loads the
same `.vsix`/extension folder, so there is no separate "Cursor build." It is a
plain-JS extension (no build step) that detects the editor activity the public
API actually exposes:

| Editor event             | Sent kind |
| ------------------------ | --------- |
| You type in a file       | `editing` |
| You save a file          | `tool`    |
| `doraemonPet.signal` cmd | any kind  |

(It deliberately does **not** emit `idle` — the renderer relaxes a session ~9s
after the last event, and an editor `idle` would stomp an in-progress agent mood.)

**Run it (dev):** open `integrations/vscode-extension/` in VS Code / Cursor and
press `F5` (Extension Development Host).

**Install it (persistent):** copy the folder into your editor's extensions dir
and reload the window (`Developer: Reload Window`):

- VS Code → `~/.vscode/extensions/doraemon-pet-activity-0.1.0`
- Cursor → `~/.cursor/extensions/doraemon-pet-activity-0.1.0`

Configure host/port under the `doraemonPet.*` settings. The `doraemonPet.signal`
command lets keybindings, tasks, or other extensions push any agent mood.

### `codex/` — OpenAI Codex CLI hooks

Codex's lifecycle hooks mirror Claude Code's and hand each hook a JSON payload
on stdin, so the **same `pet-notify.mjs`** drives both. `codex/config.hooks.toml`
maps:

| Codex hook          | Sent kind | Pet shows           |
| ------------------- | --------- | ------------------- |
| `UserPromptSubmit`  | `prompt`  | poses your question |
| `PreToolUse`        | `tool`    | intense coding      |
| `PermissionRequest` | `ask`     | puzzled / needs you |
| `Stop`              | `answer`  | presenting answer   |
| `SessionStart`      | `idle`    | back to routine     |

**Install:** merge the `[[hooks.*]]` blocks from `codex/config.hooks.toml` into
your **user-level** Codex config (`~/.codex/config.toml`) and replace
`ABSOLUTE_PATH` with the path to this repo. Restart Codex. (Codex has no
`SessionEnd`; `Stop` ends each turn. The `matcher` is omitted on `PreToolUse` so
it fires for every tool — Bash, apply_patch, MCP.)

### Copilot / other agents

Any agent that supports lifecycle hooks or shell callbacks can call
`pet-notify.mjs <kind>` (or POST directly). Map its "prompt submitted / thinking
/ tool run / responded / awaiting input / finished / failed" events onto the
kinds above. If the agent passes a hook payload with a `hook_event_name` field
on stdin, you can omit `<kind>` entirely and let `pet-notify.mjs` derive it.
