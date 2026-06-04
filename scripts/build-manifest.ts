import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';

type StateName =
  | 'idle'
  | 'walk'
  | 'sleep'
  | 'happy'
  | 'thinking'
  | 'coding'
  | 'gadget'
  | 'eating'
  | 'angry'
  | 'misc';

type StateConfig = {
  fps: number;
  loop: boolean;
  frames: string[];
};

type Manifest = {
  character: string;
  version: string;
  canvas: { width: number; height: number };
  defaultScale: number;
  states: Record<string, StateConfig>;
};

// Ordered classification rules. The first rule whose keyword appears in the
// frame's file name wins, so the order here is significant: e.g. a file named
// "coding_thinking" matches `thinking` before `coding`. Anything that matches
// no rule falls through to `misc`.
const CLASSIFICATION_RULES: { state: StateName; keywords: string[] }[] = [
  { state: 'idle', keywords: ['idle', 'calm', 'normal'] },
  { state: 'walk', keywords: ['walk'] },
  { state: 'sleep', keywords: ['sleep', 'nap', 'fatigue'] },
  { state: 'happy', keywords: ['happy', 'joy', 'excitement', 'pride'] },
  { state: 'thinking', keywords: ['thinking', 'contemplation', 'confusion'] },
  { state: 'coding', keywords: ['coding', 'focus'] },
  { state: 'gadget', keywords: ['gadget', 'pocket', 'take_copter', 'time_travel'] },
  { state: 'eating', keywords: ['eating', 'hungry', 'dorayaki'] },
  { state: 'angry', keywords: ['angry', 'frustration'] }
];

// Default playback settings per state, also defining the output order of states.
const STATE_DEFAULTS: { name: StateName; fps: number; loop: boolean }[] = [
  { name: 'idle', fps: 6, loop: true },
  { name: 'walk', fps: 8, loop: true },
  { name: 'sleep', fps: 3, loop: true },
  { name: 'happy', fps: 8, loop: false },
  { name: 'thinking', fps: 4, loop: true },
  { name: 'coding', fps: 6, loop: true },
  { name: 'gadget', fps: 7, loop: false },
  { name: 'eating', fps: 6, loop: true },
  { name: 'angry', fps: 6, loop: false },
  { name: 'misc', fps: 6, loop: true }
];

const DEFAULT_SCALE = 0.55;
const CANVAS = { width: 512, height: 512 };

function toPosixPath(pathName: string): string {
  return pathName.split(sep).join('/');
}

function classifyFrame(filePath: string): StateName {
  const stem = basename(filePath, extname(filePath)).toLowerCase();

  for (const rule of CLASSIFICATION_RULES) {
    if (rule.keywords.some((keyword) => stem.includes(keyword))) {
      return rule.state;
    }
  }

  return 'misc';
}

function scanPngFiles(root: string): string[] {
  const found: string[] = [];

  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }

      if (entry.isFile() && extname(entry.name).toLowerCase() === '.png') {
        found.push(fullPath);
      }
    }
  }

  visit(root);
  return found;
}

function naturalByFileName(left: string, right: string): number {
  const byName = basename(left).localeCompare(basename(right), undefined, { numeric: true });
  if (byName !== 0) {
    return byName;
  }

  return left.localeCompare(right, undefined, { numeric: true });
}

function readProjectVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.1.0';
  } catch {
    return '0.1.0';
  }
}

// Preserve any manually tuned fps / loop values if a manifest in the new
// `states` shape already exists, so re-running the script does not clobber edits.
function readExistingStates(manifestPath: string): Map<string, { fps: number; loop: boolean }> {
  const existing = new Map<string, { fps: number; loop: boolean }>();

  if (!existsSync(manifestPath)) {
    return existing;
  }

  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<Manifest>;
    if (parsed.states && typeof parsed.states === 'object') {
      for (const [name, config] of Object.entries(parsed.states)) {
        if (config && typeof config.fps === 'number' && typeof config.loop === 'boolean') {
          existing.set(name, { fps: config.fps, loop: config.loop });
        }
      }
    }
  } catch {
    // Ignore an unparseable or legacy-format manifest and fall back to defaults.
  }

  return existing;
}

function buildPreviewHtml(character: string, manifest: Manifest): string {
  const states = Object.entries(manifest.states).map(([name, config]) => ({
    name,
    fps: config.fps,
    loop: config.loop,
    frames: config.frames
  }));
  const data = JSON.stringify({ canvas: manifest.canvas, states }, null, 2);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${character} animation preview</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px;
    font-family: "Segoe UI", system-ui, sans-serif;
    background: #1e2430;
    color: #e7ecf3;
  }
  h1 { margin: 0 0 4px; font-size: 20px; }
  p.sub { margin: 0 0 24px; color: #9aa6b8; font-size: 13px; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 16px;
  }
  .card {
    background: #262d3a;
    border: 1px solid #333c4d;
    border-radius: 12px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .stage {
    position: relative;
    width: 100%;
    aspect-ratio: 1 / 1;
    border-radius: 8px;
    background-color: #f7f9fb;
    background-image:
      linear-gradient(45deg, #e2e7ee 25%, transparent 25%),
      linear-gradient(-45deg, #e2e7ee 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #e2e7ee 75%),
      linear-gradient(-45deg, transparent 75%, #e2e7ee 75%);
    background-size: 20px 20px;
    background-position: 0 0, 0 10px, 10px -10px, -10px 0;
    overflow: hidden;
  }
  .stage img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    image-rendering: auto;
  }
  .meta { display: flex; justify-content: space-between; align-items: baseline; }
  .name { font-weight: 600; font-size: 15px; text-transform: capitalize; }
  .count { color: #9aa6b8; font-size: 12px; }
  .tags { display: flex; gap: 6px; flex-wrap: wrap; }
  .tag {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    background: #313a4a;
    color: #b9c4d6;
  }
  .tag.empty { background: #4a2630; color: #ffb4c0; }
  .controls { display: flex; gap: 8px; align-items: center; font-size: 12px; color: #9aa6b8; }
  input[type="range"] { flex: 1; }
</style>
</head>
<body>
  <h1>${character} &mdash; animation preview</h1>
  <p class="sub">Generated by <code>scripts/build-manifest.ts</code>. Each card loops its frames at the state's configured fps. Open this file directly in a browser from the character folder.</p>
  <div class="controls">
    <label>Global speed</label>
    <input id="speed" type="range" min="0.25" max="2" step="0.25" value="1" />
    <span id="speedLabel">1.00x</span>
  </div>
  <div class="grid" id="grid"></div>
<script>
  const manifest = ${data};
  let speedMultiplier = 1;
  const players = [];

  function makeCard(state) {
    const card = document.createElement('div');
    card.className = 'card';

    const stage = document.createElement('div');
    stage.className = 'stage';
    const img = document.createElement('img');
    if (state.frames.length > 0) {
      img.src = state.frames[0];
    }
    img.alt = state.name;
    stage.appendChild(img);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = state.name;
    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = state.frames.length + ' frame' + (state.frames.length === 1 ? '' : 's');
    meta.appendChild(name);
    meta.appendChild(count);

    const tags = document.createElement('div');
    tags.className = 'tags';
    const fpsTag = document.createElement('span');
    fpsTag.className = 'tag';
    fpsTag.textContent = state.fps + ' fps';
    const loopTag = document.createElement('span');
    loopTag.className = 'tag';
    loopTag.textContent = state.loop ? 'loop' : 'once';
    tags.appendChild(fpsTag);
    tags.appendChild(loopTag);
    if (state.frames.length === 0) {
      const emptyTag = document.createElement('span');
      emptyTag.className = 'tag empty';
      emptyTag.textContent = 'no frames';
      tags.appendChild(emptyTag);
    }

    card.appendChild(stage);
    card.appendChild(meta);
    card.appendChild(tags);

    if (state.frames.length > 1) {
      players.push({ img, frames: state.frames, fps: state.fps, index: 0, elapsed: 0 });
    }
    return card;
  }

  const grid = document.getElementById('grid');
  for (const state of manifest.states) {
    grid.appendChild(makeCard(state));
  }

  let last = performance.now();
  function tick(now) {
    const dt = (now - last) / 1000;
    last = now;
    for (const player of players) {
      player.elapsed += dt * speedMultiplier;
      const frameDuration = 1 / player.fps;
      while (player.elapsed >= frameDuration) {
        player.elapsed -= frameDuration;
        player.index = (player.index + 1) % player.frames.length;
        player.img.src = player.frames[player.index];
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  const speed = document.getElementById('speed');
  const speedLabel = document.getElementById('speedLabel');
  speed.addEventListener('input', () => {
    speedMultiplier = Number(speed.value);
    speedLabel.textContent = speedMultiplier.toFixed(2) + 'x';
  });
</script>
</body>
</html>
`;
}

function buildWarningsMarkdown(
  character: string,
  emptyStates: StateName[],
  miscCount: number,
  miscSample: string[]
): string {
  const lines = [
    `# Manifest warnings (${character})`,
    '',
    `Generated: ${new Date().toISOString()}`,
    ''
  ];

  if (emptyStates.length === 0) {
    lines.push('No empty states. Every classified state has at least one frame.');
  } else {
    lines.push('## Empty states');
    lines.push('');
    lines.push('These states matched no processed frames. They remain in the manifest with an empty `frames` array so the renderer can reference them, but they will not animate until you add matching art or move frames into them manually.');
    lines.push('');
    for (const state of emptyStates) {
      lines.push(`- \`${state}\``);
    }
  }

  lines.push('');
  lines.push('## Unclassified frames');
  lines.push('');
  if (miscCount === 0) {
    lines.push('No frames fell through to `misc`.');
  } else {
    lines.push(`${miscCount} frame(s) did not match any keyword rule and were placed in \`misc\`. Review these and, if needed, rename the source art or extend the classification keywords in \`scripts/build-manifest.ts\`.`);
    lines.push('');
    for (const sample of miscSample) {
      lines.push(`- ${sample}`);
    }
    if (miscCount > miscSample.length) {
      lines.push(`- … and ${miscCount - miscSample.length} more`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

function main(): void {
  const character = process.argv[2] ?? 'doraemon';
  const characterRoot = resolve('assets', 'characters', character);
  const processedRoot = join(characterRoot, 'processed');
  const manifestPath = join(characterRoot, 'manifest.json');
  const warningsPath = join(characterRoot, 'manifest-warnings.md');
  const previewPath = join(characterRoot, 'manifest-preview.html');

  if (!existsSync(processedRoot) || !statSync(processedRoot).isDirectory()) {
    throw new Error(`Processed asset folder does not exist: ${processedRoot}`);
  }

  const existingStates = readExistingStates(manifestPath);

  const grouped = new Map<StateName, string[]>();
  for (const { name } of STATE_DEFAULTS) {
    grouped.set(name, []);
  }

  for (const filePath of scanPngFiles(processedRoot)) {
    const state = classifyFrame(filePath);
    const relativePath = toPosixPath(relative(characterRoot, filePath));
    grouped.get(state)!.push(relativePath);
  }

  const states: Record<string, StateConfig> = {};
  for (const { name, fps, loop } of STATE_DEFAULTS) {
    const frames = grouped.get(name)!.sort(naturalByFileName);
    const preserved = existingStates.get(name);
    states[name] = {
      fps: preserved?.fps ?? fps,
      loop: preserved?.loop ?? loop,
      frames
    };
  }

  const manifest: Manifest = {
    character,
    version: readProjectVersion(),
    canvas: CANVAS,
    defaultScale: DEFAULT_SCALE,
    states
  };

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const emptyStates = STATE_DEFAULTS.map((entry) => entry.name).filter(
    (name) => states[name].frames.length === 0
  );
  const miscFrames = states.misc.frames;
  const warnings = buildWarningsMarkdown(
    character,
    emptyStates,
    miscFrames.length,
    miscFrames.slice(0, 25).map((frame) => basename(frame))
  );
  writeFileSync(warningsPath, warnings, 'utf8');

  writeFileSync(previewPath, buildPreviewHtml(character, manifest), 'utf8');

  const total = Object.values(states).reduce((sum, state) => sum + state.frames.length, 0);
  console.log(`Built manifest for ${character}: ${total} frame(s) across ${STATE_DEFAULTS.length} state(s).`);
  for (const { name } of STATE_DEFAULTS) {
    console.log(`  ${name.padEnd(9)} ${states[name].frames.length} frame(s)`);
  }
  if (emptyStates.length > 0) {
    console.warn(`[warning] empty state(s): ${emptyStates.join(', ')} (see ${relative(process.cwd(), warningsPath)})`);
  }
  console.log(`Manifest written to ${manifestPath}`);
  console.log(`Warnings written to ${warningsPath}`);
  console.log(`Preview written to ${previewPath}`);
}

main();
