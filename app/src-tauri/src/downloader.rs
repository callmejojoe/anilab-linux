use tauri::{AppHandle, Emitter};
use std::path::Path;
use tokio::process::Command as AsyncCommand;
use tokio::io::{AsyncBufReadExt, BufReader};
use std::process::Stdio;
use regex::Regex;
use once_cell::sync::Lazy;

static PROGRESS_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\[download\]\s+([\d\.]+)%").unwrap());

#[derive(Clone, serde::Serialize)]
pub struct DownloadProgressPayload {
    pub id: i64,
    pub progress: u8,
}

#[derive(Clone, serde::Serialize)]
pub struct DownloadCompletePayload {
    pub id: i64,
    pub status: String,
    pub path: String,
}

/// Tauri command: start downloading an HLS stream or direct URL using yt-dlp asynchronously.
#[tauri::command]
pub fn download_episode(
    app: AppHandle,
    url: String, 
    output_path: String,
    download_id: i64, 
) -> Result<String, String> {
    let expanded = if output_path.starts_with("~/") {
        let home = dirs_next::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
        home.join(&output_path[2..]).to_string_lossy().to_string()
    } else {
        output_path.clone()
    };

    if let Some(parent) = Path::new(&expanded).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create output directory: {e}"))?;
    }

    eprintln!("[AniLab] Background download {} → {}", download_id, expanded);

    let expanded_clone = expanded.clone();
    
    tauri::async_runtime::spawn(async move {
        let mut child = match AsyncCommand::new("yt-dlp")
            .args(["--newline", "-o", &expanded_clone, &url])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                eprintln!("yt-dlp spawn failed: {}", e);
                let _ = app.emit("download-complete", DownloadCompletePayload { 
                    id: download_id, status: "failed".into(), path: expanded_clone 
                });
                return;
            }
        };

        if let Some(stdout) = child.stdout.take() {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if let Some(caps) = PROGRESS_RE.captures(&line) {
                    if let Ok(percent) = caps[1].parse::<f64>() {
                        let _ = app.emit("download-progress", DownloadProgressPayload {
                            id: download_id,
                            progress: percent.round() as u8,
                        });
                    }
                }
            }
        }

        let status = match child.wait().await {
            Ok(s) if s.success() => "completed",
            _ => "failed",
        };

        let _ = app.emit("download-complete", DownloadCompletePayload { 
            id: download_id, status: status.into(), path: expanded_clone 
        });
    });

    Ok(expanded)
}
