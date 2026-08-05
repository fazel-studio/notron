# Product Requirements Document (PRD) - Notron

## 1. Ringkasan Proyek
**Notron** adalah aplikasi code editor desktop modern yang dirancang untuk kecepatan, efisiensi, dan pengalaman pengguna yang minimalis namun bertenaga. Dibangun menggunakan **Tauri** untuk backend (Rust) dan **Svelte 5** untuk frontend, Notron menawarkan performa aplikasi native dengan fleksibilitas teknologi web.

### 1.1. Artitektur:
- Package Manager: Bun
- Stack : Tauri + Stelve + Rust
- Engine : Code Mirror 6

## 2. Target Pengguna
*   **Software Engineers:** Yang membutuhkan editor ringan untuk pengeditan cepat atau manajemen proyek skala menengah.
*   **Web Developers:** Pengguna yang terbiasa dengan ekosistem modern seperti VS Code tetapi menginginkan aplikasi yang lebih hemat sumber daya (RAM/CPU).
*   **Writer/Note-takers:** Pengguna yang sering menggunakan Markdown.

## 3. Fitur Utama

### 3.1. Manajemen File & Workspace
*   **File Tree Explorer:** Navigasi struktur folder secara hierarkis.
*   **Operasi File (CRUD):** Membuat file/folder baru, mengubah nama, menghapus, serta mendukung operasi Copy, Cut, dan Paste.
*   **Workspace Restoration:** Mengingat folder terakhir yang dibuka, posisi sidebar, folder yang di-expand, dan tab yang sedang terbuka saat aplikasi dijalankan kembali.
*   **File Watcher:** Sinkronisasi real-time antara file di disk dengan tampilan di editor (menggunakan sistem rekursif yang dioptimasi).

### 3.2. Editor Kode (Core)
*   **Engine CodeMirror 6:** Integrasi editor kelas dunia dengan performa tinggi.
*   **Multi-tab Interface:** Mendukung pembukaan banyak file sekaligus dalam bentuk tab.
*   **Syntax Highlighting:** Dukungan otomatis untuk berbagai bahasa (JS, TS, Rust, Python, Go, C++, dll).
*   **Lazy Loading Content:** Hanya memuat konten file ke memori saat tab aktif untuk menghemat RAM.
*   **Auto-save:** Penyimpanan otomatis berdasarkan durasi tertentu (configurable).

### 3.3. Navigasi & Inteligensi Kode
*   **Command Palette (Ctrl+Shift+P):** Akses cepat ke semua perintah aplikasi.
*   **Symbol Engine:** Ekstraksi simbol (Function, Class, Variable) menggunakan Regex untuk fitur "Go to Definition" dan "Find References".
*   **Go To Line (Ctrl+G):** Navigasi cepat ke baris tertentu dalam file.
*   **Global Search:** Fitur pencarian teks di seluruh workspace dengan filter direktori (node_modules, .git, dll diabaikan secara otomatis).

### 3.4. Antarmuka Pengguna (UI/UX)
*   **Custom Title Bar:** Menggunakan frameless window untuk tampilan yang lebih modern dan menyatu.
*   **Theming:** Dukungan Tema Dark dan Light, serta opsi mengikuti sistem OS.
*   **Skeleton Loading:** Tampilan awal yang cepat dengan placeholder saat data workspace sedang dimuat.
*   **Markdown Preview:** Tampilan visual real-time untuk file `.md`.
*   **Image Viewer:** Dukungan untuk melihat file gambar secara langsung di dalam tab.

## 4. Stack Teknologi
*   **Frontend Framework:** Svelte 5 (menggunakan Runes untuk reactivity yang efisien).
*   **Backend Runtime:** Tauri 2.0 (Rust).
*   **Runtime/Package Manager:** Bun.
*   **Editor Engine:** CodeMirror 6.
*   **Database:** SQLite (melalui Rusqlite) untuk menyimpan pengaturan dan riwayat file.
*   **Styling:** Vanilla CSS & Tailwind CSS.

## 5. Kebutuhan Non-Fungsional

### 5.1. Performa
*   **Start-up Time:** Aplikasi harus dapat menampilkan UI fungsional dalam waktu < 2 detik.
*   **Memory Usage:** Penggunaan memori harus tetap di bawah 200MB untuk penggunaan standar (di bawah Electron secara signifikan).
*   **Reactivity:** UI tidak boleh hang saat melakukan operasi file tree yang dalam atau saat melakukan pencarian global.

### 5.2. Keamanan
*   **File Isolation:** Aplikasi hanya memiliki akses ke direktori yang diberikan izin oleh sistem operasi melalui Tauri API.
*   **Data Persistence:** Pengaturan pengguna disimpan secara lokal di direktori `AppData` (Windows) atau setaranya di OS lain.

## 6. Arsitektur Teknis Baru (Optimasi Svelte 5)
Aplikasi telah dioptimasi untuk menggunakan **Svelte 5 Store Pattern** yang modern:
*   Menghindari `.subscribe()` manual di komponen.
*   Menggunakan `$derived` untuk state yang bersifat turunan.
*   Implementasi `$effect` yang terisolasi untuk fitur berat seperti file watcher.

## 7. Peta Jalan Pengembangan (Roadmap)
*   [ ] Integrasi Terminal Terintegrasi.
*   [ ] Sistem Extension/Plugin dasar.
*   [ ] Integrasi Git (Branching, Commit, Push/Pull).
*   [ ] Fitur Collaborative Editing melalui WebSockets.
*   [ ] Peningkatan akurasi Symbol Engine menggunakan LSP (Language Server Protocol).
