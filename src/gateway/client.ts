import { randomUUID } from "node:crypto";

import { GatewayClient, type DeviceIdentity, type GatewayClientHostDeps } from "@openclaw/gateway-client";
import { GATEWAY_CLIENT_CAPS } from "@openclaw/gateway-protocol/client-info";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol/version";

import { loadConfig, saveConfig, type AppConfig, type StoredIdentity } from "./config";
import { mapClose, mapConnectError, mapReconnectPaused } from "./connector-state";
import { loadOrCreateIdentity, publicKeyRawBase64UrlFromPem, signDevicePayload } from "./identity";
import type { ConnectorState, GatewayConnector } from "./service";

const CLIENT_VERSION = "0.1.0";
const SCOPES = ["operator.read", "operator.write", "operator.approvals"];

/** Where the connector reports connection progress. */
export type ConnectorLogger = {
	debug(message: string): void;
	info(message: string): void;
	error(message: string): void;
};

/** Used when the caller does not supply a logger (tests, scripts). */
const consoleLogger: ConnectorLogger = {
	debug: () => {},
	info: (message) => console.log(`[openclaw] ${message}`),
	error: (message) => console.error(`[openclaw] ${message}`),
};

/**
 * The production transport: a `GatewayClient` wired to our stored device
 * identity and device token. The client owns connection lifecycle and retry
 * policy; this adapter only translates its callbacks into `ConnectorState`.
 */
export function createGatewayConnector(config: AppConfig, log: ConnectorLogger = consoleLogger): GatewayConnector {
	const eventListeners = new Set<(evt: { event: string; payload: unknown }) => void>();
	const stateListeners = new Set<(state: ConnectorState) => void>();
	let currentState: ConnectorState = { phase: "disconnected" };

	function setState(next: ConnectorState): void {
		currentState = next;
		log.info(describeState(next));

		for (const listener of [...stateListeners]) {
			listener(next);
		}
	}

	const hostDeps: GatewayClientHostDeps = {
		loadOrCreateDeviceIdentity: () => toDeviceIdentity(persistIdentity()),
		signDevicePayload: (privateKeyPem, payload) => signDevicePayload(privateKeyPem, payload),
		publicKeyRawBase64UrlFromPem: (publicKeyPem) => publicKeyRawBase64UrlFromPem(publicKeyPem),
		loadDeviceAuthToken: () => {
			const stored = loadConfig().deviceToken;
			return stored ? { token: stored.token, scopes: stored.scopes } : null;
		},
		storeDeviceAuthToken: ({ token, scopes }) => {
			const stored = loadConfig();
			stored.deviceToken = { token, scopes: [...scopes] };
			saveConfig(stored);
		},
		clearDeviceAuthToken: () => {
			const stored = loadConfig();
			if (stored.deviceToken) {
				stored.deviceToken = null;
				saveConfig(stored);
			}
		},
		logDebug: (message) => log.debug(message),
		logError: (message) => log.error(message),
		redactForLog: (message) => redact(message, config),
	};

	const client = new GatewayClient({
		url: config.gatewayUrl,
		clientName: "cli",
		clientDisplayName: "OpenClaw Stream Deck",
		clientVersion: CLIENT_VERSION,
		platform: process.platform,
		deviceFamily: "streamdeck",
		mode: "cli",
		role: "operator",
		scopes: [...SCOPES],
		caps: [GATEWAY_CLIENT_CAPS.APPROVALS, GATEWAY_CLIENT_CAPS.EXEC_APPROVALS],
		minProtocol: PROTOCOL_VERSION,
		maxProtocol: PROTOCOL_VERSION,
		requestTimeoutMs: config.requestTimeoutMs,
		instanceId: randomUUID(),
		deviceIdentity: toDeviceIdentity(persistIdentity()),
		hostDeps,
		notifyOnStartupRetry: true,
		...authOptions(config),
		onEvent: (evt) => {
			for (const listener of [...eventListeners]) {
				listener({ event: evt.event, payload: evt.payload });
			}
		},
		onHelloOk: (hello) => {
			logConnected(hello);
			setState({ phase: "ready", detail: hello.server.version });
		},
		onConnectError: (error) => setState(mapConnectError(error)),
		onReconnectPaused: (info) => setState(mapReconnectPaused(info)),
		onClose: (code, reason, info) => setState(mapClose(code, reason, info)),
	});

	return {
		start: () => client.start(),
		stop: () => client.stop(),
		request: <T,>(method: string, params?: unknown): Promise<T> => client.request<T>(method, params),
		onEvent: (cb) => {
			eventListeners.add(cb);
			return () => {
				eventListeners.delete(cb);
			};
		},
		onState: (cb) => {
			stateListeners.add(cb);
			// Replay: a subscriber that arrives after the handshake is not blind.
			cb(currentState);
			return () => {
				stateListeners.delete(cb);
			};
		},
	};
}

/** Loads the stored identity, generating and persisting one on first run. */
function persistIdentity(): StoredIdentity {
	const stored = loadConfig();
	const identity = loadOrCreateIdentity(stored.identity);

	if (stored.identity?.deviceId !== identity.deviceId) {
		stored.identity = identity;
		saveConfig(stored);
	}

	return identity;
}

function toDeviceIdentity(identity: StoredIdentity): DeviceIdentity {
	return {
		deviceId: identity.deviceId,
		privateKeyPem: identity.privateKeyPem,
		publicKeyPem: identity.publicKeyPem,
	};
}

function authOptions(config: AppConfig): { token?: string; password?: string } {
	if (config.gatewayAuth.kind === "token") {
		return { token: config.gatewayAuth.token };
	}

	if (config.gatewayAuth.kind === "password") {
		return { password: config.gatewayAuth.password };
	}

	return {};
}

function logConnected(hello: { server?: { version?: string }; auth?: unknown }): void {
	const auth = isRecord(hello.auth) ? hello.auth : {};
	const scopes = Array.isArray(auth.scopes) ? auth.scopes.join(", ") : "unknown";
	console.log(`[openclaw] connected to Gateway ${hello.server?.version ?? "unknown"} (scopes: ${scopes})`);
}

/** One line per connection state change, for the plugin log. */
function describeState(state: ConnectorState): string {
	switch (state.phase) {
		case "ready":
			return `connected (Gateway ${state.detail ?? "unknown"})`;
		case "pairing":
			return `pairing required (${state.detail ?? "waiting for approval"})`;
		case "connecting":
			return "connecting";
		case "error":
			return `error: ${state.detail ?? "unknown"}`;
		default:
			return state.detail ? `disconnected: ${state.detail}` : "disconnected";
	}
}

function redact(message: string, config: AppConfig): string {
	const secrets = [
		config.gatewayAuth.kind === "token" ? config.gatewayAuth.token : undefined,
		config.gatewayAuth.kind === "password" ? config.gatewayAuth.password : undefined,
	].filter((secret): secret is string => typeof secret === "string" && secret.length > 6);

	let redacted = message;
	for (const secret of secrets) {
		redacted = redacted.split(secret).join("<redacted>");
	}

	return redacted;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
