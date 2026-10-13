import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";

import type { StoredIdentity } from "./config";

/** Fixed DER prefix of an Ed25519 SPKI public key; the raw key follows it. */
export const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** Fixed DER prefix of an Ed25519 PKCS#8 private key; the raw key follows it. */
export const ED25519_PKCS8_PRIVATE_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

const RAW_KEY_LENGTH = 32;

/** The 32 raw bytes of an Ed25519 public key held in `publicKeyPem`. */
export function publicKeyRawFromPem(publicKeyPem: string): Buffer {
	const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" }) as Buffer;
	if (
		der.length !== ED25519_SPKI_PREFIX.length + RAW_KEY_LENGTH ||
		!der.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
	) {
		throw new Error("public key has a non-canonical Ed25519 encoding");
	}

	return der.subarray(ED25519_SPKI_PREFIX.length);
}

/** Base64url of the raw public key, as the Gateway's device-auth wire shape expects. */
export function publicKeyRawBase64UrlFromPem(publicKeyPem: string): string {
	return publicKeyRawFromPem(publicKeyPem).toString("base64url");
}

/** Device id: hex sha256 of the raw public key bytes. */
export function deviceIdFromPublicKeyRaw(rawBase64Url: string): string {
	return createHash("sha256").update(Buffer.from(rawBase64Url, "base64url")).digest("hex");
}

export function createStoredIdentity(): StoredIdentity {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");

	const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
	const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

	return {
		deviceId: deviceIdFromPublicKeyRaw(publicKeyRawBase64UrlFromPem(publicKeyPem)),
		privateKeyPem,
		publicKeyPem,
	};
}

/** Signs a challenge payload; base64url of an Ed25519 signature over its UTF-8 bytes. */
export function signDevicePayload(privateKeyPem: string, payload: string): string {
	return sign(null, Buffer.from(payload, "utf8"), createPrivateKey(privateKeyPem)).toString("base64url");
}

/** Returns the stored identity when it is usable, otherwise generates a fresh one. */
export function loadOrCreateIdentity(stored: StoredIdentity | null): StoredIdentity {
	if (stored && isUsable(stored)) {
		return stored;
	}

	return createStoredIdentity();
}

function isUsable(identity: StoredIdentity): boolean {
	try {
		const derived = deviceIdFromPublicKeyRaw(publicKeyRawBase64UrlFromPem(identity.publicKeyPem));
		const key = createPrivateKey(identity.privateKeyPem);
		return derived === identity.deviceId && key.asymmetricKeyType === "ed25519";
	} catch {
		return false;
	}
}
