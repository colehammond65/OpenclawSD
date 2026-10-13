import streamDeck, {
	action,
	type Action,
	type DialAction,
	type KeyAction,
	type SendToPluginEvent,
	SingletonAction,
	type WillAppearEvent,
} from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";

import { gatewayService } from "../gateway";
import { imageForStatus, statusTitle } from "../lib/deck";
import { todayCost, usageKind, windowCost, worstRemainingPercent } from "../lib/usage";

/** Indicator layout for the dial variant. */
const DIAL_LAYOUT = "$B1";

/** Cost window; matches the Gateway's own default. */
const COST_DAYS = 30;

/** The dial re-reads usage no more often than this, whatever the event traffic. */
const REFRESH_MS = 30_000;

/** One usage reading, already reduced to what a face needs. */
type Reading = { worst: number | null; today: number; window: number; providers: Array<{ label: string; remainingPercent: number | null }> };

/**
 * Shows provider quota ("X% left") and spend. With local models there is no
 * quota, so the key falls back to today's cost.
 */
@action({ UUID: "com.encrypt.openclaw.usage" })
export class Usage extends SingletonAction<JsonObject> {
	private lastRead = 0;
	private reading: Reading = { worst: null, today: 0, window: 0, providers: [] };

	constructor() {
		super();

		gatewayService.onState(() => void this.refreshFaces());
		gatewayService.getEvent("tick", () => void this.refreshFaces());
	}

	override async onWillAppear(ev: WillAppearEvent<JsonObject>): Promise<void> {
		await this.refreshFaces();
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, JsonObject>): Promise<void> {
		const request = ev.payload as unknown as { cmd?: string } | undefined;
		if (request?.cmd !== "usage") {
			return;
		}

		await this.read(true);
		await streamDeck.ui.sendToPropertyInspector({ kind: "usage", ...this.reading, days: COST_DAYS });
	}

	private async refreshFaces(): Promise<void> {
		await this.read(false);

		for (const action of this.actions) {
			await render(action, this.reading);
		}
	}

	private async read(force: boolean): Promise<void> {
		if (gatewayService.state.phase !== "ready") {
			this.reading = { worst: null, today: 0, window: 0, providers: [] };
			return;
		}

		if (!force && Date.now() - this.lastRead < REFRESH_MS) {
			return;
		}

		this.lastRead = Date.now();
		const [status, cost] = await Promise.allSettled([
			gatewayService.usageStatus(),
			gatewayService.usageCost({ days: COST_DAYS }),
		]);

		const statusValue = status.status === "fulfilled" ? status.value : {};
		const costValue = cost.status === "fulfilled" ? cost.value : {};

		this.reading = {
			worst: worstRemainingPercent(statusValue),
			today: todayCost(costValue, utcDate()),
			window: windowCost(costValue),
			providers: (statusValue.providers ?? []).map((provider) => ({
				label: provider.label ?? provider.id ?? "provider",
				remainingPercent: typeof provider.remainingPercent === "number" ? provider.remainingPercent : null,
			})),
		};
	}
}

async function render(action: Action<JsonObject>, reading: Reading): Promise<void> {
	const connected = gatewayService.state.phase === "ready";
	const kind = connected ? usageKind(reading.worst) : "error";
	const detail = reading.worst !== null ? `${reading.worst}% left` : money(reading.today);

	if (action.isKey()) {
		await action.setImage(imageForStatus(kind));
		await action.setTitle(statusTitle(connected ? "Usage" : "DOWN", detail));
		return;
	}

	if (action.isDial()) {
		await action.setFeedbackLayout(DIAL_LAYOUT);
		await action.setFeedback({
			indicator: { value: reading.worst ?? 100, range: { min: 0, max: 100 } },
			title: "Usage",
			value: reading.worst !== null ? `${reading.worst}%` : money(reading.today),
		});
	}
}

function money(amount: number): string {
	return `$${amount.toFixed(2)}`;
}

/** The Gateway buckets cost by UTC day. */
function utcDate(): string {
	return new Date().toISOString().slice(0, 10);
}
