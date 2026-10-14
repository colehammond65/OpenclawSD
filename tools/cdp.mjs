// Minimal Chrome DevTools Protocol client for the Stream Deck app's embedded
// browser. Development tooling only — nothing in the plugin imports it.
//
// The app runs QtWebEngine and exposes DevTools on loopback while it is running,
// which is what makes the property inspectors testable without a human clicking.
// QtWebEngine refuses to create pages over HTTP (`/json/new` and
// `Target.createTarget` are both rejected), so callers reuse an existing page
// target and navigate it; windows opened by `window.open()` are new targets and
// work normally.
//
// As a library:
//   import { HOST, Session, pick, targets, STUB } from "./cdp.mjs";
//
// As a CLI:
//   node tools/cdp.mjs list
//   node tools/cdp.mjs eval <target> <expression> [--await]
//   node tools/cdp.mjs html <target>
//   node tools/cdp.mjs shot <target> <outFile.png>
//   node tools/cdp.mjs open <target> <url> [windowName]
//   node tools/cdp.mjs navigate <target> <url>
//   node tools/cdp.mjs close <target>
//
// <target> is a target id, or any substring of a target's URL or title.

import { pathToFileURL } from "node:url";

export const HOST = process.env.SD_CDP ?? "http://127.0.0.1:23654";

/** Stub for SDPIComponents, so a property inspector can run without the app's bridge. */
export const STUB = `
window.__sent = [];
window.__replies = [];
window.__received = [];
window.__reply = (payload) => window.__replies.forEach((handler) => handler(payload));
window.SDPIComponents = {
	streamDeckClient: {
		send: (event, payload) => { window.__sent.push({ event, payload }); return Promise.resolve(); },
		sendToPropertyInspector: { subscribe: (handler) => { window.__replies.push(handler); } },
		getSettings: () => Promise.resolve({}),
		setSettings: () => Promise.resolve(),
	},
};
window.connectElgatoStreamDeckSocket = function () {};
`;

export async function targets() {
	const response = await fetch(`${HOST}/json/list`);
	return response.json();
}

export async function pick(needle) {
	const all = await targets();
	const hit =
		all.find((t) => t.id === needle) ??
		all.find((t) => (t.url ?? "").includes(needle)) ??
		all.find((t) => (t.title ?? "").includes(needle));

	if (!hit) {
		throw new Error(`no target matching ${needle}\n${all.map((t) => `  ${t.id}  ${t.type}  ${t.url}`).join("\n")}`);
	}

	return hit;
}

export class Session {
	#ws;
	#id = 0;
	#pending = new Map();

	static async open(wsUrl) {
		const session = new Session();
		session.#ws = new WebSocket(wsUrl);
		session.#ws.addEventListener("message", (event) => {
			const message = JSON.parse(event.data);
			const entry = session.#pending.get(message.id);
			if (!entry) {
				return;
			}
			session.#pending.delete(message.id);
			message.error ? entry.reject(new Error(JSON.stringify(message.error))) : entry.resolve(message.result);
		});
		await new Promise((resolve, reject) => {
			session.#ws.addEventListener("open", resolve, { once: true });
			session.#ws.addEventListener("error", reject, { once: true });
		});
		return session;
	}

	send(method, params = {}) {
		const id = ++this.#id;
		return new Promise((resolve, reject) => {
			this.#pending.set(id, { resolve, reject });
			this.#ws.send(JSON.stringify({ id, method, params }));
		});
	}

	/** Evaluates an expression in the page and returns its value. */
	async evaluate(expression, awaitPromise = true) {
		const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise });
		if (result.exceptionDetails) {
			throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
		}
		return result.result?.value;
	}

	close() {
		this.#ws.close();
	}
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
	const [command, ...args] = process.argv.slice(2);

	switch (command) {
		case "list": {
			for (const target of await targets()) {
				console.log(`${target.id}  ${target.type.padEnd(6)}  ${target.title || "(no title)"}\n    ${target.url}`);
			}
			break;
		}

		case "eval": {
			const target = await pick(args[0]);
			const session = await Session.open(target.webSocketDebuggerUrl);
			console.log(JSON.stringify(await session.evaluate(args[1], args.includes("--await")), null, 2));
			session.close();
			break;
		}

		case "html": {
			const target = await pick(args[0]);
			const session = await Session.open(target.webSocketDebuggerUrl);
			console.log(await session.evaluate("document.documentElement.outerHTML"));
			session.close();
			break;
		}

		case "shot": {
			const target = await pick(args[0]);
			const session = await Session.open(target.webSocketDebuggerUrl);
			const result = await session.send("Page.captureScreenshot", { format: "png" });
			const { writeFileSync } = await import("node:fs");
			writeFileSync(args[1], Buffer.from(result.data, "base64"));
			console.log(`wrote ${args[1]}`);
			session.close();
			break;
		}

		case "open": {
			const target = await pick(args[0]);
			const session = await Session.open(target.webSocketDebuggerUrl);
			console.log(await session.evaluate(`String(window.open(${JSON.stringify(args[1])}, ${JSON.stringify(args[2] ?? "")}))`, false));
			session.close();
			break;
		}

		case "navigate": {
			const target = await pick(args[0]);
			const session = await Session.open(target.webSocketDebuggerUrl);
			await session.send("Page.enable");
			await session.send("Page.navigate", { url: args[1] });
			await new Promise((resolve) => setTimeout(resolve, 800));
			console.log(await session.evaluate("document.readyState"));
			session.close();
			break;
		}

		case "close": {
			const target = await pick(args[0]);
			await fetch(`${HOST}/json/close/${target.id}`);
			console.log("closed");
			break;
		}

		default:
			console.log("usage: list | eval <t> <expr> [--await] | html <t> | shot <t> <file> | open <t> <url> [name] | navigate <t> <url> | close <t>");
	}
}
