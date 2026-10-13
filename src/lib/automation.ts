import type { CronJobSummary } from "../gateway/types";
import type { StatusKind } from "./deck";

/** Automation names are long; a key face is not. */
const MAX_LABEL = 14;

/** What a Run Automation key or dial shows for a chosen job. */
export type AutomationFace = { label: string; detail: string };

export function jobFace(job: CronJobSummary | undefined): AutomationFace {
	if (!job) {
		return { label: "No job", detail: "choose one" };
	}

	const label = shorten(job.displayName ?? job.name);
	if (!job.enabled) {
		return { label, detail: "disabled" };
	}

	switch (job.lastRunStatus) {
		case "ok":
			return { label, detail: "ok" };
		case "error":
			return { label, detail: "failed" };
		case "skipped":
			return { label, detail: "skipped" };
		default:
			return { label, detail: "never run" };
	}
}

/** Face colour for a job: only real outcomes earn green or red. */
export function jobKind(job: CronJobSummary | undefined): StatusKind {
	if (!job || !job.enabled) {
		return "neutral";
	}

	switch (job.lastRunStatus) {
		case "ok":
			return "ok";
		case "error":
			return "error";
		default:
			return "neutral";
	}
}

function shorten(value: string): string {
	return value.length <= MAX_LABEL ? value : `${value.slice(0, MAX_LABEL - 3)}...`;
}
