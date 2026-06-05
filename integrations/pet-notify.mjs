#!/usr/bin/env node
// pet-notify — post a coding/agent activity event to the Doraemon desktop pet.
//
// Usage:
//   node pet-notify.mjs <kind> [source]
//
// <kind> is one of:
//   editing | prompt | thinking | tool | research | answer | ask | done | error | idle
//
// It is intentionally fire-and-forget: it never blocks the caller for more than
// a moment and always exits 0, so wiring it into an editor or an AI-agent hook
// can never slow down or break your real workflow. If the pet isn't running,
// the POST simply fails silently.
//
// It also understands Claude Code hook JSON on stdin: when called with `tool`
// it will downgrade read-only tools (Read/Grep/Glob/WebFetch/...) to `research`,
// and it derives a sensible kind from `hook_event_name` when no kind is given.

const HOST = process.env.PET_HOST ?? '127.0.0.1';
const PORT = process.env.PET_PORT ?? '53118';
const ENDPOINT = `http://${HOST}:${PORT}/activity`;
const TIMEOUT_MS = 600;

const VALID = new Set([
  'editing',
  'prompt',
  'thinking',
  'tool',
  'research',
  'answer',
  'ask',
  'done',
  'error',
  'idle'
]);

// Read-only Claude Code tools read as "research" rather than heads-down "tool".
const READ_ONLY_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'WebFetch',
  'WebSearch',
  'NotebookRead',
  'TodoWrite'
]);

// Claude Code hook event -> activity kind, used when no explicit kind is passed.
const HOOK_EVENT_KIND = {
  UserPromptSubmit: 'prompt',
  Notification: 'ask',
  PreToolUse: 'tool',
  PostToolUse: 'tool',
  Stop: 'answer',
  SubagentStop: 'answer',
  SessionStart: 'idle',
  SessionEnd: 'idle'
};

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    let data = '';
    const timer = setTimeout(() => resolve(data), 150);
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(data);
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function main() {
  let kind = process.argv[2];
  const source = process.argv[3] ?? 'cli';

  let hook = null;
  const raw = await readStdin();
  if (raw) {
    try {
      hook = JSON.parse(raw);
    } catch {
      hook = null;
    }
  }

  // Derive a kind from the Claude Code hook payload when none was passed.
  if (!kind && hook?.hook_event_name) {
    kind = HOOK_EVENT_KIND[hook.hook_event_name];
  }

  // Refine a generic "tool" event using the actual tool being run.
  if (kind === 'tool' && hook?.tool_name && READ_ONLY_TOOLS.has(hook.tool_name)) {
    kind = 'research';
  }

  if (!VALID.has(kind)) {
    // Nothing meaningful to send; succeed quietly so hooks never error out.
    process.exit(0);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, source }),
      signal: controller.signal
    });
  } catch {
    // Pet not running / unreachable — ignore.
  } finally {
    clearTimeout(timer);
  }
  process.exit(0);
}

main().catch(() => process.exit(0));
