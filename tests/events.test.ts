import { describe, expect, it } from "vitest";

import { GatewayEventBus } from "../src/gateway/events";

describe("GatewayEventBus", () => {
	it("delivers events to subscribers and unsubscribes", () => {
		const bus = new GatewayEventBus();
		const seen: unknown[] = [];

		const off = bus.on("sessions.changed", (payload) => seen.push(payload));
		bus.emit("sessions.changed", { n: 1 });
		off();
		bus.emit("sessions.changed", { n: 2 });

		expect(seen).toEqual([{ n: 1 }]);
	});

	it("isolates namespaces", () => {
		const bus = new GatewayEventBus();
		const agent: unknown[] = [];
		const cron: unknown[] = [];

		bus.on("agent", (payload) => agent.push(payload));
		bus.on("cron", (payload) => cron.push(payload));
		bus.emit("agent", { x: 1 });

		expect(agent).toHaveLength(1);
		expect(cron).toHaveLength(0);
	});

	it("reports a throwing subscriber and keeps serving the others", () => {
		const errors: unknown[] = [];
		const bus = new GatewayEventBus((error) => errors.push(error));
		let secondSubscriberCalls = 0;

		bus.on("tick", () => {
			throw new Error("boom");
		});
		bus.on("tick", () => {
			secondSubscriberCalls++;
		});

		expect(() => bus.emit("tick", {})).not.toThrow();
		expect(secondSubscriberCalls).toBe(1);
		expect(errors).toHaveLength(1);
	});

	it("clear removes every subscriber", () => {
		const bus = new GatewayEventBus();
		let calls = 0;
		bus.on("health", () => calls++);

		bus.clear();
		bus.emit("health", {});

		expect(calls).toBe(0);
	});

	it("off removes a single subscriber without disturbing the others", () => {
		const bus = new GatewayEventBus();
		const first: unknown[] = [];
		const second: unknown[] = [];
		const onFirst = (payload: unknown) => first.push(payload);

		bus.on("presence", onFirst);
		bus.on("presence", (payload) => second.push(payload));
		bus.off("presence", onFirst);
		bus.emit("presence", { ok: true });

		expect(first).toHaveLength(0);
		expect(second).toHaveLength(1);
	});
});
