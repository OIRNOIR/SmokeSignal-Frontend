import ChatCrypto from "../global/crypto.js";
import { Connection } from "../global/websocket.js";

let currentSlide = 0;

/**
 * @type {Element}
 */
let title;

/* cspell: disable-next-line */
const defaultApiHostname = "API_HOSTNAME";
const frontHostname = "FRONT_HOSTNAME";

let apiHostname = defaultApiHostname;

const switchAPIServer = (newServerHostname) => {
	apiHostname = newServerHostname;
	localStorage.setItem("apiHostname", apiHostname);
	document.getElementById("hostname").innerText =
		/* cspell: disable-next-line */
		apiHostname == defaultApiHostname ? frontHostname : apiHostname;
	console.log(`Server switched to ${apiHostname}`);
};

function downloadData(text, name, type) {
	const a = document.createElement("a");
	const file = new Blob([text], { type: type });
	const url = URL.createObjectURL(file);
	a.href = url;
	a.download = name;
	document.body.appendChild(a);
	a.click();
	setTimeout(() => {
		document.body.removeChild(a);
		window.URL.revokeObjectURL(url);
	}, 0);
}

function preventDefault(ev) {
	ev.preventDefault();
}

function setCurrentSlide() {
	setSlide(currentSlide);
}

function setSlide(slideId) {
	for (const element of document.getElementsByClassName("slide-selected")) {
		element.classList.remove("slide-selected");
	}
	document.getElementById(`slide-${slideId}`).classList.add("slide-selected");
}

function getFirstSlideIdOfClass(c) {
	return Number(
		document.querySelector(`div.slide.${c}`).getAttribute("id").split("-")[1]
	);
}

/**
 * @typedef KyberKeyPair
 * @property {Uint8Array} publicKey
 * @property {Uint8Array} privateKey
 */

/**
 * @param {String} uploadElementId
 * @returns {Promise<String>} the received file in text form
 */
async function awaitCredFileUpload(uploadElementId) {
	return new Promise((resolve) => {
		async function handleCredFile(file) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.addEventListener("load", (event2) => {
					return resolve(event2.target.result);
				});
				reader.addEventListener("error", () => {
					reject(new Error("There was an error reading the inserted file as text."));
				});
				reader.readAsText(file, "utf8");
			});
		}
		const event1 = document
			.getElementById(uploadElementId)
			.addEventListener("change", async (event) => {
				if (event.target.files[0]) {
					try {
						const file = await handleCredFile(event.target.files[0]);
						document
							.getElementById(uploadElementId)
							.removeEventListener("change", event1);
						document
							.querySelector(`label.drop-container[for="${uploadElementId}"]`)
							.removeEventListener("dragover", event2);
						document
							.querySelector(`label.drop-container[for="${uploadElementId}"]`)
							.removeEventListener("drop", event3);
						return resolve(file);
					} catch (err) {
						console.error(err);
						alert(err.message ?? err);
					}
				}
			});
		const event2 = document
			.querySelector(`label.drop-container[for="${uploadElementId}"]`)
			.addEventListener("dragover", preventDefault);
		const event3 = document
			.querySelector(`label.drop-container[for="${uploadElementId}"]`)
			.addEventListener("drop", async (event) => {
				event.preventDefault();
				if (event.dataTransfer.items[0]) {
					const file = event.dataTransfer.items[0].getAsFile();
					try {
						const text = await handleCredFile(file);
						document
							.getElementById(uploadElementId)
							.removeEventListener("change", event1);
						document
							.querySelector(`label.drop-container[for="${uploadElementId}"]`)
							.removeEventListener("dragover", event2);
						document
							.querySelector(`label.drop-container[for="${uploadElementId}"]`)
							.removeEventListener("drop", event3);
						return resolve(text);
					} catch (err) {
						console.error(err);
						alert(err.message ?? err);
					}
				}
			});
	});
}

function mainPage() {
	const inviteCodeInput = document.getElementById("invite-code");
	const createAccountButton = document.getElementById("create-account-button");

	inviteCodeInput.addEventListener("input", () => {
		if (inviteCodeInput.value.length >= 5 && inviteCodeInput.value.length <= 18) {
			createAccountButton.removeAttribute("disabled");
		} else {
			createAccountButton.setAttribute("disabled", "");
		}
	});

	const continueCreateAccount = async () => {
		if (inviteCodeInput.value.length < 5 || inviteCodeInput.value.length > 18)
			return;
		let res;
		try {
			res = await fetch(
				`https://${apiHostname}/invites/verify/${encodeURIComponent(inviteCodeInput.value)}`
			);
		} catch (err) {
			console.error(err);
			return alert("Error contacting the server");
		}
		if (res.status != 200) return alert("Error contacting the server");
		const text = await res.text();
		if (text == "true") {
			choosePasswordSignupPage(inviteCodeInput.value);
		} else {
			const inviteError = document.getElementById("invite-error");
			inviteError.removeAttribute("hidden");
			inviteError.innerText = "Invalid Invite Code";
		}
	};

	createAccountButton.addEventListener("click", continueCreateAccount);
	inviteCodeInput.addEventListener("keydown", (e) => {
		if (e.key == "Enter") continueCreateAccount();
	});

	async function awaitUpload() {
		const text = await awaitCredFileUpload("login-credentials");
		/**
		 * @type {string}
		 */
		let exportedKyber;
		/**
		 * @type {string}
		 */
		let exportedAES;
		try {
			const parsed = JSON.parse(atob(text));
			exportedKyber = parsed.kyber;
			exportedAES = parsed.accountAES;
		} catch (error) {
			console.error(error);
			alert("The authentication file you uploaded is not in a valid format.");
			return await awaitUpload();
		}
		return { exportedKyber, exportedAES };
	}
	awaitUpload().then((wrappedCredentials) => {
		title.innerText = "Log In";
		currentSlide = getFirstSlideIdOfClass("login-slide");
		setCurrentSlide();
		const passwordEl = document.getElementById("password-input");
		const confirmPasswordButton = document.getElementById(
			"confirm-password-button"
		);
		passwordEl.addEventListener("input", () => {
			if (passwordEl.value.length >= 1) {
				confirmPasswordButton.removeAttribute("disabled");
			} else {
				confirmPasswordButton.setAttribute("disabled", "");
			}
		});

		const continueLogIn = async () => {
			if (passwordEl.value.length < 1) return;
			setSlide("loading");
			const password = passwordEl.value;
			/**
			 * @type {?KyberKeyPair}
			 */
			let kyber = null;
			/**
			 * @type {?CryptoKey}
			 */
			let accountAES = null;
			try {
				kyber = await ChatCrypto.importKyberKeyPair(
					wrappedCredentials.exportedKyber,
					password
				);
				accountAES = await ChatCrypto.unwrapAESKeyWithPassword(
					wrappedCredentials.exportedAES,
					password
				);
			} catch (error) {
				console.error(error);
				alert(
					"There was a problem decrypting your encryption keys with this password. This likely means the password is incorrect."
				);
				setCurrentSlide();
				return;
			}
			const exported = await ChatCrypto.exportKyberKeyPair(kyber);
			const exportedAES = await ChatCrypto.exportAESKey(accountAES);
			localStorage.setItem("publicKey", exported.publicKey);
			localStorage.setItem("privateKey", exported.privateKey);
			localStorage.setItem("accountAES", exportedAES);
			window.location.href = "/app";
		};

		confirmPasswordButton.addEventListener("click", continueLogIn);
		passwordEl.addEventListener("keydown", (e) => {
			if (e.key == "Enter") continueLogIn();
		});
	});
}

/**
 *
 * @param {string} inviteCode
 */
function choosePasswordSignupPage(inviteCode) {
	title.innerText = "Sign Up";
	currentSlide = getFirstSlideIdOfClass("signup-slide");
	setCurrentSlide();
	const passwordEl = document.getElementById("new-password-input");
	const confirmPasswordEl = document.getElementById("new-password-confirm");
	const confirmNewPasswordButton = document.getElementById(
		"confirm-new-password-button"
	);
	const inputEventListener = () => {
		if (
			passwordEl.value.length >= 8 &&
			passwordEl.value == confirmPasswordEl.value
		) {
			confirmNewPasswordButton.removeAttribute("disabled");
		} else {
			confirmNewPasswordButton.setAttribute("disabled", "");
		}
	};
	const continueEventListener = async () => {
		const password = passwordEl.value;
		const confirmPassword = confirmPasswordEl.value;
		if (password.length < 8)
			return alert("Password must be at least 8 characters long.");
		if (password != confirmPassword)
			return alert("Password and confirmation do not match.");
		await generateCredentialsSignupPage(inviteCode, password);
	};
	passwordEl.addEventListener("input", inputEventListener);
	confirmPasswordEl.addEventListener("input", inputEventListener);
	confirmNewPasswordButton.addEventListener("click", continueEventListener);
	passwordEl.addEventListener("keydown", (e) => {
		if (e.key == "Enter") confirmPasswordEl.focus();
	});
	confirmPasswordEl.addEventListener("keydown", (e) => {
		if (e.key == "Enter") continueEventListener();
	});
}

/**
 * @param {string} inviteCode
 * @param {string} password
 */
async function generateCredentialsSignupPage(inviteCode, password) {
	title.innerText = "Sign Up";
	setSlide("loading");
	const kyberKeyPair = await ChatCrypto.generateKyberKeyPair();
	const exportedKyber = await ChatCrypto.exportKyberKeyPair(
		kyberKeyPair,
		password
	);
	const accountAES = await ChatCrypto.generateAESKey();
	const exportedAES = await ChatCrypto.wrapAESKeyWithPassword(
		accountAES,
		password
	);
	const fullExported = { kyber: exportedKyber, accountAES: exportedAES };
	currentSlide++;
	setCurrentSlide();
	document
		.getElementById("save-auth-file-button")
		.addEventListener("click", () => {
			downloadData(
				btoa(JSON.stringify(fullExported)),
				"Authentication.o-chat-auth",
				"text/plain"
			);
		});

	async function awaitUpload() {
		const text = await awaitCredFileUpload("verify-credentials");
		const verify = btoa(JSON.stringify(fullExported));
		if (text == verify) {
			// Success!
			return;
		}
		alert(
			"The authentication file you uploaded does not match the one generated."
		);
		await awaitUpload();
	}
	await awaitUpload();
	selectAccountDetailsSignupPage(inviteCode, kyberKeyPair, accountAES);
}

/**
 * @param {String} inviteCode
 * @param {KyberKeyPair} kyberKeyPair
 * @param {CryptoKey} accountAES
 */
function selectAccountDetailsSignupPage(inviteCode, kyberKeyPair, accountAES) {
	currentSlide++;
	setCurrentSlide();
	const usernameInput = document.getElementById("username");
	const confirmAccountDetailsButton = document.getElementById(
		"confirm-account-details-button"
	);

	usernameInput.addEventListener("input", () => {
		if (usernameInput.value.length >= 1 && usernameInput.value.length <= 32) {
			confirmAccountDetailsButton.removeAttribute("disabled");
		} else {
			confirmAccountDetailsButton.setAttribute("disabled", "");
		}
	});

	confirmAccountDetailsButton.addEventListener("click", () => {
		createAccountFlow(inviteCode, kyberKeyPair, accountAES, usernameInput.value);
	});

	usernameInput.addEventListener("keydown", (e) => {
		if (
			e.key == "Enter" &&
			usernameInput.value.length >= 1 &&
			usernameInput.value.length <= 32
		)
			createAccountFlow(inviteCode, kyberKeyPair, accountAES, usernameInput.value);
	});
}

/**
 * @param {String} inviteCode
 * @param {KyberKeyPair} kyberKeyPair
 * @param {CryptoKey} accountAES
 * @param {String} username
 */
async function createAccountFlow(
	inviteCode,
	kyberKeyPair,
	accountAES,
	username
) {
	setSlide("loading");
	const exportedKyberPublicKey =
		ChatCrypto.exportKyberPublicKeyFromPair(kyberKeyPair);
	let usernameEncrypted;
	try {
		usernameEncrypted = await ChatCrypto.encryptAESString(accountAES, username);
	} catch (error) {
		console.error(error);
		alert("There was an error encrypting your username.");
		currentSlide--;
		selectAccountDetailsSignupPage(inviteCode, kyberKeyPair, accountAES);
		return;
	}
	const connection = new Connection(apiHostname);
	/**
	 * @param {CloseEvent} e
	 */
	const onClose = (e) => {
		if (e.detail.code == 1006)
			return alert(
				"Unable to connect with the Gateway. This may be a problem with your internet connection, or the server may be down."
			);
		alert(`Fatal: Gateway connection closed with code ${e.detail.code}`);
	};
	connection.addEventListener("close", onClose);
	connection.addEventListener("open", async () => {
		const token = await connection.doAuthenticationFlow(kyberKeyPair);
		console.log(token);
		connection.removeEventListener("close", onClose);
		connection.removeCloseListener();
		const res = await fetch(`https://${apiHostname}/users`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Token ${token}`
			},
			body: JSON.stringify({
				keys: {
					Kyber: {
						publicKey: exportedKyberPublicKey
					}
				},
				usernameEncrypted,
				inviteCode
			})
		});
		if (res.status != 200) {
			const errorText = await res.text();
			console.error(`Account creation request failed ${res.status}`);
			console.error(errorText);
			alert(
				`Account creation failed with code ${res.status}. Check console for details.`
			);
			return;
		}
		const userId = await res.text();
		console.log(`User ID: ${userId}`);
		alert(
			"Account created successfully! Please log in via the login prompt on the left side of the login page. The page will now refresh."
		);
		connection.close(1000);
		window.location.reload();
	});
}

document.addEventListener("DOMContentLoaded", async () => {
	title = document.querySelector(".main-title");

	window.switchAPIServer = switchAPIServer;

	if (localStorage.getItem("apiHostname") != null) {
		switchAPIServer(localStorage.getItem("apiHostname"));
	}

	if (localStorage.getItem("privateKey") != null) {
		window.location.href = "/app";
	}

	if (window.crypto?.subtle == null) {
		setSlide("incompatible");
		return;
	}

	currentSlide = 0;
	setCurrentSlide();

	mainPage();
});
