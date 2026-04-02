use std::path::Path;
use std::process::{Command, Stdio};
use tauri::Emitter;

const MPV_CANDIDATES: &[&str] = &[
    "/usr/bin/mpv",
    "/usr/local/bin/mpv",
    "/opt/homebrew/bin/mpv",
    "/usr/local/opt/mpv/bin/mpv",
    "mpv",
];

fn find_mpv() -> Option<&'static str> {
    MPV_CANDIDATES
        .iter()
        .copied()
        .find(|&p| p == "mpv" || Path::new(p).exists())
}

/// Tauri command: launches mpv, then marks the episode watched when it exits.
#[tauri::command]
pub fn play_episode(app: tauri::AppHandle, file_path: String) -> Result<(), String> {
    let mpv = find_mpv().ok_or_else(|| {
        "mpv not found. Please install mpv (e.g. `sudo apt install mpv`).".to_string()
    })?;

    let mut child = Command::new(mpv)
        .arg(&file_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to launch mpv: {e}"))?;

    // Wait in a background thread — mark watched and notify frontend on exit
    std::thread::spawn(move || {
        if child.wait().map(|s| s.success()).unwrap_or(false) {
            let _ = crate::db::set_watched_internal(&file_path);
            let _ = app.emit("episode-watched", file_path);
        }
    });

    Ok(())
}

