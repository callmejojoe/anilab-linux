# AniLab Linux

AniLab Linux is a high-performance anime desktop client for Linux, designed to provide a seamless streaming and downloading experience. This project is a dedicated clone of the AniLab Android application, specifically optimized for CachyOS and Arch-based distributions. 

The project is currently in active development, with the goal of bringing the "pain-free" anime experience of the original app to power users on the Linux desktop using modern web and systems technologies.

## Features

- **Efficient Search**: Rapid title searching integrated with the AllAnime API.
- **Embedded Streaming**: Native high-quality streaming utilizing a custom-built HTML5 player, eliminating the need for external tools for basic playback.
- **Integrated Downloads**: High-speed anime downloads handled via `yt-dlp` for reliable offline access.
- **Library Management**: Automated progress tracking and local file scanning with AniList metadata integration.
- **Modern Interface**: A responsive, dark-mode UI built for Linux, emphasizing speed and visual clarity.

## Technical Foundation

- **Backend**: Rust and Tauri v2.
- **Frontend**: Vanilla JavaScript and CSS, following modern design principles for a premium feel.
- **Data Integrations**: AllAnime (Streaming/Search) and AniList (Metadata).
- **Core Dependencies**: `reqwest`, `serde`, `tokio`, and `rusqlite`.
- **System Dependencies**: `yt-dlp` for downloads and `mpv` for optional local playback.

## Installation and Development

### System Requirements (CachyOS / Arch Linux)

Ensure the necessary development tools and dependencies are installed on your system:

```bash
sudo pacman -S base-devel curl wget openssl rustup yt-dlp mpv
```

### Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/callmejojoe/anilab-linux.git
   cd anilab-linux
   ```

2. Install dependencies and start the development environment:
   ```bash
   # From the root directory
   npm install
   npm run tauri dev
   ```

## Roadmap and Development Status

The following features and integrations are planned or currently being implemented:

- [x] AllAnime GraphQL API Integration
- [x] Stream URL XOR Decoding
- [x] In-App HTML5 Video Player
- [ ] Watch History Synchronization
- [ ] Advanced Search Filtering and Sorting
- [ ] MyAnimeList and AniList Account Integration

---

Created for the Linux anime community.
