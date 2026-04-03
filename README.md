<h1 align="center">AniLab Linux</h1>

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Arch%20Linux-1793d1?style=for-the-badge&logo=arch-linux" alt="Platform: Arch Linux">
  <img src="https://img.shields.io/badge/Language-Rust-ea5c0b?style=for-the-badge&logo=rust" alt="Language: Rust">
  <img src="https://img.shields.io/badge/Framework-Tauri_v2-ffc131?style=for-the-badge&logo=tauri" alt="Framework: Tauri">
  <img src="https://img.shields.io/badge/Status-Active_Development-brightgreen?style=for-the-badge" alt="Status: Active Development">
</p>

> [!IMPORTANT]
> **AniLab Linux** is a high-performance desktop client dedicated to easily stream and download anime on Linux (Arch/Arch-based) machines. 
> 
> We aim to bring the "pain-free" anime experience of the original AniLab app to power users on the Linux desktop using modern web and systems technologies.

## 🚀 Purpose

AniLab Linux eliminates the friction of discovering, streaming, and managing anime on the desktop. By integrating native backend processing with an elegant front-end, it provides top-tier anime streaming and downloading completely out of the box—no web browsers, third-party sites, or complicated external tools required. 

## 🌟 Current Progress & Features

We've made significant strides in building a responsive, premium application. Our current functional progress includes:

- **Efficient Search:** Rapid title searching natively integrated with modern anime APIs.
- **Embedded Streaming:** High-quality streaming out of the box using our custom-built HTML5 video player.
- **Integrated Downloads:** High-speed anime payload delivery handled seamlessly via `yt-dlp` for reliable offline access.
- **Library & Metadata:** Automated progress tracking and local file scanning with underlying AniList metadata syncing.
- **Modern Interface:** A responsive, sleek dark-mode UI built from the ground up for the Linux desktop emphasizing speed, glassmorphism, and visual clarity.
- **Stream Decoding:** Backend reverse engineering (XOR decoding) to reliably fetch the highest quality streams under the hood.

## 🚧 Upcoming Features

We have an exciting roadmap mapped out to reach version 1.0 and beyond:

- [ ] **Select Download Quality:** Let users pick their preferred resolution before downloading, from 360p up to pristine 1080p.
- [ ] **Play Local Files in App:** A fully functional built-in media player to directly watch local downloaded video files natively within the app.
- [ ] **Revamp UI:** Continuous polishing of the user interface to ensure maximum user engagement with dynamic interactions, hover states, and animations.
- [ ] **Package for Other Distros:** Package the app as a Flatpak/AppImage/Snap to easily support more Linux distributions beyond just Arch.
- [ ] **Watch History Synchronization:** Keep track of where you left off across streaming, local playback, and downloads.
- [ ] **Advanced Filtering & Sorting:** Implement robust catalog organization to find exactly what you want to watch.

## ⚙️ Installation & Development Setup

### System Requirements (Arch Linux / CachyOS)

To build and run AniLab Linux, ensure the necessary system dependencies and build libraries are installed. Open your terminal and verify you have them:

```bash
sudo pacman -S base-devel curl wget openssl rustup yt-dlp mpv
```

*(Note: We rely on `yt-dlp` for robust download capabilities and backend media resolution, while `mpv` acts as a fallback or integrated video layer).*

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
