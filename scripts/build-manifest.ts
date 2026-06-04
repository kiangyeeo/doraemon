import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';

const STATE_NAMES = [
  'idle',
  'greeting',
  'walk',
  'sleep',
  'rest',
  'happy',
  'curiosity',
  'connection',
  'thinking',
  'confusion',
  'chatQuestion',
  'chatAnswer',
  'coding',
  'codingThinking',
  'codingIntense',
  'codingCelebrate',
  'research',
  'gadgetSearch',
  'gadgetExplain',
  'gadgetUse',
  'gadgetSurprise',
  'copter',
  'timeTravel',
  'door',
  'eating',
  'hungry',
  'angry',
  'longing',
  'concern',
  'awe',
  'gratitude',
  'satisfaction',
  'protect',
  'randomThought',
  'calm',
  'hope',
  'wonder',
  'contemplation',
  'drag',
  'dragEnd',
  'misc'
] as const;

type StateName = (typeof STATE_NAMES)[number];

type Matcher = string | RegExp;

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

type StateDefinition = {
  name: StateName;
  fps: number;
  loop: boolean;
  include: Matcher[];
};

const DEFAULT_SCALE = 0.55;
const CANVAS = { width: 512, height: 512 };

// Scene-first state design. Each state draws frames from a SINGLE coherent art
// source so a clip never jumps between unrelated styles mid-loop (e.g. idle no
// longer flips between a calm face, a standing pose and a stray sketch every few
// frames). Distinct moods that used to be merged are now their own states so the
// idle rotation can hold each one, looping cleanly, for a comfortable while.
const STATE_DEFINITIONS: StateDefinition[] = [
  {
    name: 'idle',
    fps: 6,
    loop: true,
    include: [/\/idle\/idle_\d+\.png$/]
  },
  {
    name: 'greeting',
    fps: 7,
    loop: false,
    include: [/\/action\/action-greeting-\d+\.png$/]
  },
  {
    name: 'walk',
    fps: 8,
    loop: true,
    include: [/\/walk\/walk_\d+\.png$/, /\/action\/action-walk-\d+\.png$/]
  },
  {
    name: 'sleep',
    fps: 0.35,
    loop: true,
    include: [
      /\/sleep\/sleep_\d+\.png$/,
      /\/action\/action-nap-\d+\.png$/,
      /\/misc\/shime(?:20|20a|20b|21|21a)\.png$/
    ]
  },
  {
    name: 'rest',
    fps: 4,
    loop: true,
    include: [/\/action\/action-rest-\d+\.png$/]
  },
  {
    name: 'happy',
    fps: 8,
    loop: false,
    include: [/\/happy\/happy_\d+\.png$/]
  },
  {
    name: 'curiosity',
    fps: 5,
    loop: true,
    include: [/\/emotion\/emotion-curiosity-\d+\.png$/]
  },
  {
    name: 'connection',
    fps: 5,
    loop: false,
    include: [/\/emotion\/emotion-connection-\d+\.png$/]
  },
  {
    name: 'thinking',
    fps: 4,
    loop: true,
    include: [/\/thinking\/thinking_\d+\.png$/]
  },
  {
    name: 'confusion',
    fps: 4,
    loop: false,
    include: [/\/emotion\/emotion-confusion-\d+\.png$/]
  },
  {
    name: 'chatQuestion',
    fps: 6,
    loop: true,
    include: [/\/action\/action-chat_question-\d+\.png$/]
  },
  {
    name: 'chatAnswer',
    fps: 6,
    loop: true,
    include: [/\/action\/action-chat_answer-\d+\.png$/]
  },
  {
    name: 'coding',
    fps: 6,
    loop: true,
    include: [
      /\/action\/action-coding_typing-\d+\.png$/,
      /\/coding\/coding(?:_\d+|(?:2|3|4|9|10|11)?)\.png$/
    ]
  },
  {
    name: 'codingThinking',
    fps: 5,
    loop: true,
    include: [/\/action\/action-coding_thinking-\d+\.png$/, /\/coding\/codingthinking\d+\.png$/]
  },
  {
    name: 'codingIntense',
    fps: 8,
    loop: true,
    include: [/\/coding\/codingintense\d*\.png$/]
  },
  {
    name: 'codingCelebrate',
    fps: 8,
    loop: false,
    include: [/\/coding\/codingcelebrate\d+\.png$/]
  },
  {
    name: 'research',
    fps: 5,
    loop: true,
    include: [/\/action\/action-research-\d+\.png$/]
  },
  {
    name: 'gadgetSearch',
    fps: 6,
    loop: false,
    include: [/\/action\/action-gadget_search-\d+\.png$/]
  },
  {
    name: 'gadgetExplain',
    fps: 5,
    loop: false,
    include: [/\/action\/action-explain_gadget-\d+\.png$/]
  },
  {
    name: 'gadgetUse',
    fps: 7,
    loop: false,
    include: [/\/gadget\/gadget_\d+\.png$/, /\/action\/action-gadget_use-\d+\.png$/]
  },
  {
    name: 'gadgetSurprise',
    fps: 7,
    loop: false,
    include: [/\/action\/action-gadget_surprise-\d+\.png$/]
  },
  {
    name: 'copter',
    fps: 8,
    loop: false,
    include: [/\/action\/action-take_copter-\d+\.png$/, /\/misc\/shime(?:15|16|17|22|23|23a|23b|23c|24|25)\.png$/]
  },
  {
    name: 'timeTravel',
    fps: 7,
    loop: false,
    include: [/\/action\/action-time_travel-\d+\.png$/]
  },
  {
    name: 'door',
    fps: 8,
    loop: false,
    include: [/\/misc\/shime(?:40|41[a-n]?|42|43|44|45|46|47|48|49|50)\.png$/]
  },
  {
    name: 'eating',
    fps: 6,
    loop: true,
    include: [/\/eating\/eating_\d+\.png$/, /\/action\/action-eating-\d+\.png$/]
  },
  {
    name: 'hungry',
    fps: 5,
    loop: false,
    include: [/\/action\/action-hungry-\d+\.png$/]
  },
  {
    name: 'angry',
    fps: 6,
    loop: false,
    include: [/\/action\/action-angry-\d+\.png$/]
  },
  {
    name: 'longing',
    fps: 4,
    loop: true,
    include: [/\/emotion\/emotion-longing-\d+\.png$/]
  },
  {
    name: 'concern',
    fps: 4,
    loop: false,
    include: [/\/emotion\/emotion-concern-\d+\.png$/]
  },
  {
    name: 'awe',
    fps: 6,
    loop: true,
    include: [/\/emotion\/emotion-awe-\d+\.png$/]
  },
  {
    name: 'gratitude',
    fps: 5,
    loop: false,
    include: [/\/emotion\/emotion-gratitude-\d+\.png$/]
  },
  {
    name: 'satisfaction',
    fps: 5,
    loop: true,
    include: [/\/emotion\/emotion-satisfaction-\d+\.png$/]
  },
  {
    name: 'protect',
    fps: 5,
    loop: true,
    include: [/\/action\/action-protect-\d+\.png$/]
  },
  {
    name: 'randomThought',
    fps: 4,
    loop: true,
    include: [/\/action\/action-random_thought-\d+\.png$/]
  },
  // Calm idle moods, each a clean single-source loop used by the idle rotation.
  {
    name: 'calm',
    fps: 4,
    loop: true,
    include: [/\/emotion\/emotion-calm-\d+\.png$/]
  },
  {
    name: 'hope',
    fps: 4,
    loop: true,
    include: [/\/emotion\/emotion-hope-\d+\.png$/]
  },
  {
    name: 'wonder',
    fps: 4,
    loop: true,
    include: [/\/emotion\/emotion-wonder-\d+\.png$/]
  },
  {
    name: 'contemplation',
    fps: 4,
    loop: true,
    include: [/\/emotion\/emotion-contemplation-\d+\.png$/]
  },
  {
    name: 'drag',
    fps: 6,
    loop: true,
    include: [/\/drag\/drag_\d+\.png$/]
  },
  {
    // "Slams down" when released: shime18 is the impact (star burst, dizzy eyes),
    // shime19 is the settle right after. Played exactly once by the controller.
    name: 'dragEnd',
    fps: 5,
    loop: false,
    include: [/\/misc\/shime(?:18|19)\.png$/]
  },
  {
    name: 'misc',
    fps: 6,
    loop: true,
    include: []
  }
];

function toPosixPath(pathName: string): string {
  return pathName.split(sep).join('/');
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

function matchesFrame(framePath: string, matcher: Matcher): boolean {
  const normalized = framePath.toLowerCase();
  if (typeof matcher === 'string') {
    return normalized.includes(matcher.toLowerCase());
  }

  return matcher.test(normalized);
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
  <h1>${character} - animation preview</h1>
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
    lines.push('No empty states. Every designed state has at least one frame.');
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
  lines.push('## Unassigned frames');
  lines.push('');
  if (miscCount === 0) {
    lines.push('No frames fell through to `misc`.');
  } else {
    lines.push(`${miscCount} frame(s) were not assigned to a designed state and were placed in \`misc\`. Review these and, if needed, extend \`STATE_DEFINITIONS\` in \`scripts/build-manifest.ts\`.`);
    lines.push('');
    for (const sample of miscSample) {
      lines.push(`- ${sample}`);
    }
    if (miscCount > miscSample.length) {
      lines.push(`- ... and ${miscCount - miscSample.length} more`);
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
  const processedFrames = scanPngFiles(processedRoot)
    .map((filePath) => toPosixPath(relative(characterRoot, filePath)))
    .sort(naturalByFileName);
  const referenced = new Set<string>();
  const states: Record<string, StateConfig> = {};

  for (const definition of STATE_DEFINITIONS) {
    if (definition.name === 'misc') {
      continue;
    }

    const frames = processedFrames.filter((frame) =>
      definition.include.some((matcher) => matchesFrame(frame, matcher))
    );
    for (const frame of frames) {
      referenced.add(frame);
    }

    const preserved = existingStates.get(definition.name);
    states[definition.name] = {
      fps: preserved?.fps ?? definition.fps,
      loop: preserved?.loop ?? definition.loop,
      frames
    };
  }

  const miscDefinition = STATE_DEFINITIONS.find((definition) => definition.name === 'misc')!;
  const preservedMisc = existingStates.get('misc');
  states.misc = {
    fps: preservedMisc?.fps ?? miscDefinition.fps,
    loop: preservedMisc?.loop ?? miscDefinition.loop,
    frames: processedFrames.filter((frame) => !referenced.has(frame))
  };

  const orderedStates: Record<string, StateConfig> = {};
  for (const name of STATE_NAMES) {
    orderedStates[name] = states[name];
  }

  const manifest: Manifest = {
    character,
    version: readProjectVersion(),
    canvas: CANVAS,
    defaultScale: DEFAULT_SCALE,
    states: orderedStates
  };

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const emptyStates = STATE_NAMES.filter(
    (name) => name !== 'misc' && manifest.states[name].frames.length === 0
  );
  const miscFrames = manifest.states.misc.frames;
  const warnings = buildWarningsMarkdown(
    character,
    emptyStates,
    miscFrames.length,
    miscFrames.slice(0, 25).map((frame) => basename(frame))
  );
  writeFileSync(warningsPath, warnings, 'utf8');

  writeFileSync(previewPath, buildPreviewHtml(character, manifest), 'utf8');

  const totalAssigned = Object.entries(manifest.states)
    .filter(([name]) => name !== 'misc')
    .reduce((sum, [, state]) => sum + state.frames.length, 0);
  const uniqueAssigned = referenced.size;
  console.log(
    `Built manifest for ${character}: ${uniqueAssigned} unique frame(s), ${totalAssigned} assigned use(s), ${STATE_NAMES.length} state(s).`
  );
  for (const name of STATE_NAMES) {
    console.log(`  ${name.padEnd(16)} ${manifest.states[name].frames.length} frame(s)`);
  }
  if (emptyStates.length > 0) {
    console.warn(`[warning] empty state(s): ${emptyStates.join(', ')} (see ${relative(process.cwd(), warningsPath)})`);
  }
  console.log(`Manifest written to ${manifestPath}`);
  console.log(`Warnings written to ${warningsPath}`);
  console.log(`Preview written to ${previewPath}`);
}

main();
