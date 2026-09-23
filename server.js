// ===========================================================================
// KOPI SENJA API — jembatan antara website (browser) dan Firebase
// ===========================================================================
// Kenapa ini dibutuhkan:
// Sebelumnya, browser kasir & pembeli langsung baca/tulis ke Firebase pakai
// kunci (apiKey) yang nempel di kode HTML — siapa saja yang lihat kode
// halaman bisa lihat kunci itu. Server ini yang sekarang pegang akses penuh
// ke Firebase (lewat "Service Account", kunci rahasia yang TIDAK pernah
// dikirim ke browser). Browser cuma boleh minta lewat endpoint di server
// ini, dan aksi-aksi milik kasir (konfirmasi pesanan, tandai selesai, dst)
// WAJIB menyertakan bukti bahwa yang minta memang kasir yang sudah login.
// ===========================================================================

const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
require('dotenv').config();

// --------------------------- 1. Inisialisasi Firebase Admin ---------------
// FIREBASE_SERVICE_ACCOUNT_JSON = isi file kunci Service Account (dalam satu
// baris JSON), disimpan sebagai environment variable — lihat README.md.
let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
} catch (e) {
  console.error('FIREBASE_SERVICE_ACCOUNT_JSON tidak valid / belum diisi. Lihat README.md.');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = admin.database();
const ordersRef = db.ref('orders');
const settingsRef = db.ref('settings');

// --------------------------- 2. Setup Express ------------------------------
const app = express();
app.use(cors()); // Izinkan website memanggil API ini dari domain lain
app.use(express.json());

// --------------------------- 3. Middleware: cek login kasir -----------------
// Kasir login di website pakai Firebase Auth (email + password). Browser
// kasir mengirim "ID Token" hasil login itu di header Authorization.
// Middleware ini memverifikasi token tersebut BENAR-BENAR sah dan belum
// kedaluwarsa sebelum mengizinkan aksi kasir (konfirmasi, hapus, dst).
async function wajibKasir(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Tidak ada token login. Silakan login sebagai kasir dulu.' });
  }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.kasir = decoded; // info kasir yang login, kalau dibutuhkan nanti
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token login tidak valid atau sudah kedaluwarsa.' });
  }
}

// --------------------------- 4. Endpoint: cek server hidup -----------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Kopi Senja API jalan normal.' });
});

// --------------------------- 5. Endpoint MENU (publik) ----------------------
// Pembeli & kasir sama-sama boleh lihat menu, tidak perlu login.
app.get('/api/menu', async (req, res) => {
  try {
    const snap = await settingsRef.once('value');
    res.json(snap.val() || {});
  } catch (e) {
    res.status(500).json({ error: 'Gagal mengambil data menu.' });
  }
});

// --------------------------- 6. Endpoint PESANAN (orders) -------------------

// 6a. Pembeli membuat pesanan baru — tidak perlu login.
app.post('/api/orders', async (req, res) => {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return res.status(400).json({ error: 'Pesanan harus punya minimal 1 item.' });
    }
    const id = 'ord_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    const order = {
      id,
      queueNo: body.queueNo || null,
      tableNumber: body.tableNumber || null,
      orderType: body.orderType || 'dine_in',
      paymentMethod: body.paymentMethod || 'cash',
      items: body.items,
      total: body.total || 0,
      customerName: body.customerName || '',
      customerPhone: body.customerPhone || '',
      fcmToken: body.fcmToken || null,
      status: body.paymentMethod === 'online' ? 'awaiting_payment_verification' : 'awaiting_scan',
      createdAt: Date.now(),
    };
    await ordersRef.child(id).set(order);
    res.status(201).json(order);
  } catch (e) {
    res.status(500).json({ error: 'Gagal membuat pesanan.' });
  }
});

// 6b. Pembeli cek status pesanannya sendiri — tidak perlu login.
app.get('/api/orders/:id', async (req, res) => {
  try {
    const snap = await ordersRef.child(req.params.id).once('value');
    if (!snap.exists()) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
    res.json(snap.val());
  } catch (e) {
    res.status(500).json({ error: 'Gagal mengambil data pesanan.' });
  }
});

// 6c. Kasir lihat semua pesanan — WAJIB login kasir.
app.get('/api/orders', wajibKasir, async (req, res) => {
  try {
    const snap = await ordersRef.once('value');
    const val = snap.val() || {};
    res.json(Object.values(val));
  } catch (e) {
    res.status(500).json({ error: 'Gagal mengambil daftar pesanan.' });
  }
});

// 6d. Kasir konfirmasi scan QR (pesanan "Bayar di Kasir") — WAJIB login kasir.
app.post('/api/orders/:id/confirm-scan', wajibKasir, async (req, res) => {
  try {
    const ref = ordersRef.child(req.params.id);
    const snap = await ref.once('value');
    if (!snap.exists()) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
    if (snap.val().status !== 'awaiting_scan') {
      return res.status(400).json({ error: 'Pesanan ini sudah diproses sebelumnya.' });
    }
    await ref.update({ status: 'pending' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Gagal konfirmasi pesanan.' });
  }
});

// 6e. Kasir konfirmasi pembayaran QRIS diterima — WAJIB login kasir.
app.post('/api/orders/:id/confirm-payment', wajibKasir, async (req, res) => {
  try {
    const ref = ordersRef.child(req.params.id);
    const snap = await ref.once('value');
    if (!snap.exists()) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
    if (snap.val().status !== 'awaiting_payment_verification') {
      return res.status(400).json({ error: 'Pesanan ini sudah diproses sebelumnya.' });
    }
    await ref.update({ status: 'pending' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Gagal konfirmasi pembayaran.' });
  }
});

// 6f. Kasir tandai pesanan selesai/siap diambil — WAJIB login kasir.
app.post('/api/orders/:id/done', wajibKasir, async (req, res) => {
  try {
    const ref = ordersRef.child(req.params.id);
    const snap = await ref.once('value');
    if (!snap.exists()) return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
    await ref.update({ status: 'done' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Gagal menandai pesanan selesai.' });
  }
});

// 6g. Kasir hapus pesanan — WAJIB login kasir.
app.delete('/api/orders/:id', wajibKasir, async (req, res) => {
  try {
    await ordersRef.child(req.params.id).remove();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Gagal menghapus pesanan.' });
  }
});

// --------------------------- 7. Jalankan server -----------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Kopi Senja API berjalan di port ${PORT}`);
});
