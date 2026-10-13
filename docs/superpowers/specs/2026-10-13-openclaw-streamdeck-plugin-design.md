# OpenClaw Stream Deck Plugin — Design

## Intent

A Stream Deck plugin that turns an Elgato Stream Deck into a physical control
panel for a self-hosted **OpenClaw** Gateway: fire automations, kick off
repeatable agent tasks, and read live status/usage off the deck.

Cole runs OpenClaw locally (Windows). He wants buttons that "trigger
automations, run repeatable tasks as needed, give me usage feedback." This
document is the agreed description of what gets built.

## Goals

- Keys (and dials where they earn their place) that trigger OpenClaw work.
- Live feedback on the deck: Gateway reachability, running work, pending
  approvals, provider usage / cost.
- One-time guided setup — a first-run wizard in v1 — with no hand-editing of
  `openclaw.json` to mint credentials.
- Ships as a normal Stream Deck plugin: `*.sdPlugin` folder, TypeScript, built
  with the standard scaffold.

## Non-goals (v1)

- Not a chat client or transcript browser. No message history UI.
- No device/node **pairing management** (we pair ourselves, we do not
  administer other devices).
- No Cloud Workers, no remote-Gateway fleet management. A single configurable
  Gateway WebSocket URL.
- No channel/messaging actions (send WhatsApp/Telegram).
- No Marketplace submission; local development install only.

## Anti-goals

- Setup that needs manual token minting or editing `openclaw.json`.
- Silent failure: a press that does nothing must visibly say why.
- Blocking the Stream Deck app on slow work. Key presses return immediately;
  long results stream into the action's display.

## Constraints (researched, verified)

### Stream Deck

- **SDK v3** (`@elgato/streamdeck`), scaffolded with `@elgato/cli`
  (`npm i -g @elgato/cli` then `streamdeck create`). Requires Node.js 24+ and
  Stream Deck app 7.1+.
- A plugin compiles to a `*.sdPlugin/` folder containing `manifest.json`,
  `bin/plugin.js`, `imgs/`, `logs/`, `ui/` (property inspectors), and custom
  `*.json` layout files.
- Actions are single-instance classes extending `SingletonAction`, annotated
  `@action({ UUID: "<plugin-uuid>.<action>" })`. Controller types: `Keypad`,
  `Encoder`, `Neo`.
- Events: `onKeyDown`, `onKeyUp`, `onWillAppear`, `onWillDisappear`,
  `onDialDown/Up/Rotate`, `onTouchTap`, `onDidReceiveSettings`, `onSendToPlugin`.
- Commands: `setTitle`, `setImage`, `setSettings`/`getSettings`, and for dials
  `setFeedback`, `setFeedbackLayout`, `setTriggerDescription`, `showAlert`.
- Settings come in two flavours. **Action settings** are plain text and are
  included when a Stream Deck profile is exported — never for secrets.
  **Global settings** (`streamDeck.settings`) are plugin-scoped and stored on
  the local machine — this is the sanctioned place for API keys/tokens.
- Dial feedback uses 200x100px layouts: built-ins `$X1` (icon), `$A0` (canvas),
  `$A1` (value), `$B1` (indicator), `$B2` (gradient indicator), `$C1` (double
  indicator), or a custom layout JSON.
- All actions must be registered before calling `streamDeck.connect()`.

### OpenClaw

- The **Gateway** is the single control plane. Default local WebSocket endpoint
  `ws://127.0.0.1:18789`. The Gateway WS protocol is the documented way for
  external apps (scripts, dashboards, IDE extensions) to start runs, stream
  events, and read resources.
- Reference client packages: **`@openclaw/gateway-client`** (Node entry includes
  the `ws` transport) and **`@openclaw/gateway-protocol`** (schemas, types,
  protocol version constants). Both declare Node `>=22.19.0`. Pin exact
  versions. Observed npm dist-tags: `latest` `2026.10.2`, `extended-stable`
  `2026.8.35`. The docs' stable pin at time of writing was `2026.8.1` (wire
  protocol **v4**). Wire version and package version are separate release
  trains; the installed Gateway is `2026.9.3`, so pin a `2026.9.x` client (or
  `2026.10.2` if wire v4 is unchanged) and confirm with a real connect rather
  than trusting the version number.
- **Handshake.** Server sends `connect.challenge` `{ nonce, ts }`. The client
  replies `connect` with `minProtocol: 4`, `maxProtocol: 4`, `role: "operator"`,
  requested `scopes`, `auth` (`token`/`password`, or nothing when the Gateway
  runs `gateway.auth.mode: "none"` on private ingress), and a `device` block
  `{ id, publicKey, signature, signedAt: <challenge.ts>, nonce }`. The signature
  is over the challenge-bound device payload (`buildDeviceAuthPayloadV3` in
  `@openclaw/gateway-client`; binds platform + device family).
- **Pairing.** A new device ID needs approval unless local auto-approval applies
  — and pairing auto-approval is *centred on direct local loopback connects*.
  On rejection the Gateway returns `PAIRING_REQUIRED` with
  `{ requestId, deviceId, waitForResolution }`; the host approves out-of-band
  with `openclaw devices list` then `openclaw devices approve <requestId>`, and
  the client reconnects and persists `hello-ok.auth.deviceToken`.
- **Scopes** we need: `operator.read` (sessions, health/status, usage),
  `operator.write` (chat.send, agent, cron.run), `operator.approvals`
  (list/resolve approvals). We deliberately do **not** request
  `operator.admin` or `operator.pairing`.
- **RPCs of interest** (all over the one socket):
  - `health`, `status`, `diagnostics.stability`
  - `sessions.list` (incl. `activeOnly: true`), `sessions.subscribe`
    (live roster via `sessions.changed` events)
  - `chat.send`, `chat.history`, `sessions.abort`
  - `agent`, `agent.wait` (returns terminal `{ status, startedAt, endedAt }`)
  - `cron.list`, `cron.status`, `cron.runs`, `cron.run`
    (enqueues -> `{ ok, enqueued, runId }`, optional `waitTimeoutMs`)
  - `usage.status` (provider quota windows, e.g. "X% left"), `usage.cost`,
    `sessions.usage`
  - `exec.approval.list`, `exec.approval.resolve`
- **Events**: `health`, `heartbeat`, `presence`, `tick`, `cron`,
  `sessions.changed`, `session.message`, `agent`, `shutdown`,
  `exec.approval.requested`, `exec.approval.resolved`.
- **Not chosen** (kept as documented fallbacks): HTTP hooks
  (`POST /hooks/wake`, `POST /hooks/agent`, bearer token, disabled by default,
  give no status back) and shelling out to the CLI
  (`openclaw gateway call <method> --params '<json>' --json`,
  `openclaw gateway usage-cost --json`, `openclaw status --usage --json`).

### Environment (verified on Cole's machine)

- Node `v26.7.0`, npm `11.19.0`.
- OpenClaw CLI `2026.9.3` on PATH (`C:\nvm4w\nodejs\openclaw.ps1`).
- Gateway **not currently listening** on port 18789 — testing requires starting
  it (`openclaw gateway`).
- Stream Deck CLI not yet installed globally.

## Decisions

Cole delegated the "how"; these are the author's calls, recorded so they can be
checked and overridden.

- **Connect over the Gateway WS protocol via embedded `@openclaw/gateway-client`**,
  rather than HTTP hooks or CLI shell-outs. Only the socket gives live events
  (approval badges, run state, usage) with low latency — which is the whole
  point of the status half of the product.
- **Plugin UUID `com.encrypt.openclaw`**, display name "OpenClaw". Action
  UUIDs are prefixed with it.
- **Scopes** `operator.read`, `operator.write`, `operator.approvals`.
- **Default Gateway URL** `ws://127.0.0.1:18789`, overridable in global settings.
- **Secrets** (Ed25519 device private key, issued device token, optional shared
  Gateway token) live in **global settings**, never action settings.
- **Language/build**: TypeScript + Rollup, exactly as the scaffold produces.
- **Local install only** in v1.
- **v1 action set** listed below.

## Architecture

One Node process (the plugin). Layers:

- `src/plugin.ts` — entry point. Registers every action, then
  `streamDeck.connect()`.
- `src/gateway/` — a singleton **`GatewayService`** that owns the
  `GatewayClient`: connect/reconnect with backoff, a typed `request(method,
  params)` helper, event fan-out, and small cached snapshots (health,
  sessions/roster, cron jobs, usage).
  - `identity.ts` — generate/persist the Ed25519 device identity, sign the
    challenge payload, store/read the device token. (Global-settings-backed.)
  - `events.ts` — publish/subscribe for the action layer.
- `src/actions/` — one class per action, each subscribing to the events it
  needs and updating only its own visible instances
  (`this.actions.forEach(...)`).
- `src/ui/` — one plain HTML/JS property inspector per action, using the
  Stream Deck JS client. No framework.
- `*.sdPlugin/imgs/` + layout JSONs for art and dial feedback.

**Data flow.** Key press -> action handler -> `GatewayService.request(...)` ->
Gateway -> result updates the action's title/image/feedback. Server events ->
`GatewayService` -> subscribed actions update themselves. Presses never block on
a long-running agent turn: they acknowledge, then render progress and the
terminal outcome.

**Pairing UX.** On `PAIRING_REQUIRED`, surface it loudly: key title becomes a
short "PAIR" state, `showAlert()` fires, the log prints the exact
`openclaw devices approve <requestId>` command, and the property inspector shows
connection state with a copy button. The service retries with backoff. On
loopback this may auto-approve and never be seen.

## v1 actions

The plugin ships a **Setup** action plus six control actions.

**Setup** (Key). First-run onboarding wizard, and afterwards a connection light.
Its property inspector walks through: Gateway URL (defaulted to
`ws://127.0.0.1:18789`) with a **Test connection** step; optional shared
token/password; automatic device-identity generation; then the pairing step —
if the Gateway returns `PAIRING_REQUIRED` the wizard shows the exact
`openclaw devices approve <requestId>` command with a Copy button and keeps
retrying until approved; then a done state showing the negotiated role, scopes,
and Gateway version. The key face mirrors the state: Needs setup / Connecting /
Pairing / Ready / Error. Every other action's property inspector shows a
"not configured — open Setup" banner until this completes.

1. **Run Automation** (Key + Encoder). Settings: which cron job (populated live
   from `cron.list`). Press = `cron.run`. Key shows idle / running / ok / failed,
   driven by `cron` events plus `cron.runs` for the returned `runId`. Dial
   variant lets you rotate through a shortlist and push to run, with the last
   result on the touch strip.
2. **Send Prompt** (Key). Settings: target session key + prompt text (+ optional
   queue mode). Press = `chat.send`. Brief flash, then ok / error; no transcript.
3. **Status** (Key + Encoder). Reachability from the socket state + `health`
   (not `presence`, which reports connected devices); plus active-run count from
   `sessions.list { activeOnly: true }`. Key is red/green; dial feedback shows
   active runs and Gateway uptime.
4. **Usage** (Key + Encoder). `usage.status` quota windows ("X% left") and
   `usage.cost`. Key shows the worst-remaining window; dial renders a `$B1`
   gauge with cost in the title.
5. **Approvals** (Key + Encoder). Lights up on `exec.approval.requested`; key
   press = approve, key long-press = deny (`exec.approval.resolve`); dial push =
   approve, dial long touch = deny. Seeds its count from `exec.approval.list` on
   appear.
6. **Stop** (Key). `sessions.abort` for the active/settable session; confirms
   with `showAlert`.

## Phasing

- **Phase 0 (riskiest first):** scaffold; `GatewayService` connect + handshake +
  device identity; the **Setup** wizard and its key; then the **Status** key.
  This proves auth, pairing, and reconnect end-to-end.
- **Phase 1:** **Run Automation** + **Usage** (the two things Cole named).
- **Phase 2:** **Send Prompt**, **Approvals**, **Stop**.
- **Phase 3:** dial layouts, icons, polish.

## Risks / must-verify before or during Phase 0

1. ~~Exact exports of `@openclaw/gateway-client`~~ **Largely resolved.** The
   installed CLI bundle uses the same helpers we need, so the names exist:
   `buildDeviceAuthPayloadV3` / `buildDeviceAuthPayload` (device-auth), and
   `loadOrCreateDeviceIdentity`, `generateStoredDeviceIdentity`,
   `signDevicePayload`, `deriveDeviceIdFromPublicKey`,
   `publicKeyRawBase64UrlFromPem`, `resolveDeviceIdentityStore` (device-identity),
   `loadDeviceAuthToken` / `storeDeviceAuthToken` (device-auth-store);
   `GatewayClientHostDeps` appears in the client bundle. Still to confirm: which
   of these `@openclaw/gateway-client` re-exports vs. expects the host to
   implement — read the published package's typings at Phase 0.
2. ~~Which client version matches wire v4~~ **Resolved:** pin a `2026.9.x`
   client against Gateway `2026.9.3` and prove v4 with a real connect.
3. Whether loopback operator pairing auto-approves on this install, or whether
   the manual `openclaw devices approve` step is always needed.
4. The Stream Deck plugin's Node runtime can load `ws` and `node:crypto`.
5. Tests need a running Gateway; none is up right now.
6. Fallback if pairing/key-storage proves painful: swap `GatewayService`'s
   transport to CLI shell-outs (polling instead of events) without touching the
   action layer.

## Resolved questions (builder check)

Settled here rather than deferred, so the plan can be written from this
document alone.

- **Session targeting.** Sessions are addressed by a `sessionKey`. `sessions.list`
  gives the live roster, `sessions.resolve` canonicalizes a key/label/short-id,
  and `sessions.create` makes a new one. **Send Prompt** and **Stop** take their
  target from a dropdown populated by `sessions.list` (with an optional free-text
  key); an empty target means the default agent's main session. `chat.send`
  targets the resolved key. The **Status** action's active-run count reflects
  session-bound work only: sessionless/internal runs are outside the session
  index, so a sessionless automation run will not appear there.
- **`agent` / `agent.wait` are reserved, not used in v1.** "Repeatable tasks" in
  v1 means *running a defined automation* (`cron.run`) plus conversational sends
  (`chat.send`). A one-shot headless task (`agent` + `agent.wait` for its
  terminal status) is a natural *future* "Ad-hoc Task" action, deliberately out
  of v1. Likewise `chat.history`, `diagnostics.stability`, and `cron.status` are
  listed as available but unused by v1.
- **Device identity is required regardless of auth mode.** Per the auth spec,
  every external operator client includes the signed `device` block; the only
  device-less exceptions are the Gateway's own reserved internal backend path and
  trusted-proxy Control UI auth — neither applies to us. So the Ed25519
  identity/signing/pairing work stays on the Phase 0 critical path. This install's
  `~/.openclaw/openclaw.json` has **no `gateway` block**, so the effective auth
  mode and whether a shared bootstrap token/password is also needed are
  determined at Phase 0 (start the Gateway, inspect `gateway.auth`). A loopback
  client may need no shared secret and still needs its device identity.
- **Approvals is Key + Encoder.** Dial push = approve, long touch = deny; the key
  variant approves on press and denies on long-press (a key-up timer). One action
  with `Controllers: ["Keypad", "Encoder"]`.
- **First-run onboarding IS a v1 deliverable.** The **Setup** action's property
  inspector hosts the wizard described under v1 actions; it writes configuration
  and secrets to global settings and *displays* live connection and pairing
  state, with a Copy button for the `openclaw devices approve <requestId>`
  command. The wizard is self-contained HTML/JS, no framework.
- **`presence` is not Gateway liveness.** It reports connected operator/node
  *devices*. Gateway reachability is the socket's own connected state plus the
  `health` RPC; `presence` is shown only as a secondary "who's connected" readout.

## Left to the builder

- Icon art, key colours, and dial layout JSONs.
- Property inspector styling and exact field set.
- Poll/timeout/backoff constants.
- Internal module names and file split details.
- Whether `Neo`/Infobar gets its own action.
