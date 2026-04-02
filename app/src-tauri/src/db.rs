use rusqlite::{Connection, Result};
use std::fs;
use std::path::PathBuf;

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
            watched        INTEGER DEFAULT 0
        );
        ",
    )?;

    Ok(conn)
}

/// Tauri command: initialise the database.
#[tauri::command]
pub fn init_db() -> Result<(), String> {
    open_and_init().map(|_| ()).map_err(|e| e.to_string())
}
