import { describe, expect, it } from "vitest";

import { DEFAULT_CONFIG, type AppConfig, type StoredConfig } from "../src/gateway/config";
import type { ConnectorState } from "../src/gateway/service";
import { buildAuth, describeState, mergeConfig, previousSecret } from "../src/setup/logic";

const SECRET = "s3cret-token";

function stored(overrides: Partial<AppConfig> = {}, deviceId = "device-abc"): StoredConfig {
	return {
		config: { ...DEFAULT_CONFIG, ...overrides },
		identity: deviceId ? { deviceId, privateKeyPem: "private", publicKeyPem: "public" } : null,
		deviceToken: null,
	};
}

describe("mergeConfig", () => {
	it("rejects a URL that is not a websocket URL", () => {
		expect(mergeConfig({ gatewayUrl: "http://127.0.0.1:18789" }, stored().config)).toBeNull();
		expect(mergeConfig({ gatewayUrl: "not a url" }, stored().config)).toBeNull();
	});

	it("keeps the stored URL when the incoming one is blank", () => {
		const config = mergeConfig({ gatewayUrl: "   " }, stored({ gatewayUrl: "ws://host:1234" }).config);
		expect(config?.gatewayUrl).toBe("ws://host:1234");
	});

	it("accepts a secure websocket URL", () => {
		const config = mergeConfig({ gatewayUrl: "wss://gateway.example:18789" }, stored().config);
		expect(config?.gatewayUrl).toBe("wss://gateway.example:18789");
	});

	it("keeps the saved secret when the field is blank and the auth kind is unchanged", () => {
		const config = mergeConfig(
			{ gatewayUrl: "ws://127.0.0.1:18789", authKind: "token", secret: "" },
			stored({ gatewayAuth: { kind: "token", token: SECRET } }).config,
		);
		expect(config?.gatewayAuth).toEqual({ kind: "token", token: SECRET });
	});

	it("drops the saved secret when the auth kind changes", () => {
		const config = mergeConfig(
			{ authKind: "none" },
			stored({ gatewayAuth: { kind: "token", token: SECRET } }).config,
		);
		expect(config?.gatewayAuth).toEqual({ kind: "none" });
	});

	it("uses a newly typed secret", () => {
		const config = mergeConfig(
			{ authKind: "token", secret: "typed" },
			stored({ gatewayAuth: { kind: "token", token: SECRET } }).config,
		);
		expect(config?.gatewayAuth).toEqual({ kind: "token", token: "typed" });
	});

	it("keeps unrelated settings", () => {
		const config = mergeConfig({ gatewayUrl: "ws://host:1" }, stored({ pollIntervalMs: 12_345 }).config);
		expect(config?.pollIntervalMs).toBe(12_345);
	});
});

describe("buildAuth", () => {
	it("never builds a token auth without a token", () => {
		expect(buildAuth("token", undefined)).toEqual({ kind: "none" });
		expect(buildAuth("password", "")).toEqual({ kind: "none" });
	});

	it("builds each supported kind", () => {
		expect(buildAuth("none", undefined)).toEqual({ kind: "none" });
		expect(buildAuth("token", "t")).toEqual({ kind: "token", token: "t" });
		expect(buildAuth("password", "p")).toEqual({ kind: "password", password: "p" });
	});
});

describe("previousSecret", () => {
	it("returns the secret for the matching kind only", () => {
		expect(previousSecret({ kind: "token", token: SECRET })).toBe(SECRET);
		expect(previousSecret({ kind: "password", password: "pw" })).toBe("pw");
		expect(previousSecret({ kind: "none" })).toBeUndefined();
	});
});

describe("describeState", () => {
	const ready: ConnectorState = { phase: "ready", detail: "2026.9.3" };

	it("reports the connection without ever echoing the secret", () => {
		const described = describeState(ready, stored({ gatewayAuth: { kind: "token", token: SECRET } }), "C:\\cfg");

		expect(described.config).toEqual({ gatewayUrl: DEFAULT_CONFIG.gatewayUrl, authKind: "token", hasSecret: true });
		expect(described.deviceId).toBe("device-abc");
		expect(described.configPath).toBe("C:\\cfg");
		expect(JSON.stringify(described)).not.toContain(SECRET);
	});

	it("reports no secret when none is configured", () => {
		const described = describeState({ phase: "disconnected" }, stored(), "C:\\cfg");
		expect(described.config).toEqual({ gatewayUrl: DEFAULT_CONFIG.gatewayUrl, authKind: "none", hasSecret: false });
	});

	it("carries the pairing request id through", () => {
		const described = describeState({ phase: "pairing", requestId: "req-1" }, stored(), "C:\\cfg");
		expect(described.state).toEqual({ phase: "pairing", detail: "", requestId: "req-1" });
	});
});
