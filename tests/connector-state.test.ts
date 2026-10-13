import { describe, expect, it } from "vitest";

import { mapClose, mapConnectError, mapReconnectPaused } from "../src/gateway/connector-state";

describe("connector state mapping", () => {
	it("maps a pairing-required connect error, keeping the request id", () => {
		const state = mapConnectError({ details: { code: "PAIRING_REQUIRED", requestId: "req-1" } });

		expect(state.phase).toBe("pairing");
		expect(state.requestId).toBe("req-1");
	});

	it("reads pairing details nested under an error field", () => {
		const state = mapConnectError({ error: { details: { code: "PAIRING_REQUIRED", requestId: "req-2" } } });

		expect(state.phase).toBe("pairing");
		expect(state.requestId).toBe("req-2");
	});

	it("maps other connect errors to an error state with the message", () => {
		const state = mapConnectError(new Error("connection refused"));

		expect(state.phase).toBe("error");
		expect(state.detail).toBe("connection refused");
	});

	it("reports a rejected handshake as an error, not as a mere disconnect", () => {
		const state = mapClose(1008, "unauthorized: gateway token mismatch", {
			phase: "pre-hello",
			transientPreHelloCleanClose: false,
		});

		expect(state.phase).toBe("error");
		expect(state.detail).toBe("unauthorized: gateway token mismatch");
	});

	it("reports a lost connection after the handshake as disconnected", () => {
		const state = mapClose(1001, "going away", { phase: "post-hello", transientPreHelloCleanClose: false });

		expect(state.phase).toBe("disconnected");
		expect(state.detail).toBe("going away");
	});

	it("does not raise an error for a transient pre-hello close", () => {
		const state = mapClose(1006, "", { phase: "pre-hello", transientPreHelloCleanClose: true });

		expect(state.phase).toBe("disconnected");
	});

	it("names the close code when the reason is empty", () => {
		const state = mapClose(1005, "", { phase: "pre-hello", transientPreHelloCleanClose: false });

		expect(state.phase).toBe("error");
		expect(state.detail).toBe("closed (1005)");
	});

	it("maps a paused reconnect to pairing", () => {
		const state = mapReconnectPaused({ code: 1008, reason: "pairing required", detailCode: "PAIRING_REQUIRED" });

		expect(state.phase).toBe("pairing");
		expect(state.detail).toBe("PAIRING_REQUIRED");
	});
});
