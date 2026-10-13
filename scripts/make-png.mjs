// Writes a solid-colour square PNG with no dependencies.
//
//   node scripts/make-png.mjs <out-file> <size> <hex-colour>
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { parseColour, solidPng } from "./lib/png.mjs";

const [out, sizeArg, colourArg] = process.argv.slice(2);
if (!out || !sizeArg || !colourArg) {
	console.error("usage: node scripts/make-png.mjs <out-file> <size> <hex-colour>");
	process.exit(2);
}

const size = Number.parseInt(sizeArg, 10);
if (!Number.isInteger(size) || size <= 0) {
	throw new Error(`size must be a positive integer, got "${sizeArg}"`);
}

const target = resolve(out);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, solidPng(size, parseColour(colourArg)));
console.log(`wrote ${target} (${size}x${size} ${colourArg})`);
