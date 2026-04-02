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
      // For folder-grouped entries, synthesise a display title from the folder name
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

  // Keep the library ID set in sync so search buttons reflect current state
  _libraryAnimeIds = new Set(
    rows.filter(r => r.anime_id != null).map(r => r.anime_id)
  );

  countBadge.textContent = `${shows.length} show${shows.length !== 1 ? "s" : ""}`;

  if (shows.length === 0) {
    grid.appendChild(empty);
    return;
  }

  for (const { meta, episodes } of shows) {
    grid.appendChild(buildLibraryCard(meta, episodes));
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

      streamContent.innerHTML = `<p class="stream-status">Searching Aniwatch…</p>`;
      try {
        const results = await invoke("search_online", { query: anime.title });
        if (!results || results.length === 0) {
          streamContent.innerHTML = `<p class="stream-status">Not found on Aniwatch.</p>`;
          return;
        }
        const match = results[0];
        const episodes = await invoke("get_episodes", { idanime: match.idanime });
        streamContent.innerHTML = "";

        if (!episodes || episodes.length === 0) {
          streamContent.innerHTML = `<p class="stream-status">No episodes available.</p>`;
          return;
        }

        // Dub/sub toggle
        const toggleRow = document.createElement("div");
        toggleRow.className = "stream-toggle-row";
        let preferDub = false;
        const subBtn  = document.createElement("button");
        subBtn.textContent  = "Sub";
        subBtn.className    = "stream-track-btn active";
        const dubBtn  = document.createElement("button");
        dubBtn.textContent  = "Dub";
        dubBtn.className    = "stream-track-btn";
        subBtn.addEventListener("click", () => { preferDub = false; subBtn.classList.add("active"); dubBtn.classList.remove("active"); });
        dubBtn.addEventListener("click", () => { preferDub = true;  dubBtn.classList.add("active"); subBtn.classList.remove("active"); });
        toggleRow.append(subBtn, dubBtn);
        streamContent.appendChild(toggleRow);

        const matchMeta = document.createElement("p");
        matchMeta.className = "stream-match-meta";
        matchMeta.textContent = `Match: ${match.name} (${episodes.length} episodes)`;
        streamContent.appendChild(matchMeta);

        const ul = document.createElement("ul");
        ul.className = "episode-list";

        for (const ep of episodes) {
          const li = document.createElement("li");
          li.className = "episode-item";
          li.style.flexWrap = "wrap";

          const num = document.createElement("span");
          num.className = "episode-num";
          num.textContent = `#${ep.order}`;

          const name = document.createElement("span");
          name.className = "episode-file";
          name.textContent = ep.name || `Episode ${ep.order}`;

          // ── Quality picker (shared between stream + download) ────────────
          function buildQualityPicker(sources, onPick) {
            // Remove any stale picker in this li
            li.querySelectorAll(".quality-picker").forEach(p => p.remove());
            if (sources.length === 1) { onPick(sources[0]); return; }
            const picker = document.createElement("div");
            picker.className = "quality-picker";
            sources.forEach(src => {
              const btn = document.createElement("button");
              btn.className = "quality-option";
              btn.textContent = src.label || src.kind || "Play";
              btn.addEventListener("click", (e) => {
                e.stopPropagation();
                picker.remove();
                onPick(src);
              });
              picker.appendChild(btn);
            });
            li.appendChild(picker);
            // Close on outside click
            setTimeout(() => document.addEventListener("click", () => picker.remove(), { once: true }), 50);
          }

          // ── Stream button ────────────────────────────────────────────────
          const streamBtn = document.createElement("button");
          streamBtn.className = "play-btn";
          streamBtn.title = "Stream in mpv";
          streamBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
          streamBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            streamBtn.disabled = true;
            try {
              const sources = await invoke("get_stream_url", { epId: ep.ep_id, preferDub });
              buildQualityPicker(sources, async (src) => {
                await invoke("stream_episode", { url: src.url });
                showToast(`Streaming ${src.label} in mpv…`);
              });
            } catch (err) {
              showToast(`Stream error: ${err}`);
            } finally {
              streamBtn.disabled = false;
            }
          });

          // ── Download button ──────────────────────────────────────────────
          const dlBtn = document.createElement("button");
          dlBtn.className = "play-btn dl-btn";
          dlBtn.title = "Download with yt-dlp";
          dlBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
          dlBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            dlBtn.disabled = true;
            try {
              const sources = await invoke("get_stream_url", { epId: ep.ep_id, preferDub });
              buildQualityPicker(sources, async (src) => {
                const epLabel = ep.name || `Episode ${ep.order}`;
                const dir = await invoke("download_episode", {
                  url: src.url,
                  title: anime.title || "Unknown",
                  epName: epLabel,
                });
                showToast(`Downloading to ${dir}`, 4000);
              });
            } catch (err) {
              showToast(`Download error: ${err}`);
            } finally {
              dlBtn.disabled = false;
            }
          });

          li.append(num, name, streamBtn, dlBtn);
          ul.appendChild(li);
        }
        streamContent.appendChild(ul);
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
  }

  navBtns.forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });

  // Sidebar scan shortcut → jump to settings
  document.getElementById("scan-btn").addEventListener("click", () => switchView("settings"));
}

// ── Boot ──────────────────────────────────────────────────────────────────────

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
