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

/** A job from `cron.list`. */
export type CronJobSummary = {
	jobId: string;
	name?: string;
	schedule?: string;
	enabled: boolean;
	kind?: string;
};

/** A run record from `cron.runs`. */
export type CronRunEntry = {
	runId: string;
	jobId: string;
	status: string;
	completionStatus?: string;
	startedAt?: number;
	endedAt?: number;
	error?: string | null;
};

/** Result of `usage.status`: provider quota windows. */
export type UsageStatusResult = {
	cacheStatus?: unknown;
	providers?: Array<{
		id: string;
		label?: string;
		remainingPercent?: number | null;
		used?: string;
		total?: string;
		planName?: string;
		window?: string;
	}>;
};

/** Result of `usage.cost`. */
export type UsageCostResult = {
	totals?: Record<string, unknown>;
	today?: number;
	thirtyDays?: number;
	cacheStatus?: unknown;
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
