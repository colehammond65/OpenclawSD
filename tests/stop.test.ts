import { describe, expect, it } from "vitest";

import type { SessionRow } from "../src/gateway/types";
import { pickTargetSession } from "../src/lib/stop";

function row(key: string, status?: SessionRow["status"]): SessionRow {
	return { key, status };
}

describe("stop target", () => {
	it("returns null when there are no sessions", () => {
		expect(pickTargetSession([])).toBeNull();
	});

	it("prefers a session with a run in flight", () => {
		expect(pickTargetSession([row("a", "done"), row("b", "running"), row("c", "queued")])).toBe("b");
	});

	it("falls back to the first session", () => {
		expect(pickTargetSession([row("a", "done"), row("b")])).toBe("a");
	});

	it("lets an explicit setting win", () => {
		expect(pickTargetSession([row("a", "running")], "z")).toBe("z");
	});
});
