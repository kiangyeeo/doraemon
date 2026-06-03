import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const character = process.argv[2] ?? 'doraemon';
const rawRoot = resolve('assets', 'characters', character, 'raw');
const processedRoot = resolve('assets', 'characters', character, 'processed');

if (!existsSync(rawRoot) || !statSync(rawRoot).isDirectory()) {
  throw new Error(`Raw asset folder does not exist: ${rawRoot}`);
}

mkdirSync(processedRoot, { recursive: true });

const actions = readdirSync(rawRoot).filter((entry) => {
  const actionPath = join(rawRoot, entry);
  return statSync(actionPath).isDirectory();
});

for (const action of actions) {
  const sourceDir = join(rawRoot, action);
  const destinationDir = join(processedRoot, action);
  mkdirSync(destinationDir, { recursive: true });

  const frames = readdirSync(sourceDir)
    .filter((fileName) => extname(fileName).toLowerCase() === '.png')
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  frames.forEach((frame, index) => {
    const paddedIndex = String(index).padStart(3, '0');
    copyFileSync(join(sourceDir, frame), join(destinationDir, `${action}_${paddedIndex}.png`));
  });

  console.log(`Normalized ${frames.length} frame(s) for ${action}`);
}
