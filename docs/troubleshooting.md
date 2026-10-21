# Troubleshooting

### Double-clicking a `.md` file still opens another app

Windows requires you to confirm the default app yourself. Right-click a `.md` file and choose **Open with**, then **Choose another app**, then **Noumark**, then **Always**.
If Noumark isn't in the list, reinstall it with the installer. The portable exe doesn't register file associations.

### The window doesn't appear

1. Check Task Manager for `noumark.exe`. If it's there, end it and start Noumark again.
2. Make sure the **Microsoft Edge WebView2 Runtime** is installed (*Settings → Apps → Installed apps*). If it's missing, install it from <https://developer.microsoft.com/microsoft-edge/webview2/>.
3. Delete `%APPDATA%\com.kroombox.noumark\window.json` to reset the saved window position, for example after unplugging a monitor.

If none of that helps, please [open an issue](https://github.com/BBguss/noumark/issues/new/choose) and include your Windows version.

### SmartScreen warns "Windows protected your PC"

Unsigned open-source builds show this warning until they build up reputation. Click **More info**, then **Run anyway**. To be sure of what you're running, build it yourself from source ([building.md](building.md)).

### Images don't show

- Relative paths are resolved from the document's folder: `![](img/a.png)` loads `<doc folder>\img\a.png`.
- Paths with spaces should be URL-encoded (`my%20image.png`) or wrapped in angle brackets (`![](<my image.png>)`).
- Remote images (`https://…`) need an internet connection.

### A Mermaid diagram shows an error

Noumark shows Mermaid's own error message in place of the diagram. Check the syntax with the [Mermaid live editor](https://mermaid.live).

### My edit was replaced by the version on disk

Noumark never reloads while a block edit or save is pending. If another program writes the file *after* your edit was saved, the newer file on disk wins and the changed blocks are highlighted. Use your version control (for example `git diff`) to compare.

### The sidebar doesn't list all files

The sidebar scans the document's Git repository root, or its folder if there's no repository. The scan is limited to 3,000 files and 6 levels deep. It skips hidden folders and `node_modules`, `target`, `dist`, `build`, `vendor`, `__pycache__`, `venv` and `bin`.

### Reset all settings

Open **Settings** (<kbd>Ctrl</kbd>+<kbd>,</kbd>) and click **Reset to defaults**. To wipe everything, including recent files and window position, close Noumark and delete:

- `%APPDATA%\com.kroombox.noumark\`
- `%LOCALAPPDATA%\com.kroombox.noumark\`
