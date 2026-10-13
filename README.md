# OpenClaw Stream Deck Plugin

Control and monitor a local [OpenClaw](https://openclaw.ai) Gateway from an
Elgato Stream Deck: run automations, send prompts, stop work, approve exec
requests, and keep live status and usage on the deck.

Plugin UUID: `com.encrypt.openclaw`.

Design: `docs/superpowers/specs/2026-10-13-openclaw-streamdeck-plugin-design.md`
Plan: `docs/superpowers/plans/2026-10-13-openclaw-streamdeck-plugin.md`

## Prerequisites

- A running OpenClaw Gateway. On a config without `gateway.mode` the Gateway
  refuses to start; either set it (`openclaw config set gateway.mode local`) or
  start it explicitly:
  ```powershell
  openclaw gateway --allow-unconfigured
  ```
- Stream Deck 7.1 or newer (Node 24 ships with the app; nothing to install).
- The plugin requests `operator.read`, `operator.write` and
  `operator.approvals` — nothing more.

## Install (development)

```powershell
npm install
npm run build
npx @elgato/cli link com.encrypt.openclaw.sdPlugin
npx @elgato/cli dev                      # a newly linked plugin needs dev mode
npx @elgato/cli restart com.encrypt.openclaw
```

The plugin then appears under the **OpenClaw** category. Remove it with
`npx @elgato/cli unlink com.encrypt.openclaw`.

## First run

1. Drag **Setup** onto a key and open its settings panel.
2. Enter the Gateway URL (default `ws://127.0.0.1:18789`).
3. Choose the authentication the Gateway is running with:
   - **None** — the Gateway was started with `--auth none`.
   - **Shared token** — the default. Paste the token (`openclaw gateway
     auth-token` reveals the configured one; `openclaw config set
     gateway.auth.token <token>` sets a stable one).
   - **Password** — when the Gateway uses `gateway.auth.mode=password`.
4. **Save + test connection**. The key face follows the state: `Not connected`,
   `Connecting`, `PAIR`, `Ready`, `Error`.

If the Gateway asks for approval, the panel shows the exact commands to run on
the Gateway host (`openclaw devices list`, then `openclaw devices approve
<requestId>`) with a Copy button. On a loopback connection the Gateway
auto-approves, so this is usually only seen for remote Gateways.

## Actions

| Action | What it does |
| --- | --- |
| **Setup** | Onboarding wizard and connection light. |
| **Status** | Red when the Gateway is unreachable, green when healthy, blue with an active-run count while work is in flight. |
| **Run Automation** | Runs a chosen automation immediately (`cron.run`), and shows that job's last outcome. |
| **Usage** | Worst provider quota window, or today's spend when there is no quota (local models have none). |
| **Send Prompt** | Sends a fixed prompt to a session (`chat.send`) and flashes Sent / Failed. |
| **Approvals** | Lights up on an exec approval request. Short press approves once, long press (>700 ms) denies. |
| **Stop** | Aborts the run in flight (`sessions.abort`), targeting the busiest session. |

Dials (Stream Deck + / + XL) are implemented for Status, Run Automation and
Usage; they are inert on decks without encoders (for example a Stream Deck Neo).

## Where state lives

`~/.openclaw-streamdeck/config.json` holds the Gateway URL, the authentication
choice, the plugin's Ed25519 device identity and the issued device token. It is
deliberately **outside** Stream Deck action settings, which are plain text and
travel with exported profiles. Override the location with the
`OPENCLAW_SD_CONFIG_DIR` environment variable.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Key shows `DOWN` | The Gateway is not reachable. Start it, then check `openclaw gateway status --require-rpc`. |
| Key shows `PAIR` | The Gateway wants this device approved: `openclaw devices approve <requestId>` (the Setup panel shows it). |
| `unauthorized: gateway token mismatch` | The token in Setup does not match the Gateway's. Re-copy it, or start the Gateway with `--auth none` and choose **None**. |
| `device metadata change pending approval` | The plugin's requested scopes or caps changed since it was paired. Approve the device again. |
| Nothing updates | Re-open **Setup** to confirm `Ready`; usage and cost refresh at most once per 30 s. |
| Plugin will not start after `link` | Run `npx @elgato/cli dev`, then restart the plugin — the app caches its plugin registry. |

Plugin logs: `com.encrypt.openclaw.sdPlugin/logs/`. Gateway connection state is
logged there as `[gateway] connected (Gateway <version>)` and friends.

## Development

```powershell
npm run build       # bundle src/plugin.ts -> com.encrypt.openclaw.sdPlugin/bin/plugin.js
npm run watch       # rebuild and restart the plugin in the app
npm test            # unit tests (no Gateway or device needed)
npm run typecheck   # tsc --noEmit (includes tests)
npm run icons       # regenerate the flat-colour PNGs (status faces, plugin icons)
npm run test:live   # integration test against a running Gateway
```

`npm run test:live` skips unless `RUN_LIVE=1`. It connects with the stored
identity, then checks `sessions.list`, `cron.list`, `usage.status`,
`usage.cost` and `exec.approval.list` against real payloads. Set
`OPENCLAW_SD_TEST_TOKEN` to exercise the shared-token path, and
`OPENCLAW_SD_CONFIG_DIR` to run it against your real stored identity.

## Not in v1

No chat transcript, no device pairing administration, no remote-Gateway fleet
management, no channel/messaging actions, and no marketplace packaging.
