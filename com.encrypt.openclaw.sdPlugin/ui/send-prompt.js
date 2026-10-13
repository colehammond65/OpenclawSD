// Send Prompt property inspector: pick a session, write a prompt, saved as the
// action's settings.
(function () {
	const client = SDPIComponents.streamDeckClient;
	const element = (id) => document.getElementById(id);

	let settings = { sessionKey: "", prompt: "", queueMode: "followup" };
	let saveTimer = null;

	function save() {
		if (saveTimer) {
			window.clearTimeout(saveTimer);
		}
		saveTimer = window.setTimeout(function () {
			client.setSettings({
				sessionKey: element("sessionKey").value.trim(),
				prompt: element("prompt").value,
				queueMode: element("queueMode").value,
			});
		}, 300);
	}

	function renderSessions(sessions) {
		const select = element("session");
		select.innerHTML = "";

		const none = document.createElement("option");
		none.value = "";
		none.textContent = "Default (main session)";
		select.appendChild(none);

		for (const session of sessions) {
			const option = document.createElement("option");
			option.value = session.key;
			option.textContent = session.label + (session.isMain ? " (main)" : "");
			select.appendChild(option);
		}

		select.value = settings.sessionKey || "";
	}

	function onMessage(message) {
		const payload = message && message.event === "sendToPropertyInspector" ? message.payload : message;
		if (payload && payload.kind === "sessions") {
			renderSessions(payload.sessions || []);
		}
	}

	(async function init() {
		client.sendToPropertyInspector.subscribe(onMessage);

		const stored = await client.getSettings();
		settings = Object.assign(settings, (stored && stored.settings) || {});

		element("sessionKey").value = settings.sessionKey || "";
		element("queueMode").value = settings.queueMode || "followup";
		element("prompt").value = settings.prompt || "";

		element("session").addEventListener("change", function (event) {
			element("sessionKey").value = event.target.value;
			save();
		});
		element("sessionKey").addEventListener("input", save);
		element("queueMode").addEventListener("change", save);
		element("prompt").addEventListener("input", save);

		client.send("sendToPlugin", { cmd: "sessions" });
		window.setInterval(function () {
			client.send("sendToPlugin", { cmd: "sessions" });
		}, 15000);
	})();
})();
