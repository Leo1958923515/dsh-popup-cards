# Security policy

## Supported versions

The latest published minor version receives fixes. Configuration keys and the
card layout are internal; nothing here is a public API contract.

## Reporting a vulnerability

Open a private security advisory on GitHub
(<https://github.com/Leo1958923515/dsh-popup-cards/security/advisories/new>)
or email `1958923515@qq.com`. Please do not open a public issue for a reported
vulnerability before a fix is available.

## Threat model (what this plugin can and cannot do)

- **Local only.** No network calls, no telemetry, no update channel.
- **No credentials.** The plugin never reads tokens, credentials or session
  storage.
- **Rendered content is limited.** The card shows the session title and a fixed
  kind label. Tool arguments, file paths from tool calls, and message bodies are
  never rendered.
- **It cannot approve anything.** Dismissing a card has no effect on the pending
  request; approval still happens inside DSH.
- **PowerShell is the rendering engine.** A card is a hidden `powershell.exe`
  running a script generated in `buildScript()`. The title and type are inserted
  as PowerShell single-quoted literals with `'` doubled; there is no string
  concatenation of untrusted input into the script body.
- **Window activation is heuristic.** Click-to-focus finds a window whose title
  matches `dshWindowTitleMarker`. A malicious window could adopt that title, but
  the only consequence is that it gets focused — no data is sent anywhere.

If you believe any of the above is wrong, that is exactly the kind of report
worth sending privately.
