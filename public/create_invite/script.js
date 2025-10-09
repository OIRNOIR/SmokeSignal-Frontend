/* cspell: disable-next-line */
let apiHostname = "API_HOSTNAME";

const switchAPIServer = (newServerHostname) => {
	apiHostname = newServerHostname;
	localStorage.setItem("apiHostname", apiHostname);
	console.log(`Server switched to ${apiHostname}`);
};

document.addEventListener("DOMContentLoaded", () => {
	window.switchAPIServer = switchAPIServer;

	if (localStorage.getItem("apiHostname") != null) {
		switchAPIServer(localStorage.getItem("apiHostname"));
	}

	document.getElementById("ts").value = Date.now();
	document.getElementById("submit").addEventListener("click", async () => {
		/**
		 * @type {Response}
		 */
		let res;
		try {
			res = await fetch(`https://${apiHostname}/invites/create`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					ts: Date.now(),
					key: document.getElementById("key").value
				})
			});
		} catch (err) {
			console.error(err);
			alert("Error contacting the server");
		}
		const body = await res.json();
		document.writeln(`Code: ${body.code}\nExpiry: ${body.expiry}`);
	});
});
