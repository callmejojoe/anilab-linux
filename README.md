<h1 align="center">AniLab Linux</h1>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Arch%20Linux-1793d1?style=for-the-badge&logo=arch-linux" alt="Platform: Arch Linux">
  <img src="https://img.shields.io/badge/Language-Rust-ea5c0b?style=for-the-badge&logo=rust" alt="Language: Rust">
  <img src="https://img.shields.io/badge/Framework-Tauri_v2-ffc131?style=for-the-badge&logo=tauri" alt="Framework: Tauri">
  <img src="https://img.shields.io/badge/Status-Active_Development-brightgreen?style=for-the-badge" alt="Status: Active Development">
</p>

> [!IMPORTANT]
> **AniLab Linux** is a desktop application for streaming and downloading anime on Linux (Arch and Arch-based) systems.
> 
> It brings the AniLab mobile experience to the desktop, allowing you to watch and download content without needing a web browser or external websites.

## Purpose

The goal of this project is to provide a straightforward way to stream and download anime directly from your desktop. It handles searching, video playback, and download management all within a single application.

## Current Features

Here is what is currently working in the application:

- **Search:** Search for anime titles using anilist APIs.
- **Streaming:** Watch episodes directly in the app using a built-in HTML5 video player.
- **Downloads:** Download episodes for offline viewing using `yt-dlp`.
- **Library & Metadata:** Track your watch progress and fetch show metadata using AniList.
- **Interface:** A responsive coffee-themed UI designed for desktop use.
- **Stream Decoding:** Backend XOR decoding to resolve direct stream URLs.

## Planned Features

The following features are planned for future updates:

- [ ] **Download Quality Selection:** Choose the video resolution before downloading.
- [ ] **Local Playback:** Play downloaded video files directly within the application.
- [ ] **UI Updates:** Continue improving the interface and user experience.
- [ ] **Distribution Packaging:** Create Flatpak and AppImage packages to support non-Arch Linux distributions.
- [ ] **Watch History:** Synchronize watch history across streamed and downloaded files.
- [ ] **Filtering & Sorting:** Add more options to search and filter the catalog.

## Installation & Setup

### System Requirements

To build and run AniLab Linux, install the necessary system dependencies. On Arch Linux or CachyOS, you can install them via terminal {I haven't tested this outside my machine tho}:

```bash
sudo pacman -S base-devel curl wget openssl rustup yt-dlp mpv
```

`yt-dlp` is used for handling downloads and media resolution, and `mpv` provides media playback capabilities.

### Getting Started

1. **Clone the repository:**
   ```bash
   git clone https://github.com/callmejojoe/anilab-linux.git
   cd anilab-linux
   ```

2. **Install Node.js dependencies:**
   ```bash
   # Make sure you are in the project root containing package.json
   npm install
   ```

3. **Start the development server:**
   ```bash
   npm run tauri dev
   ```

---
 
<p align="center">
  <i>Created for the Linux anime community.</i>
</p>
