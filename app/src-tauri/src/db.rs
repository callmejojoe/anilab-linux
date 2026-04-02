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
