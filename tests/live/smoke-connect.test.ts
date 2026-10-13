import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createGatewayConnector } from "../../src/gateway/client";
import { DEFAULT_CONFIG, type AppConfig } from "../../src/gateway/config";
import type { ConnectorState } from "../../src/gateway/service";

const RUN_LIVE = process.env.RUN_LIVE === "1";

/**
 * Proves the whole auth path against a real Gateway: device identity, signed
 * handshake, and (when the Gateway asks for it) pairing. Requires the Gateway
 * to be running and is skipped unless RUN_LIVE=1.
 *
 *   openclaw gateway --allow-unconfigured --auth none     # in another terminal
 *   $env:RUN_LIVE="1"; npm run test:live
 *
 * Set OPENCLAW_SD_TEST_TOKEN to exercise the shared-token path instead:
 *
 *   openclaw gateway --allow-unconfigured --token <token>
 *   $env:RUN_LIVE="1"; $env:OPENCLAW_SD_TEST_TOKEN="<token>"; npm run test:live
 */
describe.skipIf(!RUN_LIVE)("live connect", () => {
	it(
		"becomes ready and answers sessions.list and health",
		async () => {
			// Defaults to a throwaway state dir; set OPENCLAW_SD_CONFIG_DIR to
			// exercise the real stored identity and device token instead.
			const generated = !process.env.OPENCLAW_SD_CONFIG_DIR;
			const sandbox = generated ? mkdtempSync(join(tmpdir(), "openclaw-sd-live-")) : "";
			if (generated) {
				process.env.OPENCLAW_SD_CONFIG_DIR = sandbox;
			}

			const connector = createGatewayConnector(testConfig());
			let state: ConnectorState = { phase: "disconnected" };
			connector.onState((next) => {
				state = next;
			});

			try {
				connector.start();
				const settled = await waitFor(
					() => state.phase === "ready" || state.phase === "pairing" || state.phase === "error",
					45_000,
				);

				if (!settled) {
					throw new Error(`timed out waiting for the Gateway; last state: ${JSON.stringify(state)}`);
				}

				if (state.phase === "pairing") {
					throw new Error(
						[
							"PAIRING REQUIRED — approve this device on the Gateway host, then re-run:",
							"  openclaw devices list",
							`  openclaw devices approve ${state.requestId ?? "<requestId>"}`,
						].join("\n"),
					);
				}

				expect(state.phase, `connector state: ${JSON.stringify(state)}`).toBe("ready");

				const sessions = await connector.request<unknown>("sessions.list", {});
				expect(sessions).toBeDefined();

				const health = await connector.request<{ ok?: boolean }>("health", {});
				expect(health.ok).toBe(true);
			} finally {
				connector.stop();
				if (generated) {
					rmSync(sandbox, { recursive: true, force: true });
					delete process.env.OPENCLAW_SD_CONFIG_DIR;
				}
			}
		},
		60_000,
	);
});

/** Waits for the predicate to hold; false means it never did before the timeout. */
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

/** DEFAULT_CONFIG, or the shared-token variant when OPENCLAW_SD_TEST_TOKEN is set. */
function testConfig(): AppConfig {
	const token = process.env.OPENCLAW_SD_TEST_TOKEN;
	return token ? { ...DEFAULT_CONFIG, gatewayAuth: { kind: "token", token } } : DEFAULT_CONFIG;
}
