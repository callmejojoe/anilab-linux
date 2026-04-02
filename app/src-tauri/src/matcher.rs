use crate::anilist::{fetch_anime, AnimeResult};
use once_cell::sync::Lazy;
use regex::Regex;
use reqwest::Client;
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

// ── Return type tehe───────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct MatchedAnime {
    pub file_path: String,
    pub anime_id: Option<i64>,
    pub title: Option<String>,
    pub cover_image: Option<String>,
    pub episodes: Option<i64>,
    pub status: Option<String>,
}

// ── Static compiled regexes ───────────────────────────────────────────────────

/// Bracket / parenthesis tags: [HorribleSubs], (1080p), etc.
static RE_BRACKETS: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[\[\(][^\]\)]*[\]\)]").unwrap());

/// Episode markers: " - 01", E01, EP01, Episode 01 (case-insensitive)
static RE_EPISODE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)(\s*-\s*\d{1,3}|[_ ]?ep?\d{1,3}|[_ ]?episode[_ ]?\d{1,3})").unwrap());

/// Resolution tags: 1080p, 720p, 480p, 4K, etc.
static RE_RESOLUTION: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\b(4k|2160p|1080p|720p|480p|360p)\b").unwrap());

/// Common codec / format junk: x264, x265, HEVC, BluRay, WEB-DL, etc.
static RE_JUNK: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)\b(x264|x265|hevc|avc|bluray|blu-ray|web-?dl|webrip|dvdrip|aac|flac|mp3|10bit|8bit|hi10p)\b").unwrap());

/// Release-group @ tags: @Anime_Nation, @SubsPlease, etc.
static RE_AT_TAG: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"@\S+").unwrap());

/// Multiple consecutive spaces / dashes left over after stripping
static RE_CLEANUP: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"[\s_\-]{2,}").unwrap());

// ── Title extraction ──────────────────────────────────────────────────────────

/// Applies the full cleaning pipeline to any string (stem or folder name).
fn clean_string(raw: &str) -> String {
    let mut s = raw.replace('_', " ");
    s = RE_AT_TAG.replace_all(&s, " ").to_string();
    s = RE_BRACKETS.replace_all(&s, " ").to_string();
    s = RE_EPISODE.replace_all(&s, " ").to_string();
    s = RE_RESOLUTION.replace_all(&s, " ").to_string();
    s = RE_JUNK.replace_all(&s, " ").to_string();
    s = RE_CLEANUP.replace_all(&s, " ").to_string();
    s.trim().trim_matches('-').trim().to_string()
}

/// Returns true when the cleaned title carries no real show name —
/// e.g. purely numeric, a bare version token, starts with "ep"/"e0", etc.
fn looks_like_episode_only(s: &str) -> bool {
    if s.is_empty() {
        return true;
    }
    let lower = s.to_lowercase();
    // Purely numeric (timestamps, raw ep numbers)
    if lower.chars().all(|c| c.is_ascii_digit() || c == '.' || c == ' ') {
        return true;
    }
    // Starts with episode marker remnants
    if lower.starts_with("ep") || lower.starts_with("e0") || lower.starts_with("e1")
        || lower.starts_with("e2") || lower.starts_with("e3")
    {
        return true;
    }
    // Version-only token: "v2", "v3", etc.
    if lower.len() <= 3 && lower.starts_with('v') && lower[1..].chars().all(|c| c.is_ascii_digit()) {
        return true;
    }
    // Very short leftovers (≤ 2 chars) are not useful titles
    if s.chars().count() <= 2 {
        return true;
    }
    false
}

fn extract_title(file_path: &str) -> String {
    let path = Path::new(file_path);

    // 1. Try the filename stem
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let from_stem = clean_string(stem);

    if !looks_like_episode_only(&from_stem) {
        return from_stem;
    }

    // 2. Fall back to the immediate parent folder name
    let from_folder = path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .map(clean_string)
        .unwrap_or_default();

    from_folder
}


// ── Tauri command ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn match_anime(files: Vec<String>) -> Result<Vec<MatchedAnime>, String> {
    let client = Client::new();

    // Map extracted title → list of file paths sharing that title
    let mut title_to_files: HashMap<String, Vec<String>> = HashMap::new();
    for path in &files {
        let title = extract_title(path);
        title_to_files
            .entry(title)
            .or_default()
            .push(path.clone());
    }

    // For each unique title, fetch the top AniList result
    let mut results: Vec<MatchedAnime> = Vec::new();

    for (title, paths) in &title_to_files {
        let top: Option<AnimeResult> = if title.is_empty() {
            None
        } else {
            fetch_anime(&client, title)
                .await
                .ok()
                .and_then(|mut v| if v.is_empty() { None } else { Some(v.remove(0)) })
        };

        for file_path in paths {
            results.push(match &top {
                Some(anime) => MatchedAnime {
                    file_path: file_path.clone(),
                    anime_id: Some(anime.id),
                    title: anime
                        .title
                        .english
                        .clone()
                        .or_else(|| anime.title.romaji.clone()),
                    cover_image: anime.cover_image.large.clone(),
                    episodes: anime.episodes,
                    status: anime.status.clone(),
                },
                None => MatchedAnime {
                    file_path: file_path.clone(),
                    anime_id: None,
                    title: Some(title.clone()),
                    cover_image: None,
                    episodes: None,
                    status: None,
                },
            });
        }
    }

    Ok(results)
}
