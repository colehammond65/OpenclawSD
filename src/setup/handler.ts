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
 * the panel belongs to whichever action the user has selected — Status,
 * Approvals and Stop all share it — and the setup window's messages arrive
 * through that same panel.
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
			// Another action's panel (jobs / sessions / usage) — not ours.
			return;
	}
}

async function save(incoming: IncomingConfig): Promise<JsonObject> {
	const stored = loadConfig();
	const config = mergeConfig(incoming, stored.config);
	if (!config) {
		return { ok: false, error: "Gateway URL must start with ws:// or wss://" };
	}

	stored.config = config;
	saveConfig(stored);

	// Apply immediately: no plugin restart needed for the new settings.
	gatewayService.replaceConnector(createLoggedConnector(config));

	return { ok: true, ...describeState(gatewayService.state, stored, configDir()) };
}

async function test(incoming: IncomingConfig): Promise<JsonObject> {
	const config = mergeConfig(incoming, loadConfig().config);
	if (!config) {
		return { ok: false, phase: "error", detail: "Gateway URL must start with ws:// or wss://" };
	}

	const probe = createLoggedConnector(config);
	let state: ConnectorState = { phase: "disconnected" };
	const off = probe.onState((next) => {
		state = next;
	});

	try {
		probe.start();
		const settled = await waitFor(
			() => state.phase === "ready" || state.phase === "pairing" || state.phase === "error",
			TEST_TIMEOUT_MS,
		);

		if (!settled) {
			return {
				ok: false,
				phase: state.phase,
				detail: `No answer from the Gateway within ${TEST_TIMEOUT_MS / 1000}s`,
			};
		}

		return {
			ok: state.phase === "ready",
			phase: state.phase,
			detail: state.detail ?? "",
			requestId: state.requestId ?? "",
			version: state.phase === "ready" ? (state.detail ?? "") : "",
		};
	} finally {
		off();
		probe.stop();
	}
}

async function reply(payload: JsonObject): Promise<void> {
	await streamDeck.ui.sendToPropertyInspector(payload);
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}

	return predicate();
}
