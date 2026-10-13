import { action, type DialAction, type KeyAction, SingletonAction, type WillAppearEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { gatewayService } from "../gateway";
import { activeRunCount, imageForStatus, statusTitle, type StatusKind } from "../lib/deck";

/** Bursts of Gateway events are coalesced into one repaint. */
const RENDER_DEBOUNCE_MS = 250;

/** Gradient indicator layout for the dial variant. */
const DIAL_LAYOUT = "$B2";

/** What a Status key or dial shows right now. */
type Face = { kind: StatusKind; label: string; detail: string };

/**
 * Live view of the Gateway: red when it is unreachable, green when it is up,
 * blue with an active-run count while work is in flight.
 */
@action({ UUID: "com.encrypt.openclaw.status" })
export class Status extends SingletonAction<JsonObject> {
	private pending: ReturnType<typeof setTimeout> | null = null;

	constructor() {
		super();

		gatewayService.onState(() => this.scheduleRender());
		gatewayService.getEvent("health", () => this.scheduleRender());
		gatewayService.getEvent("sessions.changed", () => this.scheduleRender());
	}

	override async onWillAppear(ev: WillAppearEvent<JsonObject>): Promise<void> {
		if (ev.action.isKey()) {
			await renderKey(ev.action);
		} else if (ev.action.isDial()) {
			await renderDial(ev.action);
		}
	}

	private scheduleRender(): void {
		if (this.pending) {
			return;
		}

		this.pending = setTimeout(() => {
			this.pending = null;
			void this.renderAll();
		}, RENDER_DEBOUNCE_MS);
	}

	private async renderAll(): Promise<void> {
		for (const action of this.actions) {
			if (action.isKey()) {
				await renderKey(action);
			} else if (action.isDial()) {
				await renderDial(action);
			}
		}
	}
}

function faceOf(): Face {
	const state = gatewayService.state;
	const busy = activeRunCount(gatewayService.sessionList);

	if (state.phase === "pairing") {
		return { kind: "warn", label: "PAIR", detail: "approve on the host" };
	}

	if (state.phase === "error") {
		return { kind: "error", label: "DOWN", detail: shorten(state.detail) };
	}

	if (state.phase !== "ready") {
		return { kind: "neutral", label: "Idle", detail: "not connected" };
	}

	if (busy > 0) {
		return { kind: "running", label: "BUSY", detail: `${busy} active` };
	}

	const health = gatewayService.healthSnapshot;
	if (health && !health.ok) {
		return { kind: "error", label: "DEGRADED", detail: shorten(health.eventLoop?.reasons?.join(", ")) };
	}

	// `state.detail` is the Gateway version once connected.
	return { kind: "ok", label: "OK", detail: state.detail ?? "" };
}

async function renderKey(action: KeyAction<JsonObject>): Promise<void> {
	const face = faceOf();

	await action.setImage(imageForStatus(face.kind));
	await action.setTitle(statusTitle(face.label, face.detail));
}

async function renderDial(action: DialAction<JsonObject>): Promise<void> {
	const busy = activeRunCount(gatewayService.sessionList);

	await action.setFeedbackLayout(DIAL_LAYOUT);
	await action.setFeedback({
		indicator: { value: Math.min(busy, 3), range: { min: 0, max: 3 } },
		title: "Active runs",
		value: String(busy),
	});
}

function shorten(detail: string | undefined): string {
	if (!detail) {
		return "";
	}

	return detail.length > 24 ? `${detail.slice(0, 23)}...` : detail;
}
