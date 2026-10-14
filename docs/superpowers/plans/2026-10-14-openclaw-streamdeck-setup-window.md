# Plan — Move OpenClaw connection setup into a Stream Deck window

Date: 2026-10-14
Repo: `C:\Users\coled\Repositories\OpenclawSD`
Branch to create: `feat/setup-window` (from `main` @ `7967de5`)
Plugin UUID: `com.encrypt.openclaw`

Design authority for everything not changed here:
`docs/superpowers/specs/2026-10-13-openclaw-streamdeck-plugin-design.md`

## 1. Goal

Today the first-run wizard is a **property inspector belonging to a `Setup` action**, so the user must put a Setup key on the deck to configure the plugin. Change that to:

- **No `Setup` action at all** — no button on the deck.
- The connection UI is reached from **any OpenClaw action's settings panel** in the Stream Deck app (a plugin-level property inspector covers Status, Approvals and Stop; the other three actions get a button).
- The wizard itself opens as a **Stream Deck window** (opened with `window.open()` from a panel, sized by `DefaultWindowSize`), not squeezed into the sidebar.

The sidebar panel stays compact: state, a summary of the saved connection, **Test connection**, **Open setup window**.

## 2. Verified facts

Checked against the pinned SDK, the published manifest JSON schema, and plugins installed on this machine — not assumed:

| Fact | Evidence |
| --- | --- |
| The Stream Deck app has **no plugin-settings page**. A plugin cannot add UI to Preferences → Plugins. | `https://schemas.elgato.com/streamdeck/plugins/manifest.json` has no key for one; the only UI-bearing keys are `PropertyInspectorPath` (plugin and action level) and `Encoder.layout`. |
| A **plugin-level** `PropertyInspectorPath` exists and is the inspector used by actions that do not declare their own. | Action-level schema text: *"When `undefined`, the manifest's top-level `PropertyInspectorPath` is used, otherwise none."* Used locally by `com.elgato.tutorial` and `us.johnholbrook.pihole`. |
| `DefaultWindowSize` sizes **a window opened by `window.open()` from a property inspector**. | Schema text: *"Size of a window (`[width, height]`) opened when calling `window.open()` from the property inspector. Default value is `[500, 650]`."* |
| Opening a setup wizard in a window from a property inspector is a **shipped, mainstream pattern**. | `com.elgato.tutorial` sets `"DefaultWindowSize": [1320, 816]` and calls `window.open('actions/plugins.html', 'Tutorial')`. `com.barraider.spotify` and `com.barraider.twitchtools` both do `authWindow = window.open("Setup/index.html")` from their inspectors. |
| Both keys are supported by the SDK version already declared (`Software.MinimumVersion: "7.1"`). | The schema's `MinimumVersion` 6.4 and 6.5 branches both define them. No version bump needed. |
| The SDK exposes a **global** property-inspector message hook and a reply channel. | `node_modules/@elgato/streamdeck/dist/plugin/ui.d.ts`: `ui.onSendToPlugin(listener)`, `ui.sendToPropertyInspector(payload)`, `ui.action`. |

## 3. Accepted constraints (not fixable)

1. **A property inspector only exists for a placed action instance.** The first configuration still needs one OpenClaw action on the deck — Status is the natural one. There is no way to configure the plugin from the app before placing an action, because no manifest key declares a plugin-settings surface.
2. **Removing the `Setup` action removes its key face.** Nothing is lost: `Status` already renders `OK / BUSY / PAIR / DOWN`.
3. Secrets stay in `~/.openclaw-streamdeck/config.json`. Global settings cannot hold them: `@openclaw/gateway-client`'s `hostDeps.loadDeviceAuthToken` is synchronous, so the token must be readable without an `await`.

## 4. Scope

In: `manifest.json`, the four UI files that exist today, three new UI files, the message-handler move, unit tests for the moved pure logic, README + design doc.

Out: the Gateway protocol, action behaviour, the identity/config format, the Node-side connector, and any change to `tests/live/smoke-connect.test.ts` — that test still runs as part of verification, unchanged.

## 5. Task order, and why it is this order

Each task leaves the plugin building, loading and working.

1. **Task 0 — spike** (temporary; reverted). Proves the window mechanism and how it talks to the plugin *before* anything is deleted, so the `Setup` action is only removed once its replacement is known to work.
2. **Task 1 — the panel and the shared script** (new, unreferenced files). Adding them changes nothing that runs yet.
3. **Task 2 — re-point the wizard** at the new command names and its window transport.
4. **Task 3 — the switch-over, one atomic change**: move the handler out of the `Setup` action, delete that action, remove it from the manifest, and add the plugin-level inspector + `DefaultWindowSize`. Splitting these would leave the plugin declaring an action that no longer answers, or answering for an action that no longer exists.
5. **Task 4 — docs.**

---

## Task 0 — Spike: does the window work, and can it talk to the plugin?

Two questions decide Task 2's implementation, so answer them first.

**Steps**

1. Create `com.encrypt.openclaw.sdPlugin/ui/spike.html`:

```html
<!doctype html>
<html><head lang="en"><meta charset="utf-8" /><script src="sdpi-components.js"></script></head>
<body style="font-family:Segoe UI;font-size:9pt;background:#2d2d2d;color:#d8d8d8">
  <p>Spike: <button id="go">Open window</button></p>
  <pre id="log"></pre>
  <script>
    const log = (m) => document.getElementById("log").textContent += m + "\n";
    const client = SDPIComponents.streamDeckClient;
    client.sendToPropertyInspector.subscribe((msg) => {
      const payload = msg && msg.event === "sendToPropertyInspector" ? msg.payload : msg;
      log("panel got: " + JSON.stringify(payload));
    });
    let probe = null;
    window.addEventListener("message", (e) => {
      if (e.data && e.data.spikeAsk) { client.send("sendToPlugin", { cmd: "spike" }); log("relaying"); }
    });
    document.getElementById("go").addEventListener("click", () => {
      probe = window.open("spike-window.html", "SpikeWindow");
      log("opened");
    });
  </script>
</body></html>
```

2. Create `com.encrypt.openclaw.sdPlugin/ui/spike-window.html`:

```html
<!doctype html>
<html><head lang="en"><meta charset="utf-8" /><script src="sdpi-components.js"></script></head>
<body style="font-family:Segoe UI;font-size:9pt;background:#2d2d2d;color:#d8d8d8">
  <h3>Spike window</h3><pre id="out"></pre>
  <script>
    const out = document.getElementById("out");
    const report = (k, v) => out.textContent += k + ": " + v + "\n";
    // The vendored bundle always defines SDPIComponents and
    // connectElgatoStreamDeckSocket, so their presence proves nothing — only a
    // round trip does.
    report("has opener", !!window.opener);
    SDPIComponents.streamDeckClient.getSettings()
      .then((s) => report("getSettings resolved", JSON.stringify(s)))
      .catch((e) => report("getSettings failed", String(e)));
    setTimeout(() => report("getSettings still pending after 3s", "yes — no SDK wiring"), 3000);
    window.addEventListener("message", (e) => report("from panel", JSON.stringify(e.data)));
    // Question B, direction 1: can the window SEND to the plugin?
    try {
      SDPIComponents.streamDeckClient.sendToPropertyInspector.subscribe((m) => report("REPLY REACHED WINDOW", JSON.stringify(m)));
      SDPIComponents.streamDeckClient.send("sendToPlugin", { cmd: "spike" });
      report("direct send", "attempted");
    } catch (error) { report("direct send threw", String(error)); }
    // Question B fallback: ask the panel to relay.
    setTimeout(() => { if (window.opener) window.opener.postMessage({ spikeAsk: true }, "*"); }, 1500);
  </script>
</body></html>
```

3. Temporarily add at plugin level in `manifest.json`: `"PropertyInspectorPath": "ui/spike.html"` and `"DefaultWindowSize": [420, 320]`.
4. Add a **temporary global** reply in `src/plugin.ts`, before `streamDeck.connect()`:

```ts
streamDeck.ui.onSendToPlugin((ev) => {
	if ((ev.payload as { cmd?: string } | undefined)?.cmd === "spike") {
		void streamDeck.ui.sendToPropertyInspector({ kind: "spike", ok: true });
	}
});
```

Do **not** put this on the `Setup` action. Per-action routing matches the event's action against the handler's action id, and the spike inspector belongs to whichever action is selected (Status), so a `Setup`-scoped handler would never fire and the spike would appear dead. Registering globally also pre-proves the mechanism Task 3 depends on.
5. `npm run build` → `npx --no-install @elgato/cli restart com.encrypt.openclaw`.
6. In the app: select a Status key (it now resolves to the plugin-level inspector), press **Open window**, and read the spike window.

**Decision table**

| Observation | Conclusion | Task 2 implementation |
| --- | --- | --- |
| Window opens **inside the Stream Deck app**, roughly 420×320 | `window.open` + `DefaultWindowSize` work | continue below |
| Window opens in the **system browser**, or ignores the size | mechanism unusable | **Variant C**: the wizard stays **inline in the sidebar panel**. Stop and tell the user before continuing — the "window" half of the request cannot be delivered. |
| The window shows `REPLY REACHED WINDOW` with `{kind:"spike",ok:true}` | the window has its own, working SDK round trip | **Variant A** |
| No `REPLY REACHED WINDOW`, but the *panel* logs `panel got: {kind:"spike",…}` after the window asks it to relay | the window must go through the panel | **Variant B** |

Variant A needs **both directions** confirmed from the window (request *and* reply). A window that can send but never receives is Variant B.

Expect **Variant B**. `streamDeck.ui.sendToPropertyInspector(payload)` takes no window or context argument — it replies to the currently-visible inspector, and the SDK exposes no way to address a `window.open()`'d window. So a window that can reach the plugin may still never receive its answer. Treat Variant A as a bonus that applies only if the spike observes the reply *in the window*; otherwise implement the relay.

**Outcome (measured on this machine, 2026-10-14).** The spike was run over the DevTools protocol instead of by hand, and its answer is recorded here:

- The app's embedded browser is **QtWebEngine 6.11.1 (Chrome 140)** and exposes CDP on `127.0.0.1:23654` while the app runs. That made the feature verifiable without a human: panels and the window are loaded in the app's own browser and driven with a stubbed bridge.
- `window.open()` from a page in that browser **creates a real browsing context** (a new CDP target, titled from the page), and `StreamDeck.exe` contains the string `DefaultWindowSize` — the app does read that key.
- A page loaded outside the app's inspector management reports a **0×0 viewport**, so the window's actual size is only confirmable from a real, app-managed inspector. Everything else is verifiable without one.
- The window gets **no bridge of its own**, confirming **Variant B**: the relay is required, not optional.

7. Delete `ui/spike.html`, `ui/spike-window.html`, the two temporary manifest keys and the temporary global `spike` handler.

---

## Task 1 — The compact connection panel and the shared script

New files only; nothing references them yet, so the plugin behaves exactly as before.

**`com.encrypt.openclaw.sdPlugin/ui/connection.html`** — sidebar-sized, same visual language as the other panels (dark, 9pt Segoe UI, `#2d2d2d`):

```html
<!doctype html>
<html>
	<head lang="en">
		<meta charset="utf-8" />
		<title>OpenClaw connection</title>
		<script src="sdpi-components.js"></script>
		<style>
			:root { color-scheme: dark; }
			body { font-family: "Segoe UI", system-ui, sans-serif; font-size: 9pt; color: #d8d8d8; background: #2d2d2d; margin: 0; padding: 10px; }
			h1 { font-size: 9pt; color: #969696; margin: 0 0 8px; font-weight: 600; }
			.row { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid #3d3d3d; }
			.muted { color: #8a8a8a; }
			button { width: 100%; margin-top: 8px; padding: 6px; background: #3d3d3d; color: #d8d8d8; border: 1px solid #4d4d4d; border-radius: 4px; font-size: 9pt; }
			button:hover { background: #4d4d4d; }
			#status { margin-top: 8px; padding: 8px; border-radius: 4px; background: #3d3d3d; border-left: 3px solid #6b7280; white-space: pre-wrap; }
			#status.ok { border-left-color: #10b981; }
			#status.warn { border-left-color: #f59e0b; }
			#status.error { border-left-color: #ef4444; }
			#status.running { border-left-color: #3b82f6; }
			#pairing { margin-top: 8px; }
			#pairing.hidden { display: none; }
			code { display: block; background: #262626; padding: 6px; border-radius: 4px; margin: 4px 0; word-break: break-all; }
			#meta { margin-top: 8px; color: #8a8a8a; font-size: 8pt; white-space: pre-wrap; }
		</style>
	</head>
	<body>
		<h1>OpenClaw connection</h1>
		<div class="row"><span>Gateway</span><span id="url">—</span></div>
		<div class="row"><span>Auth</span><span id="auth">—</span></div>
		<div id="status" class="running">Reading connection…</div>

		<div id="pairing" class="hidden">
			<div class="muted">Approve this device on the Gateway host:</div>
			<code id="approve">openclaw devices approve &lt;requestId&gt;</code>
			<button id="copy">Copy command</button>
		</div>

		<button id="test">Test connection</button>
		<button id="openSetup">Open setup window…</button>

		<div id="meta"></div>

		<script src="connection.js"></script>
		<script src="connection-bar.js"></script>
	</body>
</html>
```

**`com.encrypt.openclaw.sdPlugin/ui/connection.js`** — polls state, renders, wires Test and Copy:

```js
// Connection panel: shows what the plugin is connected to, and tests it.
(function () {
	const client = SDPIComponents.streamDeckClient;
	const element = (id) => document.getElementById(id);

	let approveCommand = "openclaw devices approve <requestId>";

	const LABELS = {
		disconnected: "Not connected. Start the Gateway, then test.",
		connecting: "Connecting to the Gateway…",
		ready: "Connected.",
		pairing: "Waiting for approval on the Gateway host.",
		error: "Not connected.",
	};

	function send(payload) {
		return client.send("sendToPlugin", payload);
	}

	function setStatus(kind, text) {
		const status = element("status");
		status.className = kind;
		status.textContent = text;
	}

	function showPairing(requestId) {
		approveCommand = "openclaw devices approve " + (requestId || "<requestId>");
		element("approve").textContent = approveCommand;
		element("pairing").classList.remove("hidden");
	}

	function renderState(payload) {
		const state = payload.state || {};
		const config = payload.config || {};

		element("url").textContent = config.gatewayUrl || "—";
		element("auth").textContent = config.hasSecret ? config.authKind : "none";

		const phase = state.phase || "disconnected";
		const detail = state.detail ? "\n" + state.detail : "";
		setStatus(phase === "ready" ? "ok" : phase === "error" ? "error" : phase === "pairing" ? "warn" : "running", (LABELS[phase] || phase) + detail);

		if (phase === "pairing") {
			showPairing(state.requestId);
		} else if (phase === "ready") {
			element("pairing").classList.add("hidden");
		}

		const meta = [];
		if (payload.deviceId) meta.push("device " + payload.deviceId);
		if (payload.configPath) meta.push("config " + payload.configPath);
		element("meta").textContent = meta.join("\n");
	}

	function renderTestResult(payload) {
		if (payload.ok) {
			setStatus("ok", "Connected." + (payload.version ? "\nGateway " + payload.version : ""));
			element("pairing").classList.add("hidden");
			return;
		}
		if (payload.phase === "pairing") {
			setStatus("warn", "Waiting for approval on the Gateway host.");
			showPairing(payload.requestId);
			return;
		}
		setStatus("error", "Connection failed." + (payload.detail ? "\n" + payload.detail : ""));
	}

	function onMessage(message) {
		const payload = message && message.event === "sendToPropertyInspector" ? message.payload : message;
		if (!payload || typeof payload !== "object") {
			return;
		}

		switch (payload.kind) {
			case "test-result":
				renderTestResult(payload);
				return;
			case "save-result":
				setStatus(payload.ok ? "ok" : "error", payload.ok ? "Saved." : payload.error || "Could not save.");
				if (payload.ok) {
					renderState(payload);
				}
				return;
			case "state":
				renderState(payload);
				return;
			default:
				// Another panel's payload (jobs / sessions / usage) — not ours.
				return;
		}
	}

	(function init() {
		client.sendToPropertyInspector.subscribe(onMessage);

		element("test").addEventListener("click", function () {
			setStatus("running", "Testing connection…");
			send({ cmd: "connection.test", config: {} });
		});
		element("copy").addEventListener("click", function () {
			navigator.clipboard.writeText(approveCommand);
			setStatus("running", "Approve command copied to the clipboard.");
		});

		send({ cmd: "connection.state" });
		window.setInterval(function () {
			send({ cmd: "connection.state" });
		}, 2000);
	})();
})();
```

**`com.encrypt.openclaw.sdPlugin/ui/connection-bar.js`** — shared by every OpenClaw panel: opens the setup window and relays for it.

```js
// Shared by every OpenClaw property inspector.
//
// The setup wizard runs in a window opened from a panel. That window has no
// Stream Deck bridge of its own — the app only wires the inspector it manages —
// so this panel relays for it. Replies are addressed with the sender's own
// window object (event.source) rather than a stored handle, which means the
// relay keeps working if the user selects a different OpenClaw action while the
// wizard is open: whichever panel is in the opener window answers.
(function () {
	const button = document.getElementById("openSetup");
	if (button) {
		button.addEventListener("click", function () {
			window.open("setup.html", "OpenClawSetup");
		});
	}

	if (!window.SDPIComponents) {
		return;
	}

	const client = SDPIComponents.streamDeckClient;
	const CONNECTION_KINDS = ["state", "save-result", "test-result"];
	const waiting = new Set();

	// Window -> plugin
	window.addEventListener("message", function (event) {
		const request = event.data && event.data.openclawSetup;
		if (!request) {
			return;
		}
		if (event.source) {
			waiting.add(event.source);
		}
		client.send("sendToPlugin", request);
	});

	// Plugin -> every window that has asked us something.
	client.sendToPropertyInspector.subscribe(function (message) {
		const payload = message && message.event === "sendToPropertyInspector" ? message.payload : message;
		if (!payload || typeof payload !== "object" || CONNECTION_KINDS.indexOf(payload.kind) === -1) {
			return;
		}

		for (const source of waiting) {
			try {
				if (source.closed) {
					waiting.delete(source);
					continue;
				}
				source.postMessage({ openclawSetupReply: payload }, "*");
			} catch (error) {
				// The window went away between the check and the post.
				waiting.delete(source);
			}
		}
	});
})();
```

> This differs from the first draft of this plan, which kept the `window.open()` handle and gated the relay behind a `RELAY` flag. Addressing `event.source` needs no handle, cannot create a stray blank window, and survives the panel being replaced. The flag is gone: Task 0 established the relay is always required.

**Verify:** `npm run build` is clean and the plugin still loads (these files are inert until Task 3). Nothing to check in the app yet.

## Task 2 — Re-point the wizard at the new commands and its window transport

Files: `com.encrypt.openclaw.sdPlugin/ui/setup.html`, `com.encrypt.openclaw.sdPlugin/ui/setup.js`.

- Content and CSS stay as they are, with one addition so the wizard does not stretch absurdly in a 560px window:
  ```css
  body { max-width: 520px; margin: 0 auto; }
  ```
- The three command strings become `connection.state`, `connection.save`, `connection.test`. The reply `kind` values (`state`, `save-result`, `test-result`) are unchanged.
- **Also rename them in `src/actions/setup.ts` in this same step** — widen its `Request` union and switch on the `connection.*` names. Without this, Save and Test fall through to its `default` branch, which replies with a plain state payload: nothing is saved, and the verify below would still pass because the status line renders either way. The file is deleted in Task 3, so this rename is deliberately short-lived; it exists so that Task 2 ends with a working plugin.
- **Variant A** (spike confirmed the window's own SDK round trip): `setup.js` keeps `const client = SDPIComponents.streamDeckClient;` and every existing call. Only the command strings change — a three-line diff.
- **Variant B** (relay through the panel): replace the bridge at the top of `setup.js`:

```js
// Setup window: opened with window.open() from a connection panel, which owns
// the Stream Deck bridge. Everything is relayed through it.
(function () {
	const element = (id) => document.getElementById(id);
	let onReply = function () {};

	function send(payload) {
		if (!window.opener || window.opener.closed) {
			setStatus("error", "Connection to Stream Deck was lost. Reopen the setup window from an action's settings panel.");
			return;
		}
		window.opener.postMessage({ openclawSetup: payload }, "*");
	}

	window.addEventListener("message", function (event) {
		if (event.data && event.data.openclawSetupReply) {
			onReply(event.data.openclawSetupReply);
		}
	});

	/* setStatus, readForm, toggleSecretRow, showPairing, renderState,
	   renderTestResult and onMessage stay exactly as they are today */

	(function init() {
		onReply = onMessage;
		/* button wiring unchanged, now sending connection.* commands */
		send({ cmd: "connection.state" });
		window.setInterval(function () { send({ cmd: "connection.state" }); }, 2000);
	})();
})();
```

- **Variant C** (spike showed `window.open` is not app-hosted): stop — the wizard would have to stay inline in the panel, which is a different design. Report back before continuing.

**Verify:** with the `Setup` action still present (it owns its own inspector, `ui/setup.html`), `npx --no-install @elgato/cli restart com.encrypt.openclaw`, select the Setup key, and confirm **Save actually persists**: change the URL or auth mode, press Save, then select another action and come back — the panel must show the value you saved, and the key face must follow the connection state. Rendering a status line is not enough: the `default` branch does that too, which is exactly how a broken rename hides.

## Task 3 — Switch over: handler move, Setup action removal, plugin-level inspector

One atomic change. Files: new `src/setup/logic.ts`, new `src/setup/handler.ts`, new `tests/connection.test.ts`, delete `src/actions/setup.ts`, edit `src/plugin.ts`, edit `manifest.json`, delete `imgs/actions/setup/{icon.svg,key.svg}`.

**Step 3a — tests first.** Write `tests/connection.test.ts` and watch it fail (`Cannot find module '../src/setup/logic'`), then implement 3b.

Cases (they lock in today's behaviour rather than change it):

1. `mergeConfig` returns `null` for a URL that is not `ws://`/`wss://`.
2. `mergeConfig` keeps the stored URL when the incoming one is blank.
3. `mergeConfig` keeps the saved secret when the incoming secret is blank **and** the auth kind is unchanged.
4. `mergeConfig` drops the saved secret when the auth kind changes (token → none).
5. `mergeConfig` uses the typed secret when one is supplied.
6. `buildAuth("token", undefined)` falls back to `{ kind: "none" }` — never a token-less token auth.
7. `previousSecret` returns the token / password for the matching kind, `undefined` for `none`.
8. `describeState` never includes the secret: assert `JSON.stringify(describeState(state, stored, "C:\\cfg"))` does not contain the stored token, and that it reports `hasSecret: true`.

**Step 3b — `src/setup/logic.ts`** — pure, **no SDK import**, so it is unit-testable:

```ts
import type { JsonObject } from "@elgato/utils";

import type { AppConfig, GatewayAuth, StoredConfig } from "../gateway/config";
import type { ConnectorState } from "../gateway/service";

/** What a panel sends; `secret` is omitted to keep an already-saved one. */
export type IncomingConfig = {
	gatewayUrl?: unknown;
	authKind?: unknown;
	secret?: unknown;
};

export function mergeConfig(incoming: IncomingConfig, stored: AppConfig): AppConfig | null { /* as today, `stored` passed in */ }
export function previousSecret(auth: GatewayAuth): string | undefined { /* as today */ }
export function buildAuth(kind: "none" | "token" | "password", secret: string | undefined): GatewayAuth { /* as today */ }
export function describeState(state: ConnectorState, stored: StoredConfig, configPath: string): JsonObject { /* as today */ }
```

The only behavioural change is that `mergeConfig` and `describeState` take their inputs as arguments instead of calling `loadConfig()` themselves — that is what makes them testable without touching the filesystem or the SDK.

**Step 3c — `src/setup/handler.ts`** — the SDK-side wiring:

```ts
import streamDeck from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";

import { createLoggedConnector, gatewayService } from "../gateway";
import { configDir, loadConfig, saveConfig } from "../gateway/config";
import type { ConnectorState } from "../gateway/service";
import { describeState, mergeConfig, type IncomingConfig } from "./logic";

/** How long "Test connection" waits for the Gateway to accept or refuse us. */
const TEST_TIMEOUT_MS = 15_000;

/** Requests the connection panel and the setup window may send. */
export type ConnectionRequest =
	| { cmd: "connection.state" }
	| { cmd: "connection.save"; config: IncomingConfig }
	| { cmd: "connection.test"; config: IncomingConfig };

/**
 * Serves the connection panel and the setup window. Registered globally because
 * the panel belongs to whichever action is selected, and the window's messages
 * arrive through that same panel.
 */
export function registerConnectionHandlers(): void {
	streamDeck.ui.onSendToPlugin<JsonValue, JsonObject>((ev) => {
		void handle(ev.payload as unknown as ConnectionRequest | undefined);
	});
}

async function handle(request: ConnectionRequest | undefined): Promise<void> {
	switch (request?.cmd) {
		case "connection.save":
			await reply({ kind: "save-result", ...(await save(request.config)) });
			return;
		case "connection.test":
			await reply({ kind: "test-result", ...(await test(request.config)) });
			return;
		case "connection.state":
			await reply({ kind: "state", ...describeState(gatewayService.state, loadConfig(), configDir()) });
			return;
		default:
			// Another panel's payload (jobs / sessions / usage) — not ours.
			return;
	}
}
```

`save`, `test`, `reply` and `waitFor` move across from `src/actions/setup.ts`, with two changes:
- `save` calls `mergeConfig(incoming, loadConfig().config)`, persists with `saveConfig`, then `gatewayService.replaceConnector(createLoggedConnector(config))` so a change applies without a plugin restart. The old `for (const action of this.actions) … renderFace(…)` loop is dropped — there is no Setup key any more.
- `PHASE_LABEL` and `renderFace` are deleted (they existed only for that key face).

`describeState` must never echo a secret; it returns `{ state: { phase, detail, requestId }, config: { gatewayUrl, authKind, hasSecret }, configPath, deviceId }`.

**Step 3d — `src/plugin.ts`:**

```ts
import streamDeck from "@elgato/streamdeck";

import { Approvals } from "./actions/approvals";
import { RunAutomation } from "./actions/run-automation";
import { SendPrompt } from "./actions/send-prompt";
import { Status } from "./actions/status";
import { Stop } from "./actions/stop";
import { Usage } from "./actions/usage";
import { gatewayService } from "./gateway";
import { registerConnectionHandlers } from "./setup/handler";

streamDeck.logger.setLevel("trace");

streamDeck.actions.registerAction(new Status());
streamDeck.actions.registerAction(new RunAutomation());
streamDeck.actions.registerAction(new Usage());
streamDeck.actions.registerAction(new SendPrompt());
streamDeck.actions.registerAction(new Approvals());
streamDeck.actions.registerAction(new Stop());

// Serves the connection panel and the setup window (any action's inspector).
registerConnectionHandlers();

// Start talking to the Gateway before the Stream Deck handshake, so the first
// key faces already have state to render.
gatewayService.start();

// Must be last: opens the connection to the Stream Deck software.
streamDeck.connect();
```

Delete `src/actions/setup.ts` **only after** `logic.ts` and `handler.ts` are written — it is the source of the code being moved, and its `describeState()` and `mergeConfig()` are the reference for the two changed signatures.

**Step 3e — `manifest.json`:** delete the whole `Setup` action object (the first entry, lines 6–21 of the current file) and add two plugin-level keys next to `Category`:

```json
"PropertyInspectorPath": "ui/connection.html",
"DefaultWindowSize": [560, 760],
```

Delete `imgs/actions/setup/icon.svg` and `imgs/actions/setup/key.svg` (nothing references them now).

**Step 3f — add the button to the three panels that have their own inspector.** In `ui/run-automation.html`, `ui/send-prompt.html` and `ui/usage.html`:
- add `<button id="openSetup">Open setup window…</button>` immediately before that file's own `<script src="…"></script>` tag,
- add the `button { … }` rule from `connection.html` to each file's `<style>`,
- add `<script src="connection-bar.js"></script>` after the file's own script tag.

**Verify:**
```
node -e "console.log(require('./com.encrypt.openclaw.sdPlugin/manifest.json').Actions.length)"   # 6
npm test          # 69 existing + 8 new
npm run typecheck
npm run build
npx --no-install @elgato/cli validate com.encrypt.openclaw.sdPlugin
npx --no-install @elgato/cli restart com.encrypt.openclaw
```
Then confirm the plugin log shows `[gateway] connected (Gateway 2026.9.3)` and no `Cannot find action` style warnings.

## Task 4 — Documentation

- `README.md`, **First run** section becomes:
  1. Place any OpenClaw action on the deck (Status recommended).
  2. Select it and open its settings panel on the right.
  3. Press **Open setup window…**, enter the Gateway URL and authentication, then **Save + test connection**.
  4. If the Gateway asks for approval, the window shows `openclaw devices approve <requestId>` with a Copy button.
  - Remove the "drag Setup onto a key" instruction; keep the troubleshooting table (its `PAIR` / `DOWN` rows still apply). Note that the connection panel appears for Status, Approvals and Stop, and that the other actions carry the same button.
  - Add to **Not in v1**: no plugin-settings page exists in the Stream Deck app, so one OpenClaw action must be on the deck before the connection can be configured.
- `docs/superpowers/specs/2026-10-13-openclaw-streamdeck-plugin-design.md` — grep it for `Setup` and for `global settings`, then fix every hit:
  - the Setup-action section becomes the window design (plugin-level inspector, `DefaultWindowSize`, `window.open`, the two verified platform facts from §2);
  - the three later passages that still describe a Setup action or a Setup key;
  - the paragraph claiming the wizard writes configuration and secrets to **global settings** — it writes `~/.openclaw-streamdeck/config.json`, per constraint 3. That passage already contradicts the design's own earlier decision, so this is a correction, not a change.
- `README.md` — beyond the **First run** section:
  - the troubleshooting rows that tell the user to open Setup or to re-open it for state;
  - the link at the top of the file, which still points at the superseded `2026-10-13` plan; add the `2026-10-14` plan beside it.

---

## Verification (all of it)

From the repo root:

```
npm test                       # 69 existing + 8 new
npm run typecheck              # tsc --noEmit
npm run build                  # rollup -> com.encrypt.openclaw.sdPlugin/bin/plugin.js
npx --no-install @elgato/cli validate com.encrypt.openclaw.sdPlugin
```

With the Gateway running (`openclaw gateway --allow-unconfigured --auth none`):

```
$env:RUN_LIVE = '1'; $env:OPENCLAW_SD_CONFIG_DIR = "$env:USERPROFILE\.openclaw-streamdeck"
npm run test:live
Remove-Item Env:\RUN_LIVE, Env:\OPENCLAW_SD_CONFIG_DIR
```

Then restart the plugin in the app and confirm six actions and a live connection in the log.

**The part only a human can check** — state this in the hand-off:
- The panel appears for **Status, Approvals and Stop** (the actions with no inspector of their own) and shows `Gateway`, `Auth`, a green `Connected.` line, the device id and the config path.
- **Run Automation, Send Prompt and Usage** keep their own panels *and* show the **Open setup window…** button.
- The window opens inside the app at 560×760, is focused (not duplicated) when the button is pressed again from another panel, and the wizard's fields are readable at that width.
- Save applies without restarting the plugin; a wrong token produces a readable error; the pairing path shows the approve command with a working Copy.

## Risks and mitigations

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| `window.open()` is not app-hosted, or `DefaultWindowSize` is ignored | Low (docs plus three shipped plugins) | Task 0 decides. Fallback **Variant C**: wizard stays inline in the panel, which still delivers "no Setup action". Report before building. |
| The window cannot reach the plugin | Medium | **Variant B** relay, decided by the spike. |
| The panel that opened the window is closed while it is open (user selects another action) | Medium, Variant B only | `send()` detects a closed opener and tells the user to reopen the window from a panel. Variant A removes the limitation entirely. |
| The plugin-level inspector does not appear on 7.6 for actions without their own | Very low (schema and docs are explicit) | Fallback: add `"PropertyInspectorPath": "ui/connection.html"` to Status, Approvals and Stop individually. |
| Removing the Setup action breaks a placed key | Certain if one exists | None is placed on this dev machine; anyone with one sees an empty key to clear. |
| Global `onSendToPlugin` and the per-action handlers double-handle a message | Low | Command names are disjoint: the global handler owns `connection.*` and returns otherwise; the per-action handlers own `jobs` / `sessions` / `usage`. |
| A secret leaks to a panel or a window | Low | `describeState` returns only `hasSecret`; Task 3 case 8 asserts it. |
| The wizard's Save reply reaches only the panel, leaving the window stale | Low, Variant A only | The panel polls state every 2 s, so it self-corrects; the window renders its own save result. |

## Rollback

Revert the branch's commits. The change is confined to `manifest.json`, `ui/`, `src/setup/`, `src/plugin.ts` (one import, one call, one registration removed), the deleted `src/actions/setup.ts` and the docs. Restoring the Setup action is: re-add the manifest entry, re-add the action class with its `onSendToPlugin`, and point its `PropertyInspectorPath` back at `ui/setup.html`.
