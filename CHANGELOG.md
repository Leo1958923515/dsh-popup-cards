# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.5] - 2026-10-28

First release of `dsh-popup-cards`, based on
[`dsh-popup-notify`](https://github.com/yiumanlenong/dsh-popup-notify) 0.1.4 by
yiumanlenong (MIT). The event integration comes from upstream; the presentation
and the interaction model are new.

### Added

- DSH-styled card: dark `#2C2C2E` panel, 12 px radius, 1 px `#1FFFFFFF` border,
  soft shadow, 160 ms fade-in, fixed to the bottom-right corner of the primary
  display's work area (24 px above the taskbar).
- Card body intentionally limited to two facts — task name (session title) and
  confirmation type — plus a small configurable hint line.
- Click-to-focus: clicking the card brings the DSH window to the front (restoring
  it if minimised) and then closes the card.
- Close button: a top-right `×` closes the card without switching back to DSH.
- Auto-close on return: while a card is open the foreground window is polled
  (default 400 ms); coming back to DSH closes the card by itself.
- Foreground suppression: no card while the DSH window is already in front.
- `durationMs` for toast-style auto-dismiss (`0` keeps the card until clicked).
- `title`, `testOnStart` and `traceFile` self-test/diagnostic switches.

### Changed

- Replaced the `MessageBox` used by upstream with a WPF `Window` (same
  `powershell.exe` + `-EncodedCommand` transport).
- Sound is off by default and is now a single toggle.
- Removed the upstream message-template options (`approvalMessage`,
  `approvalReasonSuffix`, `questionMessage`, `questionCountSuffix`,
  `planReviewMessage`, `completeMessage`, `completeReasonSuffix`,
  `projectSuffix`, `plainDialog`): the card no longer renders message bodies.
- Hint text defaults to `点击回到 DSH`.

### Fixed

- Approvals no longer silently skip the plugin when the DSH Web bridge answers
  first: the `approval/request` listener is registered with `prepend` and still
  calls `next()`, preserving fail-closed behaviour.
- The card's border no longer renders pale yellow (WPF colours are
  `#AARRGGBB`; the border uses `#1FFFFFFF`, not `#FFFFFF1F`).

## [0.1.4] — upstream

MessageBox-based notifications for approvals, questions, plan reviews and run
completion. See the upstream
[repository](https://github.com/yiumanlenong/dsh-popup-notify) for its history.
