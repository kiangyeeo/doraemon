import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';

type ManifestAction = {
  name: string;
  frames: string[];
  fps: number;
  loop: boolean;
  anchorX: number;
  anchorY: number;
  scale: number;
  nextState?: string;
};

type Manifest = {
  schemaVersion: 1;
  characterId: string;
  displayName: string;
  defaultState: string;
  window: {
    width: number;
    height: number;
  };
  stage: {
    anchorX: number;
    anchorY: number;
    defaultDisplaySize: number;
  };
  actions: ManifestAction[];
};

const character = process.argv[2] ?? 'doraemon';
const characterRoot = resolve('assets', 'characters', character);
const processedRoot = join(characterRoot, 'processed');
const manifestPath = join(characterRoot, 'manifest.json');

if (!existsSync(processedRoot) || !statSync(processedRoot).isDirectory()) {
  throw new Error(`Processed asset folder does not exist: ${processedRoot}`);
}

const existingManifest = existsSync(manifestPath)
  ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest)
  : null;
const existingActions = new Map((existingManifest?.actions ?? []).map((action) => [action.name, action]));

const actionFolders = readdirSync(processedRoot)
  .filter((entry) => statSync(join(processedRoot, entry)).isDirectory())
  .sort();

const actions = actionFolders.map((actionName) => {
  const actionDir = join(processedRoot, actionName);
  const frames = readdirSync(actionDir)
    .filter((fileName) => extname(fileName).toLowerCase() === '.png')
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map((fileName) => relative(characterRoot, join(actionDir, fileName)).split(sep).join('/'));
  const existingAction = existingActions.get(actionName);

  return {
    name: actionName,
    frames,
    fps: existingAction?.fps ?? 6,
    loop: existingAction?.loop ?? true,
    anchorX: existingAction?.anchorX ?? 128,
    anchorY: existingAction?.anchorY ?? 256,
    scale: existingAction?.scale ?? 1,
    nextState: existingAction?.nextState ?? 'idle'
  };
});

const manifest: Manifest = {
  schemaVersion: 1,
  characterId: existingManifest?.characterId ?? `${character}-local`,
  displayName: existingManifest?.displayName ?? character,
  defaultState: existingManifest?.defaultState ?? 'idle',
  window: existingManifest?.window ?? {
    width: 512,
    height: 512
  },
  stage: existingManifest?.stage ?? {
    anchorX: 256,
    anchorY: 448,
    defaultDisplaySize: 256
  },
  actions
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Updated manifest: ${manifestPath}`);
