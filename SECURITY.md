# Security Policy

## Supported versions

Security fixes are released for the latest minor version only.

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅        |

## Reporting a vulnerability

**Don't open a public issue for security problems.**

Report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/BBguss/noumark/security/advisories/new).
Include:

- a description of the issue and its impact,
- steps to reproduce it, ideally with a minimal Markdown file,
- the Noumark version and your Windows version.

You'll get an acknowledgement within 3 working days. We'll keep you informed while we work on a fix and credit you in the release notes, unless you'd rather stay anonymous.

## Security model

Noumark renders Markdown, which can contain HTML, from files you open. The design assumes that a document can be hostile:

- **Sanitised output.** All rendered HTML passes through [DOMPurify](https://github.com/cure53/DOMPurify). Scripts, event handlers and inline `style` attributes are removed.
- **Content Security Policy.** The webview only runs the app's own scripts (`script-src 'self'`), so injected inline scripts can't execute.
- **Mermaid** runs with `securityLevel: 'strict'`.
- **Restricted IPC.** The frontend can only call the commands listed in `src-tauri/src/main.rs` and the permissions in `src-tauri/capabilities/default.json`.
- **External links.** `open_external` only opens `http(s)://`, `mailto:` and `ms-settings:` URLs, or files that exist. Arbitrary protocol handlers aren't launched.
- **Local images.** Relative image paths are served through Tauri's asset protocol so documents can show images that sit next to them. The asset scope is not limited to a folder, because documents commonly reference images elsewhere on disk. A document can therefore *display* local image files, but it can't read their contents back or send them anywhere, because scripts don't run.

If you find a way around any of these protections, please report it as described above.
