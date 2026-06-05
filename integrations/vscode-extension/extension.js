// Doraemon Pet Activity — VS Code / Cursor companion extension.
//
// Detects the parts of "coding activity" the editor reliably exposes and posts
// them to the desktop pet's loopback activity server:
//   - You typing in a real file        -> editing
//   - The window going idle for a while -> idle
//   - Saving a file                     -> tool (a concrete code action)
//   - A `doraemonPet.signal` command    -> any kind (for keybindings / tasks /
//                                          other extensions to drive agent moods)
//
// AI-agent "thinking / answering / asking" states are best driven by that
// agent's own hooks (e.g. Claude Code hooks calling pet-notify.mjs), because no
// public VS Code API reliably reports another extension's chat/agent state.

const http = require('node:http');
const vscode = require('vscode');

/** @param {string} kind */
function postActivity(kind) {
  const config = vscode.workspace.getConfiguration('doraemonPet');
  const host = config.get('host', '127.0.0.1');
  const port = config.get('port', 53118);
  const body = JSON.stringify({ kind, source: 'vscode' });

  const request = http.request(
    {
      host,
      port,
      path: '/activity',
      method: 'POST',
      timeout: 600,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    },
    (response) => {
      response.resume(); // drain
    }
  );
  // Fire-and-forget: never let a missing pet disrupt the editor.
  request.on('error', () => {});
  request.on('timeout', () => request.destroy());
  request.write(body);
  request.end();
}

/** @param {vscode.ExtensionContext} context */
function activate(context) {
  const config = vscode.workspace.getConfiguration('doraemonPet');
  const debounceMs = config.get('editingDebounceMs', 400);

  let lastEditingAt = 0;

  // NOTE: the extension deliberately does NOT emit `idle`. The pet's renderer
  // already relaxes a coding/agent session back to its ambient routine ~9s
  // after the last event, so an editor-driven `idle` is redundant — and worse,
  // it would stomp an in-progress *agent* mood (chatQuestion/answer/thinking)
  // the moment you stop typing to read a reply. Standing down is left to the
  // renderer's own hold timers.

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      // Only real files, and ignore output/log/scm virtual documents.
      if (event.document.uri.scheme !== 'file' || event.contentChanges.length === 0) {
        return;
      }
      const now = Date.now();
      if (now - lastEditingAt >= debounceMs) {
        lastEditingAt = now;
        postActivity('editing');
      }
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.uri.scheme === 'file') {
        postActivity('tool');
      }
    }),
    vscode.commands.registerCommand('doraemonPet.signal', async (kind) => {
      const value =
        typeof kind === 'string'
          ? kind
          : await vscode.window.showQuickPick(
              ['editing', 'prompt', 'thinking', 'tool', 'research', 'answer', 'ask', 'done', 'error', 'idle'],
              { placeHolder: 'Activity signal to send to the desktop pet' }
            );
      if (value) {
        postActivity(value);
      }
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
