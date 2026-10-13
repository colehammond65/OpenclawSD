import streamDeck, {
	action,
	type Action,
	type KeyDownEvent,
	type KeyUpEvent,
	SingletonAction,
	type WillAppearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { gatewayService } from "../gateway";
import type { ApprovalDecision } from "../gateway/types";
import { approvalId, approvalLabel } from "../lib/approvals";
import { imageForStatus, statusTitle } from "../lib/deck";

/** Presses longer than this deny instead of approve. */
const LONG_PRESS_MS = 700;

type Face = { kind: "neutral" | "warn" | "error"; label: string; detail: string };

/**
 * Lights up when the Gateway is waiting for an exec approval. A short press
 * approves the oldest request; a long press denies it.
 */
@action({ UUID: "com.encrypt.openclaw.approvals" })
export class Approvals extends SingletonAction<JsonObject> {
	/** Pending approvals by id, with a short label for the face. */
	private readonly pending = new Map<string, string>();
	private pressedAt = 0;

	constructor() {
		super();

		gatewayService.getEvent("exec.approval.requested", (payload) => void this.onRequested(payload));
		gatewayService.getEvent("exec.approval.resolved", (payload) => void this.onResolved(payload));
		gatewayService.onState(() => void this.renderAll());
	}

	override async onWillAppear(ev: WillAppearEvent<JsonObject>): Promise<void> {
		await this.seed();
		await render(ev.action, this.face());
	}

	override async onKeyDown(ev: KeyDownEvent<JsonObject>): Promise<void> {
		this.pressedAt = Date.now();
	}

	override async onKeyUp(ev: KeyUpEvent<JsonObject>): Promise<void> {
		const held = Date.now() - this.pressedAt;
		await this.resolve(ev.action, held >= LONG_PRESS_MS ? "deny" : "allow-once");
	}

	private async onRequested(payload: unknown): Promise<void> {
		const id = approvalId(payload);
		if (id) {
			this.pending.set(id, approvalLabel(payload));
		}

		await this.renderAll();
	}

	private async onResolved(payload: unknown): Promise<void> {
		const id = approvalId(payload);
		if (id) {
			this.pending.delete(id);
		}

		await this.renderAll();
	}

	/** Seeds from the Gateway so a key added mid-request still lights up. */
	private async seed(): Promise<void> {
		if (gatewayService.state.phase !== "ready") {
			return;
		}

		try {
			const items = await gatewayService.listApprovals();
			this.pending.clear();
			for (const item of items) {
				if (item.id) {
					this.pending.set(item.id, approvalLabel(item));
				}
			}
		} catch (error) {
			streamDeck.logger.error(`[approvals] could not list: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async resolve(action: Action<JsonObject>, decision: ApprovalDecision): Promise<void> {
		const oldest = this.pending.keys().next();
		if (oldest.done || !oldest.value) {
			if (action.isKey()) {
				await action.showAlert();
			}
			return;
		}

		const id = oldest.value;
		try {
			await gatewayService.resolveApproval({ id, decision });
			this.pending.delete(id);
			if (action.isKey()) {
				await action.showOk();
			}
		} catch (error) {
			streamDeck.logger.error(`[approvals] resolve failed: ${error instanceof Error ? error.message : String(error)}`);
			if (action.isKey()) {
				await action.showAlert();
			}
		}

		await this.renderAll();
	}

	private async renderAll(): Promise<void> {
		const face = this.face();
		for (const action of this.actions) {
			await render(action, face);
		}
	}

	private face(): Face {
		if (gatewayService.state.phase !== "ready") {
			return { kind: "error", label: "DOWN", detail: "no gateway" };
		}

		if (this.pending.size === 0) {
			return { kind: "neutral", label: "Approvals", detail: "none pending" };
		}

		const [first] = [...this.pending.values()];

		return { kind: "warn", label: "APPROVE", detail: `${first} (+${this.pending.size - 1})` };
	}
}

async function render(action: Action<JsonObject>, face: Face): Promise<void> {
	if (action.isKey()) {
		await action.setImage(imageForStatus(face.kind));
		await action.setTitle(statusTitle(face.label, face.detail));
	}
}
