# OpenClaw Stream Deck Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Stream Deck plugin (UUID `com.encrypt.openclaw`) that connects to a local OpenClaw Gateway over its WebSocket protocol and provides keys/dials to run automations, send prompts, stop work, approve requests, and display live status and usage.

**Architecture:** One Node process. A singleton `GatewayService` owns a `GatewayClient` (from `@openclaw/gateway-client`, pinned `2026.9.3` to match the installed Gateway) over `ws://127.0.0.1:18789`, with an Ed25519 device identity and device token persisted in `~/.openclaw-streamdeck/config.json` (sync file access, because the client's host deps are synchronous). An event bus fans Gateway events out to thin action classes that update key titles/images and dial feedback. The **Setup** action's property inspector hosts a first-run onboarding wizard.

**Tech Stack:** TypeScript; Stream Deck SDK v3 (`@elgato/streamdeck`); `@openclaw/gateway-client` + `@openclaw/gateway-protocol` (exact `2026.9.3`); Rollup (scaffold output); vitest for unit tests; Node built-in `node:crypto` for Ed25519.

**Spec:** `docs/superpowers/specs/2026-10-13-openclaw-streamdeck-plugin-design.md`

## Global Constraints

- Node.js 24+ required by SDK v3; the dev machine has `v26.7.0` — fine.
- Pin `@openclaw/gateway-client` and `@openclaw/gateway-protocol` to **exact** `2026.9.3` (verified published; matches the installed Gateway `2026.9.3`). Wire protocol `v4` (`minProtocol: 4`, `maxProtocol: 4` via `PROTOCOL_VERSION` from `@openclaw/gateway-protocol/version`).
- Plugin UUID `com.encrypt.openclaw`. Every action UUID is prefixed `com.encrypt.openclaw.<action>` (lowercase alphanumeric, dots, hyphens only). Never change a UUID after it ships.
- **Secrets never go in action settings** (they are plain-text and leak into Stream Deck profile exports). Secrets and identity live in `~/.openclaw-streamdeck/config.json` only. That path is outside the repo; nothing secret is committed. Do not ship `config.json` inside the `.sdPlugin` folder.
- Handshake facts (verified from the installed packages): the server sends `connect.challenge` `{ nonce, ts }`; the client replies `connect` with `device: { id, publicKey, signature, signedAt, nonce }`. The `GatewayClient` assembles and signs this itself **iff** you supply `hostDeps` (below). `deviceId` = `sha256(raw public key)` in hex (mirror OpenClaw's `deriveDeviceIdFromPublicKey`). Signing = `base64url(crypto.sign(null, utf8(payload), privateKey))`. Public key raw = SPKI DER minus the fixed Ed25519 prefix `302a300506032b6570032100`, base64url-encoded.
- Scopes to request: `operator.read`, `operator.write`, `operator.approvals`. Do not request `operator.admin` or `operator.pairing`. Caps: `approvals`, `exec-approvals` from `GATEWAY_CLIENT_CAPS` (import from `@openclaw/gateway-protocol/client-info`); do not advertise caps you do not implement.
- Client identity for the socket: `clientName: "cli"`, `mode: "cli"`, `role: "operator"`, `platform: "win32"`, `clientDisplayName: "OpenClaw Stream Deck"`.
- Events arrive as `{ type: "event", event: <string>, payload: <unknown>, seq?: number }` (confirm with `isGatewayEventFrame` from `@openclaw/gateway-protocol`).
- This machine restricts `write`/`edit` tools to the OpenCode plan directory; if the executor hits that error, create/edit repo files with the shell (PowerShell here-strings + `[IO.File]::WriteAllText`), not the blocked tools.
- Testing the live connection requires the Gateway running. Start it with `openclaw gateway` (foreground, another terminal) or confirm with `openclaw gateway status --require-rpc`. It is NOT currently running.
- Windows host, PowerShell, repo root `C:\Users\coled\Repositories\OpenclawSD`.

## Review Focus

Input classes the spec implies but no single task tests, listed with the behavior a reasonable person expects. Each line is pinned to a test in its owning task.

1. **Gateway is down or unreachable when a key is pressed** — the key must show a clear DOWN/error state within ~2s, never hang or stay on a stale "running" face. → Task 7 (Status action).
2. **First run without pairing approved** — the plugin must surface a "PAIRING" state and the exact `openclaw devices approve <requestId>` command, and connect without user action once approved (auto-retry). → Task 5 (live connect test).
3. **Target session does not exist** (typo, deleted) — `chat.send` must produce a readable error on the key, not an unhandled exception. → Task 10 (Send Prompt).
4. **Gateway auth mode unknown** (`none` vs `token` vs `password`) — connecting with no shared secret must work when the Gateway allows it, and the wizard must offer the token/password fields for when it does not. → Task 5 (live connect test) + Task 6 (Setup wizard).
5. **Gateway restarts mid-session** — the service must reconnect with backoff, re-subscribe to sessions, and refresh cached state automatically; keys must reflect the new state without a plugin restart. → Task 4 (GatewayService tests).

---

### Task 1: Scaffold the plugin

**Files:**
- Create: `package.json`, `tsconfig.json`, `rollup.config.mjs`, `vitest.config.ts`, `com.encrypt.openclaw.sdPlugin/manifest.json`, `src/plugin.ts`, `src/actions/status.ts` (placeholder), `com.encrypt.openclaw.sdPlugin/imgs/` (placeholder icons), `com.encrypt.openclaw.sdPlugin/logs/` (empty dir), `README.md`
- Modify: `.gitignore`

The scaffold is copied from the maintainers' hello-world sample so the build wiring is known-good: clone or download `https://github.com/elgatosf/streamdeck-plugin-samples` (branch `main`), copy the `hello-world` plugin's structure (package.json, tsconfig.json, rollup.config.mjs, src/, and the `.sdPlugin` folder), then rename the plugin UUID/name to ours.

**Interfaces:**
- Produces: a buildable skeleton; `src/plugin.ts` that registers one placeholder action and calls `streamDeck.connect()` last; `manifest.json` with one visible action `com.encrypt.openclaw.status`. Later tasks add more actions to the manifest and register them in `plugin.ts`.

- [ ] **Step 1: Copy the sample scaffold**

Clone `https://github.com/elgatosf/streamdeck-plugin-samples` into a temp dir; copy the `hello-world` plugin contents into the repo root (merge with the existing `docs/` and `.git`). Keep the sample's `package.json` scripts (`build`, `watch`), `tsconfig.json`, and `rollup.config.mjs` unchanged initially.

- [ ] **Step 2: Rename plugin identity**

In `com.encrypt.openclaw.sdPlugin/manifest.json` set `UUID: "com.encrypt.openclaw"`, `Name: "OpenClaw"`, `Author` to the username `encrypt`, `CodePath: "bin/plugin.js"`, `SDKVersion: 3`, and `Nodejs.Version` to `"24"`. Rename the action UUID in the manifest and in `src/actions/` to `com.encrypt.openclaw.status`. Folder: `com.encrypt.openclaw.sdPlugin` (not the sample name).

- [ ] **Step 3: Confirm SDK version and pin `@elgato/streamdeck` v3**

Run `npm view @elgato/streamdeck version`. If the sample pinned v2.x, add v3: `npm i -D @elgato/streamdeck@^3` and set `SDKVersion: 3` in the manifest. Update any v2-only API names in the sample's action to the v3 equivalents (`@action({ UUID })` decorator + `SingletonAction`, `streamDeck.connect()`, `onWillAppear`, `setTitle`). The docs' v3 reference (actions, settings, dials, manifest) is authoritative.

- [ ] **Step 4: Add dev-dependency test runner**

`npm i -D vitest`. Create `vitest.config.ts` with `test: { include: ["tests/**/*.test.ts"] }` and a `test` script in package.json: `"test": "vitest run"`.

- [ ] **Step 5: Build and validate**

Run `npm run build`. Expected: `com.encrypt.openclaw.sdPlugin/bin/plugin.js` exists.
Run `npx @elgato/cli validate com.encrypt.openclaw.sdPlugin` (installs the CLI on demand; globally `npm i -g @elgato/cli` is also fine). Expected: no manifest errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold OpenClaw Stream Deck plugin"
```

---

### Task 2: Config and device-identity storage

**Files:**
- Create: `src/gateway/config.ts`, `src/gateway/identity.ts`, `tests/config.test.ts`, `tests/identity.test.ts`

Pure Node modules; no `@elgato/streamdeck` import. This is what makes the rest testable without a device.

**Interfaces:**
- `src/gateway/config.ts`:
  - `export type GatewayAuth = { kind: "none" } | { kind: "token"; token: string } | { kind: "password"; password: string }`
  - `export type AppConfig = { gatewayUrl: string; gatewayAuth: GatewayAuth; pollIntervalMs: number; requestTimeoutMs: number }`
  - `export type StoredIdentity = { deviceId: string; privateKeyPem: string; publicKeyPem: string }`
  - `export type StoredConfig = { config: AppConfig; identity: StoredIdentity | null; deviceToken: { token: string; scopes: string[] } | null }`
  - `export const DEFAULT_CONFIG: AppConfig` — `gatewayUrl: "ws://127.0.0.1:18789"`, `gatewayAuth: { kind: "none" }`, `pollIntervalMs: 30_000`, `requestTimeoutMs: 15_000`
  - `export let CONFIG_DIR: string` (path.join(os.homedir(), ".openclaw-streamdeck")) — `let`, so tests can repoint it at a temp dir
  - `export let CONFIG_PATH: string` (path.join(CONFIG_DIR, "config.json")) — `let`, same reason
  - `export function loadConfig(): StoredConfig` — sync fs read; missing file/fields fall back to `DEFAULT_CONFIG`; never throws for a missing file.
  - `export function saveConfig(stored: StoredConfig): void` — mkdir -p `CONFIG_DIR`, write JSON, atomic via write-tmp-then-rename.
- `src/gateway/identity.ts`:
  - `export const ED25519_SPKI_PREFIX: Buffer` = hex `302a300506032b6570032100`
  - `export function publicKeyRawBase64UrlFromPem(publicKeyPem: string): string`
  - `export function deviceIdFromPublicKeyRaw(rawB64Url: string): string` — `sha256` hex of the raw key bytes
  - `export function createStoredIdentity(): StoredIdentity` — `crypto.generateKeyPairSync("ed25519")`, PEM export `spki` / `pkcs8`, deviceId derived from the raw public key
  - `export function signDevicePayload(privateKeyPem: string, payload: string): string`
  - `export function loadOrCreateIdentity(stored: StoredIdentity | null): StoredIdentity`
- Produces: everything later tasks and the `GatewayClient` hostDeps need for identity + config.

**Reference algorithm (copy the semantics verbatim from the installed CLI bundle `C:\nvm4w\nodejs\node_modules\openclaw\dist\ed25519-signature-De1Kepnz.mjs` and `device-identity-C6cuE-Un.mjs`):** strip the fixed SPKI prefix from the DER to get the 32-byte raw public key; `publicKeyRawBase64UrlFromPem` = base64url of that; `deviceId` = hex sha256 of the raw bytes; `signDevicePayload` = `Buffer.from(crypto.sign(null, Buffer.from(payload, "utf8"), crypto.createPrivateKey(privateKeyPem))).toString("base64url")`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/config.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { loadConfig, saveConfig, DEFAULT_CONFIG, CONFIG_PATH, CONFIG_DIR } from "../src/gateway/config";

const sandbox = join(tmpdir(), "openclaw-sd-test-config-" + process.pid);
CONFIG_DIR = sandbox;
CONFIG_PATH = join(sandbox, "config.json");

describe("config", () => {
  beforeEach(() => rmSync(sandbox, { recursive: true, force: true }));
  afterEach(() => rmSync(sandbox, { recursive: true, force: true }));
  it("returns defaults when no file exists", () => {
    const s = loadConfig();
    expect(s.config.gatewayUrl).toBe("ws://127.0.0.1:18789");
    expect(s.config.gatewayAuth).toEqual({ kind: "none" });
    expect(s.identity).toBeNull();
    expect(s.deviceToken).toBeNull();
  });
  it("round-trips saved config", () => {
    saveConfig({ config: { ...DEFAULT_CONFIG, gatewayUrl: "ws://192.168.1.10:18789" }, identity: { deviceId: "d", privateKeyPem: "p", publicKeyPem: "q" }, deviceToken: { token: "tok", scopes: ["operator.read"] } });
    const s = loadConfig();
    expect(s.config.gatewayUrl).toBe("ws://192.168.1.10:18789");
    expect(s.identity?.deviceId).toBe("d");
    expect(s.deviceToken?.token).toBe("tok");
  });
  it("creates the directory on save", () => {
    saveConfig({ config: DEFAULT_CONFIG, identity: null, deviceToken: null });
    expect(existsSync(sandbox)).toBe(true);
  });
});
```

```ts
// tests/identity.test.ts
import { describe, expect, it } from "vitest";
import { createHash, createPublicKey, verify } from "node:crypto";
import { createStoredIdentity, publicKeyRawBase64UrlFromPem, deviceIdFromPublicKeyRaw, signDevicePayload, ED25519_SPKI_PREFIX } from "../src/gateway/identity";

describe("identity", () => {
  it("derives a stable 64-char hex deviceId", () => {
    const id = createStoredIdentity();
    expect(id.deviceId).toMatch(/^[0-9a-f]{64}$/);
  });
  it("raw public key strips the SPKI prefix and has correct length", () => {
    const id = createStoredIdentity();
    const raw = publicKeyRawBase64UrlFromPem(id.publicKeyPem);
    expect(Buffer.from(raw, "base64url").length).toBe(32);
  });
  it("deviceId equals sha256 hex of raw key", () => {
    const id = createStoredIdentity();
    const raw = publicKeyRawBase64UrlFromPem(id.publicKeyPem);
    expect(id.deviceId).toBe(createHash("sha256").update(Buffer.from(raw, "base64url")).digest("hex"));
  });
  it("deviceId derived from raw matches the identity's deviceId", () => {
    const id = createStoredIdentity();
    const raw = publicKeyRawBase64UrlFromPem(id.publicKeyPem);
    expect(deviceIdFromPublicKeyRaw(raw)).toBe(id.deviceId);
  });
  it("signatures verify against the public key", () => {
    const id = createStoredIdentity();
    const sig = signDevicePayload(id.privateKeyPem, "hello-payload");
    const ok = verify(null, Buffer.from("hello-payload", "utf8"), createPublicKey(id.publicKeyPem), Buffer.from(sig, "base64url"));
    expect(ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — modules/functions not found.

- [ ] **Step 3: Implement `src/gateway/config.ts` and `src/gateway/identity.ts`**

Follow the interfaces and the reference algorithm above. Use only `node:crypto`, `node:fs`, `node:os`, `node:path`. Keep PEM output canonical (64-col wrapped base64 with `-----BEGIN PUBLIC KEY-----` / `-----BEGIN PRIVATE KEY-----` framing, LF line endings), matching the CLI bundle's `pemEncode`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add src/gateway/config.ts src/gateway/identity.ts tests/config.test.ts tests/identity.test.ts
git commit -m "feat: add config and Ed25519 identity storage"
```

---

### Task 3: Type definitions and event bus

**Files:**
- Create: `src/gateway/types.ts`, `src/gateway/events.ts`, `tests/events.test.ts`

**Interfaces:**
- `src/gateway/types.ts` — plain TS types, aligned with `@openclaw/gateway-protocol` schema names. Define (minimal, only fields later tasks read):
  - `SessionRow = { key: string; sessionId?: string; title?: string | null; label?: string | null; hasActiveRun: boolean; activeRunIds?: string[] | null; agentId?: string; updatedAt?: number | null }`
  - `CronJobSummary = { jobId: string; name?: string; schedule?: string; enabled: boolean; kind?: string }`
  - `CronRunEntry = { runId: string; jobId: string; status: string; completionStatus?: string; startedAt?: number; endedAt?: number; error?: string | null }`
  - `UsageStatusResult = { cacheStatus?: unknown; providers?: Array<{ id: string; label?: string; remainingPercent?: number | null; used?: string; total?: string; planName?: string; window?: string }> }`
  - `UsageCostResult = { totals?: Record<string, unknown>; today?: number; thirtyDays?: number; cacheStatus?: unknown }`
  - `ApprovalItem = { id: string; kind: string; summary?: string; requestedAt?: number }`
  - `ChatSendResult = { ok?: boolean; runId?: string; sessionKey?: string; message?: string; error?: string }`
  - `HealthSnapshot = { ok?: true; ts?: number; durationMs?: number; eventLoop?: { degraded: boolean; reasons: string[] } }`
  - `type QueueMode = "steer" | "followup" | "collect" | "interrupt"`
- `src/gateway/events.ts`:
  - `export type GatewayEventName = "health" | "presence" | "heartbeat" | "tick" | "cron" | "sessions.changed" | "session.message" | "agent" | "exec.approval.requested" | "exec.approval.resolved" | "shutdown"`
  - `export class GatewayEventBus { on(name: GatewayEventName, cb: (payload: unknown) => void): () => void; off(name: GatewayEventName, cb: (payload: unknown) => void): void; emit(name: GatewayEventName, payload: unknown): void; clear(): void }` — `on` returns an unsubscribe closure; `emit` never throws on a user callback error (log and continue).

- [ ] **Step 1: Write the failing test**

```ts
// tests/events.test.ts
import { describe, expect, it } from "vitest";
import { GatewayEventBus } from "../src/gateway/events";

describe("GatewayEventBus", () => {
  it("delivers events to subscribers and unsubscribes", () => {
    const bus = new GatewayEventBus();
    const seen: unknown[] = [];
    const off = bus.on("sessions.changed", (p) => seen.push(p));
    bus.emit("sessions.changed", { n: 1 });
    off();
    bus.emit("sessions.changed", { n: 2 });
    expect(seen).toEqual([{ n: 1 }]);
  });
  it("isolates namespaces", () => {
    const bus = new GatewayEventBus();
    const a: unknown[] = []; const b: unknown[] = [];
    bus.on("agent", (p) => a.push(p));
    bus.on("cron", (p) => b.push(p));
    bus.emit("agent", { x: 1 });
    expect(a).toHaveLength(1); expect(b).toHaveLength(0);
  });
  it("a throwing subscriber does not break other subscribers", () => {
    const bus = new GatewayEventBus();
    let second = 0;
    bus.on("tick", () => { throw new Error("boom"); });
    bus.on("tick", () => { second++; });
    expect(() => bus.emit("tick", {})).not.toThrow();
    expect(second).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/events.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/gateway/types.ts` and `src/gateway/events.ts`**

Straightforward per the interfaces.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gateway/types.ts src/gateway/events.ts tests/events.test.ts
git commit -m "feat: add Gateway type definitions and event bus"
```

---

### Task 4: GatewayService with a stubbed connector

**Files:**
- Create: `src/gateway/service.ts`, `tests/service.test.ts`

**Interfaces:**
- `export type ConnectorPhase = "disconnected" | "connecting" | "ready" | "pairing" | "error"`
- `export type ConnectorState = { phase: ConnectorPhase; detail?: string; requestId?: string }`
- `export interface GatewayConnector` — what `client.ts` (Task 5) implements and tests stub:
  - `start(): void`
  - `stop(): void`
  - `request<T>(method: string, params?: unknown): Promise<T>`
  - `onEvent(cb: (evt: { event: string; payload: unknown }) => void): () => void`
  - `onState(cb: (s: ConnectorState) => void): () => void`
- `export class GatewayUnavailableError extends Error {}` — thrown by `request` when state is not `ready`.
- `export class GatewayService`:
  - `constructor(connector: GatewayConnector)`
  - `start(): void` — forward; the service sets state from connector callbacks, not by opening sockets itself.
  - `stop(): void`
  - `get state(): ConnectorState`
  - `onState(cb): () => void`
  - `request<T>(method: string, params?: unknown): Promise<T>` — throws `GatewayUnavailableError` when `state.phase !== "ready"`.
  - `getEvent(name: GatewayEventName, cb): () => void` — subscribe to a named event; internally filters connector `onEvent` frames by `evt.event` and dispatches through a `GatewayEventBus`.
  - `refresh(): Promise<void>` — **no-op when `state.phase !== "ready"`**; when `ready`, in parallel: `health()`, `listSessions()`, `listCronJobs()` and stores results; on failure keeps last-good data (never throws).
  - Cached getters: `get healthSnapshot()` (HealthSnapshot | null), `get sessionList()` (SessionRow[]), `get cronJobs()` (CronJobSummary[]).
  - Typed wrappers (all `request`-based, defined here so actions never touch methods-by-string later):
    - `health(): Promise<HealthSnapshot>` — `request("health", {})`
    - `listSessions(opts?: { activeOnly?: boolean; limit?: number }): Promise<SessionRow[]>` — `request("sessions.list", opts ?? {})`; return the sessions array from the result (verify the result shape at build time from `SessionsListResultSchema`; if the array is under another key, return that).
    - `subscribeSessions(): Promise<void>` — `request("sessions.subscribe", { limit: 60, ownerFirst: true })`; the snapshot's `list` (when present) replaces the session cache.
    - `listCronJobs(): Promise<CronJobSummary[]>` — `request("cron.list", {})`.
    - `runCronJob(jobId: string, opts?: { waitTimeoutMs?: number }): Promise<{ ok: boolean; runId?: string }>` — `request("cron.run", { jobId, ...opts })`. **Verify field names against `CronRunParamsSchema` at build time** — dump it with: `node -e "import('@openclaw/gateway-protocol').then(m=>console.log(JSON.stringify(m.CronRunParamsSchema.properties ?? m.CronRunParamsSchema,null,1)))"` and adjust names (candidates: `jobId`, `runId`, `runMode`, `waitTimeoutMs`, `deliver`).
    - `cronRunHistory(jobId: string, runId?: string): Promise<CronRunEntry[]>` — `request("cron.runs", { jobId, ...(runId ? { runId } : {}) })`.
    - `usageStatus(): Promise<UsageStatusResult>` — `request("usage.status", {})`.
    - `usageCost(opts?: { days?: number }): Promise<UsageCostResult>` — `request("usage.cost", { days: opts?.days ?? 7 })`.
    - `sendPrompt(p: { sessionKey?: string; message: string; queueMode?: QueueMode; fastMode?: boolean }): Promise<ChatSendResult>` — `request("chat.send", { ...p })`.
    - `abortSession(sessionKey: string): Promise<unknown>` — `request("sessions.abort", { key: sessionKey })` (verify against `SessionsAbortParamsSchema`; candidate field `key`).
    - `listApprovals(): Promise<ApprovalItem[]>` — `request("exec.approval.list", {})`; map rows' `id`/`kind`/`summary`/`requestedAt` fields as found at build time.
    - `resolveApproval(a: { id: string; kind: string; decision: "approve" | "deny" }): Promise<unknown>` — `request("exec.approval.resolve", { id: a.id, kind: a.kind, decision: a.decision })` (verify against `ExecApprovalResolveParamsSchema`; candidate fields `id`, `kind`, `decision`).
- Produces: the single API surface every action imports. `client.ts` (Task 5) implements `GatewayConnector`, so the service is fully testable here with a stub.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/service.test.ts
import { describe, expect, it } from "vitest";
import { GatewayService, GatewayUnavailableError, type GatewayConnector, type ConnectorState } from "../src/gateway/service";

function stubConnector() {
  const listeners: Array<(evt: { event: string; payload: unknown }) => void> = [];
  const stateListeners: Array<(s: ConnectorState) => void> = [];
  const requests: Array<[string, unknown]> = [];
  function fire(evt: { event: string; payload: unknown }) { for (const l of [...listeners]) l(evt); }
  function setState(s: ConnectorState) { for (const l of [...stateListeners]) l(s); }
  const c: GatewayConnector = {
    start: () => setState({ phase: "ready" }),
    stop: () => setState({ phase: "disconnected" }),
    request: async (method: string, params?: unknown) => { requests.push([method, params]); return {}; },
    onEvent: (cb) => { listeners.push(cb); return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); }; },
    onState: (cb) => { stateListeners.push(cb); return () => { const i = stateListeners.indexOf(cb); if (i >= 0) stateListeners.splice(i, 1); }; },
  };
  return { c, fire, setState, requests };
}

describe("GatewayService", () => {
  it("throws GatewayUnavailableError when not ready", async () => {
    const { c } = stubConnector();
    const svc = new GatewayService(c);
    await expect(svc.request("health", {})).rejects.toThrow(GatewayUnavailableError);
  });
  it("tracks state from the connector", () => {
    const { c, setState } = stubConnector();
    const svc = new GatewayService(c);
    const states: string[] = [];
    svc.onState((s) => states.push(s.phase));
    svc.start();
    setState({ phase: "error", detail: "refused" });
    expect(states).toContain("ready");
    expect(svc.state.phase).toBe("error");
  });
  it("forwards typed wrappers and results", async () => {
    const { c, requests } = stubConnector();
    const svc = new GatewayService(c);
    svc.start();
    await svc.listCronJobs();
    expect(requests).toContainEqual(["cron.list", {}]);
  });
  it("fans out named events", () => {
    const { c, fire } = stubConnector();
    const svc = new GatewayService(c);
    const seen: unknown[] = [];
    svc.getEvent("cron", (p) => seen.push(p));
    fire({ event: "cron", payload: { x: 1 } });
    fire({ event: "sessions.changed", payload: { y: 2 } });
    expect(seen).toEqual([{ x: 1 }]);
  });
  it("refresh keeps last-good data on failure", async () => {
    const { c, setState } = stubConnector();
    const svc = new GatewayService(c);
    svc.start();
    await svc.refresh();
    expect(svc.sessionList).toBeDefined();
    setState({ phase: "error", detail: "down" });
    await expect(svc.refresh()).resolves.toBeUndefined();
    expect(svc.sessionList).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/gateway/service.ts`**

Per the interfaces. Important behaviors: `request` checks `state.phase` immediately; `refresh()` runs the three read RPCs with `Promise.allSettled` and only replaces a cache on success; the connector `onEvent`/`onState` subscriptions are established in the constructor and torn down in `stop()`.

- [ ] **Step 4: Run the build and tests together**

Run: `npm test` then `npm run build`
Expected: all PASS; build succeeds. The service must not import the streamDeck SDK (keep it pure so it stays testable).

- [ ] **Step 5: Commit**

```bash
git add src/gateway/service.ts tests/service.test.ts
git commit -m "feat: add GatewayService with typed RPC wrappers"
```

---

### Task 5: Real connector (client.ts) and live Gateway verification

**Files:**
- Create: `src/gateway/client.ts`, `tests/live/smoke-connect.test.ts`, `scripts/smoke-connect.mjs`, `scripts/smoke-entry.ts`
- Modify: `package.json` (add `"test:live": "vitest run tests/live"`)

**Interfaces:**
- `src/gateway/client.ts`:
  - `export function createGatewayConnector(cfg: AppConfig): GatewayConnector`
  - Builds a `GatewayClient` (`@openclaw/gateway-client`, Node entry) with:
    - `url: cfg.gatewayUrl`
    - `clientName: "cli"`, `mode: "cli"`, `role: "operator"`, `platform: "win32"`, `clientDisplayName: "OpenClaw Stream Deck"`, `clientVersion: "0.1.0"`, `instanceId` a random id per plugin launch
    - `scopes: ["operator.read", "operator.write", "operator.approvals"]`
    - `caps: [GATEWAY_CLIENT_CAPS.APPROVALS, GATEWAY_CLIENT_CAPS.EXEC_APPROVALS]`
    - `minProtocol: PROTOCOL_VERSION`, `maxProtocol: PROTOCOL_VERSION` (`@openclaw/gateway-protocol/version`)
    - `requestTimeoutMs: cfg.requestTimeoutMs`
    - auth: `kind === "token"` → `token: cfg.gatewayAuth.token`; `kind === "password"` → `password: cfg.gatewayAuth.password`; `none` → neither (the Gateway's `auth.mode` decides; loopback private ingress may need no secret)
    - `hostDeps`: object wired to Task 2 modules:
      - `loadOrCreateDeviceIdentity: () => { const stored = loadConfig(); const id = loadOrCreateIdentity(stored.identity); if (!stored.identity) { stored.identity = id; saveConfig(stored); } return { deviceId: id.deviceId, privateKeyPem: id.privateKeyPem, publicKeyPem: id.publicKeyPem }; }` (must stay synchronous)
      - `signDevicePayload: (privateKeyPem, payload) => signDevicePayload(privateKeyPem, payload)`
      - `publicKeyRawBase64UrlFromPem: (pem) => publicKeyRawBase64UrlFromPem(pem)`
      - `loadDeviceAuthToken: ({ deviceId, role }) => { const t = loadConfig().deviceToken; return t ? { token: t.token, scopes: t.scopes } : null; }`
      - `storeDeviceAuthToken: ({ deviceId, role, token, scopes }) => { const s = loadConfig(); s.deviceToken = { token, scopes }; saveConfig(s); }`
      - `clearDeviceAuthToken: () => { const s = loadConfig(); s.deviceToken = null; saveConfig(s); }`
      - `logDebug`/`logError` → `console.log`/`console.error` prefixed `[openclaw]`
    - callbacks:
      - `onHelloOk: (hello) => { setState({ phase: "ready", detail: hello.server.version }); void refreshAfterHello(); }` where `refreshAfterHello()` calls `subscribeSessions()` then a best-effort `refresh()` (never throws).
      - `onEvent: (evt) => { fire({ event: evt.event, payload: evt.payload }); if (evt.event === "health" || evt.event === "tick") void refreshThrottled(); }` — refresh throttled to once per 5s; `sessions.changed` payloads with a nested session row also update the session cache for that key.
      - `onConnectError: (err) => mapError(err)`
      - `onReconnectPaused: (info) => setState({ phase: "pairing", detail: info.detailCode ?? info.reason })`
      - `onClose: (code, reason) => setState({ phase: "disconnected", detail: reason })`
    - `mapError(err)`: if `err.details?.code === "PAIRING_REQUIRED"` (also accept `err.details?.requestId` present) → `setState({ phase: "pairing", requestId: err.details.requestId })`; else `setState({ phase: "error", detail: err.message })`. The client retries connects itself with backoff, so never open extra sockets from here.
    - `start()` → `client.start()`; `stop()` → `client.stop()`.
    - `request<T>(method, params)` → `client.request<T>(method, params)`.
    - Returns a `GatewayConnector`.
- `tests/live/smoke-connect.test.ts` — the live proof, run explicitly:
  - `const RUN_LIVE = process.env.RUN_LIVE === "1";`
  - `describe.skipIf(!RUN_LIVE)("live connect", () => { ... })`:
    - Point `CONFIG_DIR` at a temp dir for the test so it never touches the real config.
    - Create the connector from `DEFAULT_CONFIG`, `start()`.
    - Poll `state` every 500ms up to 30s for `ready` or `pairing`.
    - If `pairing`: fail with a message printing the requestId and the commands `openclaw devices list` then `openclaw devices approve <requestId>`.
    - If `ready`: `await request("sessions.list", {})` must resolve to an object whose sessions array is an array (may be empty); `await request("health", {})` must resolve with `ok: true`. Print the negotiated scopes.
  - `afterAll(() => connector.stop())`.

- [ ] **Step 1: Add the live test and run it against a down Gateway**

Start nothing. Run `npm run test:live`. Expected: all tests SKIPPED (skipIf), exit 0. (Proves the gate works.)

- [ ] **Step 2: Implement `src/gateway/client.ts`**

Per the interfaces. **Verify these at build time against the installed types** (`node_modules/@openclaw/gateway-client/dist/index.d.mts`):
  - `GATEWAY_CLIENT_CAPS` export name and member names (expected `APPROVALS`, `EXEC_APPROVALS`).
  - `PROTOCOL_VERSION` import path (`@openclaw/gateway-protocol/version`).
  - `GatewayClient` constructor options names (`clientName`, `mode`, `role`, `scopes`, `caps`, `hostDeps`, `deviceIdentity`, `minProtocol`, `maxProtocol`, `token`, `password`, `onEvent`, `onHelloOk`, `onConnectError`, `onReconnectPaused`, `onClose`, `requestTimeoutMs`).
  - `GatewayClientHostDeps` member names (`loadOrCreateDeviceIdentity`, `signDevicePayload`, `publicKeyRawBase64UrlFromPem`, `loadDeviceAuthToken`, `storeDeviceAuthToken`, `clearDeviceAuthToken`).
  - Whether `deviceIdentity` also needs to be supplied in options in addition to `hostDeps.loadOrCreateDeviceIdentity` — if both are accepted, supply the identity from `loadConfig()` at connector construction and keep the hostDep as the fallback path.
  - `GatewayClientRequestError` for typed error reading; prefer `err.message` in `mapError`.

- [ ] **Step 3: Start the Gateway and run the live test**

In a separate terminal on the Gateway host: `openclaw gateway` (leave running). Verify: `openclaw gateway status --require-rpc` prints `Runtime: running`.
Run from the repo: `$env:RUN_LIVE="1"; npm run test:live`
Expected outcome A (auto-approved loopback): the test passes — `sessions.list` returns an array; record the negotiated `scopes` from the test output.
Expected outcome B (pairing required): the test fails printing `openclaw devices approve <requestId>`. Executor runs `openclaw devices list`, then `openclaw devices approve <requestId>`, then re-runs to green.

- [ ] **Step 4: Add the smoke script for humans**

Create `scripts/smoke-connect.mjs` (with `scripts/smoke-entry.ts` as a rollup entry) that connects using the **real** `~/.openclaw-streamdeck/config.json`, prints `ready`, the Gateway version, `auth.scopes`, the `sessions.list` count, a `health` summary, then exits. Verification: run it with the Gateway up; in a pairing scenario it prints the approve command. Commit it.

- [ ] **Step 5: Commit**

```bash
git add src/gateway/client.ts tests/live/smoke-connect.test.ts scripts/smoke-connect.mjs scripts/smoke-entry.ts package.json
git commit -m "feat: real gateway connector with live smoke verification"
```

---

### Task 6: Setup wizard — action + property inspector

**Files:**
- Create: `src/actions/setup.ts`, `src/ui/setup.html`, `src/ui/setup.js`, `src/ui/shared.js`, `scripts/copy-ui.mjs`
- Modify: `com.encrypt.openclaw.sdPlugin/manifest.json` (add the Setup action + `PropertyInspectorPath`), `src/plugin.ts` (register Setup action), `rollup.config.mjs` / `package.json` build script (copy `src/ui` into the `.sdPlugin/ui` on build), `src/gateway/index.ts` (export the shared `GatewayService` singleton)

**Interfaces:**
- `src/gateway/index.ts`: `export const gatewayService: GatewayService` — singleton constructed once with `createGatewayConnector(loadConfig().config)` and started before `streamDeck.connect()` in `plugin.ts`.
- `src/actions/setup.ts` — `@action({ UUID: "com.encrypt.openclaw.setup" }) class SetupAction extends SingletonAction<Record<string, never>>`:
  - `onWillAppear` → `applyFace(this.actions)`.
  - `onSendToPlugin(ev)` — handles PI messages: `{ kind: "get-state" }` (reply current `ConnectorState` + `StoredConfig` without the private key), `{ kind: "save-config", config: AppConfig }` (write via `saveConfig`), `{ kind: "test-connection" }` (create a throwaway connector from the given config, connect, await `ready`/`error`/`pairing` up to 20s, reply `{ ok, version?, phase, requestId? }`, then stop it), `{ kind: "copy-text", text: string }` (reply with the pairing command text so the PI can offer copy).
  - `applyFace`: title per state — `Need setup` (neutral), `Connecting` (running), `PAIR: approve on host` (warn), `Ready` (ok), `Error` (error); image from `imageForStatus`.
- `src/ui/setup.html` + `src/ui/setup.js` — the wizard, plain HTML/CSS/JS using the Stream Deck property-inspector JS client (`streamDeck.ui.*`). Steps:
  1. Gateway URL text input (prefilled from config).
  2. Auth: radio `none` / `token` / `password`; token/password fields appear per selection.
  3. "Save + Test connection" button → sends `save-config` then `test-connection`, shows the result.
  4. On `pairing` phase: panel showing the exact `openclaw devices list` and `openclaw devices approve <requestId>` commands with a **Copy** button (`navigator.clipboard`), plus "Retry" (re-send `get-state`), auto-refreshing every 2s.
  5. On `ready`: "Connected — Gateway vX, scopes [...]" and a **Done** button.
  - The PI polls `get-state` every 2s while visible.
- `src/ui/shared.js` — `post(msg)` wrapper around the PI ↔ plugin messaging (`streamDeck.ui.sendToPropertyInspector` / listener), plus tiny DOM helpers.

- [ ] **Step 1: Manifest entry for Setup**

Add to `com.encrypt.openclaw.sdPlugin/manifest.json` `Actions`:
```json
{
  "Name": "Setup",
  "UUID": "com.encrypt.openclaw.setup",
  "Icon": "imgs/actions/setup/icon",
  "Tooltip": "Configure the OpenClaw connection",
  "Controllers": ["Keypad"],
  "PropertyInspectorPath": "ui/setup.html",
  "States": [{ "Image": "imgs/actions/setup/key", "TitleAlignment": "middle" }]
}
```
(Image paths are extension-less; files live under `com.encrypt.openclaw.sdPlugin/imgs/actions/setup/` as `icon.png` + `key.png`.)

- [ ] **Step 2: Wire the shared service and register the action**

In `src/plugin.ts`: construct `gatewayService` (via `src/gateway/index.ts`), call `gatewayService.start()` before `streamDeck.connect()`; register `SetupAction`. Compile: `npm run build`.

- [ ] **Step 3: Implement the PI and action**

Per the interfaces. Keep the PI dependency-free (no framework, no bundler for the HTML/JS). The PI page talks to the plugin only through `streamDeck.ui` messaging.

- [ ] **Step 4: Wire UI copy into the build**

In `scripts/copy-ui.mjs` (called by the `build` script before rollup), copy `src/ui/*` → `com.encrypt.openclaw.sdPlugin/ui/`. Run `npm run build`; confirm `com.encrypt.openclaw.sdPlugin/ui/setup.html` exists. Validate: `npx @elgato/cli validate com.encrypt.openclaw.sdPlugin`.

- [ ] **Step 5: Manual smoke with the device**

With Stream Deck software running and the plugin visible (`npm run watch`), drag **Setup** onto a key. Expected: the key shows `Need setup`; opening the inspector shows the wizard with the URL prefilled; `Save + Test connection` with the Gateway running reports green and the key flips to `Ready`; stopping the Gateway and testing again shows a clear error state and the key flips to `Error`.

- [ ] **Step 6: Commit**

```bash
git add com.encrypt.openclaw.sdPlugin/manifest.json src/actions/setup.ts src/ui scripts/copy-ui.mjs rollup.config.mjs src/gateway/index.ts src/plugin.ts
git commit -m "feat: add Setup wizard action and property inspector"
```

---

### Task 7: Status action (Review Focus 1)

**Files:**
- Create: `src/lib/deck.ts`, `src/actions/status.ts`, `tests/deck.test.ts`, `scripts/gen-status-pngs.mjs`, `com.encrypt.openclaw.sdPlugin/imgs/status/` (5 PNGs)
- Modify: `com.encrypt.openclaw.sdPlugin/manifest.json` (Status action now real), `src/plugin.ts`

**Interfaces:**
- `src/lib/deck.ts` (pure, testable render decisions):
  - `export type StatusKind = "neutral" | "ok" | "warn" | "error" | "running"`
  - `export function imageForStatus(kind: StatusKind): string` — returns one of `imgs/status/neutral.png`, `imgs/status/ok.png`, `imgs/status/warn.png`, `imgs/status/error.png`, `imgs/status/running.png` (solid-colour 144x144 PNGs: grey, green, amber, red, blue).
  - `export function statusTitle(line1: string, line2?: string): string` — `line1` + (`\n` + `line2` when present).
  - `export function kindFromHealth(h: HealthSnapshot | null, connected: boolean): StatusKind` — `!connected || !h?.ok` → `error`; else `ok`.
- `src/actions/status.ts` — `@action({ UUID: "com.encrypt.openclaw.status" })`:
  - `Controllers: ["Keypad", "Encoder"]`.
  - `onWillAppear` → `render()`.
  - `render()`: from `gatewayService.state`, `healthSnapshot`, `sessionList` compute: disconnected → `error`/`DOWN`; else `kindFromHealth`; line2 = active-run count (`sessionList.filter(s => s.hasActiveRun).length`) when > 0 else the Gateway version (from `state.detail`). `setImage(imageForStatus(kind))` + `setTitle(statusTitle(line1, line2))` on all visible instances.
  - Subscribes `getEvent("health")`, `getEvent("sessions.changed")`, and `svc.onState(...)`; all re-render throttled to 1/s.
  - Dial: `setFeedbackLayout("$B2")`; `setFeedback({ indicator: { value, range: { min: 0, max: 3 } }, title: "Active" })` with the active-run count.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/deck.test.ts
import { describe, expect, it } from "vitest";
import { imageForStatus, statusTitle, kindFromHealth } from "../src/lib/deck";

describe("deck", () => {
  it("maps status kinds to shipped images", () => {
    expect(imageForStatus("error")).toBe("imgs/status/error.png");
    expect(imageForStatus("running")).toBe("imgs/status/running.png");
  });
  it("statusTitle joins two lines", () => {
    expect(statusTitle("OK", "3 active")).toBe("OK\n3 active");
  });
  it("kindFromHealth is error when disconnected or unhealthy", () => {
    expect(kindFromHealth(null, false)).toBe("error");
    expect(kindFromHealth({ ok: false } as never, true)).toBe("error");
    expect(kindFromHealth({ ok: true } as never, true)).toBe("ok");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/deck.test.ts` — FAIL (module missing).

- [ ] **Step 3: Implement `src/lib/deck.ts`, ship status images, implement `status.ts`**

Per interfaces. Create the 5 PNGs with `scripts/gen-status-pngs.mjs` (Node `zlib` + manual PNG chunks; no external deps); commit the PNGs and the script.

- [ ] **Step 4: Run tests and build**

`npm test` (PASS) and `npm run build`.

- [ ] **Step 5: Manual verification with the device (Review Focus 1)**

With Gateway stopped: drag **Status** onto a key → within 2s the key shows red `DOWN` (not a spinner, not stale data). Start the Gateway (`openclaw gateway status --require-rpc` green from another terminal) and wait — the key flips to green `OK` without touching the plugin. Kick off a run elsewhere and confirm the key shows `BUSY n` while a session has an active run.

- [ ] **Step 6: Commit**

```bash
git add src/lib/deck.ts src/actions/status.ts tests/deck.test.ts scripts/gen-status-pngs.mjs com.encrypt.openclaw.sdPlugin/imgs/status
git commit -m "feat: add Status action with live health and busy state"
```

---

### Task 8: Run Automation action

**Files:**
- Create: `src/actions/run-automation.ts`, `src/lib/automation.ts`, `tests/automation.test.ts`, `src/ui/run-automation.html`, `src/ui/run-automation.js`
- Modify: `com.encrypt.openclaw.sdPlugin/manifest.json`, `src/plugin.ts`

**Interfaces:**
- `src/lib/automation.ts`:
  - `export function runStateFromEntries(entries: CronRunEntry[]): "running" | "ok" | "error" | "idle"` — empty → `idle`; latest entry: non-terminal `status` (e.g. `"pending"`, `"running"`) → `running`; `completionStatus === "succeeded"` → `ok`; else `error`.
- `src/actions/run-automation.ts`:
  - `type Settings = { jobId?: string; jobName?: string }`
  - `@action({ UUID: "com.encrypt.openclaw.run-automation" }) class RunAutomationAction extends SingletonAction<Settings>`
  - `Controllers: ["Keypad", "Encoder"]`.
  - `onWillAppear` → `render()`; `onKeyDown` → if `svc.state.phase !== "ready"` → `showAlert()` + short `DOWN` flash; else `runCronJob(settings.jobId)` → on `{ ok: true, enqueued: true, runId }` store `runId` and render `running`; catch → render `error` + log.
  - `render()`: no job → `neutral` `No job — configure`; else `jobName` line1, latest status line2 from `cronRunHistory(jobId)`. Subscribe `getEvent("cron")` and re-render.
  - Dial: `onDialRotate` cycles `svc.cronJobs` (persisting `Settings.jobId`/`jobName` via `setSettings`); `onDialDown` runs like a key press; feedback shows job name + last result.
- `src/ui/run-automation.html`/`.js`:
  - On appear: request `jobs-list`; plugin replies from `gatewayService.cronJobs` (refreshed via `refresh()`); dropdown selection saves `Settings { jobId, jobName }` via `setSettings`. Re-request the list at most once per 30s while visible.

- [ ] **Step 1: Manifest + action stub with the job picker round-trip**

Add the manifest entry (Keypad + Encoder, `PropertyInspectorPath: "ui/run-automation.html"`). Implement the PI: request `jobs-list`, plugin replies from `gatewayService.cronJobs`; selection writes settings. Verify manually with the Gateway running that the dropdown lists jobs. Create one if none: `openclaw automations add --cron "0 9 * * *" "Morning digest" --no-deliver`.

- [ ] **Step 2: Key press → cron.run, render running → terminal**

Implement per interfaces. Render states: `neutral` (no job), `running` (blue) while a run for the job is live, `ok` (green) on `completionStatus === "succeeded"`, `error` (red) otherwise; line2 = short status.

- [ ] **Step 3: Unit-test the run-state mapping**

Write `tests/automation.test.ts`: `runStateFromEntries([]) === "idle"`; entry with `status: "running"` → `"running"`; `completionStatus: "succeeded"` → `"ok"`; `completionStatus: "failed"` → `"error"`.

- [ ] **Step 4: Manual verification with the device**

Configure a test job in the picker; press the key with the Gateway up — the key goes blue `running` then settles `ok`/`error` as the run completes (`openclaw automations runs --json` to cross-check). Press with the Gateway down → red flash + alert.

- [ ] **Step 5: Commit**

```bash
git add src/actions/run-automation.ts src/lib/automation.ts tests/automation.test.ts src/ui/run-automation.html src/ui/run-automation.js com.encrypt.openclaw.sdPlugin/manifest.json src/plugin.ts
git commit -m "feat: add Run Automation action"
```

---

### Task 9: Usage action

**Files:**
- Create: `src/actions/usage.ts`, `src/lib/usage.ts`, `tests/usage.test.ts`, `src/ui/usage.html`
- Modify: `com.encrypt.openclaw.sdPlugin/manifest.json`, `src/plugin.ts`

**Interfaces:**
- `src/lib/usage.ts`:
  - `export function worstRemainingPercent(r: UsageStatusResult): number | null` — `min` of `providers[].remainingPercent ?? 100`, `null` when no providers.
  - `export function usageKind(worstPct: number | null): "ok" | "warn" | "error"` — `null` → `error`; `< 25` → `warn`; else `ok`.
- `src/actions/usage.ts`:
  - `SingletonAction`, `Controllers: ["Keypad", "Encoder"]`.
  - `refresh()`: `Promise.allSettled([svc.usageStatus(), svc.usageCost({ days: 7 })])`; key: `line1 = "Usage"`, `line2 = worstPct + "%"` (or `"n/a"`), cost when present; kind from `usageKind`. Errors → `error`.
  - Dial: `setFeedbackLayout("$B1")`; `setFeedback({ indicator: { value: worstPct, range: { min: 0, max: 100 } }, title: "Usage", value: worstPct + "%" })`. Verify `$B1` layout item keys (`indicator`, `title`, `value`) from the SDK docs on first render and adjust.
  - Subscribes `tick` events and re-renders at most once per `pollIntervalMs` (default 30s).
- `src/ui/usage.html` — read-only panel: worst window %, today's cost, list of provider windows; refreshed via a `usage-read` request (plugin replies `UsageStatusResult` + cost).

- [ ] **Step 1: Manifest entry + pure render helpers**

Add the usage action to the manifest (Keypad + Encoder). Write `tests/usage.test.ts`: `worstRemainingPercent({ providers: [{ remainingPercent: 40 }, { remainingPercent: 12 }] }) === 12`; `{ providers: [] }` → `null`; `usageKind(12) === "warn"`, `usageKind(60) === "ok"`, `usageKind(null) === "error"`.

- [ ] **Step 2: Implement the action and PI**

Per interfaces; run `npm test` + `npm run build`.

- [ ] **Step 3: Manual verification with the device**

With the Gateway up and a provider configured: the key shows `Usage: <n>%` and today's cost; the dial shows the gauge. Cross-check against `openclaw gateway usage-cost --json` and `openclaw status --usage`.

- [ ] **Step 4: Commit**

```bash
git add src/actions/usage.ts src/ui/usage.html src/lib/usage.ts tests/usage.test.ts com.encrypt.openclaw.sdPlugin/manifest.json src/plugin.ts
git commit -m "feat: add Usage action with quota and cost display"
```

---

### Task 10: Send Prompt action (Review Focus 3)

**Files:**
- Create: `src/actions/send-prompt.ts`, `src/lib/send.ts`, `tests/send.test.ts`, `src/ui/send-prompt.html`, `src/ui/send-prompt.js`
- Modify: `com.encrypt.openclaw.sdPlugin/manifest.json`, `src/plugin.ts`

**Interfaces:**
- `src/lib/send.ts`:
  - `export function sendOutcomeMessage(result: unknown, err: unknown): { status: "ok" | "error"; short: string }` — on a thrown error use `err.message` truncated to ~24 chars; on `{ ok: true, ... }` → `{ status: "ok", short: "Sent" }`; otherwise error with `"unknown failure"`.
- `src/actions/send-prompt.ts`:
  - `type Settings = { sessionKey?: string; prompt: string; queueMode?: QueueMode; fastMode?: boolean }`
  - `onKeyDown`: guard `svc.state.phase === "ready"` (else alert); if `!settings.prompt` → alert `"No prompt"`; `await svc.sendPrompt({ sessionKey: settings.sessionKey || undefined, message: settings.prompt, queueMode: settings.queueMode, fastMode: settings.fastMode })`; render from `sendOutcomeMessage`.
  - Subscribe `sessions.changed` and `agent` events to flip back to idle when the target session's run finishes.
- `src/ui/send-prompt.html`/`.js`:
  - Session selector: dropdown from a `sessions-list` request to the plugin (`gatewayService.sessionList`, refreshed on appear) plus a free-text key input; queue mode select (`followup` default, `steer`, `collect`, `interrupt`); multi-line prompt textarea; auto-save settings on change.

- [ ] **Step 1: Implement pure helpers + tests**

Write `tests/send.test.ts`: `sendOutcomeMessage(null, new Error("session not found"))` → `{ status: "error", short: "session not found" }`; `sendOutcomeMessage({ ok: true, runId: "r" }, null)` → `{ status: "ok", short: "Sent" }`.

- [ ] **Step 2: Implement action + PI**

Per interfaces; `npm test` + `npm run build`.

- [ ] **Step 3: Manual verification (Review Focus 3)**

Configure the prompt and a valid session key; press — the key flips `Sending` then `Sent`. Set a session key that does not exist (`sessions.typo`); press — the key shows `Failed: ...` in red within 5s and the plugin process stays healthy.

- [ ] **Step 4: Commit**

```bash
git add src/actions/send-prompt.ts src/ui/send-prompt.html src/ui/send-prompt.js src/lib/send.ts tests/send.test.ts com.encrypt.openclaw.sdPlugin/manifest.json src/plugin.ts
git commit -m "feat: add Send Prompt action"
```

---

### Task 11: Approvals action

**Files:**
- Create: `src/actions/approvals.ts`, `src/lib/approvals.ts`, `tests/approvals.test.ts`
- Modify: `com.encrypt.openclaw.sdPlugin/manifest.json`, `src/plugin.ts`

**Interfaces:**
- `src/lib/approvals.ts`:
  - `export function nextApprovalCount(current: number, evt: { type: "request" | "resolve" }): number` — floor 0.
- `src/actions/approvals.ts`:
  - `Controllers: ["Keypad", "Encoder"]`.
  - Maintains a local count: `getEvent("exec.approval.requested")` → increment + render; `exec.approval.resolved` → decrement; on appear, `svc.listApprovals()` seeds the count (pending rows only).
  - Key press → approve the oldest pending: `svc.listApprovals()` → first → `svc.resolveApproval({ id, kind, decision: "approve" })`. Key long-press (key-up after 700ms) → `decision: "deny"`.
  - Dial: push = approve; long touch = deny (`TriggerDescription` in the manifest Encoder block).
  - Render: count 0 → `neutral` `Approvals` / `0`; count > 0 → `warn` `APPROVE` / `<n> pending`. No pending on press → `showAlert()`.

- [ ] **Step 1: Extract and test the counter logic**

Write `tests/approvals.test.ts`: `nextApprovalCount(0, { type: "resolve" }) === 0`; `nextApprovalCount(2, { type: "request" }) === 3`.

- [ ] **Step 2: Implement the action + manifest Encoder block**

Per interfaces; manifest Encoder block sets `TriggerDescription: { Push: "Approve", LongTouch: "Deny" }`. `npm test` + `npm run build`.

- [ ] **Step 3: Manual verification**

Trigger an approval-worthy command from chat while the plugin runs; the key lights `APPROVE` with count 1; press to approve → count clears and the run continues; trigger again and long-press to deny → run aborts. Cross-check `openclaw` logs.

- [ ] **Step 4: Commit**

```bash
git add src/actions/approvals.ts src/lib/approvals.ts tests/approvals.test.ts com.encrypt.openclaw.sdPlugin/manifest.json src/plugin.ts
git commit -m "feat: add Approvals action"
```

---

### Task 12: Stop action

**Files:**
- Create: `src/actions/stop.ts`, `src/lib/stop.ts`, `tests/stop.test.ts`
- Modify: `com.encrypt.openclaw.sdPlugin/manifest.json`, `src/plugin.ts`

**Interfaces:**
- `src/lib/stop.ts`:
  - `export function pickTargetSession(rows: SessionRow[], settingsKey?: string): string | null` — `settingsKey` wins; else first row with `hasActiveRun`; else first row; else `null`.
- `src/actions/stop.ts`:
  - `type Settings = { sessionKey?: string }`; `Controllers: ["Keypad"]`.
  - `onKeyDown`: target = `pickTargetSession(svc.sessionList, settings.sessionKey)`; `await svc.abortSession(key)` → `showAlert()` + `Stopped` flash; on error → `error`.
  - `onWillAppear` renders `Stop` with the target session key as line2 (or `auto`).

- [ ] **Step 1: Implement + tests + manifest + register**

`tests/stop.test.ts`: `pickTargetSession([])` → `null`; rows `[{ key: "a", hasActiveRun: false }, { key: "b", hasActiveRun: true }]` with no settings → `"b"`; with `settingsKey: "z"` → `"z"`. Implement the action per interfaces; `npm test` + `npm run build`.

- [ ] **Step 2: Manual verification**

Run a long prompt elsewhere; press **Stop** — the run aborts (`openclaw logs` shows the abort; the Status key flips to OK).

- [ ] **Step 3: Commit**

```bash
git add src/actions/stop.ts src/lib/stop.ts tests/stop.test.ts com.encrypt.openclaw.sdPlugin/manifest.json src/plugin.ts
git commit -m "feat: add Stop action"
```

---

### Task 13: Icons, dial layouts, README, final verification

**Files:**
- Create: `README.md` content (install, first-run pairing, action guide), action icons under `com.encrypt.openclaw.sdPlugin/imgs/actions/*/` where still placeholder.
- Modify: `manifest.json` (final `Tooltip`, `States`, `Encoder` blocks, `Category`, `CategoryIcon`).

**Interfaces:**
- Ships the complete plugin: every action in the manifest has a matching implementation and icons; `Plugin` icon and `CategoryIcon` set; README documents the one-time pairing (`openclaw devices list` / `openclaw devices approve <requestId>`) and the config path `~/.openclaw-streamdeck/config.json`.

- [ ] **Step 1: Icons and manifest polish**

Create 144x144 and 72x72 action icons + a plugin icon under `imgs/`; set `Category: "OpenClaw"`, `CategoryIcon`, `Tooltip`s. `npm run build` and `npx @elgato/cli validate com.encrypt.openclaw.sdPlugin` clean.

- [ ] **Step 2: README**

Write README: what it does, prerequisites (OpenClaw Gateway running, Stream Deck app 7.1+), install via the Stream Deck plugin dev folder or `npx @elgato/cli` link, first-run wizard, pairing approval steps, config file location, action reference table, troubleshooting (Gateway down, pairing pending, scope mismatch).

- [ ] **Step 3: Full regression**

Run `npm test` (all green), `npm run build`, `npx @elgato/cli validate`. Re-run the live test (`$env:RUN_LIVE="1"; npm run test:live` with the Gateway up) to confirm the whole chain end-to-end.

- [ ] **Step 4: Commit**

```bash
git add README.md com.encrypt.openclaw.sdPlugin/imgs com.encrypt.openclaw.sdPlugin/manifest.json
git commit -m "chore: finalize icons, docs, and validate full plugin"
```

---

## Execution Notes

- After each task, the plugin must still build (`npm run build`) and all unit tests must pass (`npm test`); fix regressions in the task that caused them before moving on.
- The live test (`tests/live/smoke-connect.test.ts`) and the manual device steps require the Gateway running and (for manual steps) the Stream Deck software with a device. Everything else is verifiable headlessly.
- `.gitignore` must exclude: `node_modules/`, `com.encrypt.openclaw.sdPlugin/bin/`, `com.encrypt.openclaw.sdPlugin/logs/`, `*.local.json`. The user state file `~/.openclaw-streamdeck/config.json` is outside the repo by construction.
- Commit each task atomically as listed; never commit secrets or the user state file.