import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** How the client authenticates to the Gateway beyond its device identity. */
export type GatewayAuth =
	| { kind: "none" }
	| { kind: "token"; token: string }
	| { kind: "password"; password: string };

/** User-editable connection settings. */
export type AppConfig = {
	gatewayUrl: string;
	gatewayAuth: GatewayAuth;
	pollIntervalMs: number;
	requestTimeoutMs: number;
};

/** The plugin's Ed25519 device identity. */
export type StoredIdentity = {
	deviceId: string;
	privateKeyPem: string;
	publicKeyPem: string;
};

/** Everything persisted on disk, off the Stream Deck profile. */
export type StoredConfig = {
	config: AppConfig;
	identity: StoredIdentity | null;
	deviceToken: { token: string; scopes: string[] } | null;
};

export const DEFAULT_CONFIG: AppConfig = {
	gatewayUrl: "ws://127.0.0.1:18789",
	gatewayAuth: { kind: "none" },
	pollIntervalMs: 30_000,
	requestTimeoutMs: 15_000,
};

/**
 * Directory holding the plugin's state. `OPENCLAW_SD_CONFIG_DIR` overrides the
 * default so the location can be relocated (and so tests never touch the real
 * state file).
 */
export function configDir(): string {
	const override = process.env.OPENCLAW_SD_CONFIG_DIR;
	return override && override.trim().length > 0 ? override : join(homedir(), ".openclaw-streamdeck");
}

export function configPath(): string {
	return join(configDir(), "config.json");
}

export function loadConfig(): StoredConfig {
	if (!existsSync(configPath())) {
		return emptyConfig();
	}

	try {
		const parsed = JSON.parse(readFileSync(configPath(), "utf8")) as Partial<StoredConfig>;
		return {
			config: normaliseConfig(parsed.config),
			identity: normaliseIdentity(parsed.identity),
			deviceToken: normaliseDeviceToken(parsed.deviceToken),
		};
	} catch {
		// A corrupt or partially written file must never stop the plugin starting.
		return emptyConfig();
	}
}

export function saveConfig(stored: StoredConfig): void {
	const dir = configDir();
	mkdirSync(dir, { recursive: true });

	const target = configPath();
	const temporary = `${target}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
	renameSync(temporary, target);
}

function emptyConfig(): StoredConfig {
	return { config: { ...DEFAULT_CONFIG }, identity: null, deviceToken: null };
}

function normaliseConfig(value: unknown): AppConfig {
	const candidate = isRecord(value) ? value : {};

	return {
		gatewayUrl: nonEmptyString(candidate.gatewayUrl) ?? DEFAULT_CONFIG.gatewayUrl,
		gatewayAuth: normaliseAuth(candidate.gatewayAuth),
		pollIntervalMs: positiveInteger(candidate.pollIntervalMs) ?? DEFAULT_CONFIG.pollIntervalMs,
		requestTimeoutMs: positiveInteger(candidate.requestTimeoutMs) ?? DEFAULT_CONFIG.requestTimeoutMs,
	};
}

function normaliseAuth(value: unknown): GatewayAuth {
	if (!isRecord(value)) {
		return { ...DEFAULT_CONFIG.gatewayAuth };
	}

	const token = nonEmptyString(value.token);
	if (value.kind === "token" && token) {
		return { kind: "token", token };
	}

	const password = nonEmptyString(value.password);
	if (value.kind === "password" && password) {
		return { kind: "password", password };
	}

	return { kind: "none" };
}

function normaliseIdentity(value: unknown): StoredIdentity | null {
	if (!isRecord(value)) {
		return null;
	}

	const deviceId = nonEmptyString(value.deviceId);
	const privateKeyPem = nonEmptyString(value.privateKeyPem);
	const publicKeyPem = nonEmptyString(value.publicKeyPem);
	if (!deviceId || !privateKeyPem || !publicKeyPem) {
		return null;
	}

	return { deviceId, privateKeyPem, publicKeyPem };
}

function normaliseDeviceToken(value: unknown): { token: string; scopes: string[] } | null {
	if (!isRecord(value)) {
		return null;
	}

	const token = nonEmptyString(value.token);
	if (!token) {
		return null;
	}

	const scopes = Array.isArray(value.scopes) ? value.scopes.filter((scope) => typeof scope === "string") : [];
	return { token, scopes };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}
