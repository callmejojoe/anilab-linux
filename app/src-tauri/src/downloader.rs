use std::path::Path;
use std::process::{Command, Stdio};

const YTDLP_CANDIDATES: &[&str] = &[
    "/usr/bin/yt-dlp",
    "/usr/local/bin/yt-dlp",
    "/opt/homebrew/bin/yt-dlp",
    "yt-dlp",
];

fn find_ytdlp() -> Option<&'static str> {
    YTDLP_CANDIDATES
        .iter()
        .copied()
        .find(|&p| p == "yt-dlp" || Path::new(p).exists())
}

/// Tauri command: download any HLS/online URL using yt-dlp.
/// `output_path` is the full destination path including filename template,
/// e.g. "~/Videos/AniLab/Naruto/Episode_1.mp4".
#[tauri::command]
pub fn download_episode(url: String, output_path: String) -> Result<String, String> {
    let ytdlp = find_ytdlp()
        .ok_or_else(|| "yt-dlp not found. Install it with: pip install yt-dlp".to_string())?;

    // Expand ~ to the real home directory
    let expanded = if output_path.starts_with("~/") {
        let home = dirs_next::home_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."));
        home.join(&output_path[2..]).to_string_lossy().to_string()
    } else {
        output_path.clone()
    };

    // Ensure parent directory exists
    if let Some(parent) = Path::new(&expanded).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create output dir: {e}"))?;
    }

    eprintln!("[AniLab] download_episode → yt-dlp -o {} {}", expanded, url);

    Command::new(ytdlp)
        .args(["-o", &expanded, &url])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to launch yt-dlp: {e}"))?;

    Ok(expanded)
}
