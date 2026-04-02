use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;

// ── GraphQL response types ────────────────────────────────────────────────────

#[derive(Debug, Deserialize, Serialize)]
pub struct AnimeTitle {
    pub romaji: Option<String>,
    pub english: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CoverImage {
    pub large: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeResult {
    pub id: i64,
    pub title: AnimeTitle,
    pub cover_image: CoverImage,
    pub episodes: Option<i64>,
    pub status: Option<String>,
    pub average_score: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct PageMedia {
    media: Vec<AnimeResult>,
}

#[derive(Debug, Deserialize)]
struct PageData {
    #[serde(rename = "Page")]
    page: PageMedia,
}

#[derive(Debug, Deserialize)]
struct GqlResponse {
    data: PageData,
}

// ── Tauri command ─────────────────────────────────────────────────────────────

const ANILIST_URL: &str = "https://graphql.anilist.co";

const QUERY: &str = "
query ($search: String) {
  Page(perPage: 10) {
    media(search: $search, type: ANIME) {
      id
      title { romaji english }
      coverImage { large }
      episodes
      status
      averageScore
    }
  }
}
";

/// Reusable internal function — performs the AniList search and returns results.
pub async fn fetch_anime(client: &Client, query: &str) -> Result<Vec<AnimeResult>, String> {
    let body = json!({
        "query": QUERY,
        "variables": { "search": query }
    });

    let response = client
        .post(ANILIST_URL)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    let gql: GqlResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {e}"))?;

    Ok(gql.data.page.media)
}

#[tauri::command]
pub async fn search_anime(query: String) -> Result<Vec<AnimeResult>, String> {
    let client = Client::new();
    fetch_anime(&client, &query).await
}
