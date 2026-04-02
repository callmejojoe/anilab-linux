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

/// Tauri command: download an HLS/online URL using yt-dlp.
/// Saves to ~/Videos/AniLab/{title}/{ep_name}.%(ext)s (fire and forget).
#[tauri::command]
pub fn download_episode(url: String, title: String, ep_name: String) -> Result<String, String> {
    let ytdlp = find_ytdlp()
        .ok_or_else(|| "yt-dlp not found. Install it with: pip install yt-dlp".to_string())?;

    let home = dirs_next::home_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let output_dir = home.join("Videos").join("AniLab").join(&title);

    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Could not create output dir: {e}"))?;

    // Sanitise ep_name so it's safe as a filename
    let safe_name: String = ep_name
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '.' || c == ' ' { c } else { '_' })
        .collect();

    let output_template = output_dir.join(format!("{}.%(ext)s", safe_name));
    let output_path_str = output_template.to_string_lossy().to_string();

    Command::new(ytdlp)
        .args(["-o", &output_path_str, &url])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to launch yt-dlp: {e}"))?;

    Ok(output_dir.to_string_lossy().to_string())
}
