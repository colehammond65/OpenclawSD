import { GatewayEventBus, type GatewayEventName } from "./events";
import type {
	ApprovalItem,
	ChatSendResult,
	CronJobSummary,
	CronRunEntry,
	HealthSnapshot,
	QueueMode,
	SessionRow,
	UsageCostResult,
	UsageStatusResult,
} from "./types";

export type ConnectorPhase = "disconnected" | "connecting" | "ready" | "pairing" | "error";

export type ConnectorState = {
	phase: ConnectorPhase;
	detail?: string;
	/** Set when the Gateway is waiting for this device to be approved. */
	requestId?: string;
};

/**
 * The transport seam. `client.ts` implements this over `GatewayClient`; tests
 * implement it with a stub, which keeps this module free of Gateway and Stream
 * Deck imports.
 */
export interface GatewayConnector {
	start(): void;
	stop(): void;
	request<T>(method: string, params?: unknown): Promise<T>;
	onEvent(cb: (evt: { event: string; payload: unknown }) => void): () => void;
	onState(cb: (state: ConnectorState) => void): () => void;
}

export class GatewayUnavailableError extends Error {
	constructor(phase: ConnectorPhase) {
		super(`OpenClaw Gateway is not connected (state: ${phase})`);
		this.name = "GatewayUnavailableError";
	}
}

/**
 * Owns the connection state, the read-through cache, and the typed RPC surface
 * every action uses. Connection and retry policy belong to the connector; this
 * class reacts to the connector's state and events.
 */
export class GatewayService {
	private current: ConnectorState = { phase: "disconnected" };
	private readonly bus = new GatewayEventBus();
	private readonly stateListeners = new Set<(state: ConnectorState) => void>();
	private disposers: Array<() => void> = [];
	private subscribed = false;

	private cachedHealth: HealthSnapshot | null = null;
	private cachedSessions: SessionRow[] = [];
	private cachedJobs: CronJobSummary[] = [];
	private lastRefreshAt = 0;

	constructor(private connector: GatewayConnector) {
		this.subscribe();
	}

	get state(): ConnectorState {
		return this.current;
	}

	get healthSnapshot(): HealthSnapshot | null {
		return this.cachedHealth;
	}

	get sessionList(): SessionRow[] {
		return this.cachedSessions;
	}

	get cronJobs(): CronJobSummary[] {
		return this.cachedJobs;
	}

	onState(listener: (state: ConnectorState) => void): () => void {
		this.stateListeners.add(listener);
		return () => {
			this.stateListeners.delete(listener);
		};
	}

	start(): void {
		this.subscribe();
		this.connector.start();
	}

	stop(): void {
		this.connector.stop();
		this.unsubscribe();
	}

	/**
	 * Swaps the transport and starts it, so new settings take effect without
	 * restarting the plugin. The old connector is stopped first.
	 */
	replaceConnector(connector: GatewayConnector): void {
		this.connector.stop();
		this.unsubscribe();

		this.connector = connector;
		this.subscribe();
		this.connector.start();
	}

	/** Subscribes to one Gateway event; the returned function unsubscribes. */
	getEvent(name: GatewayEventName, listener: (payload: unknown) => void): () => void {
		return this.bus.on(name, listener);
	}

	async request<T>(method: string, params?: unknown): Promise<T> {
		if (this.current.phase !== "ready") {
			throw new GatewayUnavailableError(this.current.phase);
		}

		return this.connector.request<T>(method, params);
	}

	/** Refreshes the read cache. No-op unless ready; never throws. */
	async refresh(): Promise<void> {
		if (this.current.phase !== "ready") {
			return;
		}

		this.lastRefreshAt = Date.now();
		const [health, sessions, jobs] = await Promise.allSettled([this.health(), this.listSessions(), this.listCronJobs()]);

		if (health.status === "fulfilled") this.cachedHealth = health.value;
		if (sessions.status === "fulfilled") this.cachedSessions = sessions.value;
		if (jobs.status === "fulfilled") this.cachedJobs = jobs.value;
	}

	/** Coalesces refresh storms from event bursts (default: at most one per 5s). */
	refreshThrottled(windowMs = 5_000): void {
		if (Date.now() - this.lastRefreshAt < windowMs) {
			return;
		}

		void this.refresh();
	}

	async health(): Promise<HealthSnapshot> {
		const result = await this.request<unknown>("health", {});
		return isRecord(result) ? (result as HealthSnapshot) : {};
	}

	async listSessions(options: { activeOnly?: boolean; limit?: number } = {}): Promise<SessionRow[]> {
		const result = await this.request<unknown>("sessions.list", options);
		return extractRows(result, "sessions").map(normaliseSession);
	}

	async subscribeSessions(): Promise<void> {
		const result = await this.request<unknown>("sessions.subscribe", { limit: 60, ownerFirst: true });
		const rows = extractRows(result, "sessions");
		if (rows.length > 0) {
			this.cachedSessions = rows.map(normaliseSession);
		}
	}

	async listCronJobs(): Promise<CronJobSummary[]> {
		const result = await this.request<unknown>("cron.list", {});
		return extractRows(result, "jobs").map(normaliseJob);
	}

	async runCronJob(jobId: string, options: { waitTimeoutMs?: number } = {}): Promise<{ ok: boolean; runId?: string }> {
		const result = await this.request<unknown>("cron.run", { jobId, ...options });
		const record = isRecord(result) ? result : {};
		return { ok: record.ok === true, runId: typeof record.runId === "string" ? record.runId : undefined };
	}

	async cronRunHistory(jobId: string, runId?: string): Promise<CronRunEntry[]> {
		const result = await this.request<unknown>("cron.runs", runId ? { jobId, runId } : { jobId });
		return extractRows(result, "runs").map(normaliseRun);
	}

	async usageStatus(): Promise<UsageStatusResult> {
		const result = await this.request<unknown>("usage.status", {});
		return isRecord(result) ? (result as UsageStatusResult) : {};
	}

	async usageCost(options: { days?: number } = {}): Promise<UsageCostResult> {
		const result = await this.request<unknown>("usage.cost", { days: options.days ?? 7 });
		return isRecord(result) ? (result as UsageCostResult) : {};
	}

	async sendPrompt(params: {
		sessionKey?: string;
		message: string;
		queueMode?: QueueMode;
		fastMode?: boolean;
	}): Promise<ChatSendResult> {
		const result = await this.request<unknown>("chat.send", { ...params });
		return isRecord(result) ? (result as ChatSendResult) : {};
	}

	async abortSession(sessionKey: string): Promise<unknown> {
		return this.request("sessions.abort", { key: sessionKey });
	}

	async listApprovals(): Promise<ApprovalItem[]> {
		const result = await this.request<unknown>("exec.approval.list", {});
		return extractRows(result, "approvals").map(normaliseApproval);
	}

	async resolveApproval(approval: { id: string; kind: string; decision: "approve" | "deny" }): Promise<unknown> {
		return this.request("exec.approval.resolve", {
			id: approval.id,
			kind: approval.kind,
			decision: approval.decision,
		});
	}

	private subscribe(): void {
		if (this.subscribed) {
			return;
		}

		this.subscribed = true;
		this.disposers = [
			this.connector.onState((state) => this.applyState(state)),
			this.connector.onEvent((evt) => this.handleEvent(evt)),
		];
	}

	private unsubscribe(): void {
		for (const dispose of this.disposers) {
			dispose();
		}
		this.disposers = [];
		this.subscribed = false;
	}

	private applyState(state: ConnectorState): void {
		const previous = this.current;
		this.current = state;

		if (state.phase === "ready" && previous.phase !== "ready") {
			void this.refresh();
		}

		for (const listener of [...this.stateListeners]) {
			listener(state);
		}
	}

	private handleEvent(evt: { event: string; payload: unknown }): void {
		const name = evt.event as GatewayEventName;
		this.bus.emit(name, evt.payload);

		if (name === "health") {
			const snapshot = isRecord(evt.payload) ? (evt.payload as HealthSnapshot) : null;
			if (snapshot) {
				this.cachedHealth = snapshot;
			}
		}

		if (name === "health" || name === "tick" || name === "cron" || name === "sessions.changed") {
			this.refreshThrottled();
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** Accepts either a bare array of rows or a payload nesting them under `key`. */
function extractRows(result: unknown, key: string): unknown[] {
	if (Array.isArray(result)) {
		return result;
	}

	if (isRecord(result) && Array.isArray(result[key])) {
		return result[key] as unknown[];
	}

	return [];
}

function normaliseSession(value: unknown): SessionRow {
	const row = isRecord(value) ? value : {};

	return {
		key: typeof row.key === "string" ? row.key : "",
		sessionId: typeof row.sessionId === "string" ? row.sessionId : undefined,
		title: typeof row.title === "string" ? row.title : null,
		label: typeof row.label === "string" ? row.label : null,
		hasActiveRun: row.hasActiveRun === true,
		activeRunIds: Array.isArray(row.activeRunIds) ? (row.activeRunIds as string[]) : null,
		agentId: typeof row.agentId === "string" ? row.agentId : undefined,
		updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : null,
	};
}

function normaliseJob(value: unknown): CronJobSummary {
	const job = isRecord(value) ? value : {};

	return {
		jobId: typeof job.jobId === "string" ? job.jobId : "",
		name: typeof job.name === "string" ? job.name : undefined,
		schedule: typeof job.schedule === "string" ? job.schedule : undefined,
		enabled: job.enabled !== false,
		kind: typeof job.kind === "string" ? job.kind : undefined,
	};
}

function normaliseRun(value: unknown): CronRunEntry {
	const run = isRecord(value) ? value : {};

	return {
		runId: typeof run.runId === "string" ? run.runId : "",
		jobId: typeof run.jobId === "string" ? run.jobId : "",
		status: typeof run.status === "string" ? run.status : "unknown",
		completionStatus: typeof run.completionStatus === "string" ? run.completionStatus : undefined,
		startedAt: typeof run.startedAt === "number" ? run.startedAt : undefined,
		endedAt: typeof run.endedAt === "number" ? run.endedAt : undefined,
		error: typeof run.error === "string" ? run.error : null,
	};
}

function normaliseApproval(value: unknown): ApprovalItem {
	const approval = isRecord(value) ? value : {};

	return {
		id: typeof approval.id === "string" ? approval.id : "",
		kind: typeof approval.kind === "string" ? approval.kind : "exec",
		summary: typeof approval.summary === "string" ? approval.summary : undefined,
		requestedAt: typeof approval.requestedAt === "number" ? approval.requestedAt : undefined,
	};
}
