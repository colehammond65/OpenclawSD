import type { UsageCostResult, UsageStatusResult } from "../gateway/types";
import type { StatusKind } from "./deck";

/** Worst (lowest) remaining quota across providers; null when none report one. */
export function worstRemainingPercent(status: UsageStatusResult): number | null {
	const values = (status.providers ?? [])
		.map((provider) => provider.remainingPercent)
		.filter((value): value is number => typeof value === "number");

	return values.length > 0 ? Math.min(...values) : null;
}

/** Face colour for a usage reading. No quota data is normal — local models have
 * no provider quota — so it is neutral rather than an error.
 */
export function usageKind(worst: number | null): StatusKind {
	if (worst === null) {
		return "neutral";
	}

	return worst < 25 ? "warn" : "ok";
}

/** Spend recorded for one UTC day, matching the Gateway's own day buckets. */
export function todayCost(cost: UsageCostResult, utcDate: string): number {
	const row = (cost.daily ?? []).find((entry) => entry.date === utcDate);
	return typeof row?.totalCost === "number" ? row.totalCost : 0;
}

/** Spend across every day the Gateway returned. */
export function windowCost(cost: UsageCostResult): number {
	return (cost.daily ?? []).reduce(
		(sum, entry) => sum + (typeof entry.totalCost === "number" ? entry.totalCost : 0),
		0,
	);
}
