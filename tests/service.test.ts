import { describe, expect, it } from "vitest";

import { GatewayService, GatewayUnavailableError, type ConnectorState, type GatewayConnector } from "../src/gateway/service";

function stubConnector() {
	const eventListeners: Array<(evt: { event: string; payload: unknown }) => void> = [];
	const stateListeners: Array<(state: ConnectorState) => void> = [];
	const requests: Array<[string, unknown]> = [];

	const connector: GatewayConnector = {
		start: () => setState({ phase: "ready" }),
		stop: () => setState({ phase: "disconnected" }),
		request: async (method: string, params?: unknown) => {
			requests.push([method, params]);
			return {};
		},
		onEvent: (cb) => {
			eventListeners.push(cb);
			return () => {
				const index = eventListeners.indexOf(cb);
				if (index >= 0) eventListeners.splice(index, 1);
			};
		},
		onState: (cb) => {
			stateListeners.push(cb);
			return () => {
				const index = stateListeners.indexOf(cb);
				if (index >= 0) stateListeners.splice(index, 1);
			};
		},
	};

	function fire(evt: { event: string; payload: unknown }): void {
		for (const listener of [...eventListeners]) listener(evt);
	}

	function setState(state: ConnectorState): void {
		for (const listener of [...stateListeners]) listener(state);
	}

	return { connector, fire, setState, requests };
}

describe("GatewayService", () => {
	it("rejects requests when not ready", async () => {
		const { connector } = stubConnector();
		const service = new GatewayService(connector);

		await expect(service.request("health", {})).rejects.toThrow(GatewayUnavailableError);
	});

	it("rejects requests while pairing or errored", async () => {
		const { connector, setState } = stubConnector();
		const service = new GatewayService(connector);

		for (const phase of ["pairing", "error", "connecting", "disconnected"] as const) {
			setState({ phase });
			await expect(service.request("health", {})).rejects.toThrow(GatewayUnavailableError);
		}
	});

	it("tracks state from the connector", () => {
		const { connector, setState } = stubConnector();
		const service = new GatewayService(connector);
		const seen: string[] = [];
		service.onState((state) => seen.push(state.phase));

		service.start();
		setState({ phase: "error", detail: "refused" });

		expect(seen).toContain("ready");
		expect(service.state.phase).toBe("error");
	});

	it("re-subscribes to connector state after stop and start", () => {
		const { connector, setState } = stubConnector();
		const service = new GatewayService(connector);

		service.stop();
		service.start();
		setState({ phase: "ready", detail: "9.9.9" });

		expect(service.state.phase).toBe("ready");
		expect(service.state.detail).toBe("9.9.9");
	});

	it("forwards typed wrappers", async () => {
		const { connector, requests } = stubConnector();
		const service = new GatewayService(connector);
		service.start();

		await service.listCronJobs();

		expect(requests).toContainEqual(["cron.list", {}]);
	});

	it("returns an empty list when a payload has no rows", async () => {
		const { connector } = stubConnector();
		const service = new GatewayService(connector);
		service.start();

		await expect(service.listSessions()).resolves.toEqual([]);
		await expect(service.listCronJobs()).resolves.toEqual([]);
	});

	it("fans out named events only to their subscribers", () => {
		const { connector, fire } = stubConnector();
		const service = new GatewayService(connector);
		const cron: unknown[] = [];

		service.getEvent("cron", (payload) => cron.push(payload));
		fire({ event: "cron", payload: { x: 1 } });
		fire({ event: "sessions.changed", payload: { y: 2 } });

		expect(cron).toEqual([{ x: 1 }]);
	});

	it("refresh keeps last-good data when the Gateway goes away", async () => {
		const { connector, setState } = stubConnector();
		const service = new GatewayService(connector);
		service.start();

		await service.refresh();
		const before = service.sessionList;
		setState({ phase: "error", detail: "down" });

		await expect(service.refresh()).resolves.toBeUndefined();
		expect(service.sessionList).toBe(before);
	});
});
