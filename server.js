const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const packageDefinition = protoLoader.loadSync(path.join(__dirname, 'lelang.proto'), {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const lelangProto = grpc.loadPackageDefinition(packageDefinition).lelang;

const users = new Map();
const rooms = new Map();
const roomStreams = new Map();

let userCounter = 1;
let roomCounter = 1;

const ROOM_AUTO_CLOSE_MS = 60000;

function pad(num) {
  return String(num).padStart(3, '0');
}

function nowTime() {
  return new Date().toLocaleTimeString('id-ID', { hour12: false });
}

function log(tag, msg) {
  console.log(`[${nowTime()}] [SRV:${tag}] ${msg}`);
}

function generateUserId() {
  const id = `U-${pad(userCounter)}`;
  userCounter += 1;
  return id;
}

function generateRoomId() {
  const id = `R-${pad(roomCounter)}`;
  roomCounter += 1;
  return id;
}

function ensureRoomStreams(roomId) {
  if (!roomStreams.has(roomId)) {
    roomStreams.set(roomId, new Set());
  }
  return roomStreams.get(roomId);
}

function broadcastRoomUpdate(roomId, update) {
  const streams = roomStreams.get(roomId);
  if (!streams || streams.size === 0) {
    return;
  }

  for (const stream of streams) {
    try {
      stream.write(update);
    } catch (_err) {
      // Stream mungkin sudah ditutup client, abaikan.
    }
  }
}

function clearRoomTimer(room) {
  if (room && room.closeTimer) {
    clearTimeout(room.closeTimer);
    room.closeTimer = null;
  }
}

function closeRoom(roomId, reason) {
  const room = rooms.get(roomId);
  if (!room || room.is_closed) {
    return;
  }

  room.is_closed = true;
  clearRoomTimer(room);

  const winner = room.highest_bidder || 'Tidak ada pemenang';
  const price = room.current_price || room.start_price;
  const message = reason || `Lelang ditutup. Pemenang: ${winner} dengan Rp${price}`;

  log('ROOM', `${roomId} ditutup | winner=${winner} | price=${price}`);

  broadcastRoomUpdate(roomId, {
    highest_bidder: winner,
    current_highest_price: price,
    broadcast_message: message,
    is_closed: true,
  });

  const streams = roomStreams.get(roomId);
  if (streams) {
    for (const stream of streams) {
      try {
        stream.end();
      } catch (_err) {
        // no-op
      }
    }
    roomStreams.delete(roomId);
  }
}

function resetAutoCloseTimer(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.is_closed) {
    return;
  }

  clearRoomTimer(room);
  room.closeTimer = setTimeout(() => {
    closeRoom(roomId, `WAKTU HABIS. Lelang ${roomId} ditutup.`);
  }, ROOM_AUTO_CLOSE_MS);
}

function registerUser(call, callback) {
  const name = (call.request.name || '').trim() || 'Anonim';
  const user_id = generateUserId();

  users.set(user_id, {
    user_id,
    name,
    online: true,
  });

  log('USER', `Register ${name} (${user_id})`);

  callback(null, {
    success: true,
    user_id,
    name,
    message: 'Registrasi berhasil',
  });
}

function logoutUser(call, callback) {
  const userId = call.request.user_id;
  const user = users.get(userId);

  if (user) {
    user.online = false;
    log('USER', `Logout ${user.name} (${userId})`);
  }

  callback(null, {
    success: true,
    message: 'Logout berhasil',
  });
}

function getOnlineUsers(_call, callback) {
  const onlineUsers = [];
  for (const user of users.values()) {
    if (user.online) {
      onlineUsers.push({ user_id: user.user_id, name: user.name });
    }
  }

  callback(null, {
    success: true,
    users: onlineUsers,
  });
}

function createRoom(call, callback) {
  const itemName = (call.request.item_name || '').trim();
  const startPrice = Number(call.request.start_price) || 0;

  if (!itemName) {
    callback({
      code: grpc.status.INVALID_ARGUMENT,
      details: 'Nama barang wajib diisi.',
    });
    return;
  }

  if (startPrice < 1) {
    callback({
      code: grpc.status.INVALID_ARGUMENT,
      details: 'Harga pembuka harus lebih besar dari 0.',
    });
    return;
  }

  const roomId = generateRoomId();
  const room = {
    room_id: roomId,
    item_name: itemName,
    start_price: startPrice,
    current_price: startPrice,
    highest_bidder: '',
    highest_bidder_id: '',
    is_closed: false,
    closeTimer: null,
  };

  rooms.set(roomId, room);
  ensureRoomStreams(roomId);
  resetAutoCloseTimer(roomId);

  log('ROOM', `Create ${roomId} | ${itemName} | Rp${startPrice}`);

  callback(null, {
    success: true,
    room_id: room.room_id,
    item_name: room.item_name,
    start_price: room.start_price,
    message: 'Ruang berhasil dibuat',
  });
}

function getAvailableRooms(_call, callback) {
  const available = [];

  for (const room of rooms.values()) {
    if (!room.is_closed) {
      available.push({
        room_id: room.room_id,
        item_name: room.item_name,
        current_price: room.current_price,
        is_closed: room.is_closed,
      });
    }
  }

  callback(null, {
    success: true,
    rooms: available,
  });
}

function joinRoomBidding(stream) {
  let joinedRoomId = '';

  stream.on('data', (cmd) => {
    const roomId = cmd.room_id;
    const room = rooms.get(roomId);

    if (!room) {
      stream.write({
        highest_bidder: '',
        current_highest_price: 0,
        broadcast_message: `Room ${roomId} tidak ditemukan.`,
        is_closed: true,
      });
      stream.end();
      return;
    }

    if (room.is_closed) {
      stream.write({
        highest_bidder: room.highest_bidder || 'Tidak ada pemenang',
        current_highest_price: room.current_price,
        broadcast_message: `Room ${roomId} sudah ditutup.`,
        is_closed: true,
      });
      stream.end();
      return;
    }

    if (!joinedRoomId) {
      joinedRoomId = roomId;
      ensureRoomStreams(roomId).add(stream);
      resetAutoCloseTimer(roomId);

      log('JOIN', `${cmd.user_name || 'Anonim'} (${cmd.user_id || 'tanpa-id'}) masuk ${roomId}`);

      broadcastRoomUpdate(roomId, {
        highest_bidder: room.highest_bidder || '',
        current_highest_price: room.current_price,
        broadcast_message: `${cmd.user_name || 'Peserta'} memasuki room ${roomId}.`,
        is_closed: false,
      });
      return;
    }

    if (!cmd.bid_amount || cmd.bid_amount < 1) {
      return;
    }

    if (cmd.bid_amount <= room.current_price) {
      stream.write({
        highest_bidder: room.highest_bidder || '',
        current_highest_price: room.current_price,
        broadcast_message: `⚠️ MAAF, tawaran harus di atas Rp${room.current_price}.`,
        is_closed: false,
      });
      return;
    }

    room.current_price = cmd.bid_amount;
    room.highest_bidder = cmd.user_name || 'Anonim';
    room.highest_bidder_id = cmd.user_id || '';
    resetAutoCloseTimer(roomId);

    log('BID', `${roomId} | ${room.highest_bidder} memimpin Rp${room.current_price}`);

    broadcastRoomUpdate(roomId, {
      highest_bidder: room.highest_bidder,
      current_highest_price: room.current_price,
      broadcast_message: `🔥 HYPE! ${room.highest_bidder} memimpin dengan Rp${room.current_price}.`,
      is_closed: false,
    });
  });

  function removeStream() {
    if (!joinedRoomId) {
      return;
    }
    const streams = roomStreams.get(joinedRoomId);
    if (streams) {
      streams.delete(stream);
      if (streams.size === 0) {
        roomStreams.delete(joinedRoomId);
      }
    }
    joinedRoomId = '';
  }

  stream.on('end', () => {
    removeStream();
    stream.end();
  });

  stream.on('error', () => {
    removeStream();
  });

  stream.on('close', () => {
    removeStream();
  });
}

function main() {
  const server = new grpc.Server();

  server.addService(lelangProto.UserService.service, {
    RegisterUser: registerUser,
    LogoutUser: logoutUser,
    GetOnlineUsers: getOnlineUsers,
  });

  server.addService(lelangProto.RoomService.service, {
    CreateRoom: createRoom,
    GetAvailableRooms: getAvailableRooms,
  });

  server.addService(lelangProto.BiddingService.service, {
    JoinRoomBidding: joinRoomBidding,
  });

  const addr = '0.0.0.0:50052';
  server.bindAsync(addr, grpc.ServerCredentials.createInsecure(), (err) => {
    if (err) {
      console.error('[SRV:ERR] Gagal bind server:', err.message);
      return;
    }

    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║   🚀 gRPC SERVER BALAI LELANG BERJALAN          ║');
    console.log('║   → Bind    : 0.0.0.0:50052                     ║');
    console.log(`║   → AutoClose Room : ${ROOM_AUTO_CLOSE_MS / 1000}s                      ║`);
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');
  });
}

main();
