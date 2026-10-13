import type { ChatSendResult } from "../gateway/types";

/** Longest failure text a key face can carry. */
const MAX_SHORT = 24;

export type SendOutcome = { status: "ok" | "error"; short: string };

/**
 * A resolved `chat.send` means the Gateway accepted the message; `chat.send` has
 * no typed result, so only an explicit rejection or a thrown error is a failure.
 */
export function sendOutcomeMessage(result: unknown, error: unknown): SendOutcome {
	if (error) {
		return { status: "error", short: shorten(error instanceof Error ? error.message : String(error)) };
	}

	const record = isRecord(result) ? (result as ChatSendResult) : {};
	if (typeof record.error === "string" && record.error.length > 0) {
		return { status: "error", short: shorten(record.error) };
	}

	if (record.ok === false) {
		return { status: "error", short: "rejected" };
	}

	return { status: "ok", short: "Sent" };
}

function shorten(message: string): string {
	return message.length <= MAX_SHORT ? message : `${message.slice(0, MAX_SHORT - 3)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
