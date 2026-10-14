# Stream Deck 7.6 property-inspector crash (investigation record)

**Status:** app-side bug; reported to Elgato (draft in this file). Our plugin is a
trigger, not the cause. Workaround documented in `README.md`.

## Summary

Stream Deck **7.6.0.23012** (Qt 6.11.1, Windows 11 10.0.26300) crashes in its UI
thread with a **null-pointer dereference** while creating the property inspector
(a panel) for a plugin action, when **that plugin was restarted earlier in the
same app session**. The crash destroys the app; it auto-restarts about 20 s
later. Nothing in the plugin's pages, manifest or JS executes before the crash:
the fault happens ~11 ms after the app logs that it began creating the view.

## Evidence

### The two fatal crashes (both after a plugin restart in the same session)

| # | When | Type | Last log line from the app | Dump |
| --- | --- | --- | --- | --- |
| A | 2026-10-14 18:56:43 | `0xc0000409` in `Qt6Core.dll` | `UI … createDetailView  Show PI for 'com.encrypt.openclaw.status'` at 18:56:24 | Sentry `884a60d0-…dmp` (0 bytes — empty) |
| B | 2026-10-14 20:08:38 | `0xc0000005`, address `0x0`, UI thread `31456` | same line, at 20:08:38.319 (crash 11 ms later) | `Sentry/reports/5cfd01ef-25f4-446e-e9c3-330369de70b8.dmp` (7.3 MB, sentry-native 0.13.1) |

Crash B was parsed with a minidump reader (`tools/`-adjacent, see
`docs/notes/minidump.md`): `MINIDUMP_EXCEPTION_STREAM` says exception
`0xc0000005` (ACCESS_VIOLATION) at address `0x0` — a null dereference — on the
same thread id the app logs its UI work under. Live memory in the dump contains
Chromium/WebEngine GPU-context crash keys (`gpu-url-chunk`,
`gpu-gl-context-is-virtual`, `gr-context-type`, `GaneshGL`) next to the
`file:///C:/Users/coled/Repositories/OpenclawSD/com.encrypt.openclaw.sdPlugin/ui/setup.html`
URL — i.e. the app was in WebEngine view/GPU-context setup for a page belonging
to the plugin being re-opened.

### The pattern (all 4 observations fit)

| App session | Plugin started | Panels created | Plugin restarted | Panels after the restart |
| --- | --- | --- | --- | --- |
| 25436 (10-14 09:28 → 10:36) | 09:42 | none | 8× (09:48 → 10:23) | none → **no crash** |
| 21168 (10-14 10:42 → 18:56) | 10:42:36 | 10:43:46 `openclaw.setup` — OK | 16:50:07 (`Plugin deleted`) | 18:56:24 `openclaw.status` → **crash A** |
| 44444 (10-14 18:57 → 20:08) | 18:57:49 | 19:31:43 `openclaw.status` — OK | 19:43:55 (`Plugin deleted`) | 20:08:38 `openclaw.status` → **crash B** |
| 37244 (10-14 20:09 →) | 20:09:25 | none | none | — |

Control: in session 17416 (2026-10-13) the **AgentDeck** plugin's panels were
created eight times in one session with no prior restart, and the app survived —
so "the second panel in a session" is not by itself the trigger.

The restarts in the table were `npx @elgato/cli restart com.encrypt.openclaw`,
i.e. the app's own deep link `streamdeck://plugins/restart/<uuid>` →
`ESDCustomPluginHost::abort  [com.encrypt.openclaw] Aborting with reason 'Plugin
deleted'`. Both produce `Close PI for ''` (the app destroying a panel it can no
longer name, because the owning plugin is gone) immediately afterwards.

### What was ruled out

- **The plugin's pages.** The same `ui/connection.html` panel loaded and worked
  in the same session that later crashed (19:31:43 → verified live over CDP:
  title, 378×197, live state text, three working buttons). Crash B happens 11 ms
  into view creation — before any page script can run.
- **The manifest.** The crash reproduced with four different manifest shapes: a
  plugin-level inspector and per-action inspectors; a `Status` action with and
  without an `Encoder` block. (Both anomalies were still worth removing for
  hygiene, and were: see commit `4f121f3`.)
- **Our Node code.** It runs in a separate process; the app's faulting thread is
  the app's own UI thread, and the app never even sent `willAppear` for the
  crashing creations (our plugin log is silent around both).

### Not yet determined

- Whether *any* plugin's panel re-created after that plugin was restarted
  crashes the app (our plugin is the only one that was restarted with a panel in
  this log history). Test: open a plugin's panel, `npx @elgato/cli restart
  <that-plugin>`, open the panel again.
- Whether the trigger needs the panel of the restarted plugin to have existed
  before the restart, or only the restart itself.

## Repro

1. Start Stream Deck.
2. Click any action of a plugin so its panel (property inspector) is shown.
3. Restart that plugin while the app stays running: `npx @elgato/cli restart
   <uuid>`, or update/reinstall the plugin, or let the app restart it.
4. Click that plugin's action again → the app dies (null deref, dump in
   `%APPDATA%\Elgato\StreamDeck\Sentry\reports`).

Workaround: restart the Stream Deck app after restarting/updating a plugin, or
avoid re opening that plugin's panel in the same session.

## Report to Elgato (draft)

> **Stream Deck 7.6.0.23012 crashes (null deref) when a plugin's property
> inspector is re-created after that plugin was restarted**
>
> Environment: Windows 11 Pro 10.0.26300, Stream Deck 7.6.0.23012 (Qt 6.11.1).
> Dump: `…\Sentry\reports\5cfd01ef-25f4-446e-e9c3-330369de70b8.dmp`
> (7.3 MB, sentry-native 0.13.1). Exception stream: `0xc0000005`, address `0x0`,
> thread `31456` (the UI thread the app logs under).
>
> Repro: open a plugin action's panel; restart that plugin with
> `npx @elgato/cli restart <uuid>` (→ `ESDCustomPluginHost::abort … 'Plugin
> deleted'`); click the same action again. The app dies while logging
> `ESDPropertyInspector::createDetailView  Show PI for '<that action>'` — 11 ms
> after the log line, before the page loads. A second crash the same day
> (18:56:43) was `0xc0000409` in `Qt6Core.dll` right after the same log line in
> the same situation.
>
> In the crash dump, Chromium/WebEngine GPU-context crash keys
> (`gpu-url-chunk`, `gr-context-type`, `GaneshGL`) sit next to the plugin's
> `file:///…/ui/setup.html` URL, suggesting the destroyed panel's WebEngine
> view/GPU context is still referenced when the next view for that plugin is
> created.
>
> Control: the first panel creation for that plugin in a session is always fine,
> and another plugin's (AgentDeck) panels were created eight times in one
> session without a restart and the app survived.
