import { describe, expect, it } from "vitest";

import { approvalId, approvalLabel, nextApprovalCount } from "../src/lib/approvals";

describe("approvals", () => {
	it("counts pending approvals and never goes negative", () => {
		expect(nextApprovalCount(0, { type: "request" })).toBe(1);
		expect(nextApprovalCount(2, { type: "request" })).toBe(3);
		expect(nextApprovalCount(2, { type: "resolve" })).toBe(1);
		expect(nextApprovalCount(0, { type: "resolve" })).toBe(0);
	});

	it("labels an approval with its command", () => {
		expect(approvalLabel({ presentation: { commandText: "git push origin main" } })).toBe("git push origin main");
		expect(approvalLabel({ commandText: "ls -la" })).toBe("ls -la");
		expect(approvalLabel({ presentation: {} })).toBe("approval");
		expect(approvalLabel(null)).toBe("approval");
	});

	it("keeps the label short", () => {
		const long = "a".repeat(60);

		expect(approvalLabel({ presentation: { commandText: long } }).length).toBeLessThanOrEqual(20);
	});

	it("reads the approval id when present", () => {
		expect(approvalId({ id: "approval-1" })).toBe("approval-1");
		expect(approvalId({ id: "" })).toBeNull();
		expect(approvalId({})).toBeNull();
	});
});
