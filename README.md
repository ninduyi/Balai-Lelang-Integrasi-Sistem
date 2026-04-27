# 🏛️ Balai Lelang Eksekutif — Web UI

## Struktur File

```
project/
├── server.js        ← gRPC Server 
├── lelang.proto     ← Proto definition
├── gateway.js       ← 🆕 Express + Socket.IO bridge ke gRPC
├── index.html       ← 🆕 Web UI (HTML/CSS/Vanilla JS)
└── README.md
```

## Instalasi Dependencies

```bash
npm install express socket.io @grpc/grpc-js @grpc/proto-loader
```

Atau langsung:

```bash
npm install
```

## Cara Menjalankan

### Terminal 1 — gRPC Server
```bash
npm run server
```

### Terminal 2 — Gateway (Web Server)
```bash
npm run gateway
```

### Browser
Buka: http://localhost:3000

## Arsitektur

```
Browser (index.html)
    ↕ Socket.IO (WebSocket)
Gateway (gateway.js) — Express + Socket.IO
    ↕ gRPC Bi-directional Streaming
gRPC Server (server.js)
```

## Fitur Web UI

- ✅ Login modal dengan registrasi nama
- ✅ Menu utama: lihat peserta, buka lapak, masuk ruang
- ✅ Daftar ruang lelang aktif dengan harga real-time
- ✅ Dashboard bidding real-time (tanpa refresh)
- ✅ Indikator status LIVE / DITUTUP
- ✅ Log aktivitas bergulir otomatis
- ✅ Animasi harga saat tawaran baru masuk
- ✅ Pop-up pemenang otomatis (Server-Initiated via is_closed)
- ✅ Toast notifications
- ✅ Responsive design
