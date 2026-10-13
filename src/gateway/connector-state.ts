import type { ConnectorState } from "./service";

const PAIRING_REQUIRED = "PAIRING_REQUIRED";
const PAIRING_DETAIL = "Waiting for approval on the Gateway host";

type CloseInfo = {
	phase?: "pre-hello" | "post-hello";
	transientPreHelloCleanClose?: boolean;
};

/** A rejected handshake is an error; a lost connection is a disconnect. */
export function mapConnectError(error: unknown): ConnectorState {
	const details = readDetails(error);
	if (details?.code === PAIRING_REQUIRED) {
		return {
			phase: "pairing",
			detail: PAIRING_DETAIL,
			requestId: typeof details.requestId === "string" ? details.requestId : undefined,
		};
	}

	return { phase: "error", detail: error instanceof Error ? error.message : String(error) };
}

export function mapClose(code: number, reason: string, info?: CloseInfo): ConnectorState {
	const detail = reason.trim().length > 0 ? reason : `closed (${code})`;

	// A clean close after the handshake means the Gateway went away and the
	// client will reconnect; a clean transient pre-hello close is a retry in
	// progress. Neither is worth showing as an error.
	if (!info || info.phase === "post-hello" || info.transientPreHelloCleanClose) {
		return { phase: "disconnected", detail };
	}

	return { phase: "error", detail };
}

export function mapReconnectPaused(info: { code: number; reason: string; detailCode: string | null }): ConnectorState {
	return { phase: "pairing", detail: info.detailCode ?? info.reason };
}

/** Error payloads carry details either directly or nested under `error`. */
function readDetails(error: unknown): Record<string, unknown> | null {
	if (typeof error !== "object" || error === null) {
		return null;
	}

	const record = error as Record<string, unknown>;
	if (isRecord(record.details)) {
		return record.details;
	}

	return isRecord(record.error) && isRecord(record.error.details) ? record.error.details : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
