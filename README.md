# Kopi Senja API

Server "jembatan" antara website Kopi Senja dan Firebase. Kasir dan pembeli
tidak lagi bicara langsung ke Firebase dari browser — semuanya lewat API ini.

## Kenapa lebih aman

Sekarang kode di `index.html` menyimpan `apiKey` Firebase yang bisa dilihat
siapa saja lewat "Inspect Element". Dengan API ini, akses penuh ke Firebase
dipindah ke server (pakai **Service Account**, bukan `apiKey` biasa), dan
aksi kasir (konfirmasi pesanan, hapus, dll) diwajibkan membuktikan bahwa
yang minta memang kasir yang sudah login — lewat token dari Firebase Auth,
sama seperti yang sudah dipakai di halaman login kasir sekarang.

## 1. Coba jalankan di komputer sendiri (opsional)

```bash
cd kopi-senja-api
npm install
cp .env.example .env
# isi .env sesuai poin 2 di bawah
npm start
```

Server jalan di `http://localhost:3000`. Cek dengan buka
`http://localhost:3000/api/health` di browser.

## 2. Ambil kunci Service Account Firebase

1. Buka [Firebase Console](https://console.firebase.google.com) → pilih
   project **kopi-senja-2ae43**.
2. Klik ikon gerigi (⚙️) di pojok kiri atas → **Project settings**.
3. Buka tab **Service accounts** → klik **Generate new private key**.
4. Sebuah file `.json` akan terunduh. **Simpan baik-baik, jangan pernah
   diupload ke GitHub atau dibagikan ke siapa pun** — file ini setara
   "kunci utama" ke seluruh data Firebase kamu.
5. Buka file itu, salin SELURUH isinya, lalu tempel jadi satu baris untuk
   nilai `FIREBASE_SERVICE_ACCOUNT_JSON` (lihat `.env.example`).

## 3. Deploy gratis ke Render.com

1. Buat akun di [render.com](https://render.com) (bisa pakai akun GitHub).
2. Upload folder `kopi-senja-api` ini ke sebuah repository GitHub baru.
3. Di dashboard Render → **New** → **Web Service** → hubungkan ke
   repository tadi.
4. Isi pengaturan:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Buka tab **Environment** → tambahkan dua variabel:
   - `FIREBASE_SERVICE_ACCOUNT_JSON` → isi dari poin 2 di atas
   - `FIREBASE_DATABASE_URL` → `https://kopi-senja-2ae43-default-rtdb.firebaseio.com`
6. Klik **Deploy**. Setelah selesai, kamu akan dapat URL seperti
   `https://kopi-senja-api.onrender.com` — itu alamat API kamu.

> Catatan: paket gratis Render akan "tidur" kalau tidak ada yang mengakses
> beberapa menit, dan perlu ±30 detik untuk "bangun" lagi saat diakses
> pertama kali. Wajar untuk project belajar/skala kecil.

## 4. Daftar endpoint yang tersedia

| Method | Endpoint | Siapa yang boleh akses | Fungsi |
|---|---|---|---|
| GET | `/api/health` | Siapa saja | Cek server hidup |
| GET | `/api/menu` | Siapa saja | Ambil data menu & pengaturan toko |
| POST | `/api/orders` | Siapa saja | Pembeli membuat pesanan baru |
| GET | `/api/orders/:id` | Siapa saja | Pembeli cek status pesanannya |
| GET | `/api/orders` | **Kasir (login)** | Lihat semua pesanan |
| POST | `/api/orders/:id/confirm-scan` | **Kasir (login)** | Konfirmasi scan QR (bayar di kasir) |
| POST | `/api/orders/:id/confirm-payment` | **Kasir (login)** | Konfirmasi pembayaran QRIS diterima |
| POST | `/api/orders/:id/done` | **Kasir (login)** | Tandai pesanan selesai/siap diambil |
| DELETE | `/api/orders/:id` | **Kasir (login)** | Hapus pesanan |

Untuk endpoint yang butuh login kasir, browser wajib kirim header:
```
Authorization: Bearer <idToken>
```
`idToken` didapat dari `firebase.auth().currentUser.getIdToken()` setelah
kasir berhasil login di website (kode login kasir yang sudah ada di
`index.html` tidak perlu diubah, tinggal ambil token-nya).

## 5. Langkah selanjutnya (belum dikerjakan di sini)

Ini pondasi awal saja. Yang biasanya menyusul kalau mau dipakai serius:
- Ganti kode di `index.html` supaya kasir & pembeli memanggil API ini
  (pakai `fetch(...)`) alih-alih memanggil Firebase langsung.
- Batasi siapa saja yang boleh jadi "kasir" (sekarang semua akun Firebase
  Auth yang valid dianggap kasir — mungkin perlu daftar email khusus).
- Tambah rate limiting supaya API tidak gampang dibanjiri request.
