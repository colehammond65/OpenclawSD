import type { SessionRow } from "../gateway/types";

/**
 * Which session a Stop press targets: an explicit setting wins, otherwise the
 * busiest session (a run in flight), otherwise the first one.
 */
export function pickTargetSession(rows: SessionRow[], settingsKey?: string): string | null {
	if (settingsKey && settingsKey.trim().length > 0) {
		return settingsKey.trim();
	}

	const busy = rows.find((row) => row.status === "running" || row.status === "queued");
	if (busy) {
		return busy.key;
	}

	return rows.length > 0 ? rows[0].key : null;
}
