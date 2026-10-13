import type { ChatSendResult } from "../gateway/types";

/** Longest failure text a key face can carry. */
const MAX_SHORT = 24;

/** Longest prompt preview on an idle key. */
const MAX_FACE = 14;

export type SendOutcome = { status: "ok" | "error"; short: string };

/** What a Send Prompt key shows when it is not reporting an outcome. */
export type SendFace = { kind: "neutral" | "error"; label: string; detail: string };

/**
 * A resolved `chat.send` means the Gateway accepted the message; `chat.send` has
 * no typed result, so only an explicit rejection or a thrown error is a failure.
 */
export function sendOutcomeMessage(result: unknown, error: unknown): SendOutcome {
	if (error) {
		return { status: "error", short: shorten(error instanceof Error ? error.message : String(error), MAX_SHORT) };
	}

	const record = isRecord(result) ? (result as ChatSendResult) : {};
	if (typeof record.error === "string" && record.error.length > 0) {
		return { status: "error", short: shorten(record.error, MAX_SHORT) };
	}

	if (record.ok === false) {
		return { status: "error", short: "rejected" };
	}

	return { status: "ok", short: "Sent" };
}

/** The idle face: the configured prompt, so the key says what it will send. */
export function sendIdleFace(prompt: string | undefined, connected: boolean): SendFace {
	const text = (prompt ?? "").trim();

	return {
		kind: connected ? "neutral" : "error",
		label: "Send",
		detail: text.length > 0 ? shorten(text, MAX_FACE) : "set a prompt",
	};
}

function shorten(message: string, max: number): string {
	return message.length <= max ? message : `${message.slice(0, max - 3)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
