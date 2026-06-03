import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';

type ImportOptions = {
  source: string;
  character: string;
  action: string;
};

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage(): never {
  throw new Error(
    'Usage: npm run assets:import -- --source <folder> --character doraemon --action idle'
  );
}

function parseOptions(): ImportOptions {
  const source = readOption('source');
  const character = readOption('character') ?? 'doraemon';
  const action = readOption('action');

  if (!source || !action) {
    usage();
  }

  return {
    source,
    character,
    action
  };
}

const options = parseOptions();
const sourceDir = resolve(options.source);
const destinationDir = resolve('assets', 'characters', options.character, 'raw', options.action);

if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
  throw new Error(`Source folder does not exist: ${sourceDir}`);
}

mkdirSync(destinationDir, { recursive: true });

const pngFiles = readdirSync(sourceDir)
  .filter((fileName) => extname(fileName).toLowerCase() === '.png')
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

if (pngFiles.length === 0) {
  throw new Error(`No PNG files found in ${sourceDir}`);
}

for (const fileName of pngFiles) {
  copyFileSync(join(sourceDir, fileName), join(destinationDir, basename(fileName)));
}

console.log(`Imported ${pngFiles.length} PNG frame(s) to ${destinationDir}`);
