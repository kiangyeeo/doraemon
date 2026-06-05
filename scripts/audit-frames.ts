// One-off audit: for every manifest state, report how many of its frames are
// actually DISTINCT (by content hash), flag adjacent duplicate frames (which
// cause a clip to "hold" or strobe), and write a horizontal montage PNG per
// state so the real motion can be eyeballed. Output goes to assets/.../_audit/.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

type StateConfig = { fps: number; loop: boolean; frames: string[] };
type Manifest = { states: Record<string, StateConfig> };

const characterRoot = resolve('assets', 'characters', 'doraemon');
const manifest = JSON.parse(
  readFileSync(join(characterRoot, 'manifest.json'), 'utf8')
) as Manifest;

const auditDir = join(characterRoot, '_audit');
if (!existsSync(auditDir)) {
  mkdirSync(auditDir, { recursive: true });
}

const THUMB = 140;

function hashFile(absPath: string): string {
  return createHash('md5').update(readFileSync(absPath)).digest('hex').slice(0, 8);
}

async function buildMontage(name: string, frameAbs: string[]): Promise<void> {
  if (frameAbs.length === 0) return;
  const thumbs = await Promise.all(
    frameAbs.map((p) =>
      sharp(p)
        .resize(THUMB, THUMB, { fit: 'contain', background: { r: 245, g: 247, b: 250, alpha: 1 } })
        .flatten({ background: { r: 245, g: 247, b: 250 } })
        .png()
        .toBuffer()
    )
  );
  const width = THUMB * frameAbs.length;
  await sharp({
    create: { width, height: THUMB, channels: 3, background: { r: 220, g: 224, b: 230 } }
  })
    .composite(thumbs.map((buf, i) => ({ input: buf, left: i * THUMB, top: 0 })))
    .png()
    .toFile(join(auditDir, `${name}.png`));
}

async function main(): Promise<void> {
  const rows: string[] = [];
  const auditOrder = Object.keys(manifest.states);
  for (const name of auditOrder) {
    const state = manifest.states[name];
    const abs = state.frames.map((f) => join(characterRoot, f));
    const hashes = abs.map(hashFile);
    const distinct = new Set(hashes).size;
    // adjacent duplicates (frame i == frame i-1) — pure "hold" with no motion
    let adjDup = 0;
    for (let i = 1; i < hashes.length; i++) {
      if (hashes[i] === hashes[i - 1]) adjDup++;
    }
    const cycleMs = state.fps > 0 ? Math.round((state.frames.length / state.fps) * 1000) : 0;
    const distinctCycleMs = state.fps > 0 ? Math.round((distinct / state.fps) * 1000) : 0;
    rows.push(
      `${name.padEnd(16)} frames=${String(state.frames.length).padStart(2)} distinct=${String(
        distinct
      ).padStart(2)} adjDup=${adjDup} fps=${String(state.fps).padStart(4)} cycle=${cycleMs}ms hashes=[${hashes.join(
        ' '
      )}]`
    );
    await buildMontage(name, abs);
  }
  console.log(rows.join('\n'));
  console.log(`\nMontages written to ${auditDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
