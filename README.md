# 🧪 AniLab for Linux

> A premium, high-performance Anime desktop client for Linux, built with Tauri and Rust. Optimized for CachyOS and the power user.

<p align="center">
  <img src="https://img.shields.io/badge/Rust-cargo-orange.svg?style=flat-square&logo=rust" alt="Rust">
  <img src="https://img.shields.io/badge/Tauri-v2-blue.svg?style=flat-square&logo=tauri" alt="Tauri">
  <img src="https://img.shields.io/badge/Linux-CachyOS-green.svg?style=flat-square&logo=linux" alt="Linux">
  <img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square" alt="License">
</p>

---

## ✨ Features

- **🚀 Lightning Fast Search**: Instantly search through thousands of titles powered by the AllAnime API.
- **📺 Cinematic Streaming**: High-quality streaming with a custom built-in HTML5 player. No external dependencies required for the best viewing experience.
- **📥 One-Click Downloads**: High-speed downloads integrated directly with `yt-dlp` for offline viewing.
- **📂 Library Management**: Scan local folders, match files to AniList metadata, and keep track of your progress automatically.
- **🎨 Premium UI**: Optimized for Linux with a sleek, responsive dark-mode interface and smooth animations.

---

## 🛠️ Tech Stack

- **Backend**: [Rust](https://www.rust-lang.org/) + [Tauri v2](https://v2.tauri.app/)
- **Frontend**: Vanilla JavaScript + CSS (Glassmorphism & Modern Aesthetics)
- **APIs**: AllAnime (Streaming/Search), AniList (Metadata)
- **Core Dependencies**: `reqwest`, `serde`, `tokio`, `rusqlite`
- **External Tools**: `yt-dlp` (for downloads), `mpv` (opt-in for local files)

---

## 🚀 Getting Started

### Prerequisites

Make sure you have the following installed on your system:

```bash
# Arch/CachyOS
sudo pacman -S base-devel curl wget openssl rustup yt-dlp mpv
```

### Development

1. Clone the repository:
   ```bash
   git clone https://github.com/callmejojoe/anilab-linux.git
   cd anilab-linux
   ```

2. Run the dev server:
   ```bash
   # In the root directory
   npm install
   npm run tauri dev
   ```

---

## 📝 To-Do

- [x] AllAnime GQL API Integration
- [x] XOR Decoder for Stream URLs
- [x] In-App HTML5 Video Player
- [ ] Watch History Syncing
- [ ] Advanced Filter/Sorting for Search
- [ ] MAL/AniList Account Integration

---

## ⚖️ License

Distributed under the MIT License. See `LICENSE` for more information.

---
<p align="center">
  <i>Created with ❤️ for the Linux Anime community.</i>
</p>
