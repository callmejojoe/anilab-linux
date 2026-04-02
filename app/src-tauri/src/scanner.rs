use walkdir::WalkDir;

const VIDEO_EXTENSIONS: &[&str] = &["mkv", "mp4", "avi", "webm"];

/// Recursively walks `folder_path` and returns absolute paths of all video files.
#[tauri::command]
pub fn scan_folder(folder_path: String) -> Result<Vec<String>, String> {
    let mut files = Vec::new();

    for entry in WalkDir::new(&folder_path)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if VIDEO_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
                    if let Some(p) = path.to_str() {
                        files.push(p.to_string());
                    }
                }
            }
        }
    }

    Ok(files)
}
