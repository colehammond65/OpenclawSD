// Usage property inspector: a read-only readout of quota and spend.
(function () {
	const client = SDPIComponents.streamDeckClient;
	const element = (id) => document.getElementById(id);

	function money(amount) {
		return "$" + Number(amount || 0).toFixed(2);
	}

	function render(payload) {
		element("worst").textContent = payload.worst === null || payload.worst === undefined ? "no quota data" : payload.worst + "%";
		element("today").textContent = money(payload.today);
		element("window").textContent = money(payload.window);
		element("windowLabel").textContent = "Spend (" + (payload.days || 30) + " days)";

		const providers = payload.providers || [];
		const host = element("providers");
		host.innerHTML = "";
		if (!providers.length) {
			const note = document.createElement("div");
			note.className = "muted";
			note.textContent = "No provider quota — local models report none.";
			host.appendChild(note);
			return;
		}

		for (const provider of providers) {
			const row = document.createElement("div");
			row.className = "row";
			const label = document.createElement("span");
			label.textContent = provider.label;
			const value = document.createElement("span");
			value.className = "value";
			value.textContent = provider.remainingPercent === null ? "—" : provider.remainingPercent + "% left";
			row.appendChild(label);
			row.appendChild(value);
			host.appendChild(row);
		}
	}

	function onMessage(message) {
		const payload = message && message.event === "sendToPropertyInspector" ? message.payload : message;
		if (payload && payload.kind === "usage") {
			render(payload);
		}
	}

	(function init() {
		client.sendToPropertyInspector.subscribe(onMessage);

		function request() {
			client.send("sendToPlugin", { cmd: "usage" });
		}

		request();
		window.setInterval(request, 10000);
	})();
})();
