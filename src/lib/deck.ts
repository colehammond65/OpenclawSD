import type { ConnectorPhase } from "../gateway/service";
import type { HealthSnapshot, SessionRow } from "../gateway/types";

/** The five faces a key can show. */
export type StatusKind = "neutral" | "ok" | "warn" | "error" | "running";

const IMAGE_BY_KIND: Record<StatusKind, string> = {
	neutral: "imgs/status/neutral.png",
	ok: "imgs/status/ok.png",
	warn: "imgs/status/warn.png",
	error: "imgs/status/error.png",
	running: "imgs/status/running.png",
};

/** Path (relative to the plugin folder) of the face for a status kind. */
export function imageForStatus(kind: StatusKind): string {
	return IMAGE_BY_KIND[kind];
}

/** A key title from one line, or two when a second line carries detail. */
export function statusTitle(line1: string, line2?: string): string {
	return line2 && line2.trim().length > 0 ? `${line1}\n${line2}` : line1;
}

/** Health of a connected Gateway; a missing or failing snapshot is an error. */
export function kindFromHealth(health: HealthSnapshot | null, connected: boolean): StatusKind {
	if (!connected || !health?.ok) {
		return "error";
	}

	return "ok";
}

/** How many sessions have a run in flight (queued or running). */
export function activeRunCount(rows: SessionRow[]): number {
	return rows.filter((row) => row.status === "running" || row.status === "queued").length;
}

/** The most human name a session has, falling back to its key. */
export function sessionLabel(row: SessionRow): string {
	return row.label ?? row.displayName ?? row.derivedTitle ?? row.key;
}

/** Connection lifecycle as a face: not-yet-configured is neutral, not an error. */
export function kindFromPhase(phase: ConnectorPhase): StatusKind {
	switch (phase) {
		case "ready":
			return "ok";
		case "connecting":
			return "running";
		case "pairing":
			return "warn";
		case "error":
			return "error";
		default:
			return "neutral";
	}
}

/**
 * Connection lifecycle as a *reachability* face for the Status key: a Gateway
 * that is not answering is DOWN, whether it refused us or went away.
 */
export function statusKindFromPhase(phase: ConnectorPhase): StatusKind {
	switch (phase) {
		case "ready":
			return "ok";
		case "connecting":
			return "running";
		case "pairing":
			return "warn";
		default:
			return "error";
	}
}
