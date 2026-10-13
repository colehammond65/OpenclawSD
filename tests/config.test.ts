import { existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { configDir, configPath, DEFAULT_CONFIG, loadConfig, saveConfig } from "../src/gateway/config";

const sandbox = join(tmpdir(), `openclaw-sd-test-config-${process.pid}`);

describe("config", () => {
	beforeEach(() => {
		process.env.OPENCLAW_SD_CONFIG_DIR = sandbox;
		rmSync(sandbox, { recursive: true, force: true });
	});

	afterEach(() => {
		delete process.env.OPENCLAW_SD_CONFIG_DIR;
		rmSync(sandbox, { recursive: true, force: true });
	});

	it("returns defaults when no file exists", () => {
		const stored = loadConfig();

		expect(stored.config.gatewayUrl).toBe("ws://127.0.0.1:18789");
		expect(stored.config.gatewayAuth).toEqual({ kind: "none" });
		expect(stored.identity).toBeNull();
		expect(stored.deviceToken).toBeNull();
	});

	it("round-trips saved config", () => {
		saveConfig({
			config: { ...DEFAULT_CONFIG, gatewayUrl: "ws://192.168.1.10:18789" },
			identity: { deviceId: "d", privateKeyPem: "p", publicKeyPem: "q" },
			deviceToken: { token: "tok", scopes: ["operator.read"] },
		});

		const stored = loadConfig();

		expect(stored.config.gatewayUrl).toBe("ws://192.168.1.10:18789");
		expect(stored.identity?.deviceId).toBe("d");
		expect(stored.deviceToken?.token).toBe("tok");
	});

	it("creates the directory on save", () => {
		saveConfig({ config: DEFAULT_CONFIG, identity: null, deviceToken: null });

		expect(existsSync(sandbox)).toBe(true);
		expect(existsSync(configPath())).toBe(true);
	});

	it("honours OPENCLAW_SD_CONFIG_DIR for both directory and file path", () => {
		expect(configDir()).toBe(sandbox);
		expect(configPath()).toBe(join(sandbox, "config.json"));
	});

	it("falls back to defaults when the file is not valid JSON", () => {
		saveConfig({ config: DEFAULT_CONFIG, identity: null, deviceToken: null });
		writeFileSync(configPath(), "{ not json", "utf8");

		const stored = loadConfig();

		expect(stored.config.gatewayUrl).toBe("ws://127.0.0.1:18789");
		expect(stored.deviceToken).toBeNull();
	});
});
