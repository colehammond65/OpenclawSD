/** Gateway events this plugin subscribes to. */
export type GatewayEventName =
	| "health"
	| "presence"
	| "heartbeat"
	| "tick"
	| "cron"
	| "sessions.changed"
	| "session.message"
	| "agent"
	| "exec.approval.requested"
	| "exec.approval.resolved"
	| "shutdown";

type Listener = (payload: unknown) => void;

/**
 * A tiny synchronous pub/sub for Gateway events. One subscriber throwing must
 * not stop the others, so failures are reported to `onError` and swallowed.
 */
export class GatewayEventBus {
	private readonly listeners = new Map<GatewayEventName, Set<Listener>>();

	constructor(private readonly onError: (error: unknown, name: GatewayEventName) => void = defaultOnError) {}

	/** Subscribes; the returned function unsubscribes. */
	on(name: GatewayEventName, listener: Listener): () => void {
		let set = this.listeners.get(name);
		if (!set) {
			set = new Set();
			this.listeners.set(name, set);
		}

		set.add(listener);
		return () => this.off(name, listener);
	}

	off(name: GatewayEventName, listener: Listener): void {
		this.listeners.get(name)?.delete(listener);
	}

	emit(name: GatewayEventName, payload: unknown): void {
		const set = this.listeners.get(name);
		if (!set) {
			return;
		}

		// Copy first: a listener may unsubscribe itself while we iterate.
		for (const listener of [...set]) {
			try {
				listener(payload);
			} catch (error) {
				this.onError(error, name);
			}
		}
	}

	clear(): void {
		this.listeners.clear();
	}
}

function defaultOnError(error: unknown, name: GatewayEventName): void {
	console.error(`[openclaw] event handler for "${name}" threw`, error);
}
