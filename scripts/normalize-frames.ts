import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import sharp from 'sharp';

type BoundingBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type ProcessedFrame = {
  originalPath: string;
  outputPath: string;
  originalWidth: number;
  originalHeight: number;
  bbox: BoundingBox;
  scale: number;
  anchorX: number;
  anchorY: number;
};

type FrameWarning = {
  originalPath: string;
  warning: string;
};

type NormalizeOptions = {
  character: string;
  canvasSize: number;
  bodyHeightRatio: number;
  anchorX: number;
  anchorY: number;
};

const DEFAULT_OPTIONS: NormalizeOptions = {
  character: 'doraemon',
  canvasSize: 512,
  bodyHeightRatio: 0.7,
  anchorX: 0.5,
  anchorY: 0.88
};

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

function readNumberOption(name: string, fallback: number): number {
  const value = readOption(name);
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --${name} value: ${value}`);
  }

  return parsed;
}

function parseOptions(): NormalizeOptions {
  return {
    character: readOption('character') ?? DEFAULT_OPTIONS.character,
    canvasSize: Math.round(readNumberOption('size', DEFAULT_OPTIONS.canvasSize)),
    bodyHeightRatio: readNumberOption('body-height-ratio', DEFAULT_OPTIONS.bodyHeightRatio),
    anchorX: readNumberOption('anchor-x', DEFAULT_OPTIONS.anchorX),
    anchorY: readNumberOption('anchor-y', DEFAULT_OPTIONS.anchorY)
  };
}

function toPosixPath(pathName: string): string {
  return pathName.split(sep).join('/');
}

function projectPath(pathName: string): string {
  return toPosixPath(relative(process.cwd(), pathName));
}

function scanPngFiles(root: string): string[] {
  const found: string[] = [];

  function visit(directory: string): void {
    const entries = readdirSync(directory, { withFileTypes: true });

    for (const entry of entries) {
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
  return found.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

function findBoundingBox(buffer: Buffer, width: number, height: number, channels: number): BoundingBox | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = buffer[(y * width + x) * channels + 3];

      if (alpha > 0) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < 0 || maxY < 0) {
    return null;
  }

  return {
    left: minX,
    top: minY,
    right: maxX,
    bottom: maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  };
}

function buildOutputPath(rawRoot: string, processedRoot: string, sourcePath: string): string {
  return join(processedRoot, relative(rawRoot, sourcePath));
}

async function normalizeFrame(
  sourcePath: string,
  outputPath: string,
  options: NormalizeOptions
): Promise<ProcessedFrame | FrameWarning> {
  const image = sharp(sourcePath).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const bbox = findBoundingBox(data, info.width, info.height, info.channels);
  const originalPath = projectPath(sourcePath);

  if (!bbox) {
    return {
      originalPath,
      warning: 'No non-transparent pixels detected; frame skipped.'
    };
  }

  const targetBodyHeight = options.canvasSize * options.bodyHeightRatio;
  const maxBodyWidth = options.canvasSize * 0.95;
  const scale = Math.min(targetBodyHeight / bbox.height, maxBodyWidth / bbox.width);
  const resizedWidth = Math.max(1, Math.round(bbox.width * scale));
  const resizedHeight = Math.max(1, Math.round(bbox.height * scale));
  const baselineY = Math.round(options.canvasSize * options.anchorY);
  const left = Math.round(options.canvasSize * options.anchorX - resizedWidth / 2);
  const top = baselineY - resizedHeight;

  mkdirSync(dirname(outputPath), { recursive: true });

  const normalizedFrame = await sharp(sourcePath)
    .ensureAlpha()
    .extract({
      left: bbox.left,
      top: bbox.top,
      width: bbox.width,
      height: bbox.height
    })
    .resize({
      width: resizedWidth,
      height: resizedHeight,
      fit: 'fill',
      kernel: sharp.kernel.lanczos3
    })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: options.canvasSize,
      height: options.canvasSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .composite([{ input: normalizedFrame, left, top }])
    .png()
    .toFile(outputPath);

  return {
    originalPath,
    outputPath: projectPath(outputPath),
    originalWidth: info.width,
    originalHeight: info.height,
    bbox,
    scale,
    anchorX: options.anchorX,
    anchorY: options.anchorY
  };
}

function buildCheckerboardSvg(width: number, height: number, cellSize: number, tileSize: number): string {
  const gridLines: string[] = [];

  for (let x = 0; x <= width; x += cellSize) {
    gridLines.push(`<path d="M${x} 0V${height}" stroke="#d8dde3" stroke-width="1"/>`);
  }

  for (let y = 0; y <= height; y += cellSize) {
    gridLines.push(`<path d="M0 ${y}H${width}" stroke="#d8dde3" stroke-width="1"/>`);
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<defs>',
    `<pattern id="checker" width="${tileSize * 2}" height="${tileSize * 2}" patternUnits="userSpaceOnUse">`,
    `<rect width="${tileSize * 2}" height="${tileSize * 2}" fill="#f7f9fb"/>`,
    `<rect width="${tileSize}" height="${tileSize}" fill="#e8edf2"/>`,
    `<rect x="${tileSize}" y="${tileSize}" width="${tileSize}" height="${tileSize}" fill="#e8edf2"/>`,
    '</pattern>',
    '</defs>',
    '<rect width="100%" height="100%" fill="url(#checker)"/>',
    ...gridLines,
    '</svg>'
  ].join('');
}

async function writeContactSheet(frames: ProcessedFrame[], outputPath: string): Promise<void> {
  if (frames.length === 0) {
    return;
  }

  const cellSize = 128;
  const columns = Math.ceil(Math.sqrt(frames.length));
  const rows = Math.ceil(frames.length / columns);
  const width = columns * cellSize;
  const height = rows * cellSize;
  const background = Buffer.from(buildCheckerboardSvg(width, height, cellSize, 16));

  const composites = await Promise.all(
    frames.map(async (frame, index) => {
      const thumbnail = await sharp(resolve(frame.outputPath))
        .resize({
          width: cellSize,
          height: cellSize,
          fit: 'contain',
          kernel: sharp.kernel.lanczos3,
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toBuffer();

      return {
        input: thumbnail,
        left: (index % columns) * cellSize,
        top: Math.floor(index / columns) * cellSize
      };
    })
  );

  await sharp(background).composite(composites).png().toFile(outputPath);
}

async function main(): Promise<void> {
  const options = parseOptions();
  const characterRoot = resolve('assets', 'characters', options.character);
  const rawRoot = join(characterRoot, 'raw');
  const processedRoot = join(characterRoot, 'processed');
  const manifestPath = join(characterRoot, 'processed-manifest.json');
  const contactSheetPath = join(characterRoot, 'contact-sheet.png');

  if (!existsSync(rawRoot) || !statSync(rawRoot).isDirectory()) {
    throw new Error(`Raw asset folder does not exist: ${rawRoot}`);
  }

  mkdirSync(processedRoot, { recursive: true });

  const sourceFrames = scanPngFiles(rawRoot);
  const processedFrames: ProcessedFrame[] = [];
  const warnings: FrameWarning[] = [];

  for (const sourcePath of sourceFrames) {
    const outputPath = buildOutputPath(rawRoot, processedRoot, sourcePath);
    const result = await normalizeFrame(sourcePath, outputPath, options);

    if ('warning' in result) {
      warnings.push(result);
      console.warn(`[warning] ${result.originalPath}: ${result.warning}`);
    } else {
      processedFrames.push(result);
    }
  }

  await writeContactSheet(processedFrames, contactSheetPath);

  const manifest = {
    generatedAt: new Date().toISOString(),
    rawRoot: projectPath(rawRoot),
    processedRoot: projectPath(processedRoot),
    canvas: {
      width: options.canvasSize,
      height: options.canvasSize,
      targetBodyHeightRatio: options.bodyHeightRatio,
      anchorX: options.anchorX,
      anchorY: options.anchorY
    },
    frames: processedFrames,
    warnings
  };

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`Normalized ${processedFrames.length} PNG frame(s) to ${processedRoot}`);
  console.log(`Skipped ${warnings.length} empty frame(s)`);
  console.log(`Manifest written to ${manifestPath}`);
  console.log(`Contact sheet written to ${contactSheetPath}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
