// token-radar-01 entrypoint (Node 22, standard library only, erasable TypeScript).
//
// Reads the sealed snapshot, scores every pre-token protocol with lib/model.ts, writes the ranked
// board to /output/board.json, writes the page's data to /output/data.js, copies this repository's
// dashboard/ and screenshots/ into /output, and writes /output/dossier.json — the summary the judge
// reads — with vendor/makefun-board.ts.
//
// Outside the grader's container MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../tr-kit/token-radar-01-kit/input
//
// Deterministic by construction: no clock, no randomness, no network, every list ordered by a rule
// stated where it is built, so two runs write the same bytes.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's caps: the text cap shapes the dossier bytes, the rest only refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const SHOT_EXT = /\.(?:png|jpe?g)$/i;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
// The gate reads `implied_value_usd` and `farm_steps` on every row; the page reads the same values
// as `implied` and `steps`.
const boardRows = board.map((r) => ({ ...r, implied_value_usd: r.implied, farm_steps: r.steps }));
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ model: 'radar-3', formula: 'tvl x category multiple x tenure x momentum', rows: boardRows })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
// /output is empty under the grader, but a local rerun must not leave an older capture behind: clear
// the copies this program owns before taking the repository's screenshots/.
const shotsOut = join(out, 'screenshots');
if (existsSync(shotsOut)) {
  for (const name of readdirSync(shotsOut)) {
    const p = join(shotsOut, name);
    if (statSync(p).isFile()) rmSync(p);
  }
}
const shots = copyFiles(join(here, 'screenshots'), shotsOut);
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a chart view and a detail view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
  if (!SHOT_EXT.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: not a PNG or JPEG\n`);
    process.exit(1);
  }
  if (statSync(join(out, 'screenshots', name)).size > SCREENSHOT_CAPS.max_bytes) {
    process.stderr.write(`token radar: screenshots/${name}: past the 512 KiB cap\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${radar.meta.n_pre} record no token, ${radar.meta.n_watch} on the watchlist, ${board.length} board rows\n` +
    `token radar: top implied $${radar.meta.top_implied.toLocaleString('en-US')}, market multiple ${radar.meta.median_mult}x over ${radar.meta.market_n} token-bearing records\n` +
    `token radar: wrote board.json, data.js, dashboard/, screenshots/ (${shots.length} images) and dossier.json into ${out}\n`,
);
