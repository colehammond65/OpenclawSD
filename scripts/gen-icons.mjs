// Generates every shipped PNG that is a flat colour: the plugin icons and the
// five status faces the keys render. Run with `npm run icons`.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseColour, solidPng } from "./lib/png.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "com.encrypt.openclaw.sdPlugin");

const PLUGIN_COLOUR = "#111827";
const STATUS_COLOUR = {
	neutral: "#6b7280",
	ok: "#10b981",
	warn: "#f59e0b",
	error: "#ef4444",
	running: "#3b82f6"
};

const files = [
	["imgs/plugin/category-icon.png", 28, PLUGIN_COLOUR],
	["imgs/plugin/category-icon@2x.png", 56, PLUGIN_COLOUR],
	["imgs/plugin/marketplace.png", 256, PLUGIN_COLOUR],
	["imgs/plugin/marketplace@2x.png", 512, PLUGIN_COLOUR],
	...Object.entries(STATUS_COLOUR).map(([kind, colour]) => [`imgs/status/${kind}.png`, 144, colour]),
	...Object.entries(STATUS_COLOUR).map(([kind, colour]) => [`imgs/status/${kind}@2x.png`, 288, colour])
];

for (const [relative, size, colour] of files) {
	const target = resolve(pluginRoot, relative);
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, solidPng(size, parseColour(colour)));
	console.log(`wrote ${relative} (${size}x${size} ${colour})`);
}
