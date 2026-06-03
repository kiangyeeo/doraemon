import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';

type AssetCategory = 'emotion' | 'action' | 'motion' | 'coding' | 'misc';
type AssetExtension = '.png' | '.svg';

type ImportOptions = {
  source: string;
};

type AssetCandidate = {
  sourcePath: string;
  targetPath: string;
  category: AssetCategory;
  extension: AssetExtension;
  fileName: string;
};

const RAW_CATEGORIES: AssetCategory[] = ['emotion', 'action', 'motion', 'coding', 'misc'];
const MOTION_WORDS = ['walk', 'run', 'climb', 'fall', 'sleep', 'idle'];
const SKIP_DIRECTORIES = new Set([
  '.git',
  '.kiro',
  'node_modules',
  'out',
  'dist',
  'build',
  'coverage',
  '.next',
  '.vite'
]);

const SKIP_PATH_MARKERS = [
  '/browser-extension/icons/',
  '/docs/assets/',
  '/assets/showcase/'
];

const SKIP_FILE_MARKERS = ['screenshot', 'showcase', 'preview', 'thumbnail', 'profpic'];

function usage(): never {
  throw new Error('Usage: npm run assets:import -- --source <local AlleyBo55/doraemon folder>');
}

function readOption(name: string): string | undefined {
  const exactIndex = process.argv.indexOf(`--${name}`);
  if (exactIndex >= 0) {
    return process.argv[exactIndex + 1];
  }

  const withEquals = process.argv.find((argument) => argument.startsWith(`--${name}=`));
  if (withEquals) {
    return withEquals.slice(name.length + 3);
  }

  return undefined;
}

function parseOptions(): ImportOptions {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    usage();
  }

  const source = readOption('source');
  if (!source) {
    usage();
  }

  return { source };
}

function toPosixPath(pathName: string): string {
  return pathName.split(sep).join('/');
}

function scanAssetFiles(root: string): string[] {
  const found: string[] = [];

  function visit(directory: string): void {
    const entries = readdirSync(directory, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name.toLowerCase())) {
          visit(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = extname(entry.name).toLowerCase();
      if (extension === '.png' || extension === '.svg') {
        found.push(fullPath);
      }
    }
  }

  visit(root);
  return found.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function shouldSkipSourceFile(sourceRoot: string, filePath: string): boolean {
  const relativePath = `/${toPosixPath(relative(sourceRoot, filePath)).toLowerCase()}`;
  const fileName = basename(filePath).toLowerCase();

  return (
    SKIP_PATH_MARKERS.some((marker) => relativePath.includes(marker)) ||
    SKIP_FILE_MARKERS.some((marker) => fileName.includes(marker))
  );
}

function isLikelyDesktopPetAsset(sourceRoot: string, filePath: string): boolean {
  if (shouldSkipSourceFile(sourceRoot, filePath)) {
    return false;
  }

  const relativePath = toPosixPath(relative(sourceRoot, filePath)).toLowerCase();
  const pathHints = ['public/', 'renderer/public/', 'assets/', 'sprites', 'dora-sprites', 'shime'];
  const fileName = basename(filePath).toLowerCase();
  const nameHints = [
    'emotion',
    'action',
    'coding',
    'sprite',
    'shime',
    'dora',
    'doraemon',
    ...MOTION_WORDS
  ];

  return (
    pathHints.some((hint) => relativePath.includes(hint)) &&
    nameHints.some((hint) => fileName.includes(hint))
  );
}

function classifyAsset(fileName: string): AssetCategory {
  const stem = basename(fileName, extname(fileName)).toLowerCase();

  if (/^emotion(?:[-_]|$)/.test(stem)) {
    return 'emotion';
  }

  if (/^action(?:[-_]|$)/.test(stem)) {
    return 'action';
  }

  if (/^coding(?:[-_a-z0-9]|$)/.test(stem)) {
    return 'coding';
  }

  if (MOTION_WORDS.some((word) => stem.includes(word))) {
    return 'motion';
  }

  return 'misc';
}

function buildCandidates(sourceRoot: string, rawRoot: string): AssetCandidate[] {
  return scanAssetFiles(sourceRoot)
    .filter((filePath) => isLikelyDesktopPetAsset(sourceRoot, filePath))
    .map((sourcePath) => {
      const fileName = basename(sourcePath);
      const extension = extname(fileName).toLowerCase() as AssetExtension;
      const category = classifyAsset(fileName);

      return {
        sourcePath,
        targetPath: join(rawRoot, category, fileName),
        category,
        extension,
        fileName
      };
    });
}

function assertNoDuplicateTargets(candidates: AssetCandidate[]): void {
  const targetToSources = new Map<string, string[]>();

  for (const candidate of candidates) {
    const sources = targetToSources.get(candidate.targetPath) ?? [];
    sources.push(candidate.sourcePath);
    targetToSources.set(candidate.targetPath, sources);
  }

  const conflicts = [...targetToSources.entries()].filter(([, sources]) => sources.length > 1);
  if (conflicts.length === 0) {
    return;
  }

  const details = conflicts
    .map(([targetPath, sources]) => {
      const sourceList = sources.map((source) => `  - ${source}`).join('\n');
      return `${targetPath}\n${sourceList}`;
    })
    .join('\n\n');

  throw new Error(
    `Multiple source assets map to the same target file while preserving original names:\n\n${details}`
  );
}

function writeSourceCredit(characterRoot: string): void {
  const sourceCreditPath = join(characterRoot, 'source-credit.md');
  const sourceCredit = [
    '# Doraemon Source Credit',
    '',
    'Imported assets in this directory come from the local clone of AlleyBo55/doraemon.',
    '',
    'The AlleyBo55/doraemon README credits the sprite artwork to Cachomon and the Doraemon Shimeji FREE pack.',
    '',
    'These imported files are for private local development and testing only. Do not publish, bundle, or redistribute the imported Doraemon artwork. If this project is published, remove imported copyrighted character art and keep the import workflow local.',
    ''
  ].join('\n');

  writeFileSync(sourceCreditPath, sourceCredit, 'utf8');
}

function writeAssetReport(
  characterRoot: string,
  sourceRoot: string,
  rawRoot: string,
  candidates: AssetCandidate[]
): void {
  const pngCount = candidates.filter((candidate) => candidate.extension === '.png').length;
  const svgCount = candidates.filter((candidate) => candidate.extension === '.svg').length;
  const rows = candidates.map((candidate) =>
    [
      candidate.extension.slice(1).toUpperCase(),
      candidate.category,
      toPosixPath(candidate.sourcePath),
      toPosixPath(candidate.targetPath)
    ].join(' | ')
  );

  const report = [
    '# Doraemon Asset Import Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Source root: ${toPosixPath(sourceRoot)}`,
    `Target raw root: ${toPosixPath(rawRoot)}`,
    '',
    `Copied PNG: ${pngCount}`,
    `Copied SVG: ${svgCount}`,
    '',
    '## Files',
    '',
    'Extension | Category | Source path | Target path',
    '--- | --- | --- | ---',
    ...rows,
    ''
  ].join('\n');

  writeFileSync(join(characterRoot, 'asset-report.md'), report, 'utf8');
}

const options = parseOptions();
const sourceRoot = resolve(options.source);
const characterRoot = resolve('assets', 'characters', 'doraemon');
const rawRoot = join(characterRoot, 'raw');

if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) {
  throw new Error(`Source folder does not exist: ${sourceRoot}`);
}

mkdirSync(rawRoot, { recursive: true });
for (const category of RAW_CATEGORIES) {
  mkdirSync(join(rawRoot, category), { recursive: true });
}

const candidates = buildCandidates(sourceRoot, rawRoot);
assertNoDuplicateTargets(candidates);

if (candidates.length === 0) {
  throw new Error(`No matching Doraemon PNG or SVG assets found in ${sourceRoot}`);
}

for (const candidate of candidates) {
  copyFileSync(candidate.sourcePath, candidate.targetPath);
}

writeSourceCredit(characterRoot);
writeAssetReport(characterRoot, sourceRoot, rawRoot, candidates);

const pngCount = candidates.filter((candidate) => candidate.extension === '.png').length;
const svgCount = candidates.filter((candidate) => candidate.extension === '.svg').length;
console.log(`Imported ${pngCount} PNG and ${svgCount} SVG asset(s) to ${rawRoot}`);
console.log(`Report written to ${join(characterRoot, 'asset-report.md')}`);
