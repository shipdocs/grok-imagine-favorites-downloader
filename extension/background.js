const runState = {
  active: false,
  queue: [],
  index: 0,
  results: [],
  runId: 0,
  sessionFolder: '',
  total: 0,
  completed: 0,
  debug: false,
  tabId: null,
  history: [],
  progress: { total: 0, completed: 0 },
};

function resetForPage(tabId) {
  runState.runId += 1;
  runState.active = false;
  runState.queue = [];
  runState.index = 0;
  runState.results = [];
  runState.sessionFolder = '';
  runState.total = 0;
  runState.completed = 0;
  runState.debug = false;
  runState.progress = { total: 0, completed: 0 };
  runState.history = [];
  runState.tabId = tabId ?? runState.tabId;
}

function finalizeRun() {
  runState.active = false;
  runState.queue = [];
  runState.index = 0;
  runState.results = [];
  runState.sessionFolder = '';
  runState.debug = false;
}

function appendHistory(entry) {
  runState.history.push(entry);
  const maxHistory = 500;
  if (runState.history.length > maxHistory) {
    runState.history.splice(0, runState.history.length - maxHistory);
  }
}

function sendStatus(entry) {
  appendHistory(entry);
  const message = {
    type: 'STATUS',
    text: entry.text,
    state: entry.state,
    timestamp: entry.timestamp,
    progress: entry.progress,
  };
  if (runState.tabId != null) {
    chrome.tabs.sendMessage(runState.tabId, message, () => {
      void chrome.runtime.lastError;
    });
  } else {
    chrome.runtime.sendMessage(message, () => {
      void chrome.runtime.lastError;
    });
  }
}

function snapshotProgress(progress) {
  if (progress) {
    const normalized = {
      total: Math.max(0, Number(progress.total) || 0),
      completed: Math.max(0, Number(progress.completed) || 0),
    };
    runState.progress = normalized;
    return { ...normalized };
  }
  if (runState.progress.total || runState.progress.completed) {
    return { ...runState.progress };
  }
  return null;
}

function notify(text, state = 'running', progress) {
  const entry = {
    text,
    state,
    timestamp: Date.now(),
    progress: snapshotProgress(progress),
  };
  sendStatus(entry);
}

function emitDebugLogs(lines) {
  if (!runState.debug || !Array.isArray(lines) || lines.length === 0) {
    return;
  }
  const progressSnapshot = snapshotProgress();
  lines.forEach((line) => {
    if (typeof line === 'string' && line.trim()) {
      sendStatus({
        text: line.trim(),
        state: 'debug',
        timestamp: Date.now(),
        progress: progressSnapshot,
      });
    }
  });
}

async function handleStart(tabId, debugEnabled) {
  if (runState.active) {
    return { status: 'busy' };
  }

  if (!tabId) {
    return { status: 'need_tab' };
  }

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !tab.url || tab.url.startsWith('chrome://')) {
    return { status: 'need_tab' };
  }

  runState.tabId = tabId;
  runState.debug = Boolean(debugEnabled);
  notify('Scanning favorites grid for media…', 'running');
  const favoritesResult = await collectFavorites(tabId).catch((error) => ({
    status: 'error',
    message: error.message || String(error),
    items: [],
  }));

  emitDebugLogs(favoritesResult.debug);

  if (favoritesResult.status === 'not_ready') {
    notify(
      favoritesResult.message ||
        'Favorites grid not detected. Solve verification prompts, reload the page, then try again.',
      'error'
    );
    return {
      status: 'error',
      message: 'Favorites grid not detected. Solve verification prompts, reload the page, then try again.',
    };
  }

  if (!favoritesResult.items || favoritesResult.items.length === 0) {
    notify('Could not locate any downloadable media on this page.', 'error');
    return { status: 'empty' };
  }

  const sessionFolder = createSessionFolderName();
  const preparedQueue = prepareQueue(favoritesResult.items, sessionFolder);
  if (preparedQueue.length === 0) {
    notify('Collected media but failed to prepare download queue.', 'error');
    return { status: 'empty' };
  }

  runState.runId += 1;
  const currentRunId = runState.runId;
  runState.active = true;
  runState.queue = preparedQueue;
  runState.index = 0;
  runState.results = [];
  runState.sessionFolder = sessionFolder;
  runState.total = preparedQueue.length;
  runState.completed = 0;
  snapshotProgress({ total: runState.total, completed: 0 });

  notify(
    `Queued ${runState.queue.length} files for download in ${sessionFolder}.`,
    'running',
    { total: runState.total, completed: 0 }
  );
  void processQueue(currentRunId);

  return { status: 'started', total: runState.queue.length };
}

async function collectFavorites(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: scrapeFavorites,
    args: [runState.debug],
  });
  return result || { status: 'error', message: 'Unknown scrape failure', items: [] };
}

async function processQueue(runId) {
  if (!runState.active || runId !== runState.runId) {
    return;
  }

  if (runState.index >= runState.queue.length) {
    const successes = runState.results.filter((item) => item.success).length;
    const failures = runState.results.length - successes;
    snapshotProgress({ total: runState.total, completed: runState.total });
    notify(`Finished. Success: ${successes}, Failures: ${failures}.`, 'idle');
    finalizeRun();
    return;
  }

  const item = runState.queue[runState.index];
  notify(
    `Downloading ${runState.index + 1} of ${runState.queue.length}…`,
    'running',
    { total: runState.total, completed: runState.completed }
  );

  try {
    const outcome = await downloadAsset(item);
    runState.results.push({ url: item.url, ...outcome });
    if (runId !== runState.runId) {
      return;
    }
    runState.completed += 1;
    const progress = snapshotProgress({ total: runState.total, completed: runState.completed });
    if (outcome.success) {
      notify(`✔ Download queued for ${truncate(item.label || item.filename || item.url)}`, 'running', progress);
    } else {
      notify(
        `✖ Failed for ${truncate(item.label || item.filename || item.url)}: ${outcome.message || 'unknown error'}`,
        'running',
        progress
      );
    }
  } catch (error) {
    runState.results.push({ url: item.url, success: false, message: String(error) });
    runState.completed += 1;
    const progress = snapshotProgress({ total: runState.total, completed: runState.completed });
    notify(
      `✖ Error processing ${truncate(item.label || item.filename || item.url)}: ${error.message || error}`,
      'running',
      progress
    );
  }

  runState.index += 1;
  setTimeout(() => {
    void processQueue(runId);
  }, 350);
}

function downloadAsset(item) {
  return new Promise((resolve) => {
    const options = { url: item.url };
    if (item.filename) {
      options.filename = item.filename;
      options.saveAs = false;
    }

    chrome.downloads.download(options, (downloadId) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, message: chrome.runtime.lastError.message || 'Download API error.' });
        return;
      }
      if (typeof downloadId !== 'number') {
        resolve({ success: false, message: 'Download did not start (no ID returned).' });
        return;
      }
      resolve({ success: true, message: `Download started (ID ${downloadId}).` });
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'CONTENT_READY') {
    const tabId = sender.tab?.id ?? null;
    resetForPage(tabId);
    sendResponse({ ok: true });
    return false;
  }

  if (message?.type === 'REQUEST_STATE') {
    runState.tabId = sender.tab?.id ?? runState.tabId;
    sendResponse({
      history: runState.history,
      progress: runState.progress,
      active: runState.active,
      total: runState.total,
      completed: runState.completed,
    });
    return false;
  }

  if (message?.type === 'START_DOWNLOADS') {
    const tabId = sender.tab?.id ?? null;
    handleStart(tabId, message.debugEnabled)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ status: 'error', message: String(error) }));
    return true;
  }

  return undefined;
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) {
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }, () => {
    void chrome.runtime.lastError;
  });
});

async function scrapeFavorites(debugEnabled = false) {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const mediaSelector = 'img[alt*="Generated image"][src], video[src]';
  const debug = debugEnabled ? [] : null;
  const log = (message) => {
    if (debug && typeof message === 'string') {
      debug.push(message);
    }
  };

  if (!location.href.includes('/imagine')) {
    log('URL missing /imagine segment; aborting scrape.');
    return { status: 'not_ready', items: [], debug };
  }

  const getMainScrollContainer = () => {
    // Find the actual scrollable container with overflow:scroll
    const allDivs = Array.from(document.querySelectorAll('div'));
    const scrollable = allDivs.find(el => {
      const style = getComputedStyle(el);
      const hasScrollOverflow = style.overflowY === 'scroll' || style.overflow === 'scroll';
      const isScrollable = el.scrollHeight > el.clientHeight + 100;
      return hasScrollOverflow && isScrollable;
    });

    return scrollable || null;
  };

  const performHumanScrollStep = (container) => {
    if (!container) return;

    const step = Math.max(280, Math.floor((window.innerHeight || 900) * 0.9));
    const currentScrollTop = container.scrollTop || 0;
    const newScrollTop = Math.min(currentScrollTop + step, container.scrollHeight - container.clientHeight);

    container.scrollTop = newScrollTop;
  };

  const getScrollSnapshot = (container) => {
    if (!container) return { height: 0, scrollTop: 0 };
    return {
      height: container.scrollHeight || 0,
      scrollTop: container.scrollTop || 0
    };
  };

  const ensureGridVisible = async () => {
    const maxTries = 60;
    for (let attempt = 0; attempt < maxTries; attempt += 1) {
      const hasMedia = document.querySelector(mediaSelector);
      const hasGallery = document.querySelector(
        '[data-testid="drop-container"], [data-testid="favorites-scroll"], [data-radix-scroll-area-viewport]'
      );
      log(`ensureGrid attempt ${attempt + 1}: media=${hasMedia ? 'yes' : 'no'}, gallery=${hasGallery ? 'yes' : 'no'}`);
      if (hasMedia) {
        log('Media element detected; grid ready for scraping.');
        return true;
      }
      if (hasGallery) {
        log('Gallery container present but media missing; performing additional scroll.');
        const container = getMainScrollContainer();
        performHumanScrollStep(container);
        await wait(400 + Math.random() * 200);
        continue;
      }
      await wait(250 + Math.random() * 200);
    }
    log('Failed to detect favorites grid after repeated attempts.');
    return false;
  };

  const gridReady = await ensureGridVisible();
  if (!gridReady) {
    return { status: 'not_ready', items: [], debug };
  }

  const scrollContainer = getMainScrollContainer();
  if (!scrollContainer) {
    log('Could not find scrollable container');
    return { status: 'not_ready', items: [], debug };
  }

  log(`Found scroll container: scrollHeight=${scrollContainer.scrollHeight}, clientHeight=${scrollContainer.clientHeight}, scrollTop=${scrollContainer.scrollTop}`);

  // Reset scroll to top
  scrollContainer.scrollTop = 0;
  await wait(300);

  // Collect URLs as we scroll to handle virtual scrolling
  const seenUrls = new Set();
  const collectedItems = [];

  const collectVisibleMedia = () => {
    const mediaNodes = Array.from(document.querySelectorAll(mediaSelector));
    mediaNodes.forEach(node => {
      if (!node || !node.src) return;
      const url = node.currentSrc || node.src;
      if (!url || seenUrls.has(url)) return;

      seenUrls.add(url);
      const kind = node.tagName.toLowerCase() === 'video' ? 'video' : 'image';
      const poster = kind === 'video' ? (node.poster || node.getAttribute('poster') || '') : '';

      // Find the closest container that groups related media (card/article/section)
      const container = node.closest('article, section, [role="article"], div[data-testid*="card"], div[class*="card"]') || node.parentElement;
      const containerId = container ? Array.from(document.body.querySelectorAll('*')).indexOf(container) : -1;

      collectedItems.push({ url, kind, poster, containerId });

      if (collectedItems.length % 50 === 0) {
        log(`Collected ${collectedItems.length} unique media items so far`);
      }
    });
  };

  const maxPasses = 320;
  let stableHeightCount = 0;
  let stableMediaCount = 0;
  let lastSnapshot = getScrollSnapshot(scrollContainer);
  let lastMediaCount = document.querySelectorAll(mediaSelector).length;
  let paginationCycles = 0;

  const tryAdvancePage = async () => {
    const selectors = [
      'button[aria-label*="Next" i]:not([disabled])',
      'button[data-testid*="next" i]:not([disabled])',
      'button[aria-disabled="false"][data-testid*="pagination"]',
      'a[rel="next"]',
    ];
    for (const selector of selectors) {
      const control = document.querySelector(selector);
      if (control) {
        log(`Advancing pagination via selector: ${selector}`);
        control.click();
        await wait(900 + Math.random() * 400);
        return true;
      }
    }
    const fallback = Array.from(document.querySelectorAll('button, a')).find((element) => {
      if (element.disabled || element.getAttribute('aria-disabled') === 'true') {
        return false;
      }
      const label = (element.getAttribute('aria-label') || '').trim();
      const text = (element.textContent || '').trim();
      return /^(next|older|more)$/i.test(label || text) || /^[>›»]+$/.test(text);
    });
    if (fallback) {
      log('Advancing pagination via fallback control.');
      fallback.click();
      await wait(900 + Math.random() * 400);
      return true;
    }
    return false;
  };

  for (let attempt = 0; attempt < maxPasses; attempt += 1) {
    // Collect visible media before scrolling
    collectVisibleMedia();

    performHumanScrollStep(scrollContainer);
    await wait(520 + Math.random() * 320);

    const currentSnapshot = getScrollSnapshot(scrollContainer);
    const currentMediaCount = document.querySelectorAll(mediaSelector).length;
    log(
      `scroll pass ${attempt + 1}: media=${currentMediaCount}, height=${currentSnapshot.height}, scrollTop=${currentSnapshot.scrollTop}, collected=${collectedItems.length}, stableHeight=${stableHeightCount}, stableMedia=${stableMediaCount}`
    );

    if (currentSnapshot.height === lastSnapshot.height && currentSnapshot.scrollTop === lastSnapshot.scrollTop) {
      stableHeightCount += 1;
    } else {
      stableHeightCount = 0;
    }

    if (currentMediaCount === lastMediaCount) {
      stableMediaCount += 1;
    } else {
      stableMediaCount = 0;
    }

    lastSnapshot = currentSnapshot;
    lastMediaCount = currentMediaCount;

    if (currentMediaCount === 0) {
      continue;
    }

    if (stableHeightCount >= 3 && stableMediaCount >= 3) {
      if (paginationCycles < 20) {
        const advanced = await tryAdvancePage();
        if (advanced) {
          paginationCycles += 1;
          stableHeightCount = 0;
          stableMediaCount = 0;
          lastSnapshot = getScrollSnapshot(scrollContainer);
          lastMediaCount = document.querySelectorAll(mediaSelector).length;
          await wait(600 + Math.random() * 300);
          continue;
        }
      }
      break;
    }
  }

  // Final collection pass
  collectVisibleMedia();
  log(`Final collection: ${collectedItems.length} total unique media items`);

  // Now process the collected items to generate proper base names
  if (collectedItems.length === 0) {
    log('No media items were collected during scrolling.');
    return { status: 'not_ready', items: [], debug };
  }

  // Group items by container to pair images and videos
  const containerGroups = new Map();
  collectedItems.forEach((item) => {
    const key = item.containerId;
    if (!containerGroups.has(key)) {
      containerGroups.set(key, []);
    }
    containerGroups.get(key).push(item);
  });

  // Assign sequential group IDs to each container
  let groupCounter = 0;
  const items = [];

  containerGroups.forEach((mediaGroup) => {
    groupCounter += 1;

    mediaGroup.forEach((item) => {
      items.push({
        url: item.url,
        kind: item.kind,
        groupId: groupCounter,
        poster: item.poster || ''
      });
    });
  });

  log(`Processed ${items.length} items into ${groupCounter} groups.`);
  return { status: 'ok', items, debug };
}

function prepareQueue(rawItems, sessionFolder) {
  const usedNames = new Set();
  const typeCounters = { image: 0, video: 0 };

  return rawItems.map((item) => {
    const kind = item.kind === 'video' ? 'video' : item.kind === 'image' ? 'image' : 'other';
    typeCounters[kind] = (typeCounters[kind] || 0) + 1;
    const extension = deriveExtension(kind, item.url);
    const base = `${typeCounters[kind]}-${kind}`;
    const uniqueFilename = ensureUnique(`${base}${extension}`, usedNames);
    usedNames.add(uniqueFilename.toLowerCase());

    return {
      url: item.url,
      kind,
      filename: `${sessionFolder}/${uniqueFilename}`,
      label: uniqueFilename,
    };
  });
}

function deriveExtension(kind, rawUrl) {
  try {
    const url = new URL(rawUrl);
    const lastSegment = url.pathname.split('/').filter(Boolean).pop() || '';
    const extensionMatch = lastSegment.match(/\.[a-z0-9]{2,5}$/i);
    if (extensionMatch) {
      return extensionMatch[0].toLowerCase();
    }
  } catch (_error) {
    /* noop */
  }
  if (kind === 'video') {
    return '.mp4';
  }
  if (kind === 'image') {
    return '.png';
  }
  return '.bin';
}

function ensureUnique(filename, usedNames) {
  const lower = filename.toLowerCase();
  if (!usedNames.has(lower)) {
    return filename;
  }
  const dotIndex = filename.lastIndexOf('.');
  const stem = dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
  const extension = dotIndex > 0 ? filename.slice(dotIndex) : '';
  let counter = 2;
  let candidate = `${stem}-${counter}${extension}`;
  while (usedNames.has(candidate.toLowerCase())) {
    counter += 1;
    candidate = `${stem}-${counter}${extension}`;
  }
  return candidate;
}

function sanitizeBaseName(raw) {
  return (raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96);
}

function createSessionFolderName() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const folder = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `grok-favorites/${folder}`;
}

function truncate(str, max = 64) {
  if (!str || str.length <= max) return str;
  return `${str.slice(0, max - 3)}...`;
}
