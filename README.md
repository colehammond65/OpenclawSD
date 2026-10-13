# OpenClaw Stream Deck Plugin

Control and monitor a local [OpenClaw](https://openclaw.ai) Gateway from an
Elgato Stream Deck: run automations, send prompts, stop work, approve requests,
and keep live status and usage on the deck.

Plugin UUID: `com.encrypt.openclaw`.

> Status: in development. See `docs/superpowers/specs/` for the design and
> `docs/superpowers/plans/` for the implementation plan.

## Development

```powershell
npm install
npm run build     # bundles src/plugin.ts -> com.encrypt.openclaw.sdPlugin/bin/plugin.js
npm test          # unit tests (no Gateway required)
npm run watch     # rebuild + restart the plugin in the Stream Deck app
```

Requires Node.js 24+ and Stream Deck 7.1+.

## Configuration

Connection settings and the plugin's Ed25519 device identity are stored at
`~/.openclaw-streamdeck/config.json` (never in Stream Deck action settings,
which are exported in profiles). Use the **Setup** action's property inspector
for first-run configuration and pairing.
