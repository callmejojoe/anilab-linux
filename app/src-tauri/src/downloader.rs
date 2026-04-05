use tauri::{AppHandle, Emitter};
use std::path::Path;
use tokio::process::Command as AsyncCommand;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use std::process::Stdio;
use regex::Regex;
use once_cell::sync::Lazy;

static PROGRESS_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\[download\]\s+([\d\.]+)%(?:.*\bof\s+([~\d\.]+[a-zA-Z]+))?").unwrap());

#[derive(Clone, serde::Serialize)]
pub struct DownloadProgressPayload {
    pub id: i64,
    pub progress: u8,
    pub size_text: Option<String>,
}

fn format_size(bytes: u64) -> String {
    let kb = 1024_f64;
    let mb = kb * 1024_f64;
    let gb = mb * 1024_f64;
    let b = bytes as f64;
    if b >= gb {
        format!("{:.2}GiB", b / gb)
    } else if b >= mb {
        format!("{:.2}MiB", b / mb)
    } else if b >= kb {
        format!("{:.2}KiB", b / kb)
    } else {
        format!("{}B", bytes)
    }
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

    eprintln!("[AniLab] Background download {} → {} (URL: {})", download_id, expanded, url);

    let expanded_clone = expanded.clone();
    let url_clone = url.clone();
    
    tauri::async_runtime::spawn(async move {
        // Routing logic:
        // - SharePoint URLs → reqwest direct download (they're redirects)
        // - video.wixstatic.com → reqwest streaming
        // - .m3u8 → yt-dlp with standard flags
        // - .mp4 → reqwest streaming
        // - Other → yt-dlp standard (with stderr captured for debugging)
        
        if url_clone.contains("sharepoint.com") || url_clone.contains("video.wixstatic.com") || url_clone.ends_with(".mp4") {
            // Direct HTTP download
            let client = reqwest::Client::builder()
                .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0")
                .build()
                .unwrap();
            
            let mut res = match client.get(&url_clone).send().await {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("[AniLab Download {}] reqwest request failed: URL={}, Error={}", download_id, url_clone, e);
                    let _ = app.emit("download-complete", DownloadCompletePayload { 
                        id: download_id, status: "failed".into(), path: expanded_clone 
                    });
                    return;
                }
            };

            let status_code = res.status().as_u16();
            if !res.status().is_success() {
                eprintln!("[AniLab Download {}] HTTP error: URL={}, Status Code={}", download_id, url_clone, status_code);
                let _ = app.emit("download-complete", DownloadCompletePayload { 
                    id: download_id, status: "failed".into(), path: expanded_clone 
                });
                return;
            }

            let total_size = res.content_length().unwrap_or(0);
            let mut downloaded: u64 = 0;
            
            let mut file = match File::create(&expanded_clone).await {
                Ok(f) => f,
                Err(e) => {
                    eprintln!("[AniLab Download {}] file creation failed: URL={}, Error={}", download_id, url_clone, e);
                    let _ = app.emit("download-complete", DownloadCompletePayload { 
                        id: download_id, status: "failed".into(), path: expanded_clone 
                    });
                    return;
                }
            };
            
            let mut last_progress = 0;
            while let Ok(Some(chunk)) = res.chunk().await {
                if let Err(e) = file.write_all(&chunk).await {
                    eprintln!("[AniLab Download {}] file write failed: URL={}, Error={}", download_id, url_clone, e);
                    let _ = app.emit("download-complete", DownloadCompletePayload { 
                        id: download_id, status: "failed".into(), path: expanded_clone 
                    });
                    return;
                }
                downloaded += chunk.len() as u64;
                if total_size > 0 {
                    let progress = ((downloaded as f64 / total_size as f64) * 100.0).round() as u8;
                    if progress > last_progress {
                        last_progress = progress;
                        let _ = app.emit("download-progress", DownloadProgressPayload {
                            id: download_id,
                            progress,
                            size_text: Some(format_size(total_size as u64)),
                        });
                    }
                }
            }
            
            let status = if total_size > 0 && downloaded < total_size { "failed" } else { "completed" };
            let _ = app.emit("download-complete", DownloadCompletePayload { 
                id: download_id, status: status.into(), path: expanded_clone 
            });
        } else {
            // yt-dlp for HLS and other formats
            let mut child = match AsyncCommand::new("yt-dlp")
                .args(["--newline", "-o", &expanded_clone, &url_clone])
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
            {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[AniLab Download {}] yt-dlp spawn failed: URL={}, Error={}", download_id, url_clone, e);
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
                            let size_text = caps.get(2).map(|m| m.as_str().to_string());
                            let _ = app.emit("download-progress", DownloadProgressPayload {
                                id: download_id,
                                progress: percent.round() as u8,
                                size_text,
                            });
                        }
                    }
                }
            }

            // Capture stderr for error diagnostics
            let mut stderr_output = String::new();
            if let Some(stderr) = child.stderr.take() {
                let mut reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    stderr_output.push_str(&line);
                    stderr_output.push('\n');
                }
            }

            let status = match child.wait().await {
                Ok(s) if s.success() => "completed",
                Ok(s) => {
                    eprintln!("[AniLab Download {}] yt-dlp exit code {}: URL={}\nStderr:\n{}", download_id, s.code().unwrap_or(-1), url_clone, stderr_output);
                    "failed"
                },
                Err(e) => {
                    eprintln!("[AniLab Download {}] yt-dlp error: URL={}, Error={}", download_id, url_clone, e);
                    "failed"
                }
            };

            let _ = app.emit("download-complete", DownloadCompletePayload { 
                id: download_id, status: status.into(), path: expanded_clone 
            });
        }
    });

    Ok(expanded)
}
