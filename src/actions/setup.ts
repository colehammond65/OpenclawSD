import streamDeck, {
	action,
	type KeyAction,
	type SendToPluginEvent,
	SingletonAction,
	type WillAppearEvent,
} from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";

import { gatewayService, createLoggedConnector } from "../gateway";
import { configDir, loadConfig, saveConfig, type AppConfig, type GatewayAuth } from "../gateway/config";
import type { ConnectorState } from "../gateway/service";
import { imageForStatus, kindFromPhase, statusTitle } from "../lib/deck";

/** How long "Test connection" waits for the Gateway to accept or refuse us. */
const TEST_TIMEOUT_MS = 15_000;

/** Property inspector -> plugin request. */
type Request =
	| { cmd: "state" }
	| { cmd: "save"; config: IncomingConfig }
	| { cmd: "test"; config: IncomingConfig };

/** What the inspector sends; `secret` is omitted to keep an already-saved one. */
type IncomingConfig = {
	gatewayUrl?: unknown;
	authKind?: unknown;
	secret?: unknown;
};

const PHASE_LABEL: Record<string, string> = {
	disconnected: "Not connected",
	connecting: "Connecting",
	ready: "Ready",
	pairing: "PAIR",
	error: "Error",
};

/**
 * First-run onboarding and, afterwards, the connection light. The property
 * inspector hosts the wizard; this action owns the config, the test connection
 * and the key face.
 */
@action({ UUID: "com.encrypt.openclaw.setup" })
export class Setup extends SingletonAction<JsonObject> {
	override async onWillAppear(ev: WillAppearEvent<JsonObject>): Promise<void> {
		if (ev.action.isKey()) {
			await renderFace(ev.action, gatewayService.state);
		}
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, JsonObject>): Promise<void> {
		const request = ev.payload as unknown as Request | undefined;

		switch (request?.cmd) {
			case "save":
				await reply(await this.save(request.config));
				return;
			case "test":
				await reply({ kind: "test-result", ...(await this.test(request.config)) });
				return;
			default:
				await reply({ kind: "state", ...describeState() });
		}
	}

	private async save(incoming: IncomingConfig): Promise<JsonObject> {
		const config = mergeConfig(incoming);
		if (!config) {
			return { kind: "save-result", ok: false, error: "Gateway URL must start with ws:// or wss://" };
		}

		const stored = loadConfig();
		stored.config = config;
		saveConfig(stored);

		// Apply immediately: no plugin restart needed for the new settings.
		gatewayService.replaceConnector(createLoggedConnector(config));

		for (const action of this.actions) {
			if (action.isKey()) {
				await renderFace(action, gatewayService.state);
			}
		}

		return { kind: "save-result", ok: true, ...describeState() };
	}

	private async test(incoming: IncomingConfig): Promise<JsonObject> {
		const config = mergeConfig(incoming);
		if (!config) {
			return { kind: "test-result", ok: false, phase: "error", detail: "Gateway URL must start with ws:// or wss://" };
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
					kind: "test-result",
					ok: false,
					phase: state.phase,
					detail: `No answer from the Gateway within ${TEST_TIMEOUT_MS / 1000}s`,
				};
			}

			return {
				kind: "test-result",
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
}

/** State as the inspector needs it. Secrets are never echoed back. */
function describeState(): JsonObject {
	const stored = loadConfig();

	return {
		state: {
			phase: gatewayService.state.phase,
			detail: gatewayService.state.detail ?? "",
			requestId: gatewayService.state.requestId ?? "",
		},
		config: {
			gatewayUrl: stored.config.gatewayUrl,
			authKind: stored.config.gatewayAuth.kind,
			hasSecret: stored.config.gatewayAuth.kind !== "none",
		},
		configPath: configDir(),
		deviceId: stored.identity?.deviceId ?? "",
	};
}

function mergeConfig(incoming: IncomingConfig): AppConfig | null {
	const stored = loadConfig().config;
	const url =
		typeof incoming.gatewayUrl === "string" && incoming.gatewayUrl.trim().length > 0
			? incoming.gatewayUrl.trim()
			: stored.gatewayUrl;
	if (!/^wss?:\/\//.test(url)) {
		return null;
	}

	const kind = incoming.authKind === "token" || incoming.authKind === "password" ? incoming.authKind : "none";
	const typedSecret = typeof incoming.secret === "string" && incoming.secret.length > 0 ? incoming.secret : undefined;
	// An empty field means "keep the saved secret" rather than "clear it".
	const keptSecret = stored.gatewayAuth.kind === kind ? previousSecret(stored.gatewayAuth) : undefined;

	return { ...stored, gatewayUrl: url, gatewayAuth: buildAuth(kind, typedSecret ?? keptSecret) };
}

function previousSecret(auth: GatewayAuth): string | undefined {
	if (auth.kind === "token") {
		return auth.token;
	}

	return auth.kind === "password" ? auth.password : undefined;
}

function buildAuth(kind: "none" | "token" | "password", secret: string | undefined): GatewayAuth {
	if (kind === "token" && secret) {
		return { kind: "token", token: secret };
	}

	if (kind === "password" && secret) {
		return { kind: "password", password: secret };
	}

	return { kind: "none" };
}

async function renderFace(action: KeyAction<JsonObject>, state: ConnectorState): Promise<void> {
	const label = PHASE_LABEL[state.phase] ?? state.phase;
	const detail = state.phase === "ready" || state.phase === "error" ? (state.detail ?? "") : "";

	await action.setImage(imageForStatus(kindFromPhase(state.phase)));
	await action.setTitle(statusTitle(label, detail));
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
