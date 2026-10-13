import { describe, expect, it } from "vitest";

import { sendIdleFace, sendOutcomeMessage } from "../src/lib/send";

describe("send outcome", () => {
	it("reports a thrown failure with its message", () => {
		expect(sendOutcomeMessage(null, new Error("session not found"))).toEqual({
			status: "error",
			short: "session not found",
		});
	});

	it("treats a resolved request as sent, even when the result is untyped", () => {
		expect(sendOutcomeMessage({ ok: true, runId: "run-1" }, null)).toEqual({ status: "ok", short: "Sent" });
		expect(sendOutcomeMessage({}, null)).toEqual({ status: "ok", short: "Sent" });
	});

	it("reports an explicit rejection", () => {
		expect(sendOutcomeMessage({ ok: false }, null)).toEqual({ status: "error", short: "rejected" });
	});

	it("prefers an error string carried in the result", () => {
		expect(sendOutcomeMessage({ error: "agent busy" }, null)).toEqual({ status: "error", short: "agent busy" });
	});

	it("keeps the face text short", () => {
		const outcome = sendOutcomeMessage(null, new Error("a very long failure message that will not fit"));

		expect(outcome.short.length).toBeLessThanOrEqual(24);
	});

	it("keeps showing the configured prompt on the idle face", () => {
		expect(sendIdleFace("summarise my inbox", true)).toEqual({ kind: "neutral", label: "Send", detail: "summarise m..." });
		expect(sendIdleFace(undefined, true)).toEqual({ kind: "neutral", label: "Send", detail: "set a prompt" });
		expect(sendIdleFace("  ", true)).toEqual({ kind: "neutral", label: "Send", detail: "set a prompt" });
		expect(sendIdleFace("ping", false)).toEqual({ kind: "error", label: "Send", detail: "ping" });
	});
});
