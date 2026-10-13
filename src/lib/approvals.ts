/** Longest command text a key face can carry. */
const MAX_LABEL = 20;

/** Pending approvals after one lifecycle event; never below zero. */
export function nextApprovalCount(current: number, event: { type: "request" | "resolve" }): number {
	return Math.max(0, event.type === "request" ? current + 1 : current - 1);
}

/**
 * A short description of what is being approved. Accepts either an event payload
 * (`presentation.commandText`) or a list row (`commandText`).
 */
export function approvalLabel(payload: unknown): string {
	const record = isRecord(payload) ? payload : {};
	const presentation = isRecord(record.presentation) ? record.presentation : record;
	const command =
		typeof presentation.commandText === "string"
			? presentation.commandText
			: typeof record.commandText === "string"
				? record.commandText
				: undefined;

	return command && command.trim().length > 0 ? shorten(command.trim()) : "approval";
}

/** The approval id carried by an event payload, when there is one. */
export function approvalId(payload: unknown): string | null {
	const record = isRecord(payload) ? payload : {};
	return typeof record.id === "string" && record.id.length > 0 ? record.id : null;
}

function shorten(text: string): string {
	return text.length <= MAX_LABEL ? text : `${text.slice(0, MAX_LABEL - 3)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
