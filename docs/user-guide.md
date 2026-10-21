# User guide

This guide walks through everything Noumark does, in the order you're likely to need it.
For a compact list of keys, see [keyboard-shortcuts.md](keyboard-shortcuts.md).

- [Opening files](#opening-files)
- [Reading](#reading)
- [Editing](#editing)
- [Navigating between documents](#navigating-between-documents)
- [The command palette](#the-command-palette)
- [Finding text](#finding-text)
- [Customising the look](#customising-the-look)
- [Supported Markdown](#supported-markdown)
- [Where Noumark stores its data](#where-noumark-stores-its-data)

## Opening files

There are several ways to open a document:

- **Double-click** a `.md`, `.markdown`, `.mdown` or `.mkd` file in File Explorer, once Noumark is the default app (see below).
- **Drag and drop** a file onto the window.
- Press <kbd>Ctrl</kbd>+<kbd>O</kbd> or click **Open file** on the start screen.
- Pick a file from **Recent** on the start screen.
- Run `noumark.exe path\to\file.md` from a terminal.

Noumark runs as a **single instance**. Opening another file while it's running shows that file in the existing window instead of starting a second copy.

### Making Noumark the default Markdown app

The installer registers Noumark for Markdown files. For your safety, Windows still asks you to confirm the default app once:

1. Right-click any `.md` file and choose **Open with**, then **Choose another app**.
2. Select **Noumark**, then click **Always**.

The **Set as default** button on the start screen, and the palette command *Set Noumark as default Markdown app*, open the matching page in Windows Settings.

## Reading

When a document opens, you see:

- **The title bar**, with the file name and a save indicator (*Editing…*, *Saved*).
- **The files sidebar** on the left (<kbd>Ctrl</kbd>+<kbd>B</kbd>). It lists every Markdown file in the document's Git repository. If the file isn't in a repository, it lists the files in the document's folder. Type in the filter box to narrow the list.
- **The outline** on the right (<kbd>Ctrl</kbd>+<kbd>\\</kbd>). It lists the document's headings and highlights the one you're reading. Click a heading to jump to it.
- **The reading progress bar**, a thin line under the title bar.
- **The status bar**, with the file path, word count, reading time, zoom, content width and mode.

### Live reload

Noumark watches the open file. When another program changes it, such as `git pull`, a code generator, an AI agent or another editor, the document re-renders in place. The blocks that changed briefly glow so you can see what's new. Your scroll position is kept.

If you're in the middle of editing a block when the file changes, Noumark waits until you finish, so your edit is never overwritten.

### Focus mode

Press <kbd>Ctrl</kbd>+<kbd>.</kbd> to hide the side panels and title bar controls and dim everything except the block in the middle of the screen. Press <kbd>Esc</kbd> to leave focus mode.

### Zoom

<kbd>Ctrl</kbd>+<kbd>+</kbd> / <kbd>Ctrl</kbd>+<kbd>-</kbd>, or <kbd>Ctrl</kbd>+mouse wheel, zooms the document between 60% and 200%. <kbd>Ctrl</kbd>+<kbd>0</kbd> resets it. Zoom scales the text and the content width together, so line lengths stay comfortable.

## Editing

Noumark saves automatically. There's no unsaved state to lose and no save dialog. The file keeps its original line endings (CRLF or LF).

### Block editing

**Double-click** any paragraph, heading, list, table, quote or code block. Only that block turns into an editor showing its Markdown source.

- <kbd>Ctrl</kbd>+<kbd>Enter</kbd> saves the block and renders it again.
- <kbd>Esc</kbd> discards your changes to the block.
- Clicking elsewhere also saves the block.
- <kbd>Tab</kbd> inserts two spaces.

This is the fastest way to fix a typo or update a table without losing your place.

### Source editor

Press <kbd>Ctrl</kbd>+<kbd>E</kbd> (or the pencil button) to open the full source in a split view, with the rendered document beside it. The preview updates as you type, and the file is saved 0.6 s after you stop typing.

- <kbd>Ctrl</kbd>+<kbd>B</kbd> / <kbd>Ctrl</kbd>+<kbd>I</kbd> wraps the selection in `**bold**` / `*italic*`.
- <kbd>Ctrl</kbd>+<kbd>S</kbd> saves immediately. You rarely need it.
- <kbd>Ctrl</kbd>+<kbd>E</kbd> returns to reading.

### Task lists

Click a checkbox in a task list (`- [ ]` / `- [x]`) to toggle it. The change is written straight to the file.

## Navigating between documents

Links behave like a browser:

| Link | What happens |
|---|---|
| `[Setup](./setup.md)` | Opens `setup.md` in the same window |
| `[Install](./setup.md#install)` | Opens it and scrolls to the *Install* heading |
| `[Top](#introduction)` | Scrolls within the current document |
| `[Setup](./setup)` (no extension) | Opens `setup.md` if it exists |
| `https://…`, `mailto:` | Opens in your default browser or mail app |
| `./diagram.pdf`, other files | Opens with the default app for that file type |

Go **back** and **forward** with <kbd>Alt</kbd>+<kbd>←</kbd> / <kbd>Alt</kbd>+<kbd>→</kbd>, the arrow buttons in the title bar, or the side buttons on your mouse. Each document remembers its scroll position.

## The command palette

<kbd>Ctrl</kbd>+<kbd>K</kbd> (or <kbd>Ctrl</kbd>+<kbd>P</kbd>) opens the palette. It uses fuzzy matching, so `instgd` finds `install-guide.md`.

| Type | To search |
|---|---|
| *(anything)* | Files in the sidebar, then matching headings and commands |
| `#` … | Headings in the current document |
| `>` … | Commands, such as themes, fonts, widths, panels and *Reveal in File Explorer* |

<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> opens the palette directly in command mode.
Use <kbd>↑</kbd>/<kbd>↓</kbd> to move, <kbd>Enter</kbd> to run and <kbd>Esc</kbd> to close.

## Finding text

<kbd>Ctrl</kbd>+<kbd>F</kbd> opens the find bar. If you've selected some text, it's used as the search term. Every match is highlighted.
<kbd>Enter</kbd> / <kbd>Shift</kbd>+<kbd>Enter</kbd> jumps to the next / previous match, and <kbd>Esc</kbd> closes the bar.

## Customising the look

Open **Settings** with <kbd>Ctrl</kbd>+<kbd>,</kbd> or the sliders button in the title bar. You can choose:

- the mode (Auto follows Windows, or always Light / Dark),
- a light theme and a dark theme,
- an accent colour or any custom colour,
- the reading font, text size and line height,
- the content width, and whether wide tables and code may use the free space beside the text.

Drag the inner edge of the sidebar or outline to resize it, and double-click the edge to reset it.

All of this is covered in detail in [themes-and-layout.md](themes-and-layout.md).

## Supported Markdown

Noumark uses [markdown-it](https://github.com/markdown-it/markdown-it) (CommonMark), with:

- GitHub-style **tables**, **task lists**, ~~strikethrough~~ and automatic links
- **Footnotes** (`[^1]`)
- **YAML front matter**, shown as a small metadata card
- **Syntax highlighting** for common languages, plus PowerShell, Dockerfile and Nginx
- **Mermaid** diagrams in ```` ```mermaid ```` code blocks
- **KaTeX** math: `$inline$` and `$$display$$`
- Inline HTML such as `<kbd>`, `<details>` and `<mark>`, sanitised for safety
- Images relative to the document, for example `![](./img/shot.png)`

See [`examples/showcase.md`](../examples/showcase.md) for a document that uses all of these.

## Where Noumark stores its data

| What | Where |
|---|---|
| Window size and position, last background colour | `%APPDATA%\com.kroombox.noumark\window.json` |
| Preferences, recent files | WebView2 local storage in `%LOCALAPPDATA%\com.kroombox.noumark\` |

Uninstalling through Windows Settings removes the app. Delete the two folders above to remove your settings too.
