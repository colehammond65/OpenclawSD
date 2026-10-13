// Run Automation property inspector: lists the Gateway's automations and saves
// the chosen one into this action's settings.
(function () {
	const client = SDPIComponents.streamDeckClient;
	const element = (id) => document.getElementById(id);

	let selected = "";

	function send(payload) {
		return client.send("sendToPlugin", payload);
	}

	function setStatus(kind, text) {
		const status = element("status");
		status.className = kind;
		status.textContent = text;
	}

	function renderJobs(jobs) {
		const select = element("job");
		select.innerHTML = "";

		if (!jobs.length) {
			const option = document.createElement("option");
			option.value = "";
			option.textContent = "— no automations found —";
			select.appendChild(option);
			setStatus("warn", "No automations. Create one with `openclaw automations add`.");
			return;
		}

		for (const job of jobs) {
			const option = document.createElement("option");
			option.value = job.id;
			option.textContent = job.label + (job.enabled ? "" : " (disabled)");
			select.appendChild(option);
		}

		select.value = selected;
		const current = jobs.find((job) => job.id === selected);
		if (!current) {
			setStatus("warn", "Choose an automation, then press the key to run it.");
			return;
		}

		const outcome = current.status === "ok" ? "Last run ok" : current.status === "error" ? "Last run failed" : current.status === "skipped" ? "Last run skipped" : "Never run";
		setStatus(current.status === "error" ? "error" : current.status === "ok" ? "ok" : "running", `${current.label} — ${outcome}.`);
	}

	function onMessage(message) {
		const payload = message && message.event === "sendToPropertyInspector" ? message.payload : message;
		if (payload && payload.kind === "jobs") {
			renderJobs(payload.jobs || []);
		}
	}

	(async function init() {
		client.sendToPropertyInspector.subscribe(onMessage);

		const settings = await client.getSettings();
		selected = (settings && settings.settings && settings.settings.jobId) || "";

		element("job").addEventListener("change", function (event) {
			selected = event.target.value;
			client.setSettings({ jobId: selected });
		});

		send({ cmd: "jobs" });
		window.setInterval(function () {
			send({ cmd: "jobs" });
		}, 15000);
	})();
})();
