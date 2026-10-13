import { describe, expect, it } from "vitest";

import type { UsageCostResult, UsageStatusResult } from "../src/gateway/types";
import { todayCost, usageKind, windowCost, worstRemainingPercent } from "../src/lib/usage";

describe("usage", () => {
	it("takes the worst remaining provider window", () => {
		const status: UsageStatusResult = { providers: [{ remainingPercent: 40 }, { remainingPercent: 12 }] };

		expect(worstRemainingPercent(status)).toBe(12);
	});

	it("returns null when no provider reports a percentage", () => {
		expect(worstRemainingPercent({ providers: [] })).toBeNull();
		expect(worstRemainingPercent({ providers: [{ remainingPercent: null }, {}] })).toBeNull();
	});

	it("grades the remaining percentage", () => {
		expect(usageKind(12)).toBe("warn");
		expect(usageKind(60)).toBe("ok");
		// No quota data is normal (local models have none), not a failure.
		expect(usageKind(null)).toBe("neutral");
	});

	it("sums today's cost from the daily rows", () => {
		const cost: UsageCostResult = {
			daily: [
				{ date: "2026-10-14", totalCost: 0.5 },
				{ date: "2026-10-13", totalCost: 1.25 },
			],
		};

		expect(todayCost(cost, "2026-10-14")).toBe(0.5);
		expect(todayCost(cost, "2026-10-15")).toBe(0);
	});

	it("sums the whole window", () => {
		const cost: UsageCostResult = {
			daily: [
				{ date: "2026-10-14", totalCost: 0.5 },
				{ date: "2026-10-13", totalCost: 1.25 },
				{ date: "2026-10-12" },
			],
		};

		expect(windowCost(cost)).toBeCloseTo(1.75);
		expect(windowCost({})).toBe(0);
	});
});
