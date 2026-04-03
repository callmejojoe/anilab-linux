use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

/// Returns the path to the SQLite database file, creating parent directories as needed.
fn db_path() -> PathBuf {
    let mut path = dirs_next::data_dir()
        .unwrap_or_else(|| PathBuf::from("."));
    path.push("anilab");
    fs::create_dir_all(&path).expect("Failed to create anilab data directory");
    path.push("anilab.db");
    path
}

/// Opens (or creates) the SQLite database and initialises the schema.
pub fn open_and_init() -> Result<Connection> {
    let path = db_path();
    let conn = Connection::open(&path)?;

    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS anime (
            id          INTEGER PRIMARY KEY,
            title       TEXT NOT NULL,
            cover_image TEXT,
            episodes    INTEGER,
            status      TEXT,
            score       INTEGER,
            updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS library (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            anime_id       INTEGER REFERENCES anime(id),
            folder_path    TEXT NOT NULL,
            episode_file   TEXT,
            episode_number INTEGER,
            watched        INTEGER DEFAULT 0,
            UNIQUE(episode_file)
        );

        CREATE TABLE IF NOT EXISTS history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            anime_id    TEXT,
            title       TEXT,
            episode     TEXT,
            source      TEXT,
            watched_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS downloads (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            anime_id     TEXT,
            title        TEXT,
            episode      TEXT,
            save_path    TEXT,
            status       TEXT DEFAULT 'downloading',
            progress     INTEGER DEFAULT 0,
            started_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP
        );
        ",
    )?;

    Ok(conn)
}

// ── Input / output types ──────────────────────────────────────────────────────

/// Mirrors the MatchedAnime struct from matcher.rs — what JS passes in.
#[derive(Debug, Deserialize)]
pub struct LibraryEntryInput {
    pub file_path: String,
    pub anime_id: Option<i64>,
    pub title: Option<String>,
    pub cover_image: Option<String>,
    pub episodes: Option<i64>,
    pub status: Option<String>,
    pub episode_number: Option<i64>,
}

/// A fully joined row returned by get_library.
#[derive(Debug, Serialize)]
pub struct LibraryRow {
    pub library_id: i64,
    pub anime_id: Option<i64>,
    pub folder_path: String,
    pub episode_file: Option<String>,
    pub episode_number: Option<i64>,
    pub watched: bool,
    pub title: Option<String>,
    pub cover_image: Option<String>,
    pub episodes: Option<i64>,
    pub status: Option<String>,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn save_library_entry(conn: &Connection, entry: &LibraryEntryInput) -> Result<()> {
    // Derive folder_path from the file path
    let folder_path = Path::new(&entry.file_path)
        .parent()
        .and_then(|p| p.to_str())
        .unwrap_or("")
        .to_string();

    // Upsert anime row — always write so cover_image/metadata stays current
    if let (Some(anime_id), Some(title)) = (entry.anime_id, &entry.title) {
        conn.execute(
            "INSERT INTO anime (id, title, cover_image, episodes, status)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
               title       = excluded.title,
               cover_image = COALESCE(excluded.cover_image, cover_image),
               episodes    = COALESCE(excluded.episodes,    episodes),
               status      = COALESCE(excluded.status,      status)",
            params![
                anime_id,
                title,
                entry.cover_image,
                entry.episodes,
                entry.status,
            ],
        )?;
    }

    // For search-only adds (no file), store a placeholder row keyed on anime_id
    if entry.file_path.is_empty() {
        if let Some(anime_id) = entry.anime_id {
            conn.execute(
                "INSERT OR IGNORE INTO library (anime_id, folder_path, episode_file)
                 SELECT ?1, '', NULL WHERE NOT EXISTS (
                     SELECT 1 FROM library WHERE anime_id = ?1 AND episode_file IS NULL
                 )",
                params![anime_id],
            )?;
        }
        return Ok(());
    }

    // Normal file-backed insert
    conn.execute(
        "INSERT OR IGNORE INTO library (anime_id, folder_path, episode_file, episode_number)
         VALUES (?1, ?2, ?3, ?4)",
        params![
            entry.anime_id,
            folder_path,
            entry.file_path,
            entry.episode_number,
        ],
    )?;

    Ok(())
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Initialise the database.
#[tauri::command]
pub fn init_db() -> Result<(), String> {
    open_and_init().map(|_| ()).map_err(|e| e.to_string())
}

/// Persist a batch of matched anime entries into the library.
#[tauri::command]
pub fn save_to_library(entries: Vec<LibraryEntryInput>) -> Result<(), String> {
    let conn = open_and_init().map_err(|e| e.to_string())?;
    for entry in &entries {
        save_library_entry(&conn, entry).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Return all library entries joined with their anime metadata.
#[tauri::command]
pub fn get_library() -> Result<Vec<LibraryRow>, String> {
    let conn = open_and_init().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT l.id, l.anime_id, l.folder_path, l.episode_file,
                    l.episode_number, l.watched,
                    a.title, a.cover_image, a.episodes, a.status
             FROM library l
             LEFT JOIN anime a ON l.anime_id = a.id
             ORDER BY a.title, l.episode_number",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(LibraryRow {
                library_id:    row.get(0)?,
                anime_id:      row.get(1)?,
                folder_path:   row.get(2)?,
                episode_file:  row.get(3)?,
                episode_number: row.get(4)?,
                watched:       row.get::<_, i64>(5).map(|v| v != 0)?,
                title:         row.get(6)?,
                cover_image:   row.get(7)?,
                episodes:      row.get(8)?,
                status:        row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;

    Ok(rows)
}
/// Sets watched = 1 for the given file path. Called internally and via Tauri command.
pub fn set_watched_internal(file_path: &str) -> Result<()> {
    let conn = open_and_init()?;
    conn.execute(
        "UPDATE library SET watched = 1 WHERE episode_file = ?1",
        params![file_path],
    )?;
    Ok(())
}

/// Tauri command: mark an episode as watched.
#[tauri::command]
pub fn mark_watched(file_path: String) -> Result<(), String> {
    set_watched_internal(&file_path).map_err(|e| e.to_string())
}

/// Tauri command: remove all library entries for a show (by anime_id or folder_path).
#[tauri::command]
pub fn remove_from_library(anime_id: Option<i64>, folder_path: Option<String>) -> Result<(), String> {
    let conn = open_and_init().map_err(|e| e.to_string())?;

    if let Some(id) = anime_id {
        conn.execute("DELETE FROM library WHERE anime_id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        // Remove orphaned anime row if no library entries remain
        conn.execute(
            "DELETE FROM anime WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM library WHERE anime_id = ?1)",
            params![id],
        )
        .map_err(|e| e.to_string())?;
    } else if let Some(folder) = folder_path {
        conn.execute("DELETE FROM library WHERE folder_path = ?1 AND anime_id IS NULL", params![folder])
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

// ── Unified History & Tracking ────────────────────────────────────────────────

#[derive(Debug, Deserialize, Serialize)]
pub struct HistoryRow {
    pub id: i64,
    pub title: Option<String>,
    pub episode: Option<String>,
    pub source: Option<String>,
    pub watched_at: Option<String>,
    pub cover_image: Option<String>,
}

#[tauri::command]
pub fn record_history(anime_id: Option<String>, title: Option<String>, episode: Option<String>, source: Option<String>) -> Result<(), String> {
    let conn = open_and_init().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO history (anime_id, title, episode, source) VALUES (?1, ?2, ?3, ?4)",
        params![anime_id, title, episode, source],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_history() -> Result<Vec<HistoryRow>, String> {
    let conn = open_and_init().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, title, episode, source, watched_at, NULL
         FROM history
         ORDER BY watched_at DESC
         LIMIT 100"
    ).map_err(|e| e.to_string())?;
    
    let rows = stmt.query_map([], |row| {
        Ok(HistoryRow {
            id: row.get(0)?,
            title: row.get(1)?,
            episode: row.get(2)?,
            source: row.get(3)?,
            watched_at: row.get(4)?,
            cover_image: row.get(5)?,
        })
    }).unwrap().filter_map(Result::ok).collect();
    Ok(rows)
}

// ── Downloads Tracking ────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize)]
pub struct DownloadRow {
    pub id: i64,
    pub title: Option<String>,
    pub episode: Option<String>,
    pub save_path: Option<String>,
    pub status: Option<String>,
    pub progress: Option<i64>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub cover_image: Option<String>,
}

#[tauri::command]
pub fn record_download(anime_id: Option<String>, title: Option<String>, episode: Option<String>, save_path: Option<String>) -> Result<i64, String> {
    let conn = open_and_init().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO downloads (anime_id, title, episode, save_path) VALUES (?1, ?2, ?3, ?4)",
        params![anime_id, title, episode, save_path],
    ).map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn update_download_status(id: i64, status: String, progress: i64) -> Result<(), String> {
    let conn = open_and_init().map_err(|e| e.to_string())?;
    if status == "completed" || status == "failed" {
        conn.execute(
            "UPDATE downloads SET status = ?1, progress = ?2, completed_at = CURRENT_TIMESTAMP WHERE id = ?3",
            params![status, progress, id],
        ).map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "UPDATE downloads SET status = ?1, progress = ?2 WHERE id = ?3",
            params![status, progress, id],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_downloads() -> Result<Vec<DownloadRow>, String> {
    let conn = open_and_init().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, title, episode, save_path, status, progress, started_at, completed_at, NULL
         FROM downloads
         ORDER BY started_at DESC"
    ).map_err(|e| e.to_string())?;
    
    let rows = stmt.query_map([], |row| {
        Ok(DownloadRow {
            id: row.get(0)?,
            title: row.get(1)?,
            episode: row.get(2)?,
            save_path: row.get(3)?,
            status: row.get(4)?,
            progress: row.get(5)?,
            started_at: row.get(6)?,
            completed_at: row.get(7)?,
            cover_image: row.get(8)?,
        })
    }).unwrap().filter_map(Result::ok).collect();
    Ok(rows)
}
