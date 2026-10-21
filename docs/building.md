# Building Noumark

Noumark is a [Tauri 2](https://tauri.app) app. The Rust core is in `src-tauri/`, and the frontend (Vite, plain JavaScript) is in the repository root.
You can build it natively on Windows, or cross-compile the Windows installer from Linux.

- [Native build on Windows](#native-build-on-windows)
- [Cross-compiling from Linux](#cross-compiling-from-linux)
- [Building on a remote Linux machine](#building-on-a-remote-linux-machine)
- [Icons](#icons)
- [Releasing](#releasing)

## Native build on Windows

### Prerequisites

1. **Microsoft C++ Build Tools.** Install *Desktop development with C++* from the [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).
2. **Rust**, stable, version 1.77 or newer, from <https://rustup.rs>.
3. **Node.js 20+**.
4. **WebView2.** It's preinstalled on Windows 11.

The full, up-to-date list is in [Tauri's prerequisites guide](https://tauri.app/start/prerequisites/).

### Commands

```powershell
npm ci                 # install frontend dependencies and the Tauri CLI
npm run tauri dev      # development: hot reload, DevTools with Ctrl+Shift+I
npm run tauri build    # release build + installer
```

Release outputs:

| File | Description |
|---|---|
| `src-tauri/target/release/noumark.exe` | The app, which also works as a portable executable |
| `src-tauri/target/release/bundle/nsis/Noumark_<version>_x64-setup.exe` | The per-user installer, with file associations |

## Cross-compiling from Linux

Tauri can produce the Windows installer from Linux using [`cargo-xwin`](https://github.com/rust-cross/cargo-xwin), which downloads the MSVC CRT and Windows SDK, and NSIS.
The following steps are tested on Ubuntu 24.04.

```bash
# system packages
sudo apt install -y clang lld llvm nsis

# Rust target and tools
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin

# Node 20+ (any method), then:
npm ci
npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc
```

Outputs are written under `src-tauri/target/x86_64-pc-windows-msvc/release/`.

> Cross-compiled installers aren't code-signed. Windows SmartScreen may show a warning on first run. See [Releasing](#releasing).

## Building on a remote Linux machine

If your Windows machine has no build tools, `scripts/build-remote.sh` builds on a Linux host over SSH. It sends the sources, cross-compiles, and copies the installer and a portable exe back to `./release`:

```bash
# from Git Bash / WSL, with SSH key access to the host
./scripts/build-remote.sh user@build-host
# or
NOUMARK_BUILD_HOST=user@build-host ./scripts/build-remote.sh
```

The host needs the tools from [Cross-compiling from Linux](#cross-compiling-from-linux), with the Tauri CLI installed through Cargo (`cargo install tauri-cli --version "^2"`).
`NOUMARK_REMOTE_DIR` changes the working directory on the host. It defaults to `~/noumark-build`.

## Icons

All icons are generated from [`app-icon.svg`](../app-icon.svg):

```bash
npx tauri icon app-icon.svg
```

This writes `src-tauri/icons/`. Commit the desktop icons (`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.ico`, `icon.png`).

## Releasing

1. Update the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.
2. Move the **Unreleased** notes in `CHANGELOG.md` under the new version.
3. Commit, then tag and push:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
4. The [release workflow](../.github/workflows/release.yml) builds on `windows-latest` and creates a **draft** GitHub release with the installer and the portable exe attached. Review the notes, then publish it.

### Code signing (optional)

Unsigned builds work, but SmartScreen warns about them until they build up reputation. To sign releases, see [Tauri's Windows signing guide](https://tauri.app/distribute/sign/windows/). You can add the certificate as repository secrets and reference them in `release.yml`.
