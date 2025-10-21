# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Chrome Manifest V3 extension that downloads all media (images and videos) from a user's Grok Imagine favorites page. The extension runs entirely in the browser, leveraging the user's logged-in session to bypass authentication challenges.

## Development Workflow

### Loading the extension
1. Navigate to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `extension/` directory
4. Chrome hot-reloads files automatically on save

### Testing
- Navigate to `https://grok.com/imagine/favorites`
- Solve any verification prompts until the favorites grid is visible
- Click the extension icon to open the side panel
- Press **Start Download** and verify:
  - Progress bar increments correctly
  - Status log shows detailed metrics (enable debug checkbox for verbose output)
  - Files download to `grok-favorites/<timestamp>/` folder structure
- Check `chrome://extensions/?errors=<extension-id>` for runtime errors
- Verify downloads in `chrome://downloads/`

## Architecture

### Component Structure

**[background.js](extension/background.js)** - Service worker (background script)
- Maintains global download state in `runState` object
- Orchestrates the download workflow: scraping → queue preparation → sequential downloads
- Communicates with content script via Chrome messaging API
- Handles Chrome downloads API interactions

**[panel.js](extension/panel.js)** - Content script
- Injects side panel UI into the Grok favorites page
- Manages panel visibility and user interactions
- Displays real-time download progress and status history
- Forwards user actions to background service worker

**[panel.css](extension/panel.css)** - Panel styling
- Fixed right-side panel (340px width)
- Dark theme matching Grok's aesthetic
- Includes progress bar, status log, and control buttons

### Key Workflows

**Download session initialization** ([background.js:110-178](extension/background.js#L110-L178)):
1. User clicks "Start Download" in panel
2. `handleStart()` validates tab state and enables debug mode if requested
3. Executes `scrapeFavorites()` in page context via `chrome.scripting.executeScript`
4. Converts scraped items to download queue with unique filenames
5. Creates timestamped session folder name
6. Begins sequential download processing

**Scraping algorithm** ([background.js:306-676](extension/background.js#L306-L676)):
- Polls for favorites grid visibility with 40 attempts max
- Scrolls progressively (85% of viewport height per step) to trigger lazy-loading
- Detects pagination controls and advances pages automatically (max 20 cycles)
- Stops when both page height and media count stabilize for 3+ consecutive checks
- Groups media elements by container (card/article/section) to pair images with videos
- Derives base filenames from UUID extraction or URL path stems

**Queue processing** ([background.js:189-242](extension/background.js#L189-L242)):
- Downloads one asset at a time with 350ms delay between items
- Uses Chrome downloads API with pre-computed filenames
- Tracks progress and updates panel UI via `sendStatus()` messaging
- Handles failures gracefully, continuing to next item
- Finalizes run state when queue exhausts

### State Management

The service worker maintains session state in `runState` object:
- `active`: Whether a download session is running
- `queue`: Array of download items with URLs and filenames
- `sessionFolder`: Timestamped folder path for current session
- `history`: Rolling log of status messages (max 500 entries)
- `progress`: `{total, completed}` for UI display
- `debug`: Whether debug logging is enabled

Panel state syncs via message passing:
- `REQUEST_STATE`: Panel requests current state on open
- `STATUS`: Background pushes status updates to panel
- `START_DOWNLOADS`: User initiates download session
- `CONTENT_READY`: Panel signals page load/refresh (resets state)

### Helper Functions

**Filename handling**:
- `deriveBaseName()` ([background.js:521-546](extension/background.js#L521-L546)): Extracts UUID or path stem from asset URLs, falls back to sequential numbering
- `sanitizeBaseName()` ([background.js:736-743](extension/background.js#L736-L743)): Strips invalid filename characters, max 96 chars
- `ensureUnique()` ([background.js:719-734](extension/background.js#L719-L734)): Appends `-2`, `-3` etc. to avoid filename collisions
- `deriveExtension()` ([background.js:699-717](extension/background.js#L699-L717)): Parses extension from URL, defaults to `.mp4` / `.png` / `.bin`

**Status notifications**:
- `notify()` ([background.js:83-91](extension/background.js#L83-L91)): Sends user-facing status with optional progress
- `emitDebugLogs()` ([background.js:93-108](extension/background.js#L93-L108)): Batch-sends debug lines when debug mode enabled
- `sendStatus()` ([background.js:48-66](extension/background.js#L48-L66)): Low-level message dispatcher with history tracking

## Code Style

- Modern JavaScript: `const`/`let`, arrow functions, early returns
- 2-space indentation
- Descriptive variable names (camelCase for locals, kebab-case for assets)
- Pure helper functions where possible
- User-facing messages via `notify()` system

## Debugging Tips

- Enable **debug checkbox** in panel for verbose scroll/pagination/DOM selection logs
- Check content script console (`DevTools > Console` on active tab) for in-page errors
- Review service worker logs at `chrome://extensions/?errors=<extension-id>`
- When DOM selectors break, verify against live favorites page structure (see `mediaSelector` and pagination selectors in `scrapeFavorites()`)
- Use `truncate()` helper to avoid leaking full asset URLs in logs
