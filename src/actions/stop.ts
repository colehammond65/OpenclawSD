import streamDeck, {
	action,
	type Action,
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	SingletonAction,
	type WillAppearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { gatewayService } from "../gateway";
import { imageForStatus, statusTitle } from "../lib/deck";
import { pickTargetSession } from "../lib/stop";

type Settings = JsonObject & { sessionKey?: string };

/**
 * Aborts the run in flight (`sessions.abort`). Targets the busiest session, or
 * the one named in the action's settings.
 */
@action({ UUID: "com.encrypt.openclaw.stop" })
export class Stop extends SingletonAction<Settings> {
	constructor() {
		super();

		gatewayService.onState(() => void this.renderAll());
		gatewayService.getEvent("sessions.changed", () => void this.renderAll());
	}

	override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
		await render(ev.action, ev.payload.settings);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
		await render(ev.action, ev.payload.settings);
	}

	override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
		const target = pickTargetSession(gatewayService.sessionList, ev.payload.settings.sessionKey);

		if (!target || gatewayService.state.phase !== "ready") {
			await ev.action.showAlert();
			return;
		}

		try {
			await gatewayService.abortSession(target);
			await ev.action.showOk();
			streamDeck.logger.info(`[stop] aborted ${target}`);
		} catch (error) {
			streamDeck.logger.error(`[stop] ${error instanceof Error ? error.message : String(error)}`);
			await ev.action.showAlert();
		}

		await render(ev.action, ev.payload.settings);
	}

	private async renderAll(): Promise<void> {
		for (const action of this.actions) {
			await render(action, await action.getSettings());
		}
	}
}

async function render(action: Action<Settings>, settings: Settings): Promise<void> {
	if (!action.isKey()) {
		return;
	}

	const connected = gatewayService.state.phase === "ready";
	const target = pickTargetSession(gatewayService.sessionList, settings.sessionKey);
	const detail = !connected ? "no gateway" : target ? shortKey(target) : "no session";

	await action.setImage(imageForStatus(connected ? "neutral" : "error"));
	await action.setTitle(statusTitle("Stop", detail));
}

function shortKey(key: string): string {
	const parts = key.split(":");
	const tail = parts[parts.length - 1] || key;
	return tail.length <= 14 ? tail : `${tail.slice(0, 11)}...`;
}
