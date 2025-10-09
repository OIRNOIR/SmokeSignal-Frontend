window.addEventListener("DOMContentLoaded", () => {
	window.localStorage.removeItem("publicKey");
	window.localStorage.removeItem("privateKey");
	window.localStorage.removeItem("accountAES");
	window.sessionStorage.clear();
	window.location.replace("/");
});
