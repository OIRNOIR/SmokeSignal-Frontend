import ChatCrypto from "../global/crypto.js";
import { Connection } from "../global/websocket.js";

/* cspell: disable-next-line */
let apiHostname = "API_HOSTNAME";

const switchAPIServer = (newServerHostname) => {
	apiHostname = newServerHostname;
	localStorage.setItem("apiHostname", apiHostname);
	console.log(`Server switched to ${apiHostname}`);
};

/**
 * @type {Connection}
 */
let connection = null;

/**
 * @type {Identity}
 */
let identity = null;

/**
 * @type {?string}
 */
let activeConversationId = null;

let currentlyReloading = false;

let reloadFailed = false;

/**
 * @typedef KyberKeyPair
 * @property {Uint8Array} publicKey
 * @property {Uint8Array} privateKey
 */

class Profile {
	constructor(data) {
		/**
		 * @type {string}
		 */
		this.id = data.id;
		/**
		 * @type {string}
		 */
		this.username = data.username;
		/**
		 * @type {string}
		 */
		this.publicKeyExported = data.publicKeyExported;
	}

	get publicKey() {
		return ChatCrypto.importKyberPublicKey(this.publicKeyExported);
	}

	/**
	 * @param {Profile} profile
	 */
	equals(profile) {
		for (const key of Object.keys(this)) {
			if (profile[key] != this[key]) return false;
		}
		return true;
	}
}

class Conversation {
	constructor(data) {
		/**
		 * @type {string}
		 */
		this.id = data.id;
		/**
		 * @type {string}
		 */
		this.eVerify = data.eVerify;
		/**
		 * @type {?string}
		 */
		this.verify = data.verify;
		/**
		 * @type {string}
		 */
		this.eKeyStore = data.eKeyStore;
		/**
		 * @type {?CryptoKey}
		 */
		this.key = data.key;
		/**
		 * @type {string}
		 */
		this.eUserIDs = data.eUserIDs;
		/**
		 * @type {string[]}
		 */
		this.userIDs = data.userIDs;
		/**
		 * @type {?string}
		 */
		this.eLastViewed = data.eLastViewed;
		/**
		 * @type {?string}
		 */
		this.lastViewed = data.lastViewed;
		/**
		 * @type {boolean}
		 */
		this.complete = false;
	}

	get lastMessage() {
		const filtered = identity.filterMessageStore(
			(m) => m.conversationId == this.id && m.type == "message"
		);
		if (filtered.length == 0) return null;
		return filtered.sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0];
	}

	get firstCachedMessage() {
		const filtered = identity.filterMessageStore(
			(m) => m.conversationId == this.id && m.type == "message"
		);
		if (filtered.length == 0) return null;
		return filtered.sort((a, b) => a.createdTimestamp - b.createdTimestamp)[0];
	}

	render() {
		const conversationsContainer = document.getElementById("conversations");
		for (const oldE of Array.from(conversationsContainer.children).filter(
			(c) => c.getAttribute("data-conversation-id") == this.id
		)) {
			oldE.remove();
		}
		let next = null;
		if (this.lastMessage != null) {
			for (let i = 0; i < conversationsContainer.children.length; i++) {
				const node = conversationsContainer.children[i];
				const conversationId = node.getAttribute("data-conversation-id");
				const conversation = identity.conversations.find(
					(c) => c.id == conversationId
				);
				if (
					conversation?.lastMessage == null ||
					conversation.lastMessage?.createdTimestamp <
						this.lastMessage?.createdTimestamp
				) {
					next = conversationsContainer.children[i];
					break;
				}
			}
		}
		const conversationLi = document.createElement("li");
		conversationLi.classList.add("clickable");
		conversationLi.setAttribute("id", `conversation-${this.id}`);
		conversationLi.setAttribute("data-conversation-id", this.id);
		if (activeConversationId == this.id) conversationLi.classList.add("active");
		conversationLi.addEventListener("click", () => {
			switchConversation(this.id);
		});
		const conversationSpan = document.createElement("span");
		conversationSpan.classList.add("li-text-content");
		conversationSpan.innerText = this.userIDs
			.filter((u) => u != identity.userId)
			.map((uid) => identity.findProfileStore((p) => p.id == uid)?.username ?? uid)
			.join(", ");
		conversationLi.appendChild(conversationSpan);
		if (
			activeConversationId != this.id &&
			this.lastMessage != null &&
			this.lastViewed != this.lastMessage &&
			(this.lastViewed == null ||
				BigInt(this.lastViewed) < BigInt(this.lastMessage.id))
		) {
			const unreadIndicatorSpan = document.createElement("span");
			unreadIndicatorSpan.classList.add("conversation-unread-indicator");
			conversationLi.appendChild(unreadIndicatorSpan);
		}
		if (next == null) {
			conversationsContainer.appendChild(conversationLi);
		} else {
			next.before(conversationLi);
		}
	}
}

function pushConversationList() {
	if (currentlyReloading) {
		if (reloadFailed) return;
		setTimeout(() => {
			pushConversationList();
		}, 1000);
		return;
	}
	return fetch(`https://${apiHostname}/users/@me`, {
		method: "PATCH",
		headers: {
			authorization: `Token ${connection.sessionToken}`,
			"content-type": "application/json"
		},
		body: JSON.stringify({
			conversations: identity.conversations.map((c) => {
				return {
					id: c.id,
					eVerify: c.eVerify,
					eUserIDs: c.eUserIDs,
					eKeyStore: c.eKeyStore,
					eLastViewed: c.eLastViewed
				};
			})
		})
	});
}

function switchConversation(conversationId) {
	const oldConversationId = activeConversationId;
	activeConversationId = conversationId;
	document
		.getElementById("message-composition-container")
		.classList.remove("hidden");
	const conversationsContainer = document.getElementById("conversations");
	for (const child of conversationsContainer.children) {
		child.classList.remove("active");
	}
	if (activeConversationId == null) {
		document.getElementById("recipient-input").classList.remove("hidden");
	} else {
		document.getElementById("recipient-input").classList.add("hidden");
	}
	const messagesContainer = document.getElementById("messages");
	for (const el of Array.from(messagesContainer.children).filter(
		(c) => c.id != "messages-anchor" && c.id != "messages-load-more-anchor"
	)) {
		el.remove();
	}
	if (activeConversationId != null) {
		for (const message of identity.filterMessageStore(
			(m) => m.conversationId == activeConversationId && m.type == "message"
		)) {
			message.render();
		}
		document.getElementById("messages").scrollTop =
			document.getElementById("messages").scrollHeight;
		const conversation = identity.conversations.find(
			(c) => c.id == activeConversationId
		);
		if (
			conversation.lastMessage != null &&
			conversation.lastViewed != conversation.lastMessage?.id
		) {
			if (
				conversation.lastViewed != null &&
				oldConversationId != activeConversationId
			) {
				let lastViewedMessage = document.getElementById(
					`message-${conversation.lastViewed}`
				);
				if (!lastViewedMessage) {
					const candidates = identity
						.filterMessageStore((m) => BigInt(m.id) < conversation.lastViewed)
						.sort((a, b) => b.createdTimestamp - a.createdTimestamp);
					if (candidates.length != 0) {
						lastViewedMessage = document.getElementById(
							`message-${candidates[0].id}`
						);
					}
				}
				if (lastViewedMessage) {
					const inlineUnreadIndicator = document.createElement("span");
					inlineUnreadIndicator.classList.add("inline-unread-indicator");
					const inlineUnreadIndicatorBubble = document.createElement("span");
					inlineUnreadIndicatorBubble.innerText = "NEW";
					inlineUnreadIndicatorBubble.classList.add(
						"inline-unread-indicator-bubble"
					);
					inlineUnreadIndicator.appendChild(inlineUnreadIndicatorBubble);
					lastViewedMessage.after(inlineUnreadIndicator);
				}
			}
			conversation.lastViewed = conversation.lastMessage.id;
			ChatCrypto.encryptAESString(identity.aes, conversation.lastViewed).then(
				async (eLastViewed) => {
					conversation.eLastViewed = eLastViewed;
					await pushConversationList();
				}
			);
		}
	}
}

function generateNonce() {
	return `${Date.now()}-${window.crypto.randomUUID()}`;
}

class Identity {
	constructor(UID) {
		/**
		 * @type {string}
		 */
		this.userId = UID;
		/**
		 * @type {string}
		 */
		this.username = null;
		/**
		 * @type {KyberKeyPair}
		 */
		this.kyber = null;
		/**
		 * @type {CryptoKey}
		 */
		this.aes = null;
		/**
		 * @type {Conversation[]}
		 */
		this.conversations = [];
		/**
		 * @type {Map<string, Message>}
		 */
		this.messageStore = new Map();
		/**
		 * @type {Map<string, Profile>}
		 */
		this.profileStore = new Map();
	}

	getMessageById(id) {
		return this.findMessageStore((m) => m.id == id);
	}

	/**
	 * @param {(value: Message, index: number, obj: Message[]) => value is Message} findFunction
	 */
	findMessageStore(findFunction) {
		return Array.from(this.messageStore.values()).find(findFunction);
	}

	/**
	 * @param {(value: Message, index: number, array: Message[]) => value is Message} filterFunction
	 */
	filterMessageStore(filterFunction) {
		return Array.from(this.messageStore.values()).filter(filterFunction);
	}

	/**
	 * @param {(value: Profile, index: number, obj: Profile[]) => value is Profile} findFunction
	 */
	findProfileStore(findFunction) {
		return Array.from(this.profileStore.values()).find(findFunction);
	}

	/**
	 * @param {(value: Profile, index: number, array: Profile[]) => value is Profile} filterFunction
	 */
	filterProfileStore(filterFunction) {
		return Array.from(this.profileStore.values()).filter(filterFunction);
	}
}

class Message {
	constructor(data) {
		/**
		 * @type {string}
		 */
		this.id = data.id;
		/**
		 * @type {string}
		 */
		this.createdTimestamp = data.createdTimestamp;
		/**
		 * @type {?string}
		 */
		this.editedTimestamp = data.editedTimestamp;
		/**
		 * @type {string}
		 */
		this.recipientId = data.recipientId;
		/**
		 * @type {string}
		 */
		this.senderId = data.senderId;
		/**
		 * @type {?string}
		 */
		this.conversationId = data.conversationId;
		/**
		 * @type {string}
		 */
		this.eContent = data.eContent;
		/**
		 * @type {?string}
		 */
		this.nonce = data.nonce;
		/**
		 * @type {string}
		 */
		this.type = data.type;

		switch (this.type) {
			case "message": {
				Object.defineProperties(this, {
					attachments: {
						configurable: false,
						writable: true,
						enumerable: false,
						value: null
					},
					content: {
						configurable: false,
						writable: true,
						enumerable: false,
						value: null
					}
				});
				break;
			}
		}
	}

	render() {
		if (this.type != "message")
			throw new Error(`Message of type ${this.type} attempted render`);
		const conversation = identity.conversations.find(
			(c) => c.id == this.conversationId
		);
		conversation.render();
		if (this.conversationId != activeConversationId) return;
		const messagesContainer = document.getElementById("messages");
		// First find if the message box is already completely scrolled
		const fullyScrolled =
			messagesContainer.scrollTop + messagesContainer.clientHeight >=
			messagesContainer.scrollHeight;
		for (const oldE of Array.from(messagesContainer.children).filter(
			(c) => c.getAttribute("data-message-id") == this.id
		)) {
			oldE.remove();
		}
		let next = null;
		for (let i = 0; i < messagesContainer.children.length; i++) {
			const node = messagesContainer.children[i];
			if (node.id == "messages-load-more-anchor") continue;
			if (node.id == "messages-anchor") {
				next = node;
				break;
			}
			if (!node.classList.contains("message")) continue;
			const messageId = node.getAttribute("data-message-id");
			const message = identity.messageStore.get(messageId);
			if (!message) console.log(node);
			if (message.createdTimestamp > this.createdTimestamp) {
				next = node;
				break;
			}
		}
		const messageDiv = document.createElement("div");
		messageDiv.setAttribute("id", `message-${this.id}`);
		messageDiv.setAttribute("data-message-id", this.id);
		messageDiv.classList.add("message");
		messageDiv.innerText = `${
			this.senderId == identity.userId
				? identity.username
				: (identity.findProfileStore((p) => p.id == this.senderId)?.username ??
					this.senderId)
		}: ${this.content}`;
		if (next == null) next = document.getElementById("messages-anchor");
		next.before(messageDiv);
		if (fullyScrolled)
			document.getElementById("messages").scrollTop =
				document.getElementById("messages").scrollHeight; // Correct the scroll
	}
}

async function getIdentity() {
	let res;
	try {
		res = await fetch(`https://${apiHostname}/login/identity`, {
			headers: { authorization: `Token ${connection.sessionToken}` }
		});
	} catch (err) {
		console.error(err);
		alert("Error contacting the server");
	}
	if (!res.ok) {
		if (res.status == 401) {
			alert("The server rejected your authentication.");
			return window.location.replace("/logout");
		}
		alert("Error contacting the server");
		throw new Error(res.statusText);
	}
	const json = await res.json();
	const usernameEncrypted = json.usernameEncrypted;
	return {
		identity: new Identity(json.userId),
		usernameEncrypted,
		conversations: json.conversations,
		eProfileStore: json.eProfileStore
	};
}

/**
 * @param {Message} message
 * @param {boolean} isNew
 * @param {number} attempts
 */
async function handleMessage(message, isNew = true, attempts = 0) {
	identity.messageStore.set(message.id, message);
	switch (message.type) {
		case "conversationInvitation": {
			const parsedContent = JSON.parse(atob(message.eContent));
			const sharedKyberKey = await ChatCrypto.deriveKeyKyber(
				parsedContent.cipherText,
				identity.kyber.privateKey
			);
			const innerContent = JSON.parse(
				await ChatCrypto.decryptAESString(sharedKyberKey, parsedContent.content)
			);
			if (identity.conversations.find((c) => c.id == innerContent.id) != null) {
				console.log(
					`Invitation for conversation ${innerContent.id} ignored because we are already in that conversation`
				);
				break;
			}
			const conversationKey = await ChatCrypto.importAESKey(innerContent.key);
			const conversation = new Conversation({
				id: innerContent.id,
				verify: innerContent.verify,
				eVerify: await ChatCrypto.encryptAESString(
					identity.aes,
					innerContent.verify
				),
				key: conversationKey,
				eKeyStore: await ChatCrypto.wrapAESKey(identity.aes, conversationKey),
				userIDs: innerContent.userIDs,
				eUserIDs: await ChatCrypto.encryptAESString(
					identity.aes,
					JSON.stringify(innerContent.userIDs)
				),
				lastViewed: null,
				eLastViewed: null
			});
			identity.conversations.push(conversation);
			//TODO: In the future, obtain consent from the user before joining the conversation.
			const res3 = await pushConversationList();
			if (!res3.ok) throw new Error("Error updating account");
			const profileInformationMessage = {
				type: "profile",
				recipientId: message.senderId,
				conversationId: conversation.id,
				eContent: await ChatCrypto.encryptAESString(
					conversation.key,
					JSON.stringify({
						username: identity.username
						//TODO: More info here when/if profiles expand
					})
				),
				nonce: generateNonce()
			};
			const res4 = await fetch(`https://${apiHostname}/messages`, {
				method: "POST",
				headers: {
					authorization: `Token ${connection.sessionToken}`,
					"content-type": "application/json",
					"X-Conversation-Verify": conversation.verify
				},
				body: JSON.stringify(profileInformationMessage)
			});
			if (!res4.ok) throw new Error("Error sending profile information");
			//TODO: Fetch the messages in the conversation (Group chats)
			break;
		}
		case "message": {
			const conversation = identity.conversations.find(
				(c) => c.id == message.conversationId
			);
			if (!conversation) {
				console.log("No conversation found for message", message);
				if (attempts >= 5) {
					console.log("Out of retries");
				} else {
					console.log("Trying again in 500ms");
					setTimeout(() => handleMessage(message, isNew, attempts + 1));
				}
				return;
			}
			const content = JSON.parse(
				await ChatCrypto.decryptAESString(conversation.key, message.eContent)
			);
			message.content = content.content;
			message.attachments = content.attachments;
			message.render();
			if (
				activeConversationId == conversation.id &&
				isNew &&
				conversation.lastViewed != conversation.lastMessage.id
			) {
				conversation.lastViewed = conversation.lastMessage.id;
				conversation.eLastViewed = await ChatCrypto.encryptAESString(
					identity.aes,
					conversation.lastViewed
				);
				await pushConversationList();
			}
			break;
		}
		case "profile": {
			const conversation = identity.conversations.find(
				(c) => c.id == message.conversationId
			);
			if (!conversation) {
				console.log("No conversation found for profile info", message);
				if (attempts >= 5) {
					console.log("Out of retries");
				} else {
					console.log("Trying again in 500ms");
					setTimeout(() => handleMessage(message, isNew, attempts + 1));
				}
				return;
			}
			const profileInfo = JSON.parse(
				await ChatCrypto.decryptAESString(conversation.key, message.eContent)
			);
			let publicKey;
			if (identity.profileStore.has(message.senderId)) {
				publicKey = identity.profileStore.get(message.senderId).publicKeyExported;
			} else {
				const res = await fetch(
					`https://${apiHostname}/users/${message.senderId}`,
					{
						headers: { authorization: `Token ${connection.sessionToken}` }
					}
				);
				if (res.status == 404) {
					return alert("User not found");
				}
				const json = await res.json();
				publicKey = json.publicKey;
			}
			const newProfile = new Profile({
				id: message.senderId,
				publicKeyExported: publicKey,
				username: profileInfo.username
			});
			if (
				identity.profileStore.has(message.senderId) &&
				identity.profileStore.get(message.senderId).equals(newProfile)
			)
				break;
			identity.profileStore.set(message.senderId, newProfile);
			const res2 = await fetch(`https://${apiHostname}/users/@me`, {
				method: "PATCH",
				headers: {
					authorization: `Token ${connection.sessionToken}`,
					"content-type": "application/json"
				},
				body: JSON.stringify({
					eProfileStore: await ChatCrypto.encryptAESString(
						identity.aes,
						JSON.stringify(Array.from(identity.profileStore.values()))
					)
				})
			});
			if (!res2.ok) throw new Error("Error updating account");
			break;
		}
	}
}

async function scrollUpdate() {
	if (activeConversationId == null) return;
	const container = document.getElementById("messages");
	const loadMoreAnchor = document.getElementById("messages-load-more-anchor");
	const loadMoreAnchorVisible =
		container.scrollTop <= loadMoreAnchor.getBoundingClientRect().height;
	const conversation = identity.conversations.find(
		(c) => c.id == activeConversationId
	);
	if (loadMoreAnchorVisible && !conversation.complete) {
		console.log("Loading more messages...");
		/**
		 * @type {HTMLDivElement}
		 */
		const earliestLoadedMessage =
			Array.from(container.children).find((c) =>
				c.classList.contains("message")
			)[0] ?? document.getElementById("messages-anchor");
		const params = new URLSearchParams();
		params.set("conversation", conversation.id);
		params.set("limit", 50);
		if (conversation.firstCachedMessage != null)
			params.set("before", conversation.firstCachedMessage.id);
		const res = await fetch(
			`https://${apiHostname}/messages?${params.toString()}`,
			{
				method: "GET",
				headers: {
					authorization: `Token ${connection.sessionToken}`,
					"content-type": "application/json",
					"X-Conversation-Verify": conversation.verify
				}
			}
		);
		const json = await res.json();
		if (json.length < 50) conversation.complete = true;
		const heightDifferential =
			earliestLoadedMessage.offsetTop - container.offsetTop;
		for (const message of json.filter((m) => m.type != "profile")) {
			await handleMessage(new Message(message), false);
		}
		container.scroll(
			0,
			earliestLoadedMessage.offsetTop - container.offsetTop - heightDifferential
		);
		console.log("Messages loaded!");
	}
}

document.addEventListener("DOMContentLoaded", async () => {
	window.switchAPIServer = switchAPIServer;

	if (localStorage.getItem("apiHostname") != null) {
		switchAPIServer(localStorage.getItem("apiHostname"));
	}

	if (
		!localStorage.getItem("privateKey") ||
		!localStorage.getItem("publicKey")
	) {
		window.location.href = "/login";
	}

	connection = new Connection(apiHostname);
	/**
	 * @param {CloseEvent} e
	 */
	const onClose = (e) => {
		reloadFailed = true;
		document.getElementById("slide-loading").classList.add("hidden");
		document.getElementById("logged-in-container").classList.add("hidden");
		document.getElementById("mini-loader-container").classList.add("hidden");
		setTimeout(() => {
			if (e.detail.code == 1006)
				return alert(
					"Unable to connect with the Gateway. This may be a problem with your internet connection, or the server may be down. This is a fatal error. Please refresh the page to try again."
				);
			alert(
				`Fatal: Gateway connection closed with code ${e.detail.code}. Please refresh the page to continue. If this happens multiple times, please report this issue.`
			);
		}, 200);
	};
	connection.addEventListener("close", onClose);
	const onOpen = async () => {
		connection.removeEventListener("open", onOpen);
		/**
		 * @type {KyberKeyPair}
		 */
		let kyber;
		/**
		 * @type {CryptoKey}
		 */
		let aes;
		try {
			kyber = await ChatCrypto.importKyberKeyPair({
				privateKey: localStorage.getItem("privateKey"),
				publicKey: localStorage.getItem("publicKey")
			});
			aes = await ChatCrypto.importAESKey(localStorage.getItem("accountAES"));
		} catch (err) {
			console.error(err);
			alert("Key decryption error.");
			return window.location.replace("/logout");
		}
		await connection.doAuthenticationFlow(kyber);

		const {
			identity: id,
			usernameEncrypted,
			conversations,
			eProfileStore
		} = await getIdentity();
		identity = id;
		identity.username = await ChatCrypto.decryptAESString(aes, usernameEncrypted);
		if (eProfileStore != null) {
			const profilesStr = await ChatCrypto.decryptAESString(aes, eProfileStore);
			identity.profileStore = JSON.parse(profilesStr).reduce(
				(prev, curr) => prev.set(curr.id, new Profile(curr)),
				new Map()
			);
		}
		identity.aes = aes;
		identity.kyber = kyber;
		for (const conversation of conversations) {
			try {
				conversation.verify = await ChatCrypto.decryptAESString(
					aes,
					conversation.eVerify
				);
				conversation.key = await ChatCrypto.unwrapAESKey(
					aes,
					conversation.eKeyStore
				);
				const userIDsStr = await ChatCrypto.decryptAESString(
					aes,
					conversation.eUserIDs
				);
				conversation.userIDs = JSON.parse(userIDsStr);
				conversation.lastViewed =
					conversation.eLastViewed == null
						? null
						: await ChatCrypto.decryptAESString(aes, conversation.eLastViewed);
				const classed = new Conversation(conversation);
				classed.complete = false;
				identity.conversations.push(classed);
				classed.render();
			} catch (err) {
				console.error(`Error adding conversation ${conversation.id}`);
				console.error(err);
			}
		}
		const conversationInviteRes = await fetch(
			`https://${apiHostname}/messages?type=conversationInvitation&limit=50`,
			{
				method: "GET",
				headers: {
					authorization: `Token ${connection.sessionToken}`,
					"content-type": "application/json"
				}
			}
		);
		const conversationInviteJSON = await conversationInviteRes.json();
		for (const message of conversationInviteJSON) {
			// I wish there were a better way to handle this rn
			await handleMessage(new Message(message), false);
		}
		for (const conversation of identity.conversations) {
			const params = new URLSearchParams();
			params.set("conversation", conversation.id);
			params.set("limit", 50);
			const res = await fetch(
				`https://${apiHostname}/messages?${params.toString()}`,
				{
					method: "GET",
					headers: {
						authorization: `Token ${connection.sessionToken}`,
						"content-type": "application/json",
						"X-Conversation-Verify": conversation.verify
					}
				}
			);
			const json = await res.json();
			if (json.length < 50) conversation.complete = true;
			for (const message of json.filter((m) => m.type == "profile")) {
				await handleMessage(new Message(message), false);
			}
			for (const message of json.filter((m) => m.type != "profile")) {
				await handleMessage(new Message(message), false);
			}
		}
		document.getElementById("slide-loading").classList.add("hidden");
		document.getElementById("logged-in-container").classList.remove("hidden");
		console.log(identity);
		document.querySelector("#profile span.li-text-content").innerText =
			identity.username;
		document.getElementById("profile").addEventListener("click", () => {
			navigator.clipboard.writeText(identity.userId);
			alert("Copied user ID to clipboard!");
		});
		document.getElementById("new-conversation").addEventListener("click", () => {
			switchConversation(null);
		});
		document.getElementById("logout").addEventListener("click", () => {
			window.location.href = "/logout";
		});
		document.getElementById("messages").addEventListener("scroll", () => {
			console.log("Scroll Event");
			scrollUpdate();
		});
		connection.addEventListener("message", async (data) => {
			const str = data.detail.data;
			let json;
			try {
				json = JSON.parse(str);
			} catch {
				console.error("Connection sent invalid json");
				return connection.close(4001, "Invalid JSON");
			}
			switch (json.action) {
				case "messageCreate": {
					if (json.message == null) console.error("Server sent empty message!");
					handleMessage(new Message(json.message), true);
					break;
				}
			}
		});
		connection.addEventListener("disconnect", async () => {
			document.getElementById("mini-loader-container").classList.remove("hidden");
			currentlyReloading = true;
		});
		const messageInput = document.getElementById("message-input");
		messageInput.addEventListener("keydown", async (e) => {
			if (e.key == "Enter") {
				if (currentlyReloading) return;

				// Send this message! :D

				const recipientId =
					activeConversationId == null
						? document.getElementById("recipient-input").value
						: identity.conversations
								.find((c) => c.id == activeConversationId)
								?.userIDs?.find((u) => u != identity.userId); // XXX Incompatible with group chats
				if (recipientId == identity.userId)
					return alert("You cannot send messages to yourself!");

				// Get content
				const content = messageInput.value.trim();
				const attachments = [];

				if (content.length == 0) return;

				let recipientPublicKey;
				if (identity.profileStore.has(recipientId)) {
					recipientPublicKey = identity.profileStore.get(recipientId).publicKey;
				} else {
					const res = await fetch(`https://${apiHostname}/users/${recipientId}`, {
						headers: { authorization: `Token ${connection.sessionToken}` }
					});
					if (res.status == 404) {
						return alert("User not found");
					}
					const { publicKey: recipientPublicKeyExported } = await res.json();
					recipientPublicKey = ChatCrypto.importKyberPublicKey(
						recipientPublicKeyExported
					);
				}

				let conversation = identity.conversations.find(
					(c) => c.userIDs.length == 2 && c.userIDs.indexOf(recipientId) != -1 // XXX Incompatible with group chats
				);
				if (!conversation) {
					console.log("Creating new conversation");
					const res2 = await fetch(`https://${apiHostname}/conversations`, {
						method: "POST",
						headers: { authorization: `Token ${connection.sessionToken}` }
					});
					const { id: conversationId, verify } = await res2.json();
					const conversationKey = await ChatCrypto.generateAESKey();
					const userIDs = [identity.userId, recipientId];
					conversation = new Conversation({
						id: conversationId,
						verify,
						eVerify: await ChatCrypto.encryptAESString(identity.aes, verify),
						key: conversationKey,
						eKeyStore: await ChatCrypto.wrapAESKey(identity.aes, conversationKey),
						userIDs,
						eUserIDs: await ChatCrypto.encryptAESString(
							identity.aes,
							JSON.stringify(userIDs)
						),
						lastViewed: null,
						eLastViewed: null
					});
					identity.conversations.push(conversation);
					const res3 = await pushConversationList();
					if (!res3.ok) throw new Error("Error updating account");
					const { cipherText, symmetricKey: sharedKyberKey } =
						await ChatCrypto.deriveCipherKyber(recipientPublicKey);
					const conversationIntroductionMessage = {
						type: "conversationInvitation",
						recipientId,
						eContent: btoa(
							JSON.stringify({
								cipherText,
								content: await ChatCrypto.encryptAESString(
									sharedKyberKey,
									JSON.stringify({
										id: conversation.id,
										verify,
										key: await ChatCrypto.exportAESKey(conversationKey),
										userIDs
									})
								)
							})
						),
						nonce: generateNonce()
					};
					const res4 = await fetch(`https://${apiHostname}/messages`, {
						method: "POST",
						headers: {
							authorization: `Token ${connection.sessionToken}`,
							"content-type": "application/json"
						},
						body: JSON.stringify(conversationIntroductionMessage)
					});
					if (!res4.ok) throw new Error("Error sending conversation invitation");
					const profileInformationMessage = {
						type: "profile",
						recipientId,
						conversationId: conversation.id,
						eContent: await ChatCrypto.encryptAESString(
							conversation.key,
							JSON.stringify({
								username: identity.username
								//TODO: More info here when/if profiles expand
							})
						),
						nonce: generateNonce()
					};
					const res5 = await fetch(`https://${apiHostname}/messages`, {
						method: "POST",
						headers: {
							authorization: `Token ${connection.sessionToken}`,
							"content-type": "application/json",
							"X-Conversation-Verify": conversation.verify
						},
						body: JSON.stringify(profileInformationMessage)
					});
					if (!res5.ok) throw new Error("Error sending profile information");
				}

				switchConversation(conversation.id);

				const message = {
					type: "message",
					recipientId,
					conversationId: conversation.id,
					eContent: await ChatCrypto.encryptAESString(
						conversation.key,
						JSON.stringify({
							content,
							attachments
						})
					),
					nonce: generateNonce()
				};
				const messageSent = await fetch(`https://${apiHostname}/messages`, {
					method: "POST",
					headers: {
						authorization: `Token ${connection.sessionToken}`,
						"content-type": "application/json",
						"X-Conversation-Verify": conversation.verify
					},
					body: JSON.stringify(message)
				});
				if (!messageSent.ok) throw new Error("Error sending message");
				const sentMessage = await messageSent.json();
				const msg = new Message(sentMessage);
				msg.content = content;
				msg.attachments = attachments;
				identity.messageStore.set(msg.id, msg);
				msg.render();
				messageInput.value = "";
				document.getElementById("recipient-input").value = "";

				conversation.lastViewed = conversation.lastMessage.id;
				conversation.eLastViewed = await ChatCrypto.encryptAESString(
					identity.aes,
					conversation.lastViewed
				);
				await pushConversationList();
			}
		});
	};

	connection.addEventListener("open", onOpen);

	connection.addEventListener("reconnect", async (e) => {
		await connection.doAuthenticationFlow(identity.kyber); // Needs to re-do the auth flow each time it reconnects for a new token
		connection.send(JSON.stringify({ action: "identify" }));
		const disconnectedSince = e.detail.disconnectedSince;
		const conversationInviteRes = await fetch(
			`https://${apiHostname}/messages?type=conversationInvitation&limit=50&min_timestamp=${disconnectedSince}`,
			{
				method: "GET",
				headers: {
					authorization: `Token ${connection.sessionToken}`,
					"content-type": "application/json"
				}
			}
		);
		const conversationInviteJSON = await conversationInviteRes.json();
		for (const message of conversationInviteJSON) {
			// I wish there were a better way to handle this rn
			await handleMessage(new Message(message), true);
		}
		for (const conversation of identity.conversations) {
			const params = new URLSearchParams();
			params.set("conversation", conversation.id);
			params.set("limit", 50);
			params.set("min_timestamp", disconnectedSince);
			const res = await fetch(
				`https://${apiHostname}/messages?${params.toString()}`,
				{
					method: "GET",
					headers: {
						authorization: `Token ${connection.sessionToken}`,
						"content-type": "application/json",
						"X-Conversation-Verify": conversation.verify
					}
				}
			);
			const json = await res.json();
			for (const message of json.filter((m) => m.type == "profile")) {
				await handleMessage(new Message(message), true);
			}
			for (const message of json.filter((m) => m.type != "profile")) {
				await handleMessage(new Message(message), true);
			}
		}

		document.getElementById("mini-loader-container").classList.add("hidden");
		currentlyReloading = false;
	});

	window.addEventListener("beforeunload", () => {
		connection.removeEventListener("close", onClose);
		connection.removeCloseListener();
	});
});
