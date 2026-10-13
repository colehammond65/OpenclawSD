import { action, SingletonAction, type WillAppearEvent } from "@elgato/streamdeck";

/**
 * Placeholder for the Gateway status action; replaced in Task 7 of the plan
 * with live health and active-run rendering.
 */
@action({ UUID: "com.encrypt.openclaw.status" })
export class Status extends SingletonAction {
	override async onWillAppear(ev: WillAppearEvent): Promise<void> {
		if (!ev.action.isKey()) {
			return;
		}

		await ev.action.setTitle("OpenClaw");
	}
}
