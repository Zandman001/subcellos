# Linux dev setup notes

These are the system packages I needed on Arch Linux to build and run the Tauri app locally:

- webkit2gtk-4.1
- gtk3
- pkgconf (pkg-config)
- base-devel (toolchain, make, etc.)

Optional/Audio backends:
- alsa-lib (ALSA)
- pipewire and pipewire-alsa (recommended on modern distros)

On Arch Linux:

- sudo pacman -S --needed webkit2gtk-4.1 gtk3 pkgconf base-devel
- sudo pacman -S --needed pipewire pipewire-alsa  # optional but recommended

On Debian/Ubuntu (example, package names may vary by release):

- sudo apt update
- sudo apt install build-essential libgtk-3-dev libwebkit2gtk-4.1-dev pkg-config

Troubleshooting:
- If you see pkg-config errors about `javascriptcoregtk-4.1` or `webkit2gtk-4.1`, ensure the `-4.1` variant is installed (not just 4.0).
- If you see frequent ALSA underrun logs, try:
  - Closing other audio apps, ensure PipeWire is running (or try PipeWire instead of raw ALSA).
  - Using an external audio interface.
  - Increasing the buffer size in the engine (we currently request 2048 frames; we can make this configurable if needed).
