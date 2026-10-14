// Shared by every OpenClaw property inspector.
//
// The setup wizard runs in a window opened from a panel. That window has no
// Stream Deck bridge of its own — the app only wires the inspector it manages —
// so this panel relays for it. Replies are addressed with the sender's own
// window object (event.source) rather than a stored handle, which means the
// relay keeps working if the user selects a different OpenClaw action while the
// wizard is open: whichever panel is in the opener window answers.
(function () {
	const button = document.getElementById("openSetup");
	if (button) {
		button.addEventListener("click", function () {
			window.open("setup.html", "OpenClawSetup");
		});
	}

	if (!window.SDPIComponents) {
		return;
	}

	const client = SDPIComponents.streamDeckClient;
	const CONNECTION_KINDS = ["state", "save-result", "test-result"];
	const waiting = new Set();

	// Window -> plugin
	window.addEventListener("message", function (event) {
		const request = event.data && event.data.openclawSetup;
		if (!request) {
			return;
		}
		if (event.source) {
			waiting.add(event.source);
		}
		client.send("sendToPlugin", request);
	});

	// Plugin -> every window that has asked us something.
	client.sendToPropertyInspector.subscribe(function (message) {
		const payload = message && message.event === "sendToPropertyInspector" ? message.payload : message;
		if (!payload || typeof payload !== "object" || CONNECTION_KINDS.indexOf(payload.kind) === -1) {
			return;
		}

		for (const source of waiting) {
			try {
				if (source.closed) {
					waiting.delete(source);
					continue;
				}
				source.postMessage({ openclawSetupReply: payload }, "*");
			} catch (error) {
				// The window went away between the check and the post.
				waiting.delete(source);
			}
		}
	});
})();
