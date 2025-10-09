import ChatCrypto from "../global/crypto.js";

export class Connection extends EventTarget {
	constructor(apiHostname) {
		super();
		this.apiHostname = apiHostname;

		/**
		 * @type {WebSocket}
		 */
		this.socket = null;

		/**
		 * @type {?string}
		 */
		this.sessionToken = null;

		this.retries = 0;

		this.initialOpened = false;

		this.disconnectedSince = null;

		this.startConnection();

		this._websocketOnClose = null;
	}

	startConnection() {
		const currentRetries = this.retries;
		// biome-ignore lint/complexity/noUselessThisAlias: This aliasing of this is absolutely necessary
		const connection = this;
		this.socket = new WebSocket(`wss://${this.apiHostname}/gateway`);
		this.socket.addEventListener("open", () => {
			console.log("WebSocket Connected!");
			const alreadyOpen = this.initialOpened;
			if (!this.initialOpened) {
				this.dispatchEvent(new Event("open"));
				this.initialOpened = true;
			}
			setTimeout(() => {
				if (this.retries > 0 && alreadyOpen) {
					this.dispatchEvent(
						new CustomEvent("reconnect", {
							detail: { disconnectedSince: this.disconnectedSince }
						})
					);
				}
				if (currentRetries == this.retries) {
					this.retries = 0;
					this.disconnectedSince = null;
				}
			}, 500);
		});
		this._websocketOnClose = (e) => {
			console.log("WebSocket Disconnected!");
			connection.dispatchEvent(
				new CustomEvent("disconnect", { detail: { code: e.code } })
			);
			if (connection.disconnectedSince == null)
				connection.disconnectedSince = Date.now();
			if (connection.retries > 5) {
				console.log("WebSocket Out of Retries!");
				connection.dispatchEvent(
					new CustomEvent("close", { detail: { code: e.code } })
				);
			} else {
				console.log("WebSocket Attempting to Reconnect...");
				connection.retries++;
				setTimeout(() => {
					connection.startConnection();
				}, 500);
			}
		};
		this.socket.addEventListener("close", this._websocketOnClose);
		this.socket.addEventListener("message", (e) => {
			this.dispatchEvent(new CustomEvent("message", { detail: { data: e.data } }));
		});
	}

	/**
	 * @param {string | ArrayBufferLike | Blob | ArrayBufferView} message
	 */
	send(message) {
		this.socket.send(message);
	}

	/**
	 * @typedef KyberKeyPair
	 * @property {Uint8Array} publicKey
	 * @property {Uint8Array} privateKey
	 */

	/**
	 * @param {KyberKeyPair} keyPair
	 * @returns {Promise<string>} the session token
	 */
	async doAuthenticationFlow(keyPair) {
		return new Promise((resolve) => {
			const onMessage = async (message) => {
				const str = message.data;
				let json;
				try {
					json = JSON.parse(str);
				} catch {
					console.error("Connection sent invalid json");
					return this.socket.close(4001, "Invalid JSON");
				}
				switch (json.action) {
					case "authChallenge": {
						if (!json.cipherText || !json.challengeEncrypted) return;
						const symmetricKey = await ChatCrypto.deriveKeyKyber(
							json.cipherText,
							keyPair.privateKey
						);
						const challenge = await ChatCrypto.decryptAESString(
							symmetricKey,
							json.challengeEncrypted
						);
						this.socket.send(JSON.stringify({ action: "authSolve", challenge }));
						break;
					}
					case "authComplete": {
						if (!json.sessionToken) return;
						this.socket.removeEventListener("message", onMessage);
						this.sessionToken = json.sessionToken;
						return resolve(json.sessionToken);
					}
				}
			};
			this.socket.addEventListener("message", onMessage);
			const exportedKyberPublicKey =
				ChatCrypto.exportKyberPublicKeyFromPair(keyPair);
			this.socket.send(
				JSON.stringify({ action: "authStart", publicKey: exportedKyberPublicKey })
			);
		});
	}

	/**
	 * @param {?number} code
	 * @param {?string} reason
	 */
	close(code, reason) {
		this.removeCloseListener();
		this.socket?.close(code, reason);
	}

	removeCloseListener() {
		this.socket?.removeEventListener("close", this._websocketOnClose);
	}
}
