# Repository Guidelines

## Project Structure & Module Organization
- Core source lives in `extension/` and is loaded as the unpacked Chrome extension.
- `background.js` acts as the service worker, managing queues and Chrome API calls.
- `panel.js` and `panel.css` power the side-panel UI; keep shared assets in `extension/assets/` when needed.
- `extension/manifest.json` holds metadata; repository-level docs (README, this guide) stay at the root.

## Build, Test, and Development Commands
- Install locally via `chrome://extensions` → enable **Developer Mode** → **Load unpacked** → select `extension/`.
- Chrome hot-reloads changes; reopen the panel to confirm UI tweaks.
- Manual flow: navigate to `https://grok.com/imagine/favorites`, open the panel, click **Start Download**, and watch progress plus `chrome://extensions/?errors=extension` for diagnostics.

## Coding Style & Naming Conventions
- Use modern JavaScript with 2-space indentation; prefer `const`/`let` and arrow callbacks.
- Keep helpers like `notify`, `prepareQueue`, and `deriveBaseName` pure where feasible.
- CamelCase for variables/functions, kebab-case for asset filenames, and reuse stems from `buildFilename()` so paired media share a base name.

## Testing Guidelines
- No automated harness; rely on manual smoke passes during downloads.
- Confirm detected count matches the progress bar, completed rows increment as files finish, and `grok-favorites/<datetime>/` folders appear in Downloads.
- When editing DOM selectors in `scrapeFavorites()`, toggle the panel debug checkbox to log scroll metrics and capture console output for reviewers.

## Commit & Pull Request Guidelines
- Write imperative commit subjects near 65 characters, e.g., `Streamline download queue handling`.
- Separate documentation-only commits from functional changes when practical.
- Pull requests should summarize manual verification (URL visited, counts, destination paths), attach panel screenshots or GIFs for UI updates, and link related tickets or issues.

## Security & Configuration Tips
- Avoid logging full asset URLs or user identifiers; use `truncate()` to redact sensitive segments.
- Keep downloaded media inside the ignored `grok-favorites/` tree and never commit user data, credentials, or session artifacts.
