# Themes & layout

Everything here is set in **Settings** (<kbd>Ctrl</kbd>+<kbd>,</kbd>). Changes apply immediately and are remembered.
Most options are also available as palette commands: press <kbd>Ctrl</kbd>+<kbd>K</kbd> and type `>theme`, `>accent`, `>width` or `>font`.

![Settings panel](assets/screenshot-settings.png)

## Mode

| Mode | Behaviour |
|---|---|
| **Auto** | Follows the Windows app mode (*Settings → Personalisation → Colours*) and switches live when you change it. |
| **Light** | Always uses your light theme. |
| **Dark** | Always uses your dark theme. |

<kbd>Ctrl</kbd>+<kbd>T</kbd> cycles through the three modes.

## Theme presets

You pick one light theme **and** one dark theme. Auto mode switches between them.

| Light | Character |
|---|---|
| **Paper** *(default)* | Soft off-white, neutral grey text |
| **Snow** | Pure white, crisp contrast |
| **Sepia** | Warm cream, gentle on the eyes for long reads |
| **Mist** | Cool blue-grey |

| Dark | Character |
|---|---|
| **Graphite** *(default)* | Neutral charcoal |
| **Midnight** | Deep blue-black, similar to GitHub dark |
| **Nord** | Muted arctic blue-grey |
| **Ember** | Warm brown-black |
| **Black** | True black, ideal for OLED screens |

## Accent colour

The accent colours links, the active heading in the outline, checkboxes, selection and the progress bar.
There are seven built-in accents: Violet *(default)*, Blue, Teal, Green, Amber, Rose and Slate. Each has a tuned shade for light and dark themes.
Click the rainbow swatch to pick **any custom colour**.

## Typography

| Setting | Range | Notes |
|---|---|---|
| Font | Sans · Serif · Mono | Sans is Segoe UI Variable, Serif is Sitka Text / Georgia, Mono is Cascadia Code / Consolas |
| Text size | 13 – 22 px | The base size before zoom |
| Line height | 1.40 – 2.10 | 1.75 is the default |

Zoom (<kbd>Ctrl</kbd>+<kbd>+</kbd>/<kbd>-</kbd>) is applied on top of the text size and also scales the content width.

## Content width

The content width is the maximum width of the text column. Long lines are hard to read, so the text column has a limit. You choose the limit:

| Preset | Width |
|---|---|
| Narrow | 680 px |
| Comfort *(default)* | 880 px |
| Wide | 1120 px |
| Full | all available space |

Drag the slider for any width from 560 px to 1600 px. Moving it to the far right selects **Full**.
You can also use <kbd>Ctrl</kbd>+<kbd>[</kbd> / <kbd>Ctrl</kbd>+<kbd>]</kbd> to step by 80 px, or click the width label in the status bar to cycle the presets.

### Wide tables, code and diagrams

With **Let wide tables, code & diagrams use the free space** turned on (the default), a block that's wider than the text column expands evenly into the empty space on both sides, up to the edge of the window. Wide tables then show all their columns, instead of scrolling inside a narrow box while the margins stay empty. Blocks that fit the column aren't affected.

## Panels

- Drag the **inner edge** of the files sidebar (180–520 px) or the outline (160–440 px) to resize it.
- **Double-click** the edge to restore the default width.
- <kbd>Ctrl</kbd>+<kbd>B</kbd> and <kbd>Ctrl</kbd>+<kbd>\\</kbd> show or hide them.
- The outline hides itself automatically when the window is narrower than 1100 px, and the sidebar when it's narrower than 760 px.

## Reset

**Reset to defaults** at the bottom of the settings panel restores every appearance and layout option. Your zoom level and recent files are kept.

---

## Adding a theme

Themes live in [`src/theme.js`](../src/theme.js). A preset is just eight colours. Borders, hover states, panels and accent tints are all derived from them in `style.css` with `color-mix()`.

```js
export const DARK = {
  // …
  forest: {
    name: 'Forest',
    bg: '#0f1512',       // window background
    surface: '#161e1a',  // cards, popovers, inputs
    surface2: '#1d2722', // table headers, secondary surfaces
    text: '#e4ede7',     // headings and strong text
    text2: '#c3cfc7',    // body text
    muted: '#8a998f',    // secondary UI text
    faint: '#56645b',    // placeholders, list markers
    code: '#131a16',     // code block background
  },
};
```

Add the preset to `LIGHT` or `DARK`, and it shows up in the settings panel and the command palette automatically.

Checklist for a good theme:

- Body text (`text2` on `bg`) should reach a contrast ratio of at least **7:1**, and `muted` at least **4.5:1**.
- Check that every accent stays readable on it, in both the settings panel and a document with links and checkboxes.
- Look at [`examples/showcase.md`](../examples/showcase.md), which covers code, tables, quotes, Mermaid and math.
- Include a screenshot in your pull request.
