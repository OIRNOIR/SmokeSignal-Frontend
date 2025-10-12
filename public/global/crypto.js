import * as kyber from "https://esm.sh/crystals-kyber-js@1.1.2";

/**
 * @param {Uint8Array} array
 * @returns {string}
 */
function exportCryptoArray(array) {
	return btoa(JSON.stringify(Array.from(array)));
}

/**
 * @param {string} str
 * @returns {Uint8Array}
 */
function importCryptoString(str) {
	return new Uint8Array(JSON.parse(atob(str)));
}

// biome-ignore lint/complexity/noStaticOnlyClass: I like this layout
export default class ChatCrypto {
	/**
	 * @typedef KyberKeyPair
	 * @property {Uint8Array} publicKey
	 * @property {Uint8Array} privateKey
	 */

	/**
	 * @returns {Promise<KyberKeyPair>}
	 */
	static async generateKyberKeyPair() {
		const kyberInstance = new kyber.Kyber1024();
		const keys = await kyberInstance.generateKeyPair();
		return { publicKey: keys[0], privateKey: keys[1] };
	}

	/**
	 * @returns {Promise<CryptoKey>}
	 */
	static async generateAESKey() {
		return window.crypto.subtle.generateKey(
			{
				name: "AES-GCM",
				length: 256
			},
			true,
			["encrypt", "decrypt"]
		);
	}

	/**
	 * @typedef ExportedKeyPair
	 * @property {String} publicKey
	 * @property {String} privateKey
	 */

	/**
	 * @param {KyberKeyPair} keyPair
	 * @param {?string} password
	 * @returns {Promise<ExportedKeyPair>}
	 */
	static async exportKyberKeyPair(keyPair, password = null) {
		const keys = {};
		for (const k of ["publicKey", "privateKey"]) {
			const key = keyPair[k];
			const str = exportCryptoArray(key);
			if (password == null) {
				keys[k] = str;
			} else {
				keys[k] = await ChatCrypto.encryptAESStringWithPassword(str, password);
			}
		}
		return keys;
	}

	/**
	 * @param {KyberKeyPair} keyPair
	 * @returns {String}
	 */
	static exportKyberPublicKeyFromPair(keyPair) {
		return exportCryptoArray(keyPair.publicKey);
	}

	/**
	 * @param {Uint8Array} key
	 * @returns {String}
	 */
	static unprotectedKyberExport(key) {
		return exportCryptoArray(key);
	}

	/**
	 * @param {CryptoKey} key
	 * @returns {Promise<String>}
	 */
	static async exportAESKey(key) {
		const jwk = await window.crypto.subtle.exportKey("jwk", key);
		return btoa(JSON.stringify(jwk));
	}

	/**
	 * @param {CryptoKey} key
	 * @param {string} password
	 * @returns {Promise<string>}
	 */
	static async wrapAESKeyWithPassword(key, password) {
		const exportedKey = await ChatCrypto.exportAESKey(key);
		return ChatCrypto.encryptAESStringWithPassword(exportedKey, password);
	}

	/**
	 * @param {CryptoKey} wrapperKey
	 * @param {CryptoKey} wrappedKey
	 * @returns {Promise<string>}
	 */
	static async wrapAESKey(wrapperKey, wrappedKey) {
		const exportedKey = await ChatCrypto.exportAESKey(wrappedKey);
		return ChatCrypto.encryptAESString(wrapperKey, exportedKey);
	}

	/**
	 * @param {string} cipherText
	 * @param {string} password
	 * @returns {Promise<CryptoKey>}
	 */
	static async unwrapAESKeyWithPassword(cipherText, password) {
		const decrypted = await ChatCrypto.decryptAESStringWithPassword(
			cipherText,
			password
		);
		return ChatCrypto.importAESKey(decrypted);
	}

	/**
	 * @param {CryptoKey} key
	 * @param {string} cipherText
	 * @returns {Promise<CryptoKey>}
	 */
	static async unwrapAESKey(key, cipherText) {
		const decrypted = await ChatCrypto.decryptAESString(key, cipherText);
		return ChatCrypto.importAESKey(decrypted);
	}

	/**
	 * @param {ExportedKeyPair} keyPair
	 * @param {?string} password
	 * @returns {Promise<KyberKeyPair>}
	 */
	static async importKyberKeyPair(keyPair, password = null) {
		const keys = {};
		for (const k of ["publicKey", "privateKey"]) {
			const key = keyPair[k];
			if (password == null) {
				keys[k] = importCryptoString(key);
			} else {
				const decrypted = await ChatCrypto.decryptAESStringWithPassword(
					key,
					password
				);
				keys[k] = importCryptoString(decrypted);
			}
		}
		return keys;
	}

	/**
	 * @param {string} key
	 * @returns {Uint8Array}
	 */
	static importKyberPublicKey(key) {
		return importCryptoString(key);
	}

	/**
	 * @param {String} key
	 * @returns {Promise<CryptoKey>}
	 */
	static async importAESKey(key) {
		const imported = await window.crypto.subtle.importKey(
			"jwk",
			JSON.parse(atob(key)),
			{
				name: "AES-GCM"
			},
			true,
			["encrypt", "decrypt"]
		);
		return imported;
	}

	/**
	 * @param {ArrayBuffer} key
	 */
	static async importRawAESKey(key) {
		const imported = await window.crypto.subtle.importKey(
			"raw",
			key,
			{
				name: "AES-GCM"
			},
			true,
			["encrypt", "decrypt"]
		);
		return imported;
	}

	/**
	 * @param {Uint8Array} publicKey
	 * @returns {Promise<{cipherText: string, symmetricKey: CryptoKey}>}
	 */
	static async deriveCipherKyber(publicKey) {
		const kyberInstance = new kyber.Kyber1024();
		/* cspell: disable-next-line */
		const c_ss = await kyberInstance.encap(publicKey);
		const exportedCipherText = exportCryptoArray(c_ss[0]);
		const importedKey = await ChatCrypto.importRawAESKey(c_ss[1].buffer);
		return { cipherText: exportedCipherText, symmetricKey: importedKey };
	}

	/**
	 * @param {string} cipherText
	 * @param {Uint8Array} privateKey
	 * @returns {Promise<CryptoKey>}
	 */
	static async deriveKeyKyber(cipherText, privateKey) {
		const kyberInstance = new kyber.Kyber1024();
		const cipherArr = importCryptoString(cipherText);
		/* cspell: disable-next-line */
		const ss = await kyberInstance.decap(cipherArr, privateKey);
		const importedKey = await ChatCrypto.importRawAESKey(ss.buffer);
		return importedKey;
	}

	/**
	 * @param {CryptoKey} key
	 * @param {Uint8Array} data
	 * @returns {Promise<String>}
	 */
	static async encryptAES(key, data) {
		const iv = window.crypto.getRandomValues(new Uint8Array(16));

		const ivStr = Array.from(iv)
			.map((b) => String.fromCharCode(b))
			.join("");

		const encryptedData = await window.crypto.subtle.encrypt(
			{ name: "AES-GCM", iv: iv },
			key,
			data
		);

		const uintArray = Array.from(new Uint8Array(encryptedData));

		const ctStr = uintArray.map((byte) => String.fromCharCode(byte)).join("");
		return btoa(`${btoa(ivStr)}:${btoa(ctStr)}`);
	}

	/**
	 * @param {CryptoKey} key
	 * @param {String} data
	 * @returns {Promise<String>}
	 */
	static async encryptAESString(key, data) {
		return ChatCrypto.encryptAES(key, new TextEncoder().encode(data));
	}

	/**
	 * @param {CryptoKey} key
	 * @param {String} data
	 * @returns {Promise<ArrayBuffer>}
	 */
	static async decryptAES(key, data) {
		const splitData = atob(data).split(":");
		const ivStr = atob(splitData[0]);
		const iv = new Uint8Array(Array.from(ivStr).map((ch) => ch.charCodeAt(0)));

		const string = atob(splitData[1]);
		const uintArray = new Uint8Array(
			[...string].map((char) => char.charCodeAt(0))
		);

		const algorithm = {
			name: "AES-GCM",
			iv: iv
		};

		const decryptedData = await window.crypto.subtle.decrypt(
			algorithm,
			key,
			uintArray
		);

		return decryptedData;
	}

	/**
	 * @param {CryptoKey} key
	 * @param {String} data
	 * @returns {Promise<String>}
	 */
	static async decryptAESString(key, data) {
		const decryptedData = await ChatCrypto.decryptAES(key, data);
		return new TextDecoder().decode(decryptedData);
	}

	/**
	 * @param {string} password
	 * @param {Uint8Array} salt
	 * @returns {Promise<CryptoKey>}
	 */
	static async deriveEncryptionKey(password, salt) {
		const imported = await window.crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(password).buffer,
			{
				name: "PBKDF2"
			},
			false,
			["deriveKey"]
		);
		return window.crypto.subtle.deriveKey(
			{
				name: "PBKDF2",
				salt: salt,
				iterations: 1000000,
				hash: {
					name: "SHA-512"
				}
			},
			imported,
			{
				name: "AES-GCM",
				length: 256
			},
			false,
			["encrypt", "decrypt", "wrapKey", "unwrapKey"]
		);
	}

	/**
	 * @param {string} string
	 * @param {string} password
	 * @returns {Promise<string>}
	 */
	static async encryptAESStringWithPassword(string, password) {
		const salt = window.crypto.getRandomValues(new Uint8Array(32));
		const encryptionKey = await ChatCrypto.deriveEncryptionKey(password, salt);
		const encrypted = await ChatCrypto.encryptAESString(encryptionKey, string);
		const saltStr = Array.from(salt)
			.map((b) => String.fromCharCode(b))
			.join("");
		return btoa(`${btoa(saltStr)}:${encrypted}`);
	}

	/**
	 * @param {string} data
	 * @param {string} password
	 * @returns
	 */
	static async decryptAESStringWithPassword(data, password) {
		const splitData = atob(data).split(":");
		const salt = new Uint8Array(
			Array.from(atob(splitData[0])).map((ch) => ch.charCodeAt(0))
		);
		const encryptionKey = await ChatCrypto.deriveEncryptionKey(password, salt);
		return await ChatCrypto.decryptAESString(encryptionKey, splitData[1]);
	}

	/**
	 * @param {string} data
	 * @returns {Promise<string>}
	 */
	static async hashSHA256String(data) {
		const encoded = new TextEncoder().encode(data);
		const hashBuffer = await window.crypto.subtle.digest("SHA-256", encoded);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		const hashHex = hashArray
			.map((b) => b.toString(16).padStart(2, "0"))
			.join(""); // convert bytes to hex string
		return hashHex;
	}
}
