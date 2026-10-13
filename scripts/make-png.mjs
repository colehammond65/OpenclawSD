// Writes a solid-colour square PNG with no dependencies (node:zlib + manual
// PNG chunks). Used to generate plugin and key-face icons.
//
//   node scripts/make-png.mjs <out-file> <size> <hex-colour>
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const CRC_TABLE = (() => {
	const table = new Int32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c;
	}
	return table;
})();

function crc32(buffer) {
	let c = 0xffffffff;
	for (const byte of buffer) {
		c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length, 0);
	const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body), 0);
	return Buffer.concat([length, body, crc]);
}

function solidPng(size, [r, g, b]) {
	const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // colour type: truecolour RGB
	ihdr[10] = 0; // compression
	ihdr[11] = 0; // filter
	ihdr[12] = 0; // interlace

	const row = Buffer.alloc(1 + size * 3);
	row[0] = 0; // filter type: none
	for (let x = 0; x < size; x++) {
		row[1 + x * 3] = r;
		row[2 + x * 3] = g;
		row[3 + x * 3] = b;
	}
	const raw = Buffer.concat(Array.from({ length: size }, () => row));

	return Buffer.concat([
		signature,
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

function parseColour(hex) {
	const clean = hex.replace(/^#/, "");
	if (!/^[0-9a-fA-F]{6}$/.test(clean)) {
		throw new Error(`colour must be a 6-digit hex value, got "${hex}"`);
	}
	return [
		parseInt(clean.slice(0, 2), 16),
		parseInt(clean.slice(2, 4), 16),
		parseInt(clean.slice(4, 6), 16),
	];
}

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
