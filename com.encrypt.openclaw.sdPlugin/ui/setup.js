// Setup wizard. Runs in a window opened from an OpenClaw property inspector
// (see connection-bar.js): the app gives that window no Stream Deck bridge, so
// everything is relayed through the panel that opened it.
(function () {
	const element = (id) => document.getElementById(id);
	let onReply = function () {};

	let seeded = false;
	let approveCommand = "openclaw devices approve <requestId>";

	function send(payload) {
		if (!window.opener || window.opener.closed) {
			setStatus("error", "Lost the connection to Stream Deck. Reopen this window from an OpenClaw action's settings panel.");
			return;
		}
		window.opener.postMessage({ openclawSetup: payload }, "*");
	}

	window.addEventListener("message", function (event) {
		if (event.data && event.data.openclawSetupReply) {
			onReply(event.data.openclawSetupReply);
		}
	});

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
		const kind = phase === "ready" ? "ok" : phase === "error" ? "error" : phase === "pairing" ? "warn" : "running";
		setStatus(kind, labels[phase] || phase);

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

	function onMessage(payload) {
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
		onReply = onMessage;

		element("authKind").addEventListener("change", toggleSecretRow);
		element("save").addEventListener("click", function () {
			setStatus("running", "Testing connection…");
			send({ cmd: "connection.save", config: readForm() });
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
