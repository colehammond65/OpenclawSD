import { describe, expect, it } from "vitest";

import type { CronJobSummary } from "../src/gateway/types";
import { jobFace, jobKind } from "../src/lib/automation";

function job(overrides: Partial<CronJobSummary> = {}): CronJobSummary {
	return { id: "job-1", name: "Morning digest", enabled: true, ...overrides };
}

describe("automation faces", () => {
	it("asks for a job when none is chosen", () => {
		expect(jobFace(undefined)).toEqual({ label: "No job", detail: "choose one" });
	});

	it("reports the last successful run", () => {
		expect(jobFace(job({ lastRunStatus: "ok" }))).toEqual({ label: "Morning digest", detail: "ok" });
	});

	it("reports a failed run", () => {
		expect(jobFace(job({ lastRunStatus: "error" }))).toEqual({ label: "Morning digest", detail: "failed" });
	});

	it("reports a skipped run", () => {
		expect(jobFace(job({ lastRunStatus: "skipped" }))).toEqual({ label: "Morning digest", detail: "skipped" });
	});

	it("reports a job that has never run", () => {
		expect(jobFace(job())).toEqual({ label: "Morning digest", detail: "never run" });
	});

	it("flags a disabled job", () => {
		expect(jobFace(job({ enabled: false }))).toEqual({ label: "Morning digest", detail: "disabled" });
	});

	it("prefers the display name", () => {
		expect(jobFace(job({ displayName: "Digest" })).label).toBe("Digest");
	});

	it("keeps the key label short", () => {
		expect(jobFace(job({ name: "A very long automation name indeed" })).label.length).toBeLessThanOrEqual(14);
	});

	it("maps the last run to a status kind", () => {
		expect(jobKind(job({ lastRunStatus: "ok" }))).toBe("ok");
		expect(jobKind(job({ lastRunStatus: "error" }))).toBe("error");
		expect(jobKind(job({ lastRunStatus: "skipped" }))).toBe("neutral");
		expect(jobKind(job())).toBe("neutral");
		expect(jobKind(job({ enabled: false, lastRunStatus: "ok" }))).toBe("neutral");
		expect(jobKind(undefined)).toBe("neutral");
	});
});
