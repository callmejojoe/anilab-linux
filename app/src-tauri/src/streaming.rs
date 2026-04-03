use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

// ── Constants ─────────────────────────────────────────────────────────────────

const API_BASE: &str = "https://api.allanime.day/api";
const REFERER:  &str = "https://allmanga.to";
const UA:       &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0";

// Source name priority — tried in this order when resolving stream URLs.
const SOURCE_PRIORITY: &[&str] = &["Default", "S-mp4", "Luf-Mp4"];

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

/// Fetch the clock.json endpoint, parse the response, and return the
/// direct video URL from `links[0].link` (falling back to `links[0].src`).
async fn fetch_clock_path(client: &Client, decoded_path: &str) -> Result<String, String> {
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

    let raw = resp
        .text()
        .await
        .map_err(|e| format!("clock read error: {e}"))?;

    eprintln!("[AniLab] clock raw body ({} bytes): {}", raw.len(), raw);

    let v: Value = match serde_json::from_str(&raw) {
        Ok(v)  => v,
        Err(e) => return Err(format!("clock JSON parse error: {e}\nBody: {raw}")),
    };

    // Pretty-print for terminal inspection.
    println!("{:#?}", v);

    // Extract the video URL: links[0].link  →  links[0].src  →  error.
    if let Some(links) = v.get("links").and_then(|l| l.as_array()) {
        if let Some(first) = links.first() {
            if let Some(url) = first.get("link").and_then(|u| u.as_str()) {
                eprintln!("[AniLab] resolved stream URL: {}", url);
                return Ok(url.to_string());
            }
            if let Some(url) = first.get("src").and_then(|u| u.as_str()) {
                eprintln!("[AniLab] resolved stream URL (src): {}", url);
                return Ok(url.to_string());
            }
        }
        return Err(format!("links array present but no 'link'/'src' field found: {v}"));
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
/// 1. GraphQL → get `sourceUrls` for the episode.
/// 2. Walk SOURCE_PRIORITY to find a source whose `sourceUrl` starts with `--`.
/// 3. Strip `--`, XOR-decode the hex to get a path like `/apivtwo/clock?id=…`.
/// 4. GET `https://blog.allanime.day{path}` and log the full JSON response.
/// 5. Return DUMMY until the JSON schema is confirmed and we wire up extraction.
#[tauri::command]
pub async fn get_stream_url(
    show_id: String,
    episode: String,
    mode:    String,
) -> Result<String, String> {
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

    // Deserialise — filter_map silently skips entries missing required fields.
    let sources: Vec<SourceUrl> = source_urls_raw
        .iter()
        .filter_map(|v| serde_json::from_value(v.clone()).ok())
        .collect();

    eprintln!("[AniLab] get_stream_url: {} sources found", sources.len());
    for s in &sources {
        eprintln!("  name={:?}  url={:?}", s.source_name, &s.source_url[..s.source_url.len().min(80)]);
    }

    // Walk priority list — only consider sources with an encoded (--) URL.
    for &preferred in SOURCE_PRIORITY {
        if let Some(src) = sources.iter().find(|s| {
            s.source_name.eq_ignore_ascii_case(preferred) && s.source_url.starts_with("--")
        }) {
            let encoded = src.source_url.trim_start_matches('-');
            let decoded = decode_url(encoded);
            eprintln!("[AniLab] Chose source '{}', decoded path: {}", preferred, decoded);
            return fetch_clock_path(&client, &decoded).await;
        }
    }

    // Fallback: any encoded source.
    if let Some(src) = sources.iter().find(|s| s.source_url.starts_with("--")) {
        let encoded = src.source_url.trim_start_matches('-');
        let decoded = decode_url(encoded);
        eprintln!("[AniLab] Fallback source '{}', decoded path: {}", src.source_name, decoded);
        return fetch_clock_path(&client, &decoded).await;
    }

    Err(format!(
        "No encoded (--) sourceUrl found for show='{}' episode='{}' mode='{}'.\n\
         Available sources: {:?}",
        show_id, episode, mode,
        sources.iter().map(|s| &s.source_name).collect::<Vec<_>>()
    ))
}
