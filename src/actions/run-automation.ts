import streamDeck, {
	action,
	type Action,
	type DialAction,
	type DialDownEvent,
	type DialRotateEvent,
	type DidReceiveSettingsEvent,
	type KeyAction,
	type KeyDownEvent,
	type SendToPluginEvent,
	SingletonAction,
	type WillAppearEvent,
} from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";

import { gatewayService } from "../gateway";
import { jobFace, jobKind } from "../lib/automation";
import { imageForStatus, statusTitle } from "../lib/deck";

/** Indicator layout for the dial variant. */
const DIAL_LAYOUT = "$B1";

/** How long to keep the "running" face before trusting the Gateway's own state. */
const SETTLE_MS = 2_500;

type Settings = JsonObject & { jobId?: string };

/**
 * Runs a chosen automation (`cron.run`) and shows the job's last outcome.
 * Rotating the dial variant walks the job list; pushing it runs the shown job.
 */
@action({ UUID: "com.encrypt.openclaw.run-automation" })
export class RunAutomation extends SingletonAction<Settings> {
	/** Action instances with a run in flight, keyed by action id. */
	private readonly running = new Set<string>();

	constructor() {
		super();

		gatewayService.onState(() => void this.renderAll());
		gatewayService.getEvent("cron", () => void this.renderAll());
	}

	override async onWillAppear(ev: WillAppearEvent<Settings>): Promise<void> {
		await this.renderOne(ev.action, ev.payload.settings);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): Promise<void> {
		await this.renderOne(ev.action, ev.payload.settings);
	}

	override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
		await this.run(ev.action, ev.payload.settings);
	}

	override async onDialDown(ev: DialDownEvent<Settings>): Promise<void> {
		await this.run(ev.action, ev.payload.settings);
	}

	override async onDialRotate(ev: DialRotateEvent<Settings>): Promise<void> {
		const jobs = gatewayService.cronJobs;
		if (jobs.length === 0) {
			return;
		}

		const current = Math.max(
			0,
			jobs.findIndex((job) => job.id === ev.payload.settings.jobId),
		);
		const next = jobs[(current + ev.payload.ticks + jobs.length) % jobs.length];
		const settings: Settings = { ...ev.payload.settings, jobId: next.id };

		await ev.action.setSettings(settings);
		await this.renderOne(ev.action, settings);
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, Settings>): Promise<void> {
		const request = ev.payload as unknown as { cmd?: string } | undefined;
		if (request?.cmd !== "jobs") {
			return;
		}

		if (gatewayService.cronJobs.length === 0) {
			void gatewayService.refresh();
		}

		await streamDeck.ui.sendToPropertyInspector({
			kind: "jobs",
			jobs: gatewayService.cronJobs.map((job) => ({
				id: job.id,
				label: job.displayName ?? job.name,
				enabled: job.enabled,
				status: job.lastRunStatus ?? "",
			})),
		});
	}

	private async run(action: Action<Settings>, settings: Settings): Promise<void> {
		if (!settings.jobId || gatewayService.state.phase !== "ready") {
			await alert(action);
			await this.renderOne(action, settings);
			return;
		}

		this.running.add(action.id);
		await this.renderOne(action, settings);

		try {
			const result = await gatewayService.runCronJob(settings.jobId);
			if (!result.ok) {
				await alert(action);
			}
		} catch (error) {
			streamDeck.logger.error(`[automation] run failed: ${error instanceof Error ? error.message : String(error)}`);
			await alert(action);
		} finally {
			this.running.delete(action.id);
			// Give the Gateway a moment to record the run before showing its outcome.
			setTimeout(() => void this.renderOne(action, settings), SETTLE_MS);
		}
	}

	private async renderAll(): Promise<void> {
		for (const action of this.actions) {
			await this.renderOne(action, await action.getSettings());
		}
	}

	private async renderOne(action: Action<Settings>, settings: Settings): Promise<void> {
		const job = gatewayService.cronJobs.find((candidate) => candidate.id === settings.jobId);
		const busy = this.running.has(action.id);
		const face = busy ? { label: jobFace(job).label, detail: "running" } : jobFace(job);
		const kind = busy ? "running" : jobKind(job);

		if (action.isKey()) {
			await action.setImage(imageForStatus(kind));
			await action.setTitle(statusTitle(face.label, face.detail));
			return;
		}

		if (action.isDial()) {
			await action.setFeedbackLayout(DIAL_LAYOUT);
			await action.setFeedback({ indicator: busy ? 1 : 0, title: face.label, value: face.detail });
		}
	}
}
/** Only keys and dials can flash; the Neo infobar cannot. */
async function alert(action: Action<Settings>): Promise<void> {
	if (action.isKey() || action.isDial()) {
		await action.showAlert();
	}
}