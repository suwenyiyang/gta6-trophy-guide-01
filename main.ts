// gta6-trophy-guide-01 — build entry point (Node 22, standard library only).
//
// The entry itself is a static, offline GTA 6 trophy guide in app/: plain
// HTML, CSS and a single JavaScript module, plus app/data/trophies.json with
// all 55 PlayStation 5 trophies — official name, description and grade for
// each, and a route written in our own words that cites its sources. There is
// no build step and nothing is fetched from the network at run time.
//
// This script assembles the submission: it copies app/ and screenshots/ from
// next to this file into the output directory, then writes dossier.json there
// with the vendored make.fun library (vendor/makefun-frontend.ts — leave it
// exactly as the kit shipped it; the scorer rebuilds the dossier with its own
// copy, and the two must match byte for byte).
//
// The output directory comes from MAKEFUN_OUTPUT_DIR (the grader's /output)
// and defaults to /output. Run from the repository root like this:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-frontend.ts';

// The repository root, worked out from this file's own location.
const repoRoot = fileURLToPath(new URL('.', import.meta.url));

// Where the finished entry goes.
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Lay out the guide first, then the screenshots that show it in a browser.
mkdirSync(outputDir, { recursive: true });
cpSync(join(repoRoot, 'app'), join(outputDir, 'app'), { recursive: true });
mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoRoot, 'screenshots'))) {
  cpSync(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'), { recursive: true });
}

// These caps are the scorer's own limits, so a build that passes here is one
// the gate will accept: the judge's text view is capped at 160 KiB, at most
// 4 screenshots of at most 256 KiB each, and app/ is capped at 993 files and
// directories totalling 48 MiB.
const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  app_max_files: 993,
  app_max_bytes: 50331648,
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);
