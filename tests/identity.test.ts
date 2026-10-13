import { createHash, createPublicKey, verify } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
	createStoredIdentity,
	deviceIdFromPublicKeyRaw,
	publicKeyRawBase64UrlFromPem,
	signDevicePayload,
} from "../src/gateway/identity";

describe("identity", () => {
	it("derives a stable 64-char hex deviceId", () => {
		const identity = createStoredIdentity();

		expect(identity.deviceId).toMatch(/^[0-9a-f]{64}$/);
	});

	it("raw public key strips the SPKI prefix and is 32 bytes", () => {
		const identity = createStoredIdentity();

		const raw = publicKeyRawBase64UrlFromPem(identity.publicKeyPem);

		expect(Buffer.from(raw, "base64url").length).toBe(32);
	});

	it("deviceId equals sha256 hex of the raw public key", () => {
		const identity = createStoredIdentity();

		const raw = publicKeyRawBase64UrlFromPem(identity.publicKeyPem);

		expect(identity.deviceId).toBe(
			createHash("sha256").update(Buffer.from(raw, "base64url")).digest("hex"),
		);
	});

	it("deviceId derived from the raw key matches the identity's deviceId", () => {
		const identity = createStoredIdentity();

		const raw = publicKeyRawBase64UrlFromPem(identity.publicKeyPem);

		expect(deviceIdFromPublicKeyRaw(raw)).toBe(identity.deviceId);
	});

	it("signatures verify against the public key", () => {
		const identity = createStoredIdentity();

		const signature = signDevicePayload(identity.privateKeyPem, "hello-payload");

		const ok = verify(
			null,
			Buffer.from("hello-payload", "utf8"),
			createPublicKey(identity.publicKeyPem),
			Buffer.from(signature, "base64url"),
		);
		expect(ok).toBe(true);
	});
});
