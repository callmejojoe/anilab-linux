use reqwest::Client;
use serde::{Deserialize, Serialize};

const BASE: &str = "https://aniwatch-api-v1-0.onrender.com";

// ── Percent-encode a path segment ────────────────────────────────────────────

fn pct_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9'
            | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

// ── Aniwatch API response shapes ──────────────────────────────────────────────

#[derive(Deserialize)]
struct SearchResponse {
    #[serde(rename = "searchYour")]
    search_your: Option<Vec<SearchItem>>,
}

#[derive(Deserialize)]
struct SearchItem {
    idanime: Option<String>,
    name:    Option<String>,
    img:     Option<String>,
    totalep: Option<serde_json::Value>,
    sub:     Option<serde_json::Value>,
    dub:     Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct EpisodeResponse {
    episodetown: Option<Vec<EpisodeItem>>,
}

#[derive(Deserialize)]
struct EpisodeItem {
    order: Option<serde_json::Value>,
    name:  Option<String>,
    #[serde(rename = "epId")]
    ep_id: Option<String>,
}

#[derive(Deserialize)]
struct ServerResponse {
    sub: Option<Vec<ServerEntry>>,
    dub: Option<Vec<ServerEntry>>,
}

#[derive(Deserialize)]
struct ServerEntry {
    #[serde(rename = "srcId")]
    src_id: Option<String>,
}

#[derive(Deserialize)]
struct SrcServerResponse {
    #[serde(rename = "serverSrc")]
    server_src: Option<Vec<SrcEntry>>,
}

#[derive(Deserialize)]
struct SrcEntry {
    rest: Option<Vec<RestEntry>>,
}

/// Capture all known fields; the API may return label/type/quality/file.
#[derive(Deserialize, Debug)]
struct RestEntry {
    file:    Option<String>,
    #[serde(rename = "type")]
    kind:    Option<String>,
    label:   Option<String>,
    quality: Option<serde_json::Value>,
}

// ── Public return types ───────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct OnlineAnime {
    pub idanime: String,
    pub name:    String,
    pub img:     Option<String>,
    pub totalep: Option<i64>,
    pub sub:     Option<i64>,
    pub dub:     Option<i64>,
}

#[derive(Serialize)]
pub struct OnlineEpisode {
    pub order: i64,
    pub name:  String,
    pub ep_id: String,
}

/// A single quality/stream source returned by get_stream_url.
#[derive(Serialize)]
pub struct StreamSource {
    pub url:     String,
    pub label:   String,
    pub kind:    String,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Collect up to `limit` srcIds from a server entry list.
fn collect_src_ids(entries: Option<&Vec<ServerEntry>>, limit: usize) -> Vec<String> {
    entries
        .map(|v| {
            v.iter()
                .filter_map(|e| e.src_id.clone())
                .take(limit)
                .collect()
        })
        .unwrap_or_default()
}

/// Infer a quality label from a URL path (e.g. "1080p" if "1080" appears).
fn quality_from_url(url: &str) -> String {
    for q in &["2160", "1080", "720", "480", "360"] {
        if url.contains(q) {
            return format!("{}p", q);
        }
    }
    "HD".to_string()
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Search Aniwatch for an anime by name (first result page).
#[tauri::command]
pub async fn search_online(query: String) -> Result<Vec<OnlineAnime>, String> {
    let client = Client::new();
    let url = format!("{}/api/search/{}/1", BASE, pct_encode(&query));

    let resp: SearchResponse = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let results = resp
        .search_your
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| {
            Some(OnlineAnime {
                idanime: item.idanime?,
                name:    item.name.unwrap_or_default(),
                img:     item.img,
                totalep: item.totalep.as_ref().and_then(|v| v.as_i64()),
                sub:     item.sub.as_ref().and_then(|v| v.as_i64()),
                dub:     item.dub.as_ref().and_then(|v| v.as_i64()),
            })
        })
        .collect();

    Ok(results)
}

/// Return the episode list for an Aniwatch anime ID.
#[tauri::command]
pub async fn get_episodes(idanime: String) -> Result<Vec<OnlineEpisode>, String> {
    let client = Client::new();
    let url = format!("{}/api/episode/{}", BASE, idanime);

    let resp: EpisodeResponse = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let episodes = resp
        .episodetown
        .unwrap_or_default()
        .into_iter()
        .filter_map(|ep| {
            Some(OnlineEpisode {
                order: ep.order.as_ref().and_then(|v| v.as_i64()).unwrap_or(0),
                name:  ep.name.unwrap_or_default(),
                ep_id: ep.ep_id?,
            })
        })
        .collect();

    Ok(episodes)
}

/// Chain /api/server → try multiple src-server endpoint patterns.
/// Logs raw JSON to stderr and retries with fallback srcIds and endpoint paths.
#[tauri::command]
pub async fn get_stream_url(ep_id: String, prefer_dub: bool) -> Result<Vec<StreamSource>, String> {
    let client = Client::new();

    // Step 1: get server list
    let server_url = format!("{}/api/server/{}", BASE, ep_id);
    let server_resp: ServerResponse = client
        .get(&server_url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    // Collect src ids in preferred order (up to 2 of each track)
    let (primary, fallback) = if prefer_dub {
        (collect_src_ids(server_resp.dub.as_ref(), 2),
         collect_src_ids(server_resp.sub.as_ref(), 2))
    } else {
        (collect_src_ids(server_resp.sub.as_ref(), 2),
         collect_src_ids(server_resp.dub.as_ref(), 2))
    };

    let src_ids: Vec<String> = primary.into_iter().chain(fallback).take(4).collect();
    if src_ids.is_empty() {
        return Err("No stream servers listed for this episode".to_string());
    }

    // These endpoint patterns are tried in order for each srcId
    let path_patterns: &[&str] = &[
        "/api/src-server/{}",
        "/api/source/{}",
        "/api/episode-src/{}",
        "/api/stream/{}",
    ];

    let mut last_error = String::from("All endpoint patterns exhausted");

    for src_id in &src_ids {
        for pattern in path_patterns {
            let url = format!("{}{}", BASE, pattern.replace("{}", src_id));

            let raw = match client.get(&url).send().await {
                Ok(r) => match r.text().await {
                    Ok(t) => t,
                    Err(e) => { last_error = e.to_string(); continue; }
                },
                Err(e) => { last_error = e.to_string(); continue; }
            };

            eprintln!("[AniLab] {} (srcId={}):\n{}", url, src_id, &raw[..raw.len().min(600)]);

            // If the API returned an error JSON, try the next pattern
            if raw.contains("\"error\"") && !raw.contains("\"serverSrc\"") && !raw.contains("\"file\"") {
                last_error = format!("API error from {}: {}", url, &raw[..raw.len().min(120)]);
                continue;
            }

            let src_resp: SrcServerResponse = match serde_json::from_str(&raw) {
                Ok(v) => v,
                Err(e) => {
                    last_error = format!("JSON parse error ({url}): {e}");
                    continue;
                }
            };

            let rest_entries: Vec<&RestEntry> = src_resp
                .server_src
                .as_ref()
                .and_then(|v| v.first())
                .and_then(|s| s.rest.as_ref())
                .map(|r| r.iter().collect())
                .unwrap_or_default();

            if rest_entries.is_empty() {
                last_error = format!("Empty rest[] from {url}");
                continue;
            }

            let sources: Vec<StreamSource> = rest_entries
                .into_iter()
                .filter_map(|entry| {
                    let url = entry.file.clone()?;
                    let label = entry.label.clone()
                        .or_else(|| entry.quality.as_ref().and_then(|q| q.as_str().map(String::from)))
                        .or_else(|| entry.quality.as_ref().and_then(|q| q.as_i64().map(|n| format!("{}p", n))))
                        .unwrap_or_else(|| quality_from_url(&url));
                    let kind = entry.kind.clone().unwrap_or_else(|| "hls".to_string());
                    Some(StreamSource { url, label, kind })
                })
                .collect();

            if !sources.is_empty() {
                return Ok(sources);
            }
        }
    }

    Err(format!(
        "The Aniwatch streaming API is returning errors for all servers.\n\
         This is an upstream issue with the hosted API (aniwatch-api-v1-0.onrender.com).\n\
         Try again later or self-host the API.\n\
         Last error: {last_error}\n\
         srcIds tried: {}", src_ids.join(", ")
    ))
}
