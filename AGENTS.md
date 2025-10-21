# Repository Guidelines

## Project Structure & Module Organization
The unpacked Chrome extension lives in `extension/`. `background.js` hosts the service worker and download orchestration. The side-panel UI and styles are split across `panel.js` and `panel.css`, while extension metadata stays in `manifest.json`. Drop shared icons or templates into `extension/assets/` (create the folder if missing); keep documentation such as this guide at the repository root for quick lookup.

## Build, Test, and Development Commands
Load the project through `chrome://extensions`, enable Developer Mode, and choose "Load unpacked" pointing at `extension/`. Chrome hot-reloads when files change. For end-to-end checks, visit `https://grok.com/imagine/favorites`, open the extension panel, and press **Start Download**; monitor progress via the panel counter and `chrome://extensions/?errors=extension`. Confirm media lands under timestamped `grok-favorites/<datetime>/` directories in the Downloads page.

## Coding Style & Naming Conventions
Use modern JavaScript with 2-space indentation. Prefer `const` and `let`, arrow functions for inline callbacks, and early returns for guards. Keep helpers like `notify`, `prepareQueue`, and `deriveBaseName` pure where practical. Name variables and functions in camelCase, assets in kebab-case, and reuse stems from `buildFilename()` so paired media share a base name.

## Testing Guidelines
There is no automated test harness; rely on manual smoke passes. Run a full favorites download, verify the progress bar matches detected items, and ensure completed rows increment as files finish. When adjusting DOM selectors in `scrapeFavorites()`, toggle the panel's debug checkbox so scroll metrics log to the console, and capture relevant console output for review notes.

## Commit & Pull Request Guidelines
Write imperative commit subjects near 65 characters (e.g., `Streamline download queue handling`). Separate documentation-only changes from functional updates when possible. In pull requests, summarize manual verification (URL visited, counts observed, files written), attach side-panel screenshots or GIFs when the UI shifts, and link any issues or support tickets for context.

## Security & Privacy Tips
Never log full asset URLs or user identifiers; rely on the `truncate()` helper to obfuscate sensitive pieces. Ensure downloaded media stays inside the ignored `grok-favorites/` directory tree, and avoid committing user data, credentials, or session artifacts.
