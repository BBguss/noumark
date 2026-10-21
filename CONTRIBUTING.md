# Contributing to Noumark

Thanks for taking the time to contribute! This guide explains how to propose changes and what reviewers look for.

## Ways to contribute

- **Report a bug.** Open an issue using the *Bug report* template. Include the Noumark version (shown in Windows **Settings → Apps → Installed apps**), your Windows version and, if possible, a small Markdown file that reproduces the problem.
- **Suggest a feature.** Open an issue using the *Feature request* template. Describe the problem you're trying to solve before the solution you have in mind.
- **Add a theme.** Themes are small (eight colours). See [docs/themes-and-layout.md](docs/themes-and-layout.md#adding-a-theme).
- **Improve the docs.** Typos, missing steps and better screenshots are all welcome.
- **Write code.** Look for issues labelled `good first issue` or `help wanted`, or comment on an issue before starting larger work so we can agree on the approach.

## Development setup

Requirements: Windows 10/11, Node.js 20+, stable Rust (MSRV 1.77) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/).

```powershell
npm ci
npm run tauri dev
```

`tauri dev` starts Vite with hot reload for the frontend and rebuilds the Rust core when `src-tauri/` changes.
In a debug build, press <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>I</kbd> to open DevTools.

See [docs/architecture.md](docs/architecture.md) for an overview of the code before making larger changes.

## Before you open a pull request

```powershell
npm run build                                  # the frontend must build
cd src-tauri
cargo fmt --check                              # Rust formatting
cargo clippy --all-targets -- -D warnings      # Rust lints
```

Then test your change by hand in `npm run tauri dev`, with both a light and a dark theme. If you touched startup, file handling or the window lifecycle, also test the release build (`npm run tauri build`): open a file by double-clicking it, open a second file while the app is running, then close and reopen the app.

## Pull request guidelines

- Keep each pull request focused on one change. Small PRs get reviewed faster.
- Match the surrounding code style. JavaScript is plain ES modules (no framework), uses 2-space indentation and single quotes. Rust follows `rustfmt` defaults.
- Comments should explain *why*, not *what*.
- Don't add dependencies lightly. Startup speed and binary size are features. Explain in the PR why a new dependency is worth its cost.
- UI changes should include a before/after screenshot.
- Update the documentation and `CHANGELOG.md` (under **Unreleased**) when behaviour changes.
- Use clear commit messages in the imperative mood, for example `Add sepia theme` or `Fix scroll position after reload`.

## Design principles

When in doubt, these guide decisions:

1. **Reading comes first.** Editing features must never get in the way of reading.
2. **Fast or not at all.** Noumark has to feel instant when opening a file.
3. **Never lose user data.** Writes preserve line endings, and an external change never silently overwrites an unsaved edit.
4. **Quiet UI.** Prefer fewer, better options over many toggles.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating, you agree to uphold it.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
