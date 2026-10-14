// Connection panel: shows what the plugin is connected to, and tests it.
// The setup wizard lives in a separate window (see connection-bar.js).
(function () {
	const client = SDPIComponents.streamDeckClient;
	const element = (id) => document.getElementById(id);

	let approveCommand = "openclaw devices approve <requestId>";

	const LABELS = {
		disconnected: "Not connected. Start the Gateway, then test.",
		connecting: "Connecting to the Gateway…",
		ready: "Connected.",
		pairing: "Waiting for approval on the Gateway host.",
		error: "Not connected.",
	};

	function send(payload) {
		return client.send("sendToPlugin", payload);
	}

	function setStatus(kind, text) {
		const status = element("status");
		status.className = kind;
		status.textContent = text;
	}

	function showPairing(requestId) {
		approveCommand = "openclaw devices approve " + (requestId || "<requestId>");
		element("approve").textContent = approveCommand;
		element("pairing").classList.remove("hidden");
	}

	function renderState(payload) {
		const state = payload.state || {};
		const config = payload.config || {};

		element("url").textContent = config.gatewayUrl || "—";
		element("auth").textContent = config.hasSecret ? config.authKind : "none";

		const phase = state.phase || "disconnected";
		const detail = state.detail ? "\n" + state.detail : "";
		const kind = phase === "ready" ? "ok" : phase === "error" ? "error" : phase === "pairing" ? "warn" : "running";
		setStatus(kind, (LABELS[phase] || phase) + detail);

		if (phase === "pairing") {
			showPairing(state.requestId);
		} else if (phase === "ready") {
			element("pairing").classList.add("hidden");
		}

		const meta = [];
		if (payload.deviceId) meta.push("device " + payload.deviceId);
		if (payload.configPath) meta.push("config " + payload.configPath);
		element("meta").textContent = meta.join("\n");
	}

	function renderTestResult(payload) {
		if (payload.ok) {
			setStatus("ok", "Connected." + (payload.version ? "\nGateway " + payload.version : ""));
			element("pairing").classList.add("hidden");
			return;
		}

		if (payload.phase === "pairing") {
			setStatus("warn", "Waiting for approval on the Gateway host.");
			showPairing(payload.requestId);
			return;
		}

		setStatus("error", "Connection failed." + (payload.detail ? "\n" + payload.detail : ""));
	}

	function onMessage(message) {
		const payload = message && message.event === "sendToPropertyInspector" ? message.payload : message;
		if (!payload || typeof payload !== "object") {
			return;
		}

		switch (payload.kind) {
			case "test-result":
				renderTestResult(payload);
				return;
			case "save-result":
				setStatus(payload.ok ? "ok" : "error", payload.ok ? "Saved." : payload.error || "Could not save.");
				if (payload.ok) {
					renderState(payload);
				}
				return;
			case "state":
				renderState(payload);
				return;
			default:
				// Another panel's payload (jobs / sessions / usage) — not ours.
				return;
		}
	}

	(function init() {
		client.sendToPropertyInspector.subscribe(onMessage);

		element("test").addEventListener("click", function () {
			setStatus("running", "Testing connection…");
			send({ cmd: "connection.test", config: {} });
		});
		element("copy").addEventListener("click", function () {
			navigator.clipboard.writeText(approveCommand);
			setStatus("running", "Approve command copied to the clipboard.");
		});

		send({ cmd: "connection.state" });
		window.setInterval(function () {
			send({ cmd: "connection.state" });
		}, 2000);
	})();
})();
