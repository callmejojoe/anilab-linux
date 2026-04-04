use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

// ── Constants ─────────────────────────────────────────────────────────────────

const API_BASE: &str = "https://api.allanime.day/api";
const REFERER:  &str = "https://allmanga.to";
const UA:       &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0";

// Source priority is defined locally inside get_stream_url so it can be
// adjusted without touching constants. See that function for the ordered list.

// ── Public return types ───────────────────────────────────────────────────────

#[derive(Serialize, Debug)]
pub struct OnlineAnime {
    pub id:           String,
    pub name:         String,
    pub episodes_sub: i64,
    pub episodes_dub: i64,
}

#[derive(Serialize, Debug)]
pub struct OnlineEpisode {
    pub episode: String,
}

#[derive(Serialize, Debug)]
pub struct VideoQuality {
    pub resolution: String,
    pub url: String,
}

// ── Internal deserialisation types ───────────────────────────────────────────

#[derive(Deserialize, Debug)]
struct ShowEdge {
    #[serde(rename = "_id")]
    id: String,
    name: String,
    #[serde(rename = "availableEpisodes")]
    available_episodes: AvailableEpisodes,
}

#[derive(Deserialize, Debug)]
struct AvailableEpisodes {
    sub: i64,
    dub: i64,
}

#[derive(Deserialize, Debug)]
struct EpisodeDetail {
    sub: Option<Vec<String>>,
    dub: Option<Vec<String>>,
}

#[derive(Deserialize, Debug)]
struct SourceUrl {
    #[serde(rename = "sourceUrl")]
    source_url: String,
    #[serde(rename = "sourceName")]
    source_name: String,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Build the shared reqwest Client with AllAnime-required headers baked in.
fn get_client() -> Client {
    Client::builder()
        .user_agent(UA)
        .build()
        .unwrap()
}

/// Decode an obfuscated AllAnime source URL.
///
/// The URL is hex-encoded with each byte XOR'd with 56. Strip the leading `--`
/// prefix before passing here.
fn decode_url(encoded: &str) -> String {
    encoded
        .as_bytes()
        .chunks(2)
        .filter_map(|c| std::str::from_utf8(c).ok())
        .filter_map(|h| u8::from_str_radix(h, 16).ok())
        .map(|b| (b ^ 56) as char)
        .collect()
}

/// Send a GraphQL POST to the AllAnime API and return the parsed JSON body.
async fn gql(client: &Client, query: &str, variables: Value) -> Result<Value, String> {
    let payload = json!({ "query": query, "variables": variables });

    eprintln!("[AniLab] GQL POST {}", API_BASE);

    let resp = client
        .post(API_BASE)
        .header("Referer", REFERER)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("HTTP error: {e}"))?;

    let status = resp.status();
    let body: Value = resp
        .json()
        .await
        .map_err(|e| format!("JSON parse error: {e}"))?;

    eprintln!("[AniLab] GQL status={}", status);

    if !status.is_success() {
        return Err(format!("API returned HTTP {status}: {body}"));
    }

    Ok(body)
}

/// Fetch the clock.json endpoint, parse the response, and return all available
/// quality options as a `Vec<VideoQuality>` by iterating through `links`.
///
/// Returns `Err` on any HTTP, parse, or structural failure so callers can
/// silently `continue` to the next source instead of hard-failing.
async fn fetch_clock_path(client: &Client, decoded_path: &str) -> Result<Vec<VideoQuality>, String> {
    let final_path = decoded_path.replace("/clock", "/clock.json");
    let clock_url = format!("https://allanime.day{}", final_path);

    eprintln!("[AniLab] clock URL: {}", clock_url);

    let resp = client
        .get(&clock_url)
        .header("Referer", REFERER)
        .send()
        .await
        .map_err(|e| format!("clock HTTP error: {e}"))?;

    let status = resp.status();
    eprintln!("[AniLab] clock HTTP status: {}", status);

    // Treat any non-2xx response as a soft failure — caller will continue loop.
    if !status.is_success() {
        return Err(format!("clock returned HTTP {status}"));
    }

    let raw = resp
        .text()
        .await
        .map_err(|e| format!("clock read error: {e}"))?;

    eprintln!("[AniLab] clock raw body ({} bytes): {}", raw.len(), raw);

    if raw.trim().is_empty() {
        return Err("clock response body was empty".to_string());
    }

    let v: Value = match serde_json::from_str(&raw) {
        Ok(v)  => v,
        Err(e) => return Err(format!("clock JSON parse error: {e}\nBody: {raw}")),
    };

    // Pretty-print for terminal inspection.
    println!("{:#?}", v);

    // Iterate through all entries in `links`, extracting resolution + URL.
    if let Some(links) = v.get("links").and_then(|l| l.as_array()) {
        let mut qualities: Vec<VideoQuality> = Vec::new();
        for entry in links {
            let url = match entry.get("link").or_else(|| entry.get("src")).and_then(|u| u.as_str()) {
                Some(u) => u.to_string(),
                None => continue,
            };

            let resolution = entry
                .get("resolutionStr")
                .and_then(|r| r.as_str())
                .unwrap_or("Auto")
                .to_string();

            if url.contains("repackager.wixmp.com/video.wixstatic.com/video/") {
                if let Some(start) = url.find("/video.wixstatic.com/video/") {
                    let remainder = &url[start + 27..];
                    let parts: Vec<&str> = remainder.split("/,").collect();
                    if parts.len() >= 2 {
                        let video_id = parts[0];
                        let after_comma = parts[1];
                        if let Some(end_idx) = after_comma.find(",/mp4") {
                            let qualities_str = &after_comma[..end_idx];
                            for q in qualities_str.split(',') {
                                if !q.is_empty() {
                                    let direct_url = format!("https://video.wixstatic.com/video/{}/{}/mp4/file.mp4", video_id, q);
                                    eprintln!("[AniLab] quality found: {} → {}", q, direct_url);
                                    qualities.push(VideoQuality { resolution: q.to_string(), url: direct_url });
                                }
                            }
                            eprintln!("[AniLab] quality found: Auto (HLS) → {}", url);
                            qualities.push(VideoQuality { resolution: "Auto (HLS)".to_string(), url: url.clone() });
                            continue;
                        }
                    }
                }
            }

            eprintln!("[AniLab] quality found: {} → {}", resolution, url);
            qualities.push(VideoQuality { resolution, url });
        }

        if qualities.is_empty() {
            return Err(format!("links array present but no usable entries found: {v}"));
        }

        // Deduplicate by URL to avoid redundant entries.
        qualities.dedup_by(|a, b| a.url == b.url);
        return Ok(qualities);
    }

    Err(format!("No 'links' array in clock response: {v}"))
}


// ── Tauri commands ────────────────────────────────────────────────────────────

/// Search AllAnime for anime by name.
///
/// Returns up to 40 results with sub/dub episode counts.
#[tauri::command]
pub async fn search_online(query: String) -> Result<Vec<OnlineAnime>, String> {
    let client = get_client();

    let gql_query = r#"
        query($search:SearchInput $limit:Int $page:Int $translationType:VaildTranslationTypeEnumType $countryOrigin:VaildCountryOriginEnumType){
            shows(search:$search limit:$limit page:$page translationType:$translationType countryOrigin:$countryOrigin){
                edges{
                    _id
                    name
                    availableEpisodes
                }
            }
        }
    "#;

    let variables = json!({
        "search": {
            "allowAdult": false,
            "query": query
        },
        "limit": 40,
        "page": 1,
        "translationType": "sub",
        "countryOrigin": "ALL"
    });

    let body = gql(&client, gql_query, variables).await?;

    let edges = body
        .pointer("/data/shows/edges")
        .and_then(|e| e.as_array())
        .ok_or_else(|| format!("Unexpected response shape: {body}"))?;

    let results = edges
        .iter()
        .filter_map(|edge| {
            let id   = edge.get("_id")?.as_str()?.to_string();
            let name = edge.get("name")?.as_str()?.to_string();
            let eps  = edge.get("availableEpisodes")?;
            let sub  = eps.get("sub").and_then(|v| v.as_i64()).unwrap_or(0);
            let dub  = eps.get("dub").and_then(|v| v.as_i64()).unwrap_or(0);
            Some(OnlineAnime { id, name, episodes_sub: sub, episodes_dub: dub })
        })
        .collect::<Vec<_>>();

    eprintln!("[AniLab] search_online: {} results for '{}'", results.len(), query);
    Ok(results)
}

/// Fetch the list of available episode numbers for a show.
///
/// Returns episode numbers as strings (e.g. `["1","2","2.5","3"]`) in the
/// order the API provides them (usually ascending).
#[tauri::command]
pub async fn get_episodes(show_id: String, mode: String) -> Result<Vec<String>, String> {
    let client = get_client();

    let gql_query = r#"
        query($showId:String!){
            show(_id:$showId){
                _id
                availableEpisodesDetail
            }
        }
    "#;

    let variables = json!({ "showId": show_id });

    let body = gql(&client, gql_query, variables).await?;

    let detail = body
        .pointer("/data/show/availableEpisodesDetail")
        .ok_or_else(|| format!("Unexpected response shape: {body}"))?;

    let episode_detail: EpisodeDetail = serde_json::from_value(detail.clone())
        .map_err(|e| format!("Failed to parse availableEpisodesDetail: {e}"))?;

    let episodes = match mode.to_lowercase().as_str() {
        "dub" => episode_detail.dub.unwrap_or_default(),
        _     => episode_detail.sub.unwrap_or_default(),
    };

    eprintln!(
        "[AniLab] get_episodes: {} episodes ({}) for show '{}'",
        episodes.len(), mode, show_id
    );

    Ok(episodes)
}

/// Resolve a playable stream URL for a specific episode.
///
/// Pipeline:
/// 1. GraphQL → fetch `sourceUrls` for the episode.
/// 2. Walk SOURCE_PRIORITY. For each matching encoded source:
///    - Condition A: decoded URL starts with `"http"` AND is `.m3u8` or `.mp4` → return directly.
///      If the URL is neither, it is an iframe/webpage — skip it.
///    - Condition B: decoded URL starts with `"/apivtwo"` → fetch clock.json.
///      On failure (500, parse error, empty body) log and continue to next source.
/// 3. Fallback: walk any remaining encoded source not in the priority list.
/// 4. Return Err only if all sources are exhausted.
#[tauri::command]
pub async fn get_stream_url(
    show_id: String,
    episode: String,
    mode:    String,
) -> Result<Vec<VideoQuality>, String> {
    let client = get_client();

    let gql_query = r#"
        query($showId:String!,$translationType:VaildTranslationTypeEnumType!,$episodeString:String!){
            episode(showId:$showId translationType:$translationType episodeString:$episodeString){
                episodeString
                sourceUrls
            }
        }
    "#;

    let translation_type = if mode.to_lowercase() == "dub" { "dub" } else { "sub" };

    let variables = json!({
        "showId":          show_id,
        "translationType": translation_type,
        "episodeString":   episode
    });

    let body = gql(&client, gql_query, variables).await?;

    let source_urls_raw = body
        .pointer("/data/episode/sourceUrls")
        .and_then(|v| v.as_array())
        .ok_or_else(|| format!("No sourceUrls in response: {body}"))?;

    let sources: Vec<SourceUrl> = source_urls_raw
        .iter()
        .filter_map(|v| serde_json::from_value(v.clone()).ok())
        .collect();

    eprintln!("[AniLab] get_stream_url: {} sources found", sources.len());
    for s in &sources {
        eprintln!("  name={:?}  url={:?}", s.source_name, &s.source_url[..s.source_url.len().min(80)]);
    }

    // ── Priority loop ─────────────────────────────────────────────────────────
    // Priority order: reliable HLS-capable sources first, S-mp4 last-resort.
    let priority: &[&str] = &["Luf-Mp4", "Default", "Fm-Hls", "Ss-Hls", "S-mp4"];

    for &preferred in priority {
        let src = match sources.iter().find(|s| {
            s.source_name.eq_ignore_ascii_case(preferred) && s.source_url.starts_with("--")
        }) {
            Some(s) => s,
            None    => continue,
        };

        let encoded = src.source_url.trim_start_matches('-');
        let decoded = decode_url(encoded);
        eprintln!("[AniLab] Trying source '{}', decoded: {}", preferred, decoded);

        // Condition A: already a full URL.
        // Ban 1: Yt-mp4 source — always serves Fast4Speed iframe pages.
        // Ban 2: any URL containing "fast4speed" in the domain — iframe, not a video file.
        // Ban 3: URLs that are neither .m3u8 nor .mp4 are treated as iframes and skipped.
        if decoded.starts_with("http") {
            let is_banned_source = preferred.eq_ignore_ascii_case("Yt-mp4");
            let is_banned_domain = decoded.to_lowercase().contains("fast4speed");
            let is_video         = decoded.contains(".m3u8") || decoded.contains(".mp4");

            if is_banned_source || is_banned_domain || !is_video {
                eprintln!(
                    "[AniLab] Source '{}' skipped — banned_source={} banned_domain={} is_video={}: {}",
                    preferred, is_banned_source, is_banned_domain, is_video, decoded
                );
                continue;
            }

            eprintln!("[AniLab] Source '{}' decoded to a direct video URL, using as-is.", preferred);
            return Ok(vec![VideoQuality { resolution: "Auto".to_string(), url: decoded }]);
        }

        // Condition B: clock path — attempt fetch, continue loop on any failure.
        if decoded.starts_with("/apivtwo") {
            match fetch_clock_path(&client, &decoded).await {
                Ok(qualities) => {
                    eprintln!("[AniLab] Source '{}' resolved {} quality option(s).", preferred, qualities.len());
                    return Ok(qualities);
                }
                Err(e) => {
                    eprintln!("[AniLab] Source '{}' clock fetch failed ({}), trying next.", preferred, e);
                    continue;
                }
            }
        }

        // Decoded to something unexpected — log and skip.
        eprintln!("[AniLab] Source '{}' decoded to unknown path '{}', skipping.", preferred, decoded);
    }

    // ── Fallback: any remaining encoded source not matched above ──────────────
    for src in sources.iter().filter(|s| s.source_url.starts_with("--")) {
        let encoded = src.source_url.trim_start_matches('-');
        let decoded = decode_url(encoded);
        eprintln!("[AniLab] Fallback source '{}', decoded: {}", src.source_name, decoded);

        if decoded.starts_with("http") {
            let is_banned_domain = decoded.to_lowercase().contains("fast4speed");
            let is_banned_source = src.source_name.eq_ignore_ascii_case("Yt-mp4");
            let is_video         = decoded.contains(".m3u8") || decoded.contains(".mp4");

            if is_banned_source || is_banned_domain || !is_video {
                eprintln!(
                    "[AniLab] Fallback source '{}' skipped — banned={} no_video_ext={}: {}",
                    src.source_name, is_banned_source || is_banned_domain, !is_video, decoded
                );
                continue;
            }
            return Ok(vec![VideoQuality { resolution: "Auto".to_string(), url: decoded }]);
        }

        if decoded.starts_with("/apivtwo") {
            match fetch_clock_path(&client, &decoded).await {
                Ok(qualities) => return Ok(qualities),
                Err(e) => {
                    eprintln!("[AniLab] Fallback source '{}' failed ({}), continuing.", src.source_name, e);
                    continue;
                }
            }
        }
    }

    Err(format!(
        "All sources exhausted for show='{}' episode='{}' mode='{}'.\n\
         Tried priority: {:?}\n\
         Available sources: {:?}",
        show_id, episode, mode,
        priority,
        sources.iter().map(|s| &s.source_name).collect::<Vec<_>>()
    ))
}
