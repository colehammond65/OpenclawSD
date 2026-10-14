// Verifies the OpenClaw property inspectors in the Stream Deck app's own browser,
// driven over the DevTools protocol (see tools/cdp.mjs).
//
// Why a harness at all: the app only wires a property inspector it manages, so a
// page opened over CDP has no Stream Deck bridge. The real HTML and CSS are
// loaded, then the real scripts are re-evaluated against a stubbed bridge so
// every message can be driven by hand. What this proves is the real markup, the
// real script logic, and the real `window.open()` behaviour — in the browser the
// panels actually run in.
//
// Requirements: the Stream Deck app running, and the plugin linked
// (`npx @elgato/cli link com.encrypt.openclaw.sdPlugin`).
//
//   npm run verify:panels
//
// It reuses one spare page target, because QtWebEngine refuses to create pages
// over HTTP, and restores it to about:blank when finished. A window opened by
// `window.open()` is a new target and is used as-is — the same path a click takes.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { HOST, Session, STUB, targets } from "./cdp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "com.encrypt.openclaw.sdPlugin");
const PLUGIN = pathToFileURL(ROOT).href;
const uiSource = (file) => readFileSync(join(ROOT, "ui", file), "utf8");

const results = [];
function check(name, actual, expected) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	results.push({ ok, name });
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
	if (!ok) {
		console.log(`        expected ${JSON.stringify(expected)}`);
		console.log(`        actual   ${JSON.stringify(actual)}`);
	}
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const all = await targets();
const spare =
	all.find((t) => t.type === "page" && t.url === "about:blank") ??
	all.find((t) => t.type === "page" && t.url.startsWith(PLUGIN));

if (!spare) {
	console.error(
		[
			"No spare page target to drive.",
			"The app's browser has no about:blank page and none of this plugin's panels is open.",
			"Open any OpenClaw action's settings panel in the app, or open and close a Stream Deck window, then re-run.",
		].join("\n"),
	);
	process.exit(2);
}

console.log(`plugin: ${PLUGIN}`);
console.log(`harness page: ${spare.id} (${spare.url})\n`);

const harness = await Session.open(spare.webSocketDebuggerUrl);
await harness.send("Page.enable");
await harness.send("Runtime.enable");

/** Load a panel's real HTML, then run its real scripts against the stub. */
async function loadPanel(page, scripts) {
	await harness.send("Page.navigate", { url: `${PLUGIN}/ui/${page}.html` });
	await sleep(700);
	await harness.evaluate(STUB);
	for (const script of scripts) {
		await harness.evaluate(uiSource(script));
	}
	await sleep(150);
}

const readyState = {
	kind: "state",
	state: { phase: "ready", detail: "2026.9.3", requestId: "" },
	config: { gatewayUrl: "ws://127.0.0.1:18789", authKind: "token", hasSecret: true },
	configPath: "C:/cfg",
	deviceId: "device-abc",
};

// --- connection panel ---------------------------------------------------------
await loadPanel("connection", ["connection.js", "connection-bar.js"]);
console.log("--- connection panel ---");

check(
	"panel renders the connection summary and both buttons",
	await harness.evaluate(`JSON.stringify({
		url: !!document.getElementById("url"),
		auth: !!document.getElementById("auth"),
		status: !!document.getElementById("status"),
		test: !!document.getElementById("test"),
		openSetup: !!document.getElementById("openSetup"),
		pairingHidden: document.getElementById("pairing").classList.contains("hidden"),
	})`),
	JSON.stringify({ url: true, auth: true, status: true, test: true, openSetup: true, pairingHidden: true }),
);

check(
	"panel asks the plugin for its state on load",
	await harness.evaluate(`JSON.stringify(window.__sent)`),
	JSON.stringify([{ event: "sendToPlugin", payload: { cmd: "connection.state" } }]),
);

await harness.evaluate(`window.__reply(${JSON.stringify(readyState)})`);
await sleep(150);
check(
	"panel renders a ready connection",
	await harness.evaluate(`JSON.stringify({
		statusClass: document.getElementById("status").className,
		statusText: document.getElementById("status").textContent,
		url: document.getElementById("url").textContent,
		auth: document.getElementById("auth").textContent,
		meta: document.getElementById("meta").textContent,
	})`),
	JSON.stringify({
		statusClass: "ok",
		statusText: "Connected.\n2026.9.3",
		url: "ws://127.0.0.1:18789",
		auth: "token",
		meta: "device device-abc\nconfig C:/cfg",
	}),
);

await harness.evaluate(
	`window.__reply({ kind: "state", state: { phase: "pairing", detail: "", requestId: "req-9" }, config: {}, configPath: "", deviceId: "" })`,
);
await sleep(120);
check(
	"panel shows the approve command while pairing",
	await harness.evaluate(`JSON.stringify({
		statusClass: document.getElementById("status").className,
		pairingHidden: document.getElementById("pairing").classList.contains("hidden"),
		approve: document.getElementById("approve").textContent,
	})`),
	JSON.stringify({ statusClass: "warn", pairingHidden: false, approve: "openclaw devices approve req-9" }),
);

await harness.evaluate(
	`window.__reply({ kind: "state", state: { phase: "error", detail: "unauthorized: gateway token mismatch" }, config: {}, configPath: "", deviceId: "" })`,
);
await sleep(120);
check(
	"panel renders a failure with its reason",
	await harness.evaluate(
		`JSON.stringify({ statusClass: document.getElementById("status").className, statusText: document.getElementById("status").textContent })`,
	),
	JSON.stringify({ statusClass: "error", statusText: "Not connected.\nunauthorized: gateway token mismatch" }),
);

await harness.evaluate(`document.getElementById("test").click()`);
await sleep(120);
check(
	"Test connection sends a test request",
	await harness.evaluate(
		`window.__sent.some((entry) => entry.payload && entry.payload.cmd === "connection.test" && JSON.stringify(entry.payload.config) === "{}")`,
	),
	true,
);

// --- setup window -------------------------------------------------------------
console.log("\n--- setup window ---");
await harness.evaluate(`document.getElementById("openSetup").click()`);
await sleep(1200);

const opened = (await targets()).find((t) => t.id !== spare.id && t.url.endsWith("setup.html"));
check("the button opens a real setup window", !!opened, true);

if (opened) {
	const wizard = await Session.open(opened.webSocketDebuggerUrl);
	check(
		"the wizard renders its form",
		await wizard.evaluate(`JSON.stringify({
			url: !!document.getElementById("url"),
			authKind: !!document.getElementById("authKind"),
			save: !!document.getElementById("save"),
			secretHidden: document.getElementById("secretRow").classList.contains("hidden"),
			status: document.getElementById("status").textContent,
		})`),
		JSON.stringify({ url: true, authKind: true, save: true, secretHidden: true, status: "Reading configuration…" }),
	);

	check("the wizard runs in a window with an opener", await wizard.evaluate(`!!window.opener && window.opener !== window`), true);

	const before = await harness.evaluate(`window.__sent.length`);
	await wizard.evaluate(`window.opener.postMessage({ openclawSetup: { cmd: "connection.state" } }, "*")`);
	await sleep(250);
	check(
		"a wizard request is relayed to the plugin by the panel",
		await harness.evaluate(
			`JSON.stringify({ grew: window.__sent.length > ${before}, last: window.__sent[window.__sent.length - 1] })`,
		),
		JSON.stringify({ grew: true, last: { event: "sendToPlugin", payload: { cmd: "connection.state" } } }),
	);

	await harness.evaluate(
		`window.__reply(${JSON.stringify({ ...readyState, config: { gatewayUrl: "wss://gateway.example:18789", authKind: "token", hasSecret: true } })})`,
	);
	await sleep(300);
	check(
		"the panel relays the plugin's answer into the wizard",
		await wizard.evaluate(`JSON.stringify({
			statusClass: document.getElementById("status").className,
			statusText: document.getElementById("status").textContent,
			url: document.getElementById("url").value,
			authKind: document.getElementById("authKind").value,
			secretPlaceholder: document.getElementById("secret").placeholder,
		})`),
		JSON.stringify({
			statusClass: "ok",
			statusText: "Connected.\n2026.9.3",
			url: "wss://gateway.example:18789",
			authKind: "token",
			secretPlaceholder: "saved — leave blank to keep",
		}),
	);

	// The wizard polls state every 2 s, so assert on the save rather than on the
	// last message to arrive.
	await harness.evaluate(`window.__sent.length = 0`);
	await wizard.evaluate(
		`document.getElementById("url").value = "ws://127.0.0.1:18789"; document.getElementById("secret").value = "typed-token"; document.getElementById("save").click()`,
	);
	await sleep(300);
	check(
		"Save carries the form values to the plugin",
		await harness.evaluate(`JSON.stringify(window.__sent.filter((entry) => entry.payload && entry.payload.cmd === "connection.save"))`),
		JSON.stringify([
			{
				event: "sendToPlugin",
				payload: { cmd: "connection.save", config: { gatewayUrl: "ws://127.0.0.1:18789", authKind: "token", secret: "typed-token" } },
			},
		]),
	);

	await harness.evaluate(`window.__reply({ kind: "save-result", ok: false, error: "Gateway URL must start with ws:// or wss://" })`);
	await sleep(300);
	check(
		"the wizard shows a save failure",
		await wizard.evaluate(
			`JSON.stringify({ statusClass: document.getElementById("status").className, statusText: document.getElementById("status").textContent })`,
		),
		JSON.stringify({ statusClass: "error", statusText: "Gateway URL must start with ws:// or wss://" }),
	);

	wizard.close();
	await fetch(`${HOST}/json/close/${opened.id}`);
	await sleep(300);
}

// --- the other three panels ---------------------------------------------------
console.log("\n--- other panels ---");
const panels = [
	{ page: "run-automation", script: "run-automation.js", own: "select" },
	{ page: "send-prompt", script: "send-prompt.js", own: "textarea" },
	{ page: "usage", script: "usage.js", own: "#worst" },
];

for (const { page, script, own } of panels) {
	await loadPanel(page, [script, "connection-bar.js"]);
	check(
		`${page}: has the setup button and the relay, and keeps its own controls`,
		await harness.evaluate(`JSON.stringify({
			openSetup: !!document.getElementById("openSetup"),
			relayReady: typeof window.__reply === "function" && window.__replies.length >= 2,
			ownControl: !!document.querySelector(${JSON.stringify(own)}),
		})`),
		JSON.stringify({ openSetup: true, relayReady: true, ownControl: true }),
	);
}

// The relay must forward connection payloads and nothing else.
console.log("\n--- relay filtering ---");
await loadPanel("run-automation", ["run-automation.js", "connection-bar.js"]);
await harness.evaluate(`document.getElementById("openSetup").click()`);
await sleep(1200);
const filterWindow = (await targets()).find((t) => t.id !== spare.id && t.url.endsWith("setup.html"));
check("a window can be opened from a panel that has its own controls", !!filterWindow, true);

if (filterWindow) {
	const relayed = await Session.open(filterWindow.webSocketDebuggerUrl);
	await relayed.evaluate(`window.__received = []; window.addEventListener("message", (event) => window.__received.push(event.data));`);

	await harness.evaluate(`window.__reply({ kind: "jobs", jobs: [] })`);
	await sleep(250);
	check("a foreign payload (jobs) is not relayed to the window", await relayed.evaluate(`JSON.stringify(window.__received)`), "[]");

	await harness.evaluate(`window.__reply(${JSON.stringify(readyState)})`);
	await sleep(300);
	check(
		"a connection payload is relayed to the window",
		await relayed.evaluate(`JSON.stringify(window.__received.map((data) => data.openclawSetupReply && data.openclawSetupReply.kind))`),
		JSON.stringify(["state"]),
	);

	relayed.close();
	await fetch(`${HOST}/json/close/${filterWindow.id}`);
}

// Leave the app as it was found.
await harness.send("Page.navigate", { url: "about:blank" });
harness.close();

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
