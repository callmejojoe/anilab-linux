const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// Tracks which show's detail panel is currently open so it can be refreshed
let _openDetail = null; // { anime, episodes }

// Set of anime IDs currently in the library — kept in sync with every renderLibrary() call
let _libraryAnimeIds = new Set();


// ── Tauri API wrappers ────────────────────────────────────────────────────────

async function searchAnime(query) {
  try {
    return await invoke("search_anime", { query });
  } catch (err) {
    console.error("[AniLab] search_anime error:", err);
    return [];
  }
}

async function scanFolder(folderPath) {
  try {
    return await invoke("scan_folder", { folderPath });
  } catch (err) {
    console.error("[AniLab] scan_folder error:", err);
    return [];
  }
}

async function matchAnime(files) {
  try {
    return await invoke("match_anime", { files });
  } catch (err) {
    console.error("[AniLab] match_anime error:", err);
    return [];
  }
}

async function saveToLibrary(entries) {
  try {
    await invoke("save_to_library", { entries });
  } catch (err) {
    console.error("[AniLab] save_to_library error:", err);
  }
}

async function getLibrary() {
  try {
    return await invoke("get_library");
  } catch (err) {
    console.error("[AniLab] get_library error:", err);
    return [];
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function showToast(msg, duration = 2800) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => toast.classList.add("hidden"), duration);
}

// ── In-app video player ───────────────────────────────────────────────────────

/**
 * Open the coffee-themed fullscreen video player.
 *
 * @param {string}  src       - Direct video URL (mp4) or HLS playlist (.m3u8).
 * @param {string}  title     - Title shown in the control bar.
 * @param {boolean} isHls     - When true, loads via hls.js.
 * @param {object}  [context] - Optional context for Prev/Next navigation:
 *                              { showId, allEpisodes, currentEp, mode }
 */
function openVideoPlayer(src, title = "", isHls = false, context = null) {
  document.getElementById("anilab-player-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "anilab-player-overlay";
  overlay.style.cssText = [
    "position:fixed", "inset:0", "z-index:9999",
    "background:rgba(44,26,14,0.95)",
    "display:flex", "flex-direction:column",
    "justify-content:center", "align-items:center",
    "gap:0",
    "backdrop-filter:blur(8px)",
    "-webkit-backdrop-filter:blur(8px)",
  ].join(";");

  // ── Control bar ────────────────────────────────────────────────────────────
  const bar = document.createElement("div");
  bar.style.cssText = [
    "width:82%",
    "background:#E8D5B0",
    "color:#2C1A0E",
    "display:flex",
    "justify-content:space-between",
    "align-items:center",
    "padding:8px 14px",
    "border-radius:12px 12px 0 0",
    "font-family:Inter,sans-serif",
    "font-size:0.88rem",
    "font-weight:600",
    "letter-spacing:0.01em",
    "flex-shrink:0",
  ].join(";");

  const barLeft = document.createElement("div");
  barLeft.style.cssText = "display:flex;align-items:center;gap:10px;overflow:hidden;";

  const label = document.createElement("span");
  label.textContent = title || "Now Playing";
  label.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

  barLeft.appendChild(label);

  // Quality selector dropdown — populated after HLS manifest is parsed.
  // Shown for all HLS streams; hidden for direct mp4 fallback.
  const qualitySelector = document.createElement("select");
  qualitySelector.id = "quality-selector";
  qualitySelector.style.cssText = [
    "background:#C49A6C",
    "color:#2C1A0E",
    "border:none",
    "border-radius:6px",
    "padding:4px 8px",
    "font-weight:700",
    "font-size:0.78rem",
    "font-family:Inter,sans-serif",
    "outline:none",
    "cursor:pointer",
    "display:none", // revealed once manifest levels are known
  ].join(";");
  barLeft.appendChild(qualitySelector);

  const btnGroup = document.createElement("div");
  btnGroup.style.cssText = "display:flex;gap:8px;flex-shrink:0;";

  function makeBarBtn(text, titleAttr) {
    const b = document.createElement("button");
    b.textContent = text;
    b.title = titleAttr;
    b.style.cssText = [
      "background:#2C1A0E", "color:#E8D5B0", "border:none",
      "border-radius:6px", "padding:4px 10px", "cursor:pointer",
      "font-size:0.78rem", "font-weight:600", "font-family:Inter,sans-serif",
      "transition:opacity 0.15s",
    ].join(";");
    b.onmouseenter = () => b.style.opacity = "0.75";
    b.onmouseleave = () => b.style.opacity = "1";
    return b;
  }

  const pipBtn   = makeBarBtn("PiP",   "Picture-in-Picture");
  const dlBtn    = makeBarBtn("Download", "Download stream");
  const closeBtn = makeBarBtn("Close", "Close player");

  // Prev / Next — only rendered when a navigation context is provided
  const prevBtn = context ? makeBarBtn("\u2039 Prev", "Previous episode") : null;
  const nextBtn = context ? makeBarBtn("Next \u203a", "Next episode")     : null;

  if (prevBtn) btnGroup.appendChild(prevBtn);
  if (nextBtn) btnGroup.appendChild(nextBtn);
  btnGroup.append(pipBtn, dlBtn, closeBtn);
  bar.append(barLeft, btnGroup);

  // ── Video element ──────────────────────────────────────────────────────────
  const video = document.createElement("video");
  video.controls = true;
  video.style.cssText = [
    "width:82%",
    "max-height:78vh",
    "border-radius:0 0 12px 12px",
    "box-shadow:0 24px 64px rgba(44,26,14,0.7),0 4px 16px rgba(0,0,0,0.5)",
    "background:#000",
    "display:block",
  ].join(";");

  // ── HLS.js initialisation ───────────────────────────────────────────────────
  let hlsInstance = null;

  function initVideo() {
    const isHlsUrl = src.includes(".m3u8");
    if (isHlsUrl && typeof Hls !== "undefined" && Hls.isSupported()) {
      hlsInstance = new Hls();
      hlsInstance.loadSource(src);
      hlsInstance.attachMedia(video);

      // LEVEL_LOADED fires after hls.levels is fully populated — safer than MANIFEST_PARSED
      // for sources where the level list may still be empty at manifest parse time.
      let qualityPopulated = false;
      hlsInstance.on(Hls.Events.LEVEL_LOADED, (_evt, _data) => {
        if (qualityPopulated) return; // guard: only populate once
        qualityPopulated = true;
        const levels = hlsInstance.levels;
        qualitySelector.innerHTML = '<option value="-1">Auto</option>';
        if (levels && levels.length > 1) {
          levels.forEach((level, index) => {
            const option = document.createElement("option");
            option.value = index;
            option.textContent = level.height ? `${level.height}p` : `Level ${index}`;
            qualitySelector.appendChild(option);
          });
          qualitySelector.style.display = "";
          qualitySelector.addEventListener("change", (e) => {
            hlsInstance.currentLevel = parseInt(e.target.value, 10);
          });
        }
      });

      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      hlsInstance.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) showToast(`HLS error: ${data.type}`);
      });
    } else {
      // Fallback: native playback for mp4 or browsers with native HLS support
      video.src = src;
      video.play().catch(() => {});
    }
  }

  // Dynamically inject hls.js only once, then initialise
  if (!document.getElementById("hlsjs-script")) {
    const script = document.createElement("script");
    script.id  = "hlsjs-script";
    script.src = "https://cdn.jsdelivr.net/npm/hls.js@latest";
    script.onload = initVideo;
    script.onerror = () => {
      showToast("Could not load HLS.js — falling back to native playback.");
      video.src = src;
      video.play().catch(() => {});
    };
    document.body.appendChild(script);
  } else {
    // Script already loaded from a previous player session
    initVideo();
  }

  // ── Behaviour ──────────────────────────────────────────────────────────────
  function closePlayer() {
    video.pause();
    video.src = "";
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    overlay.remove();
    document.removeEventListener("keydown", onKeyDown);
  }

  pipBtn.addEventListener("click", () => {
    if (document.pictureInPictureEnabled && !video.disablePictureInPicture) {
      video.requestPictureInPicture().catch(err => showToast(`PiP failed: ${err.message}`));
    } else {
      showToast("Picture-in-Picture is not supported in this context.");
    }
  });

  // Prev / Next navigation — resolve the adjacent episode's stream URL and reopen the player.
  async function navigateEpisode(direction) {
    if (!context) return;
    const { showId, allEpisodes, currentEp, mode } = context;
    const idx = allEpisodes.indexOf(currentEp);
    const nextIdx = idx + direction;
    if (nextIdx < 0 || nextIdx >= allEpisodes.length) {
      showToast(direction < 0 ? "Already at the first episode." : "Already at the last episode.");
      return;
    }
    const targetEp = allEpisodes[nextIdx];
    closePlayer();
    try {
      const qualities = await invoke("get_stream_url", { showId, episode: targetEp, mode });
      const chosen = await pickQuality(qualities);
      if (!chosen) return;
      const newCtx = { showId, allEpisodes, currentEp: targetEp, mode };
      openVideoPlayer(chosen.url, `${title.split(" — ")[0]} — Episode ${targetEp}`, chosen.isHls ?? false, newCtx);
    } catch (err) {
      showToast(`Could not load episode ${targetEp}: ${err}`);
    }
  }

  if (prevBtn) prevBtn.addEventListener("click", () => navigateEpisode(-1));
  if (nextBtn) nextBtn.addEventListener("click", () => navigateEpisode(+1));

  dlBtn.addEventListener("click", async () => {
    dlBtn.disabled = true;
    const oldHtml = dlBtn.innerHTML;
    dlBtn.textContent = "Started";
    try {
      const parts = title.split(" — ");
      const safeTitle = (parts[0] || "Unknown").replace(/[/\\:*?"<>|]/g, "_");
      const epRaw = parts[1] ? parts[1].replace("Episode ", "") : "Unknown";
      const savePath = `~/Videos/AniLab/${safeTitle}/Episode_${epRaw}_auto.mp4`;
      
      const dlId = await invoke("record_download", {
        animeId: context ? context.showId : null,
        title: safeTitle,
        episode: epRaw,
        savePath
      });
      
      if (typeof window.incrementActiveDownloads === "function") {
        window.incrementActiveDownloads(safeTitle);
      }
      
      invoke("download_episode", { url: src, outputPath: savePath, downloadId: dlId }).catch(err => {
        showToast(`Download task error: ${err}`);
      });
      showToast(`Download started in background.`);
    } catch (err) {
      showToast(`Download init error: ${err}`);
    } finally {
      setTimeout(() => {
        dlBtn.disabled = false;
        dlBtn.innerHTML = oldHtml;
      }, 2000);
    }
  });

  closeBtn.addEventListener("click", closePlayer);
  // Disabled background click-to-close to prevent native <select> menus
  // from accidentally dismissing the player when clicked outside.

  function onKeyDown(e) {
    if (e.key === "Escape") closePlayer();
    if (e.key === "ArrowLeft")  navigateEpisode(-1);
    if (e.key === "ArrowRight") navigateEpisode(+1);
  }
  document.addEventListener("keydown", onKeyDown);

  // Record history
  if (context) {
    recordHistory(context.showId, title.split(" — ")[0], context.currentEp.toString(), "stream").catch(()=>0);
  } else {
    recordHistory(null, title, "", "stream").catch(()=>0);
  }

  overlay.append(bar, video);
  document.body.appendChild(overlay);
}


// ── Quality picker modal ──────────────────────────────────────────────────────

/**
 * Show a coffee-themed quality-selection modal if there are multiple options.
 * Resolves with the chosen { resolution, url } object, or null if dismissed.
 * If only one quality exists, resolves immediately without showing UI.
 */
function pickQuality(qualities) {
  return new Promise(resolve => {
    if (!qualities || qualities.length === 0) { resolve(null); return; }
    // Single quality (usually adaptive HLS) — skip modal, mark as HLS so badge appears
    if (qualities.length === 1) {
      resolve({ ...qualities[0], isHls: qualities[0].url?.includes(".m3u8") });
      return;
    }

    const backdrop = document.createElement("div");
    backdrop.style.cssText = [
      "position:fixed", "inset:0", "z-index:10000",
      "background:rgba(44,26,14,0.6)",
      "backdrop-filter:blur(4px)",
      "display:flex", "align-items:center", "justify-content:center",
    ].join(";");

    const modal = document.createElement("div");
    modal.style.cssText = [
      "background:#E8D5B0",
      "border-radius:14px",
      "padding:28px 32px",
      "min-width:280px",
      "max-width:380px",
      "box-shadow:0 20px 60px rgba(44,26,14,0.45)",
      "font-family:Inter,sans-serif",
      "color:#2C1A0E",
    ].join(";");

    const heading = document.createElement("p");
    heading.textContent = "Select Quality";
    heading.style.cssText = "font-size:1rem;font-weight:700;margin:0 0 6px;";

    const sub = document.createElement("p");
    sub.textContent = "Choose your preferred stream quality to continue.";
    sub.style.cssText = "font-size:0.8rem;opacity:0.65;margin:0 0 18px;";

    const list = document.createElement("div");
    list.style.cssText = "display:flex;flex-direction:column;gap:8px;";

    function cleanup() { backdrop.remove(); }

    for (const q of qualities) {
      const btn = document.createElement("button");
      btn.textContent = q.resolution || "Auto";
      btn.style.cssText = [
        "background:#2C1A0E", "color:#E8D5B0",
        "border:none", "border-radius:8px",
        "padding:10px 16px", "cursor:pointer",
        "font-size:0.9rem", "font-weight:600",
        "font-family:Inter,sans-serif",
        "text-align:left", "transition:opacity 0.15s",
      ].join(";");
      btn.onmouseenter = () => btn.style.opacity = "0.78";
      btn.onmouseleave = () => btn.style.opacity = "1";
      btn.addEventListener("click", () => { cleanup(); resolve(q); });
      list.appendChild(btn);
    }

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    cancelBtn.style.cssText = [
      "background:transparent", "color:#2C1A0E",
      "border:1.5px solid rgba(44,26,14,0.3)",
      "border-radius:8px", "padding:8px 16px",
      "cursor:pointer", "font-size:0.85rem",
      "font-family:Inter,sans-serif", "margin-top:10px",
      "width:100%", "transition:background 0.15s",
    ].join(";");
    cancelBtn.onmouseenter = () => cancelBtn.style.background = "rgba(44,26,14,0.08)";
    cancelBtn.onmouseleave = () => cancelBtn.style.background = "transparent";
    cancelBtn.addEventListener("click", () => { cleanup(); resolve(null); });

    modal.append(heading, sub, list, cancelBtn);
    backdrop.appendChild(modal);
    backdrop.addEventListener("click", e => { if (e.target === backdrop) { cleanup(); resolve(null); } });
    document.body.appendChild(backdrop);
  });
}

function statusClass(status) {
  if (!status) return "status-default";
  if (status === "FINISHED")  return "status-FINISHED";
  if (status === "RELEASING") return "status-RELEASING";
  return "status-default";
}

function coverImg(url, cls = "card-cover") {
  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.className = cls;
    img.loading = "lazy";
    return img;
  }
  const ph = document.createElement("div");
  ph.className = cls === "card-cover" ? "card-cover-placeholder" : "detail-cover-placeholder";
  ph.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>`;
  return ph;
}

// ── Card builders ─────────────────────────────────────────────────────────────

function buildLibraryCard(anime, episodes) {
  const card = document.createElement("div");
  card.className = "anime-card";
  card.dataset.animeId = anime.anime_id ?? "";

  card.appendChild(coverImg(anime.cover_image));

  const body = document.createElement("div");
  body.className = "card-body";

  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = anime.title || anime.folder_path?.split("/").filter(Boolean).pop() || "Unknown";

  const watchedCount = episodes.filter(e => e.watched).length;
  const totalCount   = episodes.length;

  const meta = document.createElement("div");
  meta.className = "card-meta";
  meta.textContent = `${totalCount} episode${totalCount !== 1 ? "s" : ""}` +
    (anime.episodes ? ` of ${anime.episodes}` : "");

  const badge = document.createElement("span");
  badge.className = `status-badge ${statusClass(anime.status)}`;
  badge.textContent = anime.status || "UNKNOWN";

  body.append(title, meta, badge);

  // Watched progress bar (only when there are file-backed episodes)
  if (totalCount > 0) {
    const progressWrap = document.createElement("div");
    progressWrap.className = "progress-wrap";
    const bar = document.createElement("div");
    bar.className = "progress-bar";
    bar.style.width = `${Math.round((watchedCount / totalCount) * 100)}%`;
    const label = document.createElement("span");
    label.className = "progress-label";
    label.textContent = watchedCount > 0 ? `${watchedCount}/${totalCount} watched` : "";
    progressWrap.append(bar, label);
    body.appendChild(progressWrap);
  }

  card.appendChild(body);
  card.addEventListener("click", () => openLibraryDetail(anime, episodes));
  return card;
}

function buildSearchCard(anime) {
  const card = document.createElement("div");
  card.className = "anime-card";

  const titleText = anime.title?.english || anime.title?.romaji || "Unknown";
  card.appendChild(coverImg(anime.coverImage?.large));

  const body = document.createElement("div");
  body.className = "card-body";

  const title = document.createElement("div");
  title.className = "card-title";
  title.textContent = titleText;

  const meta = document.createElement("div");
  meta.className = "card-meta";
  meta.textContent = anime.episodes ? `${anime.episodes} episodes` : "Episodes: —";

  const badge = document.createElement("span");
  badge.className = `status-badge ${statusClass(anime.status)}`;
  badge.textContent = anime.status || "UNKNOWN";

  body.append(title, meta, badge);
  card.appendChild(body);

  const inLibrary = _libraryAnimeIds.has(anime.id);
  const addBtn = document.createElement("button");
  addBtn.className = "card-add-btn";
  addBtn.dataset.animeId = anime.id;
  addBtn.textContent = inLibrary ? "✓ Added" : "+ Add to Library";
  addBtn.disabled = inLibrary;
  addBtn.addEventListener("click", async () => {
    addBtn.disabled = true;
    addBtn.textContent = "Saving…";
    await saveToLibrary([{
      file_path: "",
      anime_id: anime.id,
      title: titleText,
      cover_image: anime.coverImage?.large ?? null,
      episodes: anime.episodes ?? null,
      status: anime.status ?? null,
      episode_number: null,
    }]);
    showToast(`"${titleText}" added to library.`);
    addBtn.textContent = "✓ Added";
    await renderLibrary(); // updates _libraryAnimeIds
    refreshSearchButtons();
  });

  card.appendChild(addBtn);
  return card;
}

// ── Library view ──────────────────────────────────────────────────────────────

async function renderLibrary() {
  const grid = document.getElementById("library-grid");
  const countBadge = document.getElementById("library-count");
  const empty = document.getElementById("library-empty");

  grid.innerHTML = "";
  const rows = await getLibrary();

  // Group by anime_id; for unmatched entries (anime_id null) group by folder_path
  const groups = new Map();
  for (const row of rows) {
    const key = row.anime_id != null ? `id:${row.anime_id}` : `folder:${row.folder_path}`;
    if (!groups.has(key)) {
      const meta = { ...row };
      if (row.anime_id == null) {
        meta.title = row.folder_path
          ? row.folder_path.split("/").filter(Boolean).pop() ?? "Unknown Folder"
          : "Unknown Folder";
      }
      groups.set(key, { meta, episodes: [] });
    }
    if (row.episode_file) {
      groups.get(key).episodes.push(row);
    }
  }

  const shows = [...groups.values()];

  _libraryAnimeIds = new Set(
    rows.filter(r => r.anime_id != null).map(r => r.anime_id)
  );

  countBadge.textContent = `${shows.length} show${shows.length !== 1 ? "s" : ""}`;

  if (shows.length === 0) {
    grid.appendChild(empty);
    return;
  }

  // Split into local (has episode files) vs online-only (added from search, no files)
  const localShows  = shows.filter(({ episodes }) => episodes.length > 0);
  const onlineShows = shows.filter(({ episodes }) => episodes.length === 0);

  function makeSectionHeader(text, count) {
    const h = document.createElement("div");
    h.className = "library-section-header";
    h.style.cssText = [
      "width:100%", "grid-column:1/-1",
      "display:flex", "align-items:center", "gap:10px",
      "padding:6px 0 4px",
      "border-bottom:1.5px solid rgba(255,255,255,0.07)",
      "margin-bottom:4px",
    ].join(";");
    const label = document.createElement("span");
    label.style.cssText = "font-size:0.78rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--accent);";
    label.textContent = text;
    const badge = document.createElement("span");
    badge.style.cssText = "font-size:0.72rem;background:rgba(255,255,255,0.07);color:var(--text-muted);border-radius:10px;padding:1px 8px;";
    badge.textContent = count;
    h.append(label, badge);
    return h;
  }

  if (localShows.length > 0) {
    grid.appendChild(makeSectionHeader("Local Storage", localShows.length));
    for (const { meta, episodes } of localShows) {
      grid.appendChild(buildLibraryCard(meta, episodes));
    }
  }

  if (onlineShows.length > 0) {
    grid.appendChild(makeSectionHeader("Online Tracking", onlineShows.length));
    for (const { meta, episodes } of onlineShows) {
      grid.appendChild(buildLibraryCard(meta, episodes));
    }
  }
}

// ── Search view ───────────────────────────────────────────────────────────────

let _searchTimer = null;

// Refresh add-button states on currently visible search cards
function refreshSearchButtons() {
  document.querySelectorAll("#search-grid .card-add-btn[data-anime-id]").forEach(btn => {
    const id = Number(btn.dataset.animeId);
    const inLib = _libraryAnimeIds.has(id);
    btn.disabled = inLib;
    btn.textContent = inLib ? "\u2713 Added" : "+ Add to Library";
  });
}

function initSearch() {
  const input  = document.getElementById("search-input");
  const grid   = document.getElementById("search-grid");
  const empty  = document.getElementById("search-empty");

  input.addEventListener("input", () => {
    clearTimeout(_searchTimer);
    const q = input.value.trim();
    if (!q) {
      grid.innerHTML = "";
      grid.appendChild(empty);
      return;
    }
    _searchTimer = setTimeout(async () => {
      grid.innerHTML = "";
      const results = await searchAnime(q);
      if (!results || results.length === 0) {
        const none = document.createElement("div");
        none.className = "empty-state";
        none.innerHTML = `<span class="empty-icon"><svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="15" x2="16" y2="15"></line><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg></span><p>No results for "${q}".</p>`;
        grid.appendChild(none);
        return;
      }
      for (const anime of results) {
        grid.appendChild(buildSearchCard(anime));
      }
    }, 500);
  });
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function openLibraryDetail(anime, episodes) {
  _openDetail = { anime, episodes };
  _renderDetailContent(anime, episodes);
  document.getElementById("detail-panel").classList.remove("hidden");
  document.getElementById("detail-overlay").classList.remove("hidden");
}

function _renderDetailContent(anime, episodes) {
  const content = document.getElementById("detail-content");
  const titleText = anime.title || "Unknown Title";
  content.innerHTML = "";

  content.appendChild(
    anime.cover_image
      ? (() => { const img = document.createElement("img"); img.src = anime.cover_image; img.alt = ""; img.className = "detail-cover"; return img; })()
      : (() => { const ph = document.createElement("div"); ph.className = "detail-cover-placeholder"; ph.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>`; return ph; })()
  );

  const title = document.createElement("div");
  title.className = "detail-title";
  title.textContent = titleText;

  const meta = document.createElement("div");
  meta.className = "detail-meta";
  const badge = document.createElement("span");
  badge.className = `status-badge ${statusClass(anime.status)}`;
  badge.textContent = anime.status || "UNKNOWN";
  const epCount = document.createElement("span");
  epCount.textContent = anime.episodes ? `${anime.episodes} episodes total` : "";
  meta.append(badge, epCount);

  content.append(title, meta);

  if (episodes.length > 0) {
    const listLabel = document.createElement("div");
    listLabel.style.cssText = "font-weight:600;font-size:0.9rem;color:var(--accent);margin-bottom:10px;";
    listLabel.textContent = "Files in library";
    const ul = document.createElement("ul");
    ul.className = "episode-list";

    for (const ep of episodes) {
      const li = document.createElement("li");
      li.className = ep.watched ? "episode-item episode-item--watched" : "episode-item";

      const num = document.createElement("span");
      num.className = "episode-num";
      num.textContent = ep.episode_number != null ? `#${ep.episode_number}` : "—";

      const file = document.createElement("span");
      file.className = "episode-file";
      file.title = ep.episode_file || "";
      file.textContent = ep.episode_file ? ep.episode_file.split("/").pop() : "(no file)";

      const watched = document.createElement("span");
      watched.className = "episode-watched";
      if (ep.watched) {
        watched.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        watched.title = "Watched";
      }

      const playBtn = document.createElement("button");
      playBtn.className = "play-btn";
      playBtn.title = "Play in mpv";
      playBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
      playBtn.disabled = !ep.episode_file;
      playBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          await invoke("play_episode", { filePath: ep.episode_file });
          recordHistory(anime.anime_id, anime.title, ep.episode_number?.toString() || "", "local mpv").catch(()=>0);
        } catch (err) {
          showToast(`Could not open mpv: ${err}`);
        }
      });

      li.append(num, file, watched, playBtn);
      ul.appendChild(li);
    }
    content.append(listLabel, ul);
  } else {
    const noFiles = document.createElement("div");
    noFiles.className = "no-files-state";
    noFiles.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="2rem" height="2rem" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
      <p>No local files linked.</p>
      <p class="no-files-sub">Go to Settings and scan a folder to import episodes.</p>
    `;
    content.appendChild(noFiles);
  }

  // ── Stream Online section (only for AniList-matched shows) ────────────────
  if (anime.anime_id != null && anime.title) {
    const streamSection = document.createElement("div");
    streamSection.className = "stream-section";

    const streamHeader = document.createElement("div");
    streamHeader.className = "stream-header";
    streamHeader.innerHTML = `
      <span class="stream-header-label">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:5px"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
        Stream Online
      </span>
      <button class="stream-expand-btn" id="stream-expand-btn">Load Episodes</button>
    `;

    const streamContent = document.createElement("div");
    streamContent.className = "stream-content";
    streamContent.style.display = "none";

    let loaded = false;
    streamHeader.querySelector("#stream-expand-btn").addEventListener("click", async function () {
      if (streamContent.style.display === "none") {
        streamContent.style.display = "block";
        this.textContent = "Hide";
      } else {
        streamContent.style.display = "none";
        this.textContent = loaded ? "Show" : "Load Episodes";
        return;
      }
      if (loaded) return;
      loaded = true;

      streamContent.innerHTML = `<p class="stream-status">Searching AllAnime…</p>`;
      try {
        const results = await invoke("search_online", { query: anime.title });
        if (!results || results.length === 0) {
          streamContent.innerHTML = `<p class="stream-status">Not found on AllAnime.</p>`;
          return;
        }

        // ── Show result picker if there are multiple matches ———————————
        streamContent.innerHTML = "";

        const pickerNote = document.createElement("p");
        pickerNote.className = "stream-match-meta";
        pickerNote.textContent = `${results.length} result${results.length === 1 ? "" : "s"} found — select the correct one:`;
        streamContent.appendChild(pickerNote);

        const pickerList = document.createElement("ul");
        pickerList.className = "episode-list";
        pickerList.style.marginBottom = "12px";
        streamContent.appendChild(pickerList);

        const epContainer = document.createElement("div");
        streamContent.appendChild(epContainer);

        for (const result of results) {
          const li = document.createElement("li");
          li.className = "episode-item";
          li.style.cssText = "cursor:pointer;flex-wrap:wrap;gap:6px;";

          const nameSpan = document.createElement("span");
          nameSpan.className = "episode-file";
          nameSpan.style.fontWeight = "600";
          nameSpan.textContent = result.name;

          const epSpan = document.createElement("span");
          epSpan.className = "episode-num";
          epSpan.textContent = `sub:${result.episodes_sub} dub:${result.episodes_dub}`;

          const selectBtn = document.createElement("button");
          selectBtn.className = "play-btn play-btn--text";
          selectBtn.textContent = "Select";
          selectBtn.title = "Load episodes for this title";

          selectBtn.addEventListener("click", async () => {
            // Mark selected row visually
            pickerList.querySelectorAll(".episode-item").forEach(el => el.style.background = "");
            li.style.background = "rgba(var(--accent-rgb, 180,120,60),0.12)";

            epContainer.innerHTML = `<p class="stream-status">Loading episodes…</p>`;
            try {
              const epList = await invoke("get_episodes", { showId: result.id, mode: "sub" });
              epContainer.innerHTML = "";

              if (!epList || epList.length === 0) {
                epContainer.innerHTML = `<p class="stream-status">No episodes available.</p>`;
                return;
              }

              const matchMeta = document.createElement("p");
              matchMeta.className = "stream-match-meta";
              matchMeta.textContent = `${result.name} · ${epList.length} episodes`;
              epContainer.appendChild(matchMeta);

              const ul = document.createElement("ul");
              ul.className = "episode-list";

              for (const ep of epList) {
                const li2 = document.createElement("li");
                li2.className = "episode-item";
                li2.style.flexWrap = "wrap";

                const num = document.createElement("span");
                num.className = "episode-num";
                num.textContent = `#${ep}`;

                const label = document.createElement("span");
                label.className = "episode-file";
                label.textContent = `Episode ${ep}`;

                // ── Stream button ————————————————————————————
                const streamBtn = document.createElement("button");
                streamBtn.className = "play-btn";
                streamBtn.title = "Stream in-app";
                streamBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
                streamBtn.addEventListener("click", async (e) => {
                  e.stopPropagation();
                  streamBtn.disabled = true;
                  try {
                    const qualities = await invoke("get_stream_url", { showId: result.id, episode: ep, mode: "sub" });
                    const chosen = await pickQuality(qualities);
                    if (!chosen) return;
                    const ctx = { showId: result.id, allEpisodes: epList, currentEp: ep, mode: "sub" };
                    openVideoPlayer(chosen.url, `${result.name} — Episode ${ep}`, chosen.isHls ?? false, ctx);
                  } catch (err) {
                    showToast(`Stream error: ${err}`);
                  } finally {
                    streamBtn.disabled = false;
                  }
                });

                // ── Download button —————————————————————————
                const dlBtn = document.createElement("button");
                dlBtn.className = "play-btn dl-btn";
                dlBtn.title = "Download episode";
                dlBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
                dlBtn.addEventListener("click", async (e) => {
                  e.stopPropagation();
                  dlBtn.disabled = true;
                  dlBtn.title = "Started";
                  try {
                    const qualities = await invoke("get_stream_url", { showId: result.id, episode: ep, mode: "sub" });
                    const chosen = await pickQuality(qualities);
                    if (!chosen) {
                      dlBtn.disabled = false;
                      dlBtn.title = "Download episode";
                      return;
                    }
                    const safeTitle = (result.name || "Unknown").replace(/[/\\:*?"<>|]/g, "_");
                    const safeRes   = (chosen.resolution || "auto").replace(/\s+/g, "_");
                    const savePath  = `~/Videos/AniLab/${safeTitle}/Episode_${ep}_${safeRes}.mp4`;
                    
                    const dlId = await invoke("record_download", {
                      animeId: result.id,
                      title: safeTitle,
                      episode: ep.toString(),
                      savePath
                    });
                    
                    if (typeof window.incrementActiveDownloads === "function") {
                      window.incrementActiveDownloads(safeTitle);
                    }
                    
                    invoke("download_episode", { url: chosen.url, outputPath: savePath, downloadId: dlId });
                    showToast(`Background download started for Episode ${ep}.`);
                  } catch (err) {
                    showToast(`Download init error: ${err}`);
                    dlBtn.disabled = false;
                  }
                });

                li2.append(num, label, streamBtn, dlBtn);
                ul.appendChild(li2);
              }
              epContainer.appendChild(ul);
            } catch (err) {
              epContainer.innerHTML = `<p class="stream-status">Error loading episodes: ${err}</p>`;
            }
          });

          li.append(nameSpan, epSpan, selectBtn);
          pickerList.appendChild(li);
        }

        // Auto-select if only one result
        if (results.length === 1) {
          pickerList.querySelector(".play-btn")?.click();
        }

      } catch (err) {
        streamContent.innerHTML = `<p class="stream-status">Error: ${err}</p>`;
      }
    });

    streamSection.append(streamHeader, streamContent);
    content.appendChild(streamSection);
  }


  // Remove from library button
  const removeBtn = document.createElement("button");
  removeBtn.className = "remove-btn";
  removeBtn.textContent = "Remove from Library";
  removeBtn.addEventListener("click", async () => {
    await removeFromLibrary(anime);
  });
  content.appendChild(removeBtn);
}

function closeDetail() {
  _openDetail = null;
  document.getElementById("detail-panel").classList.add("hidden");
  document.getElementById("detail-overlay").classList.add("hidden");
}

async function removeFromLibrary(anime) {
  try {
    await invoke("remove_from_library", {
      animeId: anime.anime_id ?? null,
      folderPath: anime.folder_path ?? null,
    });
    showToast(`"${anime.title || "Show"}" removed from library.`);
    closeDetail();
    await renderLibrary();
    refreshSearchButtons();
  } catch (err) {
    showToast(`Remove failed: ${err}`);
  }
}

// ── Settings / scan ───────────────────────────────────────────────────────────

async function runScan(folderPath) {
  const status = document.getElementById("scan-status");
  if (!folderPath) { status.textContent = "Please enter a folder path."; return; }
  status.textContent = "Scanning…";
  const files = await scanFolder(folderPath);
  if (!files || files.length === 0) { status.textContent = "No video files found."; return; }
  status.textContent = `Found ${files.length} file(s). Matching…`;
  const matches = await matchAnime(files);
  if (!matches || matches.length === 0) { status.textContent = "No matches found."; return; }
  status.textContent = `Matched ${matches.length} file(s). Saving…`;
  await saveToLibrary(matches);
  status.textContent = `✓ Done — ${matches.length} file(s) added.`;
  showToast(`${matches.length} file(s) imported!`);
  await renderLibrary();
}

// ── Navigation ────────────────────────────────────────────────────────────────

function initNav() {
  const navBtns = document.querySelectorAll(".nav-btn");
  const views   = document.querySelectorAll(".view");

  function switchView(viewId) {
    navBtns.forEach(b => b.classList.toggle("active", b.dataset.view === viewId));
    views.forEach(v => v.classList.toggle("active", v.id === `view-${viewId}`));
    if (viewId === "history") renderHistory();
    if (viewId === "downloads") renderDownloads();
  }

  navBtns.forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  // Sidebar scan shortcut → jump to settings
  document.getElementById("scan-btn").addEventListener("click", () => switchView("settings"));
}

// ── Unified History & Downloads ───────────────────────────────────────────────

async function recordHistory(animeId, title, episode, source) {
  try {
    await invoke("record_history", {
      animeId: animeId || null,
      title: title || "Unknown Title",
      episode: episode || "",
      source: source || "stream",
    });
  } catch (err) {
    console.error("Failed to record history:", err);
  }
}

async function renderHistory() {
  const list = document.getElementById("history-list");
  if (!list) return;

  try {
    const history = await invoke("get_history");
    const empty = document.getElementById("history-empty");
    if (!history || history.length === 0) {
      if (empty) empty.style.display = "flex";
      Array.from(list.children).forEach(c => { if (c !== empty) c.remove(); });
      return;
    }
    if (empty) empty.style.display = "none";

    Array.from(list.children).forEach(c => { if (c !== empty) c.remove(); });

    for (const row of history) {
      const item = document.createElement("div");
      item.className = "episode-item";
      let d = new Date(row.watched_at + 'Z');
      if (isNaN(d)) d = new Date(row.watched_at); // fallback
      item.innerHTML = `
        <img src="${row.cover_image || ''}" class="card-cover" style="width: 44px; height: 60px; object-fit: cover; border-radius: 6px; margin-right: 12px; display: ${row.cover_image ? 'block' : 'none'};background:var(--border);">
        <div style="flex: 1; display: flex; flex-direction: column; gap: 4px; overflow: hidden;">
          <span style="font-weight: 600; color: var(--text); white-space: nowrap; text-overflow: ellipsis; overflow: hidden;">${row.title}</span>
          <span style="font-size: 0.8rem; color: var(--text-muted); opacity: 0.85;">
            Episode ${row.episode} • <span class="status-badge" style="background:#d4bc95;color:var(--text);font-size:0.6rem;padding:0px 6px;">${row.source}</span>
          </span>
        </div>
        <span style="font-size: 0.75rem; color: var(--text-muted); align-self: flex-start; padding-top: 4px;">
          ${d.toLocaleDateString()} ${d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
        </span>
      `;
      list.appendChild(item);
    }
  } catch (err) {
    console.error("renderHistory error:", err);
  }
}

async function renderDownloads() {
  const list = document.getElementById("downloads-list");
  if (!list) return;

  try {
    const dls = await invoke("get_downloads");
    const empty = document.getElementById("downloads-empty");
    if (!dls || dls.length === 0) {
      if (empty) empty.style.display = "flex";
      Array.from(list.children).forEach(c => { if (c !== empty) c.remove(); });
      return;
    }
    if (empty) empty.style.display = "none";

    Array.from(list.children).forEach(c => { if (c !== empty) c.remove(); });

    for (const row of dls) {
      const item = document.createElement("div");
      item.className = "episode-item";
      item.id = `dl-row-${row.id}`;
      
      let statusColor = "var(--text-muted)";
      if (row.status === "completed") statusColor = "var(--accent)";
      if (row.status === "downloading") statusColor = "var(--caramel-dark)";
      if (row.status === "failed") statusColor = "#d63031";

      item.innerHTML = `
        <img src="${row.cover_image || ''}" class="card-cover" style="width: 44px; height: 60px; object-fit: cover; border-radius: 6px; margin-right: 12px; display: ${row.cover_image ? 'block' : 'none'};background:var(--border);">
        <div style="flex: 1; display: flex; flex-direction: column; gap: 4px; overflow: hidden;">
          <span style="font-weight: 600; color: var(--text); white-space: nowrap; text-overflow: ellipsis; overflow: hidden;">${row.title}</span>
          <span style="font-size: 0.8rem; color: var(--text-muted);">Episode ${row.episode}</span>
          <span style="font-size: 0.7rem; color: var(--text-muted); opacity: 0.6; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: left;">
            ${row.save_path}
          </span>
        </div>
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px; min-width: 80px;">
          <span style="font-size: 0.75rem; color: ${statusColor}; font-weight: 700; text-transform: uppercase;">
            ${row.status}
          </span>
          ${row.status === 'downloading' ? `
          <div style="width:100%;height:4px;background:var(--border);border-radius:99px;overflow:hidden;">
            <div id="dl-row-prog-${row.id}" style="width:${row.progress}%;height:100%;background:${statusColor};transition:width 0.3s;"></div>
          </div>
          ` : ''}
        </div>
      `;
      list.appendChild(item);
    }
  } catch (err) {
    console.error("renderDownloads error:", err);
  }
}

let openDownloads = 0;

window.incrementActiveDownloads = function(titleText) {
  openDownloads++;
  const bar = document.getElementById("global-download-bar");
  document.getElementById("gdb-title").textContent = `Downloading ${titleText}...`;
  document.getElementById("gdb-title").style.color = "var(--text)";
  bar.classList.remove("hidden");
};

function initDownloads() {
  const gdBar = document.getElementById("global-download-bar");
  const gdTitle = document.getElementById("gdb-title");
  const gdStatus = document.getElementById("gdb-status");
  const gdProgress = document.getElementById("gdb-progress");
  const gdClose = document.getElementById("gdb-close");

  if (!gdBar) return;

  gdClose.addEventListener("click", () => {
    gdBar.classList.add("hidden");
  });

  listen("download-progress", (event) => {
    const { id, progress } = event.payload;
    if (gdBar.classList.contains("hidden") && openDownloads > 0) {
      gdBar.classList.remove("hidden");
    }
    gdStatus.textContent = `${progress}%`;
    gdProgress.style.width = `${progress}%`;

    const rowProg = document.getElementById(`dl-row-prog-${id}`);
    if (rowProg) rowProg.style.width = `${progress}%`;
  });

  listen("download-complete", (event) => {
    const { id, status, path } = event.payload;
    openDownloads--;
    if (openDownloads < 0) openDownloads = 0;
    
    gdTitle.textContent = status === "completed" ? "Download Complete" : "Download Failed";
    gdTitle.style.color = status === "completed" ? "var(--accent)" : "red";
    gdStatus.textContent = status === "completed" ? "Done" : "Error";
    gdProgress.style.width = status === "completed" ? "100%" : "0%";
    
    invoke("update_download_status", { id, status, progress: 100 }).catch(console.error);
    
    if (document.getElementById("view-downloads").classList.contains("active")) {
      renderDownloads();
    }
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────

// ── Detail panel drag-to-resize ──────────────────────────────────────────────

function initPanelResize() {
  const panel = document.getElementById("detail-panel");
  if (!panel) return;

  // Restore saved width from previous session
  const saved = localStorage.getItem("anilab-panel-width");
  if (saved) {
    document.documentElement.style.setProperty("--detail-panel-w", saved + "px");
  }

  // Inject drag handle
  const handle = document.createElement("div");
  handle.className = "detail-panel-resize-handle";
  handle.title = "Drag to resize panel";
  panel.appendChild(handle);

  let dragging = false;
  let startX = 0;
  let startW = 0;

  handle.addEventListener("mousedown", (e) => {
    dragging = true;
    startX = e.clientX;
    startW = panel.offsetWidth;
    handle.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    // Panel is on the right; dragging left increases width
    const delta = startX - e.clientX;
    const newW  = Math.max(340, Math.min(startW + delta, window.innerWidth * 0.85));
    document.documentElement.style.setProperty("--detail-panel-w", newW + "px");
  });

  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    // Persist the chosen width
    const w = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue("--detail-panel-w"));
    if (!isNaN(w)) localStorage.setItem("anilab-panel-width", Math.round(w));
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  // Init DB
  try {
    await invoke("init_db");
    console.log("[AniLab] DB ready.");
  } catch (err) {
    console.error("[AniLab] init_db failed:", err);
  }

  initNav();
  initSearch();
  initPanelResize();
  initDownloads();

  // Detail panel close
  document.getElementById("detail-close").addEventListener("click", closeDetail);
  document.getElementById("detail-overlay").addEventListener("click", closeDetail);

  // Settings scan button — opens native OS folder picker
  document.getElementById("settings-scan-btn").addEventListener("click", async () => {
    const status = document.getElementById("scan-status");
    let path;
    try {
      path = await window.__TAURI__.dialog.open({ directory: true, multiple: false, title: "Choose Anime Folder" });
    } catch (err) {
      status.textContent = `Dialog error: ${err}`;
      return;
    }
    if (!path) return; // user cancelled
    runScan(path);
  });

  // Load library
  await renderLibrary();

  // Auto-refresh library (and re-draw detail panel) when mpv marks an episode watched
  await listen("episode-watched", async (event) => {
    const watchedFile = event.payload;
    await renderLibrary();
    // If a detail panel is open for the show that contains this file, refresh it
    if (_openDetail) {
      const lib = await getLibrary();
      const matchRow = lib.find(r => r.episode_file === watchedFile);
      if (matchRow) {
        const key = matchRow.anime_id != null
          ? `id:${matchRow.anime_id}`
          : `folder:${matchRow.folder_path}`;
        const sameKey = _openDetail.anime.anime_id != null
          ? `id:${_openDetail.anime.anime_id}`
          : `folder:${_openDetail.anime.folder_path}`;
        if (key === sameKey) {
          // Re-fetch episodes for this show and re-draw panel
          const updatedEpisodes = lib.filter(r => {
            const rKey = r.anime_id != null ? `id:${r.anime_id}` : `folder:${r.folder_path}`;
            return rKey === sameKey && r.episode_file;
          });
          _openDetail.episodes = updatedEpisodes;
          _renderDetailContent(_openDetail.anime, updatedEpisodes);
        }
      }
    }
  });
});
