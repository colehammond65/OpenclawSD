/**
 * The subset of Gateway payloads this plugin reads. Field names follow the
 * schemas exported by `@openclaw/gateway-protocol`; where a payload nests its
 * rows under a key, the wrapper types in `service.ts` unwrap them.
 */

/** A row from `sessions.list`. */
export type SessionRow = {
	key: string;
	sessionId?: string;
	title?: string | null;
	label?: string | null;
	hasActiveRun: boolean;
	activeRunIds?: string[] | null;
	agentId?: string;
	updatedAt?: number | null;
};

/** A job row from `cron.list` (fields per the Gateway's CronJob schema). */
export type CronJobSummary = {
	id: string;
	name: string;
	displayName?: string;
	enabled: boolean;
	schedule?: { kind?: string; cron?: string; at?: string; every?: string };
	lastRunStatus?: "ok" | "error" | "skipped";
	lastRunAtMs?: number;
	nextRunAtMs?: number;
};

/** Result of `usage.status`: provider quota windows (empty on local models). */
export type UsageStatusResult = {
	updatedAt?: number;
	providers?: Array<{
		id?: string;
		label?: string;
		remainingPercent?: number | null;
		planName?: string;
		window?: string;
	}>;
};

/** Result of `usage.cost`: one row per day over the requested window. */
export type UsageCostResult = {
	updatedAt?: number;
	days?: number;
	daily?: Array<{
		date: string;
		totalCost?: number;
		totalTokens?: number;
		input?: number;
		output?: number;
	}>;
};

/** A pending entry from `exec.approval.list`. */
export type ApprovalItem = {
	id: string;
	kind: string;
	summary?: string;
	requestedAt?: number;
};

/** Result of `chat.send`. */
export type ChatSendResult = {
	ok?: boolean;
	runId?: string;
	sessionKey?: string;
	message?: string;
	error?: string;
};

/** Health snapshot, from the `health` RPC or the `health` event. */
export type HealthSnapshot = {
	ok?: true;
	ts?: number;
	durationMs?: number;
	eventLoop?: {
		degraded: boolean;
		reasons: string[];
	};
};

/** How a queued chat message relates to a run already in flight. */
export type QueueMode = "steer" | "followup" | "collect" | "interrupt";
