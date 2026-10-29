# Sidak

Sidak (Indonesian: *inspeksi mendadak*, a surprise inspection) is a personal PR-review board. It lists the pull requests
waiting on me, and one click starts a Claude Code review of a PR in a visible cmux terminal, with my own review memory
and checklist. The review lands on GitHub as an ordinary pull-request review; nothing else is left on the PR.

Two front ends share one page:

- `manifest.json`, `panel.html`, `panel.js`, `pr.js`, `background.js`: a Chrome/Arc extension.
- `app/Sidak.swift`: a macOS menu-bar app that loads the same page in a popover, draws a battery-style gauge of the
  review backlog, posts a notification when a review finishes, and ticks the auto-review mode. `app/build.sh` builds it.

`bin/` holds the shell side, symlinked into `~/bin`:

- `ccreview-host`: native-messaging host the extension talks to.
- `claude-review-open`: turns `ccreview://`, `ccfix://`, `ccmerge://`, `ccnudge://`, `ccready://`, `ccopen://` and
  `ccset://` URLs into actions.
- `claude-review`: checks the PR out in a worktree and runs the review interactively.
- `pr-board`: the counts for the menu bar and the auto-review tick.

`state.json`, `settings.json`, `handoffs/` and `token.txt` are live data and stay out of git. Paths, the GitHub org and
my login are hard-coded: this is a one-person tool.

`node check.js` is the self-test; it prints `ok`.
