// ============================================================
//  GATEWAY.JS — Express + Socket.IO → gRPC Bridge
//  Balai Lelang Eksekutif | Real-Time Bidding System
// ============================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

// ─── Inisialisasi gRPC Client ────────────────────────────────
const packageDefinition = protoLoader.loadSync('lelang.proto', { keepCase: true });
const lelangProto = grpc.loadPackageDefinition(packageDefinition).lelang;

const userClient   = new lelangProto.UserService('127.0.0.1:50051', grpc.credentials.createInsecure());
const roomClient   = new lelangProto.RoomService('127.0.0.1:50051', grpc.credentials.createInsecure());
const biddingClient = new lelangProto.BiddingService('127.0.0.1:50051', grpc.credentials.createInsecure());

// ─── Inisialisasi Express + HTTP + Socket.IO ─────────────────
const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.json());
app.use(express.static(path.join(__dirname)));  // serve index.html

// ─── Log Utility ────────────────────────────────────────────
function gwLog(tag, msg) {
  const t = new Date().toLocaleTimeString('id-ID', { hour12: false });
  console.log(`[${t}] [GW:${tag}] ${msg}`);
}

// ─── Peta bidStream per socket: socketId → grpc duplex stream ─
const activeBidStreams = {};

// ============================================================
//  SOCKET.IO CONNECTION HANDLER
// ============================================================
io.on('connection', (socket) => {
  gwLog('CONNECT', `Browser terhubung: ${socket.id}`);

  // ── 1. REGISTER USER ──────────────────────────────────────
  socket.on('register_user', ({ name }, cb) => {
    userClient.RegisterUser({ name: name || 'Anonim' }, (err, res) => {
      if (err) {
        gwLog('ERR', `RegisterUser gagal: ${err.details}`);
        return cb({ success: false, message: err.details });
      }
      gwLog('USER', `Terdaftar: ${res.name} [${res.user_id}]`);
      cb({ success: true, user_id: res.user_id, name: res.name });
    });
  });

  // ── 2. LOGOUT USER ────────────────────────────────────────
  socket.on('logout_user', ({ user_id }) => {
    userClient.LogoutUser({ user_id }, (err) => {
      if (!err) gwLog('USER', `Logout: ${user_id}`);
    });
    // Bersihkan stream bidding jika masih aktif
    _cleanupBidStream(socket.id);
  });

  // ── 3. GET ONLINE USERS ───────────────────────────────────
  socket.on('get_online_users', (_, cb) => {
    userClient.GetOnlineUsers({}, (err, res) => {
      if (err) return cb({ success: false, users: [] });
      cb({ success: true, users: res.users || [] });
    });
  });

  // ── 4. CREATE ROOM ────────────────────────────────────────
  socket.on('create_room', ({ item_name, start_price }, cb) => {
    roomClient.CreateRoom({ item_name, start_price: parseInt(start_price) }, (err, res) => {
      if (err) {
        gwLog('ERR', `CreateRoom gagal: ${err.details}`);
        return cb({ success: false, message: err.details });
      }
      gwLog('ROOM', `Dibuat: ${res.room_id} | ${res.item_name} | Rp${res.start_price}`);
      cb({ success: true, room_id: res.room_id, item_name: res.item_name, start_price: res.start_price });
    });
  });

  // ── 5. GET AVAILABLE ROOMS ────────────────────────────────
  socket.on('get_available_rooms', (_, cb) => {
    roomClient.GetAvailableRooms({}, (err, res) => {
      if (err) return cb({ success: false, rooms: [] });
      cb({ success: true, rooms: res.rooms || [] });
    });
  });

  // ── 6. JOIN BIDDING ROOM (Buka Bi-Directional gRPC Stream) ─
  socket.on('join_room', ({ room_id, user_id, user_name }) => {
    // Tutup stream lama jika user sudah di room sebelumnya
    _cleanupBidStream(socket.id);

    gwLog('JOIN', `${user_name} (${socket.id}) → Room ${room_id}`);

    // Buka stream baru ke gRPC server
    const bidStream = biddingClient.JoinRoomBidding();
    activeBidStreams[socket.id] = { stream: bidStream, room_id, user_id, user_name };

    // Kirim join message awal (bid_amount: 0 = hanya bergabung)
    bidStream.write({ room_id, user_id, user_name, bid_amount: 0 });

    // ── Terima BidUpdate dari gRPC → Push ke Browser via WebSocket ──
    bidStream.on('data', (update) => {
      gwLog('STREAM', `[${room_id}] → ${socket.id} | closed=${update.is_closed} | price=${update.current_highest_price}`);
      
      // Push event ke browser spesifik ini
      socket.emit('bid_update', {
        highest_bidder:        update.highest_bidder,
        current_highest_price: update.current_highest_price,
        broadcast_message:     update.broadcast_message,
        is_closed:             update.is_closed
      });
    });

    bidStream.on('error', (err) => {
      gwLog('ERR', `Stream error [${room_id}]: ${err.message}`);
      socket.emit('stream_error', { message: err.message });
    });

    bidStream.on('end', () => {
      gwLog('STREAM', `Stream ended untuk ${socket.id}`);
    });
  });

  // ── 7. PLACE BID (Browser → Gateway → gRPC bidStream.write) ─
  socket.on('place_bid', ({ room_id, user_id, user_name, bid_amount }) => {
    const entry = activeBidStreams[socket.id];
    if (!entry || !entry.stream) {
      socket.emit('bid_rejected', { message: 'Stream tidak aktif. Masuk ulang ke room.' });
      return;
    }
    gwLog('BID', `${user_name} menawar Rp${bid_amount} di Room ${room_id}`);
    // Inilah Command & Control Bridge: browser → gateway → gRPC
    entry.stream.write({ room_id, user_id, user_name, bid_amount: parseInt(bid_amount) });
  });

  // ── 8. LEAVE ROOM ─────────────────────────────────────────
  socket.on('leave_room', () => {
    _cleanupBidStream(socket.id);
  });

  // ── 9. DISCONNECT ─────────────────────────────────────────
  socket.on('disconnect', () => {
    gwLog('DISCONNECT', `Browser putus: ${socket.id}`);
    _cleanupBidStream(socket.id);
  });
});

// ─── Helper: Tutup & Hapus bidStream ─────────────────────────
function _cleanupBidStream(socketId) {
  const entry = activeBidStreams[socketId];
  if (entry && entry.stream) {
    try { entry.stream.end(); } catch (_) {}
    delete activeBidStreams[socketId];
    gwLog('CLEANUP', `Stream dihapus untuk socket ${socketId}`);
  }
}

// ─── Jalankan Gateway ─────────────────────────────────────────
const GATEWAY_PORT = 3000;
server.listen(GATEWAY_PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   🌐  GATEWAY BALAI LELANG BERJALAN              ║');
  console.log(`║   → Web UI  : http://localhost:${GATEWAY_PORT}              ║`);
  console.log('║   → gRPC    : 127.0.0.1:50051                    ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
  gwLog('SYSTEM', 'Gateway siap. Pastikan server.js sudah berjalan terlebih dahulu.');
});
