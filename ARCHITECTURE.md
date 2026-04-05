# AniLab: Technical Specification & Architecture Manual

This manual is for developers who want to understand, extend, or replicate the AniLab application. It covers every technical detail from the binary dependencies to the XOR decryption logic used for streaming.

---

## 1. System Setup & Tooling

To run or build AniLab, the following environment is required:

### Binary Dependencies (Must be in PATH)
- **Rust & Cargo**: Stable toolchain (edition 2021).
- **Node.js & NPM**: For the frontend and Tauri CLI.
- **mpv**: The primary media player engine.
- **yt-dlp**: Required for HLS stream downloading and metadata extraction.

### Project Initialization
```bash
# Install Tauri CLI
npm install -g @tauri-apps/cli

# Install dependencies (from project root)
cd app
npm install

# Run in Development mode
npm run tauri dev
```

---

## 2. Project Topology

```text
/home/joejo/repos/anilab-linux/
├── ARCHITECTURE.md           # This manual
├── app/
│   ├── src/                  # FRONTEND (Webview)
│   │   ├── index.html        # App Shell & UI Layout
│   │   ├── main.js           # Core SPA Logic & IPC
│   │   ├── styles.css        # Coffee-themed Dark Design System
│   │   └── assets/           # UI Icons & Static Media
│   └── src-tauri/            # BACKEND (Rust)
│       ├── Cargo.toml        # Backend Dependencies
│       ├── tauri.conf.json   # Tauri Config (Permissions, Icons, Version)
│       └── src/
│           ├── main.rs       # Entrypoint (Registers Commands)
│           ├── lib.rs        # Tauri setup & command definitions
│           ├── db.rs         # SQLite (rusqlite) & Persistence logic
│           ├── streaming.rs  # AllAnime GraphQL & Decoder
│           ├── downloader.rs # yt-dlp Async Wrapper
│           ├── anilist.rs    # Metadata fetching (AniList)
│           ├── matcher.rs    # Regex-based Filename Cleaning
│           ├── scanner.rs    # Recursive File System Scanner
│           └── player.rs     # mpv Process Orchestration
```

---

## 3. Database Encyclopedia (SQLite)

AniLab uses a local SQLite database (`anilab.db`) managed via `rusqlite`.

### SQL Schema (`db.rs`)
```sql
CREATE TABLE IF NOT EXISTS anime (
    id          INTEGER PRIMARY KEY,
    title       TEXT NOT NULL,
    cover_image TEXT,
    episodes    INTEGER,
    status      TEXT,
    score       INTEGER,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS library (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    anime_id       INTEGER REFERENCES anime(id),
    folder_path    TEXT NOT NULL,
    episode_file   TEXT,
    episode_number INTEGER,
    watched        INTEGER DEFAULT 0,
    UNIQUE(episode_file)
);

CREATE TABLE IF NOT EXISTS history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    anime_id    TEXT,
    title       TEXT,
    episode     TEXT,
    source      TEXT,
    watched_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS downloads (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    anime_id     TEXT,
    title        TEXT,
    episode      TEXT,
    save_path    TEXT,
    status       TEXT DEFAULT 'downloading',
    progress     INTEGER DEFAULT 0,
    started_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);
```

---

## 4. Backend Logic Specifications

### AllAnime Decryption (`streaming.rs`)
Streaming URLs from AllAnime are hex-encoded and XOR-obfuscated.
- **Key**: `56` (Decimal).
- **Process**:
  1. Remove the leading `--` (if present) from the encoded string.
  2. Iterate through hex-pairs (2 characters).
  3. Convert each pair to a byte.
  4. Perform `byte ^ 56`.
  5. Collect characters to reconstruct the URL.

### Metadata GraphQL (AniList)
AniLab uses the following query for show identification:
```graphql
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
```

### Filename "Cleaning" Regex (`matcher.rs`)
To match local files with AniList metadata, filenames are processed through:
1. **Bracket Stripping**: `[\[\(][^\]\)]*[\]\)]` (Removes [HorribleSubs], etc.)
2. **Episode Tokens**: `(?i)(\s*-\s*\d{1,3}|[_ ]?ep?\d{1,3}|[_ ]?episode[_ ]?\d{1,3})` (Removes - 01)
3. **Resolution**: `(?i)\b(4k|2160p|1080p|720p|480p|360p)\b`
4. **Junk Tags**: Codecs like `x264`, `x265`, `HEVC`, etc. are removed using a whitelist regex.

---

## 5. Downloader Architecture

AniLab implements an asynchronous download manager in `downloader.rs`.

### Real-time Progress Monitoring
We spawn `yt-dlp` as a child process:
- **Command**: `yt-dlp --newline -o <output_path> <url>`
- **Progress Extraction**: A Regex `\[download\]\s+([\d\.]+)%` parses the percentage from the child's `stdout`.
- **IPC Event**: Emits a `download-progress` event to the frontend containing `{ id, progress, size_text }`.

---

## 6. Frontend IPC & Tauri Bridge

Communication between the Webview and Rust backend happens via **Tauri Commands** and **Global Events**.

### Global Events (Main.js Listeners)
- `download-progress`: Updates the persistent footer progress bar.
- `download-complete`: Triggers a toast and refreshes the downloads list.

### Essential Tauri Commands
| Command | Arguments | Purpose |
|---------|-----------|---------|
| `get_library` | None | Fetches all shows + episodes from DB |
| `search_online` | `query: String` | GraphQL search on AllAnime |
| `get_episodes` | `show_id, mode` | List episode numbers for a show |
| `get_stream_url` | `show_id, ep, mode` | Decrypts & resolves stream links |
| `download_episode` | `url, path, id` | Triggers the async `yt-dlp` task |

---

## 7. Video Player Engine

The AniLab player (`main.js`) is more than a simple `<video>` tag.

### Custom Context System
When opening the player, we pass a `context` object:
```json
{
  "showId": "...",
  "allEpisodes": ["1", "2", "3"],
  "currentEp": "1",
  "mode": "sub"
}
```
This allows the "Next/Previous" buttons and keyboard shortcuts (Arrow Keys) to resolve the next stream URL and reload the player without returning to the library.

### HLS.js Integration
We inject `hls.js` dynamically for `.m3u8` files.
- **Auto Quality**: Populates a resolution selector once the `LEVEL_LOADED` event is triggered.
- **Decryption**: Stream segments are handled by the browser/mpv, but the initial URL is resolved via the Rust-backend's decryption logic.

---

## 8. Development Roadmap

### Version 0.0.6 (Current)
- Persistent SQLite library.
- Background AllAnime streaming + decryption.
- `yt-dlp` integrated downloader.

### Planned (Future)
- **Local File Resume**: SQLite to store `last_watched_timestamp`.
- **Custom CSS Themes**: Allow users to skin the application beyond the "Coffee" theme.
- **Native Player**: Moving from `mpv` to a built-in cross-platform decoder.
