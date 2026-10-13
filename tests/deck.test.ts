import { describe, expect, it } from "vitest";

import { activeRunCount, imageForStatus, kindFromHealth, kindFromPhase, sessionLabel, statusKindFromPhase, statusTitle } from "../src/lib/deck";
import type { SessionRow } from "../src/gateway/types";

describe("deck rendering", () => {
	it("maps status kinds to shipped images", () => {
		expect(imageForStatus("error")).toBe("imgs/status/error.png");
		expect(imageForStatus("running")).toBe("imgs/status/running.png");
		expect(imageForStatus("neutral")).toBe("imgs/status/neutral.png");
	});

	it("joins one or two title lines", () => {
		expect(statusTitle("OK")).toBe("OK");
		expect(statusTitle("OK", "3 active")).toBe("OK\n3 active");
	});

	it("treats a disconnected or unhealthy Gateway as an error", () => {
		expect(kindFromHealth(null, false)).toBe("error");
		expect(kindFromHealth({ ok: false } as never, true)).toBe("error");
		expect(kindFromHealth({ ok: true } as never, true)).toBe("ok");
	});

	it("maps connector phases to status kinds", () => {
		expect(kindFromPhase("ready")).toBe("ok");
		expect(kindFromPhase("connecting")).toBe("running");
		expect(kindFromPhase("pairing")).toBe("warn");
		expect(kindFromPhase("error")).toBe("error");
		expect(kindFromPhase("disconnected")).toBe("neutral");
	});

	it("treats a lost connection as down for the status key", () => {
		expect(statusKindFromPhase("disconnected")).toBe("error");
		expect(statusKindFromPhase("error")).toBe("error");
		expect(statusKindFromPhase("connecting")).toBe("running");
		expect(statusKindFromPhase("pairing")).toBe("warn");
		expect(statusKindFromPhase("ready")).toBe("ok");
	});

	it("counts sessions with a run in flight", () => {
		const rows: SessionRow[] = [
			{ key: "a", status: "running" },
			{ key: "b", status: "done" },
			{ key: "c", status: "queued" },
			{ key: "d" },
		];

		expect(activeRunCount(rows)).toBe(2);
		expect(activeRunCount([])).toBe(0);
	});

	it("labels a session by the first useful name", () => {		expect(sessionLabel({ key: "agent:main:main", label: "Main" })).toBe("Main");
		expect(sessionLabel({ key: "agent:main:main", displayName: "Main agent" })).toBe("Main agent");
		expect(sessionLabel({ key: "agent:main:main", derivedTitle: "Fixing the deck" })).toBe("Fixing the deck");
		expect(sessionLabel({ key: "agent:main:main" })).toBe("agent:main:main");
	});
});
