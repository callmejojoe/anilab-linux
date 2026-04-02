const { invoke } = window.__TAURI__.core;

let greetInputEl;
let greetMsgEl;

async function greet() {
  // Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
  greetMsgEl.textContent = await invoke("greet", { name: greetInputEl.value });
}

async function searchAnime(query) {
  try {
    const results = await invoke("search_anime", { query });
    console.log(`[AniLab] Search results for "${query}":`, results);
    return results;
  } catch (err) {
    console.error("[AniLab] search_anime error:", err);
  }
}

async function scanFolder(path) {
  try {
    const files = await invoke("scan_folder", { folderPath: path });
    console.log(`[AniLab] Video files in "${path}":`, files);
    return files;
  } catch (err) {
    console.error("[AniLab] scan_folder error:", err);
    return [];
  }
}

async function matchAnime(files) {
  try {
    const matches = await invoke("match_anime", { files });
    console.log("[AniLab] Matched anime:", matches);
    return matches;
  } catch (err) {
    console.error("[AniLab] match_anime error:", err);
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  // Initialise the SQLite database
  try {
    await invoke("init_db");
    console.log("[AniLab] Database initialised successfully.");
  } catch (err) {
    console.error("[AniLab] Failed to initialise database:", err);
  }

  // Test AniList search
  await searchAnime("Naruto");

  // Test local folder scan → match
  const files = await scanFolder("/home/joejo/Videos");
  if (files && files.length > 0) {
    await matchAnime(files);
  }

  greetInputEl = document.querySelector("#greet-input");
  greetMsgEl = document.querySelector("#greet-msg");
  document.querySelector("#greet-form").addEventListener("submit", (e) => {
    e.preventDefault();
    greet();
  });
});
