import streamDeck, {
	action,
	type Action,
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	type SendToPluginEvent,
	SingletonAction,
	type WillAppearEvent,
} from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";

import { gatewayService } from "../gateway";
import type { QueueMode } from "../gateway/types";
import { imageForStatus, sessionLabel, statusTitle, type StatusKind } from "../lib/deck";
import { sendIdleFace, sendOutcomeMessage } from "../lib/send";

/** How long an outcome stays on the key before it returns to idle. */
const OUTCOME_MS = 4_000;

type Settings = JsonObject & {
	sessionKey?: string;
	prompt?: string;
	queueMode?: QueueMode;
	fastMode?: boolean;
};

type Face = { kind: StatusKind; label: string; detail: string };

/**
 * Sends a fixed prompt to a session (`chat.send`). The key shows the outcome
 * briefly, then returns to idle; it never blocks on the agent's reply.
 */
@action({ UUID: "com.encrypt.openclaw.send-prompt" })
export class SendPrompt extends SingletonAction<Settings> {
	/** Recent outcomes per action instance, cleared by a timer. */
	private readonly transient = new Map<string, Face>();

	constructor() {
		super();

		gatewayService.onState(() => void this.renderAll());
	}

	override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
		await this.renderOne(ev.action, ev.payload.settings);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
		await this.renderOne(ev.action, ev.payload.settings);
	}

	override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
		await this.send(ev.action, ev.payload.settings);
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, Settings>): Promise<void> {
		const request = ev.payload as unknown as { cmd?: string } | undefined;
		if (request?.cmd !== "sessions") {
			return;
		}

		if (gatewayService.sessionList.length === 0) {
			void gatewayService.refresh();
		}

		await streamDeck.ui.sendToPropertyInspector({
			kind: "sessions",
			sessions: gatewayService.sessionList.map((row) => ({
				key: row.key,
				label: sessionLabel(row),
				isMain: row.isMain === true,
			})),
		});
	}

	private async send(action: Action<Settings>, settings: Settings): Promise<void> {
		const prompt = (settings.prompt ?? "").trim();

		if (!prompt) {
			await alert(action);
			await this.flash(action, settings, { kind: "warn", label: "No prompt", detail: "set one first" });
			return;
		}

		if (gatewayService.state.phase !== "ready") {
			await alert(action);
			await this.flash(action, settings, { kind: "error", label: "DOWN", detail: "no gateway" });
			return;
		}

		await this.flash(action, settings, { kind: "running", label: "Sending", detail: settings.sessionKey ? "to session" : "to main" });

		let outcome;
		try {
			const result = await gatewayService.sendPrompt({
				sessionKey: settings.sessionKey || undefined,
				message: prompt,
				queueMode: settings.queueMode,
				fastMode: settings.fastMode,
			});
			outcome = sendOutcomeMessage(result, null);
		} catch (error) {
			outcome = sendOutcomeMessage(null, error);
			streamDeck.logger.error(`[send-prompt] ${error instanceof Error ? error.message : String(error)}`);
		}

		if (outcome.status === "error") {
			await alert(action);
		}

		await this.flash(action, settings, {
			kind: outcome.status === "ok" ? "ok" : "error",
			label: outcome.status === "ok" ? "Sent" : "Failed",
			detail: outcome.short,
		});
	}

	/** Shows a face for a moment, then falls back to the idle face. */
	private async flash(action: Action<Settings>, settings: Settings, face: Face): Promise<void> {
		this.transient.set(action.id, face);
		await render(action, face);

		setTimeout(() => {
			this.transient.delete(action.id);
			void this.renderOne(action, settings).catch(() => undefined);
		}, OUTCOME_MS);
	}

	private async renderAll(): Promise<void> {
		for (const action of this.actions) {
			await this.renderOne(action, await action.getSettings());
		}
	}

	private async renderOne(action: Action<Settings>, settings: Settings): Promise<void> {
		await render(action, this.transient.get(action.id) ?? idleFace(settings));
	}
}

function idleFace(settings: Settings): Face {
	return sendIdleFace(settings.prompt, gatewayService.state.phase === "ready");
}

async function render(action: Action<Settings>, face: Face): Promise<void> {
	if (action.isKey()) {
		await action.setImage(imageForStatus(face.kind));
		await action.setTitle(statusTitle(face.label, face.detail));
	}
}

async function alert(action: Action<Settings>): Promise<void> {
	if (action.isKey()) {
		await action.showAlert();
	}
}


