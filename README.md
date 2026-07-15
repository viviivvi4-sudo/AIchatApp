# AI Chat — Android APK (Client Side)

Aplikasi chat AI 100% client-side (HTML/CSS/JS murni), dibungkus jadi **APK Android** menggunakan [Capacitor](https://capacitorjs.com/) (WebView native — bukan browser tab). API Key dan histori chat tetap disimpan hanya di penyimpanan lokal aplikasi (localStorage di dalam WebView), tidak ada backend/server.

## Struktur Project
```
ai-chat-app/
├── www/                     # Source web app (di-load oleh WebView Android)
│   ├── index.html
│   ├── style.css
│   └── app.js
├── package.json             # Dependensi Capacitor
├── capacitor.config.json    # Konfigurasi nama app, appId, webDir
└── .github/workflows/build-apk.yml  # CI: auto-build APK setiap push ke main
```

Folder `android/` (project native Android) **sengaja tidak di-commit** — dibuat otomatis oleh CI (`npx cap add android`) setiap kali build, supaya selalu segar dan konsisten dengan versi Capacitor terbaru.

## Cara Mendapatkan APK (paling gampang — via GitHub Actions)
1. Push project ini ke repository GitHub kamu.
2. Buka tab **Actions** di repo → workflow **"Build Android APK"** akan otomatis jalan setiap push ke `main` (atau klik **Run workflow** manual).
3. Setelah selesai (±3–5 menit), buka run tersebut → bagian **Artifacts** → download **`ai-chat-app-debug-apk`** (berisi `app-debug.apk`).
4. Pindahkan file `.apk` itu ke HP Android, lalu install (aktifkan dulu "Install from unknown sources" di pengaturan HP).

> Ini adalah **debug APK** (belum ditandatangani dengan release key), cukup untuk instalasi/testing pribadi. Untuk publish ke Play Store, kamu perlu men-generate keystore dan mengonfigurasi *release signing* di `android/app/build.gradle` — belum termasuk di workflow ini.

## Build APK secara lokal (opsional, butuh Android Studio / Android SDK + JDK 17)
```bash
npm install
npx cap add android
npx cap sync android
cd android
./gradlew assembleDebug
# hasil APK ada di: android/app/build/outputs/apk/debug/app-debug.apk
```

## Konfigurasi di dalam aplikasi
1. Buka aplikasi → klik **Pengaturan** di sidebar.
2. Pilih provider (OpenAI / Anthropic Claude / Groq / Custom).
3. Base URL terisi otomatis sesuai provider (bisa diubah manual).
4. Masukkan API Key kamu.
5. Isi nama model (contoh: `gpt-4o-mini`, `claude-sonnet-4-6`, `llama-3.3-70b-versatile`).
6. Klik **Simpan**.

> **Catatan Anthropic:** panggilan langsung dari WebView ke API Anthropic memerlukan header `anthropic-dangerous-direct-browser-access`, sudah ditangani otomatis di `app.js`.

## Fitur Baru
- **Tombol "+" di samping kotak chat**: buka menu untuk melampirkan **File**, **Foto**, atau **Video**.
  - Foto (maks 5MB) dikirim ke AI sebagai gambar (butuh model vision, mis. `gpt-4o-mini`/`claude-sonnet-4-6`).
  - File teks/kode (txt, md, json, js, py, dll) isinya dibaca dan ikut dikirim ke AI.
  - Video & file biner lain hanya untuk **pratinjau lokal** — belum ada API chat yang bisa "menonton" video langsung, jadi tidak dikirim ke AI.
  - Klik lampiran mana pun untuk membukanya di jendela pratinjau (gambar/video/isi teks) sekaligus tombol unduh.
- **Tombol tingkat upaya berpikir** (di sebelah tombol pencarian web): Rendah, Sedang, Tinggi, Ekstra, Extreme, Deep Thinking, Super Deep Thinking.
  - Tinggi ke atas mengaktifkan **extended thinking** Anthropic — proses berpikir model ditampilkan dalam kotak "🧠 Proses berpikir" yang bisa dibuka/tutup di setiap balasan.
  - Di provider selain Anthropic, mode ini disimulasikan lewat instruksi prompt (tidak ada thinking trace resmi).
- **Tombol Pencarian Web** (ikon globe): mengaktifkan tool `web_search` bawaan Anthropic. Di provider lain, AI hanya diberi tahu lewat prompt bahwa ia tidak punya akses pencarian nyata.
- **Membuat & mengunduh file (termasuk ZIP)**: kalau AI membuatkan satu atau beberapa file, setiap file akan muncul sebagai kartu dengan tombol **Lihat** dan **Unduh**. Jika lebih dari satu file dihasilkan dalam satu balasan, muncul juga tombol **"Unduh Semua sebagai ZIP"**.

## Keamanan
- API Key **tidak pernah** dikirim ke server developer aplikasi ini — hanya tersimpan lokal di perangkat dan dikirim langsung ke endpoint API yang kamu konfigurasi sendiri.
- Tombol **Hapus Semua Data** di menu Pengaturan menghapus API Key dan seluruh histori chat dari aplikasi.
- Aplikasi memerlukan izin **Internet** (otomatis ditambahkan Capacitor) agar bisa memanggil API pilihanmu.
