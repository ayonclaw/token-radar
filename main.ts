// Token Radar: a launch radar over a sealed DeFiLlama snapshot (Node 22, standard library only).
//
// WHAT THIS PROGRAM DOES, IN ORDER
//  1. Reads the sealed snapshot from /input/snapshot.json (or --input <file|directory>).
//  2. Calibrates the value model on the snapshot's own priced protocols (lib/model.ts calibrate).
//  3. Scores every protocol that records no token, ranks them by implied value into board.json, and
//     derives a six-step farm plan for each one from the protocol's own record.
//  4. Writes the dashboard's dataset beside the page as data.js.
//  5. Copies this repository's dashboard/ and screenshots/ into /output unchanged.
//  6. Writes /output/dossier.json with buildDossier from vendored vendor/makefun-board.ts, last, so the
//     bytes the scorer rebuilds are the bytes of the tree it will read.
//
// Nothing here reaches the network; the page it writes holds no address that could. Every number the
// dashboard prints is computed by this program and carried in data.js, so the screenshots, the page's
// source and board.json cannot disagree about a row.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, calibrate, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): text_max_bytes shapes the bytes, the rest only refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const MIN_SHOTS = 3;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

function fail(message: string, code = 1): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(code);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

// ------------------------------------------------------------------ model, board, and the gate's shape

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const cal = calibrate(snapshot);
const { board, radar } = buildRadar(snapshot, cal);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

// ------------------------------------------------------------------ dashboard/ and screenshots/

/** Copy one directory's regular files into `to`, minting `to` when it is missing and skipping dotfiles. */
function copyFlat(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dash = copyFlat(join(here, 'dashboard'), join(out, 'dashboard'));
if (!dash.includes('index.html')) fail('dashboard/ holds no index.html: the page is what the judge reads');
if (!dash.some((n) => n.endsWith('.css'))) fail('dashboard/ holds no .css file');
if (!dash.some((n) => n.endsWith('.js'))) fail('dashboard/ holds no .js file');

const shots = copyFlat(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < MIN_SHOTS || shots.length > SCREENSHOT_CAPS.max) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in ${MIN_SHOTS}, the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// ------------------------------------------------------------------ the dossier, written last

// The scorer rebuilds this from /output with the same caps and compares bytes, so it is the last write.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, {
  text_max_bytes: TEXT_MAX_BYTES,
  screenshots: SCREENSHOT_CAPS,
  dashboard: DASHBOARD_CAPS,
}));

// ------------------------------------------------------------------ the run's one-line report

const mb = (n: number): string => `${(n / 1e6).toFixed(1)}M`;
const millions = (n: number): string => `$${mb(n)}`;
process.stdout.write(
  `token radar: read ${snapshot.protocols.length} protocols from ${inputFile}\n` +
    `token radar: fit on ${cal.sample_size} priced protocols -> log10(mcap) = ${cal.intercept} + ${cal.size_exp}*log10(tvl), growth ${cal.growth_coef_fitted} fitted at weight ${cal.momentum_weight}, R2 ${cal.r2_size_only} without growth and ${cal.r2_with_momentum} with it; tide ${cal.tide_pct}%\n` +
    `token radar: ${board.length} ranked rows (${board.filter((r) => r.on_watchlist).length} of ${snapshot.watchlist.length} watchlist, ${radar.early_size} below the floor), implied value ${millions(board[0]!.implied_value_usd)} at rank 1 down to ${millions(board[board.length - 1]!.implied_value_usd)}; ${radar.live_size} live-token and ${radar.set_aside_size} set-aside protocols carried in their own views\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${dash.length} files), screenshots/ (${shots.length} images) and dossier.json under ${out}\n`,
);
