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

  // ── Video wrapper ──────────────────────────────────────────────────────────
  const videoWrap = document.createElement("div");
  videoWrap.className = "player-video-wrap";

  const video = document.createElement("video");
  video.preload = "metadata";

  // ── Controls ───────────────────────────────────────────────────────────────
  const controls = document.createElement("div");
  controls.className = "player-controls";

  // Progress row
  const progressRow = document.createElement("div");
  progressRow.className = "player-progress-row";

  const timeEl = document.createElement("span");
  timeEl.className = "player-time";
  timeEl.textContent = "0:00";

  const scrubber = document.createElement("input");
  scrubber.type = "range";
  scrubber.className = "player-scrubber";
  scrubber.min = "0";
  scrubber.max = "100";
  scrubber.value = "0";
  scrubber.step = "0.1";

  const durationEl = document.createElement("span");
  durationEl.className = "player-time";
  durationEl.style.textAlign = "right";
  durationEl.textContent = "0:00";

  progressRow.append(timeEl, scrubber, durationEl);

  // Button row
  const btnRow = document.createElement("div");
  btnRow.className = "player-btn-row";

  function makeSVGBtn(svgPath, title, w = 20, h = 20, viewBox = "0 0 24 24") {
    const b = document.createElement("button");
    b.className = "pctrl-btn";
    b.title = title;
    b.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgPath}</svg>`;
    return b;
  }

  // SVG icon strings
  const SVG_PREV    = '<polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5"></line>';
  const SVG_RWD     = '<path d="M2.5 2v6h6"/><path d="M2.66 15.57a10 10 0 1 0 .57-8.38"/><text x="12" y="14" text-anchor="middle" font-size="6" font-family="Courier New" fill="currentColor" stroke="none">10</text>';
  const SVG_PLAY    = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';
  const SVG_PAUSE   = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
  const SVG_FWD     = '<path d="M21.5 2v6h-6"/><path d="M21.34 15.57a10 10 0 1 1-.57-8.38"/><text x="12" y="14" text-anchor="middle" font-size="6" font-family="Courier New" fill="currentColor" stroke="none">10</text>';
  const SVG_NEXT    = '<polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line>';
  const SVG_VOL     = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>';
  const SVG_MUTE    = '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line>';
  const SVG_FULLSCR = '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path>';
  const SVG_EXITFS  = '<path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path>';
  const SVG_PIP     = '<rect x="2" y="4" width="20" height="16" rx="2"></rect><rect x="12" y="10" width="8" height="8" rx="1"></rect>';
  const SVG_DL      = '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>';
  const SVG_CLOSE   = '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>';

  const prevBtn  = context ? makeSVGBtn(SVG_PREV,  "Previous episode") : null;
  const rwdBtn   = makeSVGBtn(SVG_RWD,   "Rewind 10s");
  const playBtn  = makeSVGBtn(SVG_PLAY,  "Play / Pause");
  const fwdBtn   = makeSVGBtn(SVG_FWD,   "Forward 10s");
  const nextBtn  = context ? makeSVGBtn(SVG_NEXT,  "Next episode") : null;
  const volBtn   = makeSVGBtn(SVG_VOL,   "Mute / Unmute");
  const fsBtn    = makeSVGBtn(SVG_FULLSCR, "Fullscreen");
  const pipBtn   = makeSVGBtn(SVG_PIP,   "Picture-in-Picture");
  const dlBtn    = makeSVGBtn(SVG_DL,    "Download stream");
  const closeBtn = makeSVGBtn(SVG_CLOSE, "Close player");

  // Volume slider
  const volWrap = document.createElement("div");
  volWrap.className = "player-vol-wrap";
  const volSlider = document.createElement("input");
  volSlider.type = "range";
  volSlider.className = "player-vol-slider";
  volSlider.min = "0";
  volSlider.max = "1";
  volSlider.step = "0.02";
  volSlider.value = "1";
  volWrap.append(volBtn, volSlider);

  // Quality selector — populated after HLS manifest is parsed
  const qualitySelector = document.createElement("select");
  qualitySelector.id = "quality-selector";
  qualitySelector.className = "player-quality-sel";
  qualitySelector.style.display = "none";

  // Right side controls
  const rightRow = document.createElement("div");
  rightRow.className = "player-btn-row-right";

  rightRow.append(qualitySelector, dlBtn, pipBtn, fsBtn, closeBtn);

  if (prevBtn) btnRow.appendChild(prevBtn);
  btnRow.append(rwdBtn, playBtn, fwdBtn);
  if (nextBtn) btnRow.appendChild(nextBtn);
  btnRow.appendChild(volWrap);
  btnRow.appendChild(rightRow);

  controls.append(progressRow, btnRow);
  videoWrap.append(video, controls);

  // ── Meta bar below video ───────────────────────────────────────────────────
  const metaBar = document.createElement("div");
  metaBar.className = "player-meta-bar";

  const metaTitle = document.createElement("div");
  metaTitle.className = "player-meta-title";
  metaTitle.textContent = title || "Now Playing";

  const metaSub = document.createElement("div");
  metaSub.className = "player-meta-sub";
  metaSub.textContent = "";

  metaBar.append(metaTitle, metaSub);

  overlay.append(videoWrap, metaBar);
  document.body.appendChild(overlay);

  // ── HLS.js initialisation ───────────────────────────────────────────────────
  let hlsInstance = null;

  function initVideo() {
    const isHlsUrl = src.includes(".m3u8");
    if (isHlsUrl && typeof Hls !== "undefined" && Hls.isSupported()) {
      hlsInstance = new Hls();
      hlsInstance.loadSource(src);
      hlsInstance.attachMedia(video);

      let qualityPopulated = false;
      hlsInstance.on(Hls.Events.LEVEL_LOADED, () => {
        if (qualityPopulated) return;
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
      video.src = src;
      video.play().catch(() => {});
    }
  }

  if (!document.getElementById("hlsjs-script")) {
    const script = document.createElement("script");
    script.id = "hlsjs-script";
    script.src = "https://cdn.jsdelivr.net/npm/hls.js@latest";
    script.onload = initVideo;
    script.onerror = () => {
      showToast("Could not load HLS.js — falling back to native playback.");
      video.src = src;
      video.play().catch(() => {});
    };
    document.body.appendChild(script);
  } else {
    initVideo();
  }

  // ── Controls fade out on inactivity ───────────────────────────────────────
  let hideTimer = null;
  function showControls() {
    controls.classList.remove("hidden-controls");
    overlay.style.cursor = "";
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!video.paused) {
        controls.classList.add("hidden-controls");
        overlay.style.cursor = "none";
      }
    }, 3000);
  }

  overlay.addEventListener("mousemove", showControls);
  overlay.addEventListener("mouseenter", showControls);
  showControls();

  // ── Time / scrubber sync ───────────────────────────────────────────────────
  function formatTime(s) {
    if (!isFinite(s) || isNaN(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  }

  video.addEventListener("timeupdate", () => {
    if (video.duration) {
      const pct = (video.currentTime / video.duration) * 100;
      scrubber.value = pct;
      scrubber.style.setProperty("--progress", pct + "%");
      timeEl.textContent = formatTime(video.currentTime);
    }
  });

  video.addEventListener("durationchange", () => {
    durationEl.textContent = formatTime(video.duration);
    metaSub.textContent = `Duration: ${formatTime(video.duration)}`;
  });

  video.addEventListener("play",  () => { playBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SVG_PAUSE}</svg>`; showControls(); });
  video.addEventListener("pause", () => { playBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SVG_PLAY}</svg>`; showControls(); });

  scrubber.addEventListener("input", () => {
    if (video.duration) {
      video.currentTime = (scrubber.value / 100) * video.duration;
      scrubber.style.setProperty("--progress", scrubber.value + "%");
    }
  });

  // ── Playback controls ──────────────────────────────────────────────────────
  playBtn.addEventListener("click", () => { video.paused ? video.play() : video.pause(); });
  rwdBtn.addEventListener("click",  () => { video.currentTime = Math.max(0, video.currentTime - 10); });
  fwdBtn.addEventListener("click",  () => { video.currentTime = Math.min(video.duration || 0, video.currentTime + 10); });

  // Volume
  volSlider.addEventListener("input", () => {
    video.volume = volSlider.value;
    video.muted = video.volume === 0;
    volBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${video.muted ? SVG_MUTE : SVG_VOL}</svg>`;
  });
  volBtn.addEventListener("click", () => {
    video.muted = !video.muted;
    volSlider.value = video.muted ? 0 : video.volume || 1;
    volBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${video.muted ? SVG_MUTE : SVG_VOL}</svg>`;
  });

  // Fullscreen toggle
  let isFullscreen = false;
  fsBtn.addEventListener("click", () => {
    isFullscreen = !isFullscreen;
    overlay.classList.toggle("player-fullscreen", isFullscreen);
    fsBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${isFullscreen ? SVG_EXITFS : SVG_FULLSCR}</svg>`;
  });

  // PiP
  pipBtn.addEventListener("click", () => {
    if (document.pictureInPictureEnabled && !video.disablePictureInPicture) {
      video.requestPictureInPicture().catch(err => showToast(`PiP failed: ${err.message}`));
    } else {
      showToast("Picture-in-Picture is not supported in this context.");
    }
  });

  // ── Close ──────────────────────────────────────────────────────────────────
  function closePlayer() {
    clearTimeout(hideTimer);
    video.pause();
    video.src = "";
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    overlay.remove();
    document.removeEventListener("keydown", onKeyDown);
  }

  closeBtn.addEventListener("click", closePlayer);

  // ── Episode navigation ─────────────────────────────────────────────────────
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

  // ── Download from player bar ───────────────────────────────────────────────
  dlBtn.addEventListener("click", async () => {
    dlBtn.disabled = true;
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
      setTimeout(() => { dlBtn.disabled = false; }, 2000);
    }
  });

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  function onKeyDown(e) {
    if (e.key === "Escape")    { closePlayer(); return; }
    if (e.key === " " || e.key === "k") { video.paused ? video.play() : video.pause(); e.preventDefault(); }
    if (e.key === "ArrowLeft")  navigateEpisode(-1);
    if (e.key === "ArrowRight") navigateEpisode(+1);
    if (e.key === "j") video.currentTime = Math.max(0, video.currentTime - 10);
    if (e.key === "l") video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
    if (e.key === "f") fsBtn.click();
    if (e.key === "m") volBtn.click();
  }
  document.addEventListener("keydown", onKeyDown);

  // ── Record history ─────────────────────────────────────────────────────────
  if (context) {
    recordHistory(context.showId, title.split(" — ")[0], context.currentEp.toString(), "stream").catch(() => 0);
  } else {
    recordHistory(null, title, "", "stream").catch(() => 0);
  }
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
    if (qualities.length === 1) {
      resolve({ ...qualities[0], isHls: qualities[0].url?.includes(".m3u8") });
      return;
    }

    const backdrop = document.createElement("div");
    backdrop.style.cssText = [
      "position:fixed", "inset:0", "z-index:10000",
      "background:rgba(10,5,2,0.7)",
      "backdrop-filter:blur(4px)",
      "display:flex", "align-items:center", "justify-content:center",
    ].join(";");

    const modal = document.createElement("div");
    modal.style.cssText = [
      "background:#2a1a10",
      "border:1px solid #3d2415",
      "border-radius:8px",
      "padding:24px 28px",
      "min-width:260px",
      "max-width:360px",
      "box-shadow:0 20px 60px rgba(0,0,0,0.7)",
      "font-family:'Courier New',monospace",
      "color:#e8d5b0",
    ].join(";");

    const heading = document.createElement("p");
    heading.textContent = "[ SELECT QUALITY ]";
    heading.style.cssText = "font-size:0.88rem;font-weight:700;margin:0 0 4px;color:#c49a6c;letter-spacing:0.06em;";

    const sub = document.createElement("p");
    sub.textContent = "Choose your preferred stream quality.";
    sub.style.cssText = "font-size:0.75rem;opacity:0.6;margin:0 0 16px;letter-spacing:0.02em;";

    const list = document.createElement("div");
    list.style.cssText = "display:flex;flex-direction:column;gap:6px;";

    function cleanup() { backdrop.remove(); }

    for (const q of qualities) {
      const btn = document.createElement("button");
      btn.textContent = q.resolution || "Auto";
      btn.style.cssText = [
        "background:#c49a6c", "color:#e8d5b0",
        "border:1px solid #3d2415", "border-radius:6px",
        "padding:9px 14px", "cursor:pointer",
        "font-size:0.82rem", "font-weight:700",
        "font-family:'Courier New',monospace",
        "text-align:left", "letter-spacing:0.04em",
        "transition:background 0.15s,border-color 0.15s",
      ].join(";");
      btn.onmouseenter = () => { btn.style.background = "#d4a87a"; btn.style.borderColor = "#e8d5b0"; };
      btn.onmouseleave = () => { btn.style.background = "#c49a6c"; btn.style.borderColor = "#3d2415"; };
      btn.addEventListener("click", () => { cleanup(); resolve(q); });
      list.appendChild(btn);
    }

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "[ cancel ]";
    cancelBtn.style.cssText = [
      "background:transparent", "color:#8a7060",
      "border:1px solid #3d2415",
      "border-radius:6px", "padding:7px 14px",
      "cursor:pointer", "font-size:0.78rem",
      "font-family:'Courier New',monospace", "margin-top:8px",
      "width:100%", "letter-spacing:0.04em",
      "transition:background 0.15s",
    ].join(";");
    cancelBtn.onmouseenter = () => cancelBtn.style.background = "rgba(61,36,21,0.6)";
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
      "border-bottom:1px solid var(--border)",
      "margin-bottom:4px",
    ].join(";");
    const label = document.createElement("span");
    label.style.cssText = "font-family:var(--mono);font-size:0.72rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--caramel);";
    label.textContent = text;
    const badge = document.createElement("span");
    badge.style.cssText = "font-family:var(--mono);font-size:0.68rem;background:rgba(61,36,21,0.6);color:var(--text-muted);border-radius:4px;border:1px solid var(--border);padding:1px 7px;";
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
    listLabel.style.cssText = "font-family:var(--mono);font-weight:700;font-size:0.72rem;color:var(--caramel);margin-bottom:8px;letter-spacing:0.08em;text-transform:uppercase;";
    listLabel.textContent = "// files in library";
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
        <img src="${row.cover_image || ''}" class="card-cover" style="width:44px;height:60px;object-fit:cover;border-radius:6px;margin-right:12px;display:${row.cover_image ? 'block' : 'none'};background:var(--border);">
        <div style="flex:1;display:flex;flex-direction:column;gap:4px;overflow:hidden;">
          <span style="font-family:var(--mono);font-size:0.82rem;font-weight:700;color:var(--text);white-space:nowrap;text-overflow:ellipsis;overflow:hidden;">${row.title}</span>
          <span style="font-family:var(--mono);font-size:0.74rem;color:var(--text-muted);">
            ep ${row.episode} &bull; <span class="status-badge status-default" style="font-size:0.6rem;padding:1px 5px;">${row.source}</span>
          </span>
        </div>
        <span style="font-family:var(--mono);font-size:0.7rem;color:var(--text-muted);align-self:flex-start;padding-top:4px;white-space:nowrap;">
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
      if (row.status === "completed")  statusColor = "#8aab6e";
      if (row.status === "downloading") statusColor = "var(--caramel)";
      if (row.status === "failed")      statusColor = "#c05050";

      item.innerHTML = `
        <img src="${row.cover_image || ''}" class="card-cover" style="width:44px;height:60px;object-fit:cover;border-radius:6px;margin-right:12px;display:${row.cover_image ? 'block' : 'none'};background:var(--border);">
        <div style="flex:1;display:flex;flex-direction:column;gap:4px;overflow:hidden;">
          <span style="font-family:var(--mono);font-size:0.82rem;font-weight:700;color:var(--text);white-space:nowrap;text-overflow:ellipsis;overflow:hidden;">${row.title}</span>
          <span style="font-family:var(--mono);font-size:0.74rem;color:var(--text-muted);">ep ${row.episode}</span>
          <span style="font-family:var(--mono);font-size:0.66rem;color:var(--text-muted);opacity:0.55;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:rtl;text-align:left;">${row.save_path}</span>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;min-width:80px;">
          <span style="font-family:var(--mono);font-size:0.7rem;color:${statusColor};font-weight:700;letter-spacing:0.06em;">[${row.status.toUpperCase()}]</span>
          ${row.status === 'downloading' ? `
          <div style="width:100%;height:3px;background:var(--border);border-radius:2px;overflow:hidden;">
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

// ── Theme toggle ──────────────────────────────────────────────────────────────

function initTheme() {
  const btn   = document.getElementById("theme-toggle");
  const label = document.getElementById("theme-label");
  const sun   = document.getElementById("theme-icon-sun");
  const moon  = document.getElementById("theme-icon-moon");
  if (!btn) return;

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("anilab-theme", theme);
    if (theme === "dark") {
      // Dark mode active → offer to switch to Light
      sun.style.display  = "";
      moon.style.display = "none";
      label.textContent  = "Light Mode";
    } else {
      // Light mode active → offer to switch to Dark
      sun.style.display  = "none";
      moon.style.display = "";
      label.textContent  = "Dark Mode";
    }
  }

  // Sync UI to whatever theme was applied before JS loaded
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  applyTheme(current);

  btn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
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
  initTheme();

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

  // Clear history button
  const clearHistoryBtn = document.getElementById("clear-history-btn");
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener("click", async () => {
      try {
        await invoke("clear_history");
        showToast("Watch history cleared.");
        await renderHistory();
      } catch (err) {
        showToast(`Failed to clear history: ${err}`);
      }
    });
  }

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
