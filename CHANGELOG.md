# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-21

First public release.

### Added

- Read-first Markdown view with an outline and scrollspy, reading progress, word count and reading time.
- Block editing: double-click any top-level block to edit its Markdown in place.
- Split source editor (`Ctrl+E`) with a live preview and debounced autosave that preserves CRLF/LF line endings.
- Interactive task-list checkboxes that write back to the file.
- Live reload when the file changes on disk; changed blocks are highlighted.
- Browser-style navigation between linked Markdown files with Back/Forward.
- File sidebar for the current folder or Git repository, with a filter.
- Command palette (`Ctrl+K`) for files, headings (`#`) and commands (`>`).
- Settings panel (`Ctrl+,`):
  - 4 light and 5 dark theme presets.
  - 7 accent colours plus a custom colour.
  - Sans, Serif and Mono reading fonts.
  - Adjustable text size and line height.
- Adjustable content width (Narrow, Comfort, Wide, Full or a custom pixel value).
- Wide tables, code and diagrams can expand into free space.
- Resizable sidebar and outline.
- Find in document, focus mode and zoom.
- GFM tables, footnotes, front matter, syntax highlighting, Mermaid diagrams and KaTeX math.
- Single-instance app with per-user NSIS installer and `.md`/`.markdown`/`.mdown`/`.mkd` file associations.
- Remembers window size and position, and paints its first frame in the theme colour.

[Unreleased]: https://github.com/BBguss/noumark/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/BBguss/noumark/releases/tag/v0.1.0
