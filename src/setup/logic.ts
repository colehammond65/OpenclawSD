import type { JsonObject } from "@elgato/utils";

import type { AppConfig, GatewayAuth, StoredConfig } from "../gateway/config";
import type { ConnectorState } from "../gateway/service";

/**
 * The pure half of the connection panel: everything that can be decided from
 * values alone, with no Stream Deck or filesystem access, so it is testable
 * without either.
 */

/** What a panel sends; `secret` is omitted to keep an already-saved one. */
export type IncomingConfig = {
	gatewayUrl?: unknown;
	authKind?: unknown;
	secret?: unknown;
};

/** Folds a panel's form values onto the stored configuration. */
export function mergeConfig(incoming: IncomingConfig, stored: AppConfig): AppConfig | null {
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

export function previousSecret(auth: GatewayAuth): string | undefined {
	if (auth.kind === "token") {
		return auth.token;
	}

	return auth.kind === "password" ? auth.password : undefined;
}

export function buildAuth(kind: "none" | "token" | "password", secret: string | undefined): GatewayAuth {
	if (kind === "token" && secret) {
		return { kind: "token", token: secret };
	}

	if (kind === "password" && secret) {
		return { kind: "password", password: secret };
	}

	return { kind: "none" };
}

/** State as the panels need it. Secrets are never echoed back. */
export function describeState(state: ConnectorState, stored: StoredConfig, configPath: string): JsonObject {
	return {
		state: {
			phase: state.phase,
			detail: state.detail ?? "",
			requestId: state.requestId ?? "",
		},
		config: {
			gatewayUrl: stored.config.gatewayUrl,
			authKind: stored.config.gatewayAuth.kind,
			hasSecret: stored.config.gatewayAuth.kind !== "none",
		},
		configPath,
		deviceId: stored.identity?.deviceId ?? "",
	};
}
