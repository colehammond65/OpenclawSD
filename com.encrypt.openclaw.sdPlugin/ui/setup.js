// Setup property inspector. The bridge comes from sdpi-components (vendored
// next to this file so the inspector works offline); the form itself is plain
// HTML so there is no component-library surface to depend on.
(function () {
	const client = SDPIComponents.streamDeckClient;
	const element = (id) => document.getElementById(id);

	let seeded = false;
	let approveCommand = "openclaw devices approve <requestId>";

	function send(payload) {
		return client.send("sendToPlugin", payload);
	}

	function readForm() {
		return {
			gatewayUrl: element("url").value,
			authKind: element("authKind").value,
			secret: element("secret").value,
		};
	}

	function setStatus(kind, text) {
		const status = element("status");
		status.className = kind;
		status.textContent = text;
	}

	function toggleSecretRow() {
		const needsSecret = element("authKind").value !== "none";
		element("secretRow").classList.toggle("hidden", !needsSecret);
	}

	function showPairing(requestId) {
		approveCommand = "openclaw devices approve " + (requestId || "<requestId>");
		element("approve").textContent = approveCommand;
		element("pairing").classList.remove("hidden");
	}

	function renderState(payload) {
		const state = payload.state || {};
		const config = payload.config || {};

		if (!seeded) {
			element("url").value = config.gatewayUrl || "ws://127.0.0.1:18789";
			element("authKind").value = config.authKind || "none";
			seeded = true;
		}
		if (config.hasSecret) {
			element("secret").placeholder = "saved — leave blank to keep";
		}
		toggleSecretRow();

		const phase = state.phase || "disconnected";
		const detail = state.detail ? "\n" + state.detail : "";
		const labels = {
			disconnected: "Not connected. Start the Gateway with `openclaw gateway --allow-unconfigured`, then Save.",
			connecting: "Connecting to the Gateway…",
			ready: "Connected." + detail,
			pairing: "Waiting for approval on the Gateway host.",
			error: "Not connected." + detail,
		};
		setStatus(phase === "ready" ? "ok" : phase === "error" ? "error" : phase === "pairing" ? "warn" : "running", labels[phase] || phase);

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
				break;
			case "save-result":
				if (payload.ok) {
					setStatus("running", "Saved. Connecting…");
					renderState(payload);
				} else {
					setStatus("error", payload.error || "Could not save.");
				}
				break;
			default:
				renderState(payload);
		}
	}

	(function init() {
		client.sendToPropertyInspector.subscribe(onMessage);

		element("authKind").addEventListener("change", toggleSecretRow);
		element("save").addEventListener("click", function () {
			setStatus("running", "Testing connection…");
			send({ cmd: "save", config: readForm() });
		});
		element("copy").addEventListener("click", function () {
			navigator.clipboard.writeText(approveCommand);
			setStatus("running", "Approve command copied to the clipboard.");
		});

		send({ cmd: "state" });
		window.setInterval(function () {
			send({ cmd: "state" });
		}, 2000);
	})();
})();
