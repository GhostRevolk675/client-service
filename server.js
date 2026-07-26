/**
 * Nexa - Servidor
 * 
 * Aplicativo de mensagens seguras com auto-destruição.
 * Inclui: autenticação, perfis, sistema de Almas, 
 * mensagens com TTL dinâmico, "Manter Conversa",
 * bloqueio de usuários, exclusão de conta.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

// ============================================================
// Configuração
// ============================================================

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'], credentials: true }
});

const PORT = process.env.PORT || 3000;

// ============================================================
// TTL Dinâmico
// ============================================================

function calculateTTL(contentLength) {
  if (contentLength <= 10) return 2000;
  if (contentLength <= 40) return Math.round(2000 + ((contentLength - 10) / 30) * 2000);
  if (contentLength <= 100) return Math.round(4000 + ((contentLength - 40) / 60) * 3000);
  if (contentLength <= 200) return Math.round(7000 + ((contentLength - 100) / 100) * 5000);
  if (contentLength <= 300) return Math.round(12000 + ((contentLength - 200) / 100) * 5000);
  return 20000;
}

// ============================================================
// Middleware
// ============================================================

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', app: 'Nexa', users: Object.keys(db.users).length });
});

// ============================================================
// Banco de dados
// ============================================================

const DB_PATH = path.join(__dirname, 'data.json');

let db = {
  users: {},
  friends: {},
  friendRequests: {},
  sessions: {},
  keptChats: {},
  keepRequests: {},
  blocked: {},       // { username: [blockedUsername, ...] }
  profiles: {}       // { username: { bio, status, accentColor, fontSize, animations } }
};

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const loaded = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
      db = { ...db, ...loaded };
      if (!db.blocked) db.blocked = {};
      if (!db.profiles) db.profiles = {};
      if (!db.keptChats) db.keptChats = {};
      if (!db.keepRequests) db.keepRequests = {};
    }
  } catch (err) {
    console.error('[DB] Erro:', err.message);
  }
}

function saveDB() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('[DB] Erro ao salvar:', err.message);
  }
}

loadDB();

// ============================================================
// Memória
// ============================================================

const activeMessages = new Map();
const messageTimers = new Map();
const connectedUsers = new Map();
const userSockets = new Map();

// ============================================================
// Helpers
// ============================================================

function getChatKey(u1, u2) { return [u1, u2].sort().join(':'); }
function isChatKept(u1, u2) { return db.keptChats[getChatKey(u1, u2)] === true; }
function isBlocked(blocker, target) { return (db.blocked[blocker] || []).includes(target); }

function getFriendsWithStatus(username) {
  const friends = db.friends[username] || [];
  const blockedList = db.blocked[username] || [];
  return friends
    .filter(f => !blockedList.includes(f))
    .map(f => {
      const user = db.users[f];
      const profile = db.profiles[f] || {};
      return {
        username: f,
        displayName: user?.displayName || f,
        online: userSockets.has(f),
        bio: profile.bio || '',
        status: profile.status || 'online'
      };
    });
}

function getProfile(username) {
  return db.profiles[username] || { bio: '', status: 'Disponível', accentColor: '#1E90FF', fontSize: 'medium', animations: true };
}

// ============================================================
// Socket.IO
// ============================================================

io.on('connection', (socket) => {

  // AUTH: Register
  socket.on('auth:register', (data, cb) => {
    const { username, password } = data;
    if (!username || username.trim().length < 2) return cb({ success: false, error: 'Nome deve ter 2+ caracteres' });
    if (!password || password.length < 4) return cb({ success: false, error: 'Senha deve ter 4+ caracteres' });

    const norm = username.trim().toLowerCase();
    if (db.users[norm]) return cb({ success: false, error: 'Nome já em uso' });

    db.users[norm] = { username: username.trim(), displayName: username.trim(), password, createdAt: Date.now() };
    db.friends[norm] = [];
    db.friendRequests[norm] = [];
    db.blocked[norm] = [];
    db.profiles[norm] = { bio: '', status: 'Disponível', accentColor: '#1E90FF', fontSize: 'medium', animations: true };

    const token = uuidv4();
    db.sessions[token] = { username: norm, createdAt: Date.now() };
    saveDB();

    cb({ success: true, token, user: { username: norm, displayName: username.trim() } });
  });

  // AUTH: Login
  socket.on('auth:login', (data, cb) => {
    const { username, password } = data;
    if (!username || !password) return cb({ success: false, error: 'Preencha todos os campos' });

    const norm = username.trim().toLowerCase();
    const user = db.users[norm];
    if (!user || user.password !== password) return cb({ success: false, error: 'Usuário ou senha incorretos' });

    const token = uuidv4();
    db.sessions[token] = { username: norm, createdAt: Date.now() };
    saveDB();

    cb({ success: true, token, user: { username: norm, displayName: user.displayName || user.username } });
  });

  // AUTH: Validate
  socket.on('auth:validate', (data, cb) => {
    const { token } = data;
    if (!token || !db.sessions[token]) return cb({ success: false });
    const session = db.sessions[token];
    const user = db.users[session.username];
    if (!user) { delete db.sessions[token]; saveDB(); return cb({ success: false }); }
    cb({ success: true, user: { username: session.username, displayName: user.displayName || user.username } });
  });

  // AUTH: Logout
  socket.on('auth:logout', (data) => {
    if (data.token && db.sessions[data.token]) { delete db.sessions[data.token]; saveDB(); }
  });

  // AUTH: Change password
  socket.on('auth:changePassword', (data, cb) => {
    const { username, oldPassword, newPassword } = data;
    const user = db.users[username];
    if (!user || user.password !== oldPassword) return cb({ success: false, error: 'Senha atual incorreta' });
    if (!newPassword || newPassword.length < 4) return cb({ success: false, error: 'Nova senha deve ter 4+ caracteres' });
    user.password = newPassword;
    saveDB();
    cb({ success: true });
  });

  // AUTH: Delete account
  socket.on('auth:deleteAccount', (data, cb) => {
    const { username, password } = data;
    const user = db.users[username];
    if (!user || user.password !== password) return cb({ success: false, error: 'Senha incorreta' });

    // Remove from all friends lists
    Object.keys(db.friends).forEach(key => {
      db.friends[key] = db.friends[key].filter(f => f !== username);
    });

    delete db.users[username];
    delete db.friends[username];
    delete db.friendRequests[username];
    delete db.blocked[username];
    delete db.profiles[username];

    // Remove sessions
    Object.keys(db.sessions).forEach(token => {
      if (db.sessions[token].username === username) delete db.sessions[token];
    });

    saveDB();
    cb({ success: true });
  });

  // PROFILE: Get
  socket.on('profile:get', (data, cb) => {
    const profile = getProfile(data.username);
    cb({ success: true, profile });
  });

  // PROFILE: Update
  socket.on('profile:update', (data, cb) => {
    const { username, bio, status, accentColor, fontSize, animations } = data;
    if (!db.profiles[username]) db.profiles[username] = {};
    if (bio !== undefined) db.profiles[username].bio = bio.substring(0, 150);
    if (status !== undefined) db.profiles[username].status = status.substring(0, 30);
    if (accentColor !== undefined) db.profiles[username].accentColor = accentColor;
    if (fontSize !== undefined) db.profiles[username].fontSize = fontSize;
    if (animations !== undefined) db.profiles[username].animations = animations;
    saveDB();
    cb({ success: true, profile: db.profiles[username] });
  });

  // BLOCK: Add
  socket.on('block:add', (data, cb) => {
    const { username, target } = data;
    if (!db.blocked[username]) db.blocked[username] = [];
    if (!db.blocked[username].includes(target)) {
      db.blocked[username].push(target);
      saveDB();
    }
    cb({ success: true });
  });

  // BLOCK: Remove
  socket.on('block:remove', (data, cb) => {
    const { username, target } = data;
    if (db.blocked[username]) {
      db.blocked[username] = db.blocked[username].filter(u => u !== target);
      saveDB();
    }
    cb({ success: true });
  });

  // BLOCK: List
  socket.on('block:list', (data, cb) => {
    cb({ success: true, blocked: db.blocked[data.username] || [] });
  });

  // USER: Join
  socket.on('user:join', (data) => {
    const { username } = data;
    connectedUsers.set(socket.id, { username, online: true });
    userSockets.set(username, socket.id);

    const friends = db.friends[username] || [];
    friends.forEach(f => {
      const sid = userSockets.get(f);
      if (sid) io.to(sid).emit('user:status', { username, online: true });
    });

    socket.emit('friends:list', getFriendsWithStatus(username));
    socket.emit('friends:requests', db.friendRequests[username] || []);
  });

  // FRIENDS: Request
  socket.on('friends:request', (data, cb) => {
    const { from, to } = data;
    const norm = to.trim().toLowerCase();

    if (!db.users[norm]) return cb({ success: false, error: 'Usuário não encontrado' });
    if (norm === from) return cb({ success: false, error: 'Não pode adicionar a si mesmo' });
    if ((db.friends[from] || []).includes(norm)) return cb({ success: false, error: 'Já são Almas' });
    if ((db.friendRequests[norm] || []).some(r => r.from === from)) return cb({ success: false, error: 'Solicitação já enviada' });
    if (isBlocked(norm, from)) return cb({ success: false, error: 'Não foi possível enviar' });

    // Auto-accept
    const myReqs = db.friendRequests[from] || [];
    if (myReqs.find(r => r.from === norm)) {
      acceptFriend(from, norm);
      return cb({ success: true, message: 'Alma conectada!' });
    }

    if (!db.friendRequests[norm]) db.friendRequests[norm] = [];
    db.friendRequests[norm].push({ from, fromDisplayName: db.users[from]?.displayName || from, timestamp: Date.now() });
    saveDB();

    const targetSid = userSockets.get(norm);
    if (targetSid) io.to(targetSid).emit('friends:requests', db.friendRequests[norm]);

    cb({ success: true, message: 'Solicitação enviada!' });
  });

  socket.on('friends:accept', (data, cb) => { acceptFriend(data.username, data.from); cb({ success: true }); });

  socket.on('friends:reject', (data, cb) => {
    if (db.friendRequests[data.username]) {
      db.friendRequests[data.username] = db.friendRequests[data.username].filter(r => r.from !== data.from);
    }
    saveDB();
    socket.emit('friends:requests', db.friendRequests[data.username] || []);
    cb({ success: true });
  });

  // MESSAGES: Send
  socket.on('message:send', (data) => {
    const { senderId, receiverId, content } = data;

    if (isBlocked(receiverId, senderId)) return; // Blocked

    const ttl = calculateTTL(content.length);
    const kept = isChatKept(senderId, receiverId);

    const message = {
      id: uuidv4(), senderId, receiverId, content,
      timestamp: Date.now(), delivered: true,
      ttl, kept, encrypted: true
    };

    activeMessages.set(message.id, message);

    const senderSid = userSockets.get(senderId);
    const receiverSid = userSockets.get(receiverId);
    if (senderSid) io.to(senderSid).emit('message:new', message);
    if (receiverSid) io.to(receiverSid).emit('message:new', message);

    if (!kept) {
      const timer = setTimeout(() => deleteMessage(message.id), ttl);
      messageTimers.set(message.id, timer);
    }
  });

  // KEEP: Request
  socket.on('keep:request', (data, cb) => {
    const { from, to } = data;
    const key = getChatKey(from, to);

    if (db.keptChats[key]) return cb({ success: false, error: 'Conversa já mantida' });

    if (db.keepRequests[key] && db.keepRequests[key].from === to) {
      db.keptChats[key] = true;
      delete db.keepRequests[key];
      saveDB();
      const fromSid = userSockets.get(from);
      const toSid = userSockets.get(to);
      if (fromSid) io.to(fromSid).emit('keep:accepted', { chatKey: key, with: to });
      if (toSid) io.to(toSid).emit('keep:accepted', { chatKey: key, with: from });
      return cb({ success: true, message: 'Conversa mantida!' });
    }

    if (db.keepRequests[key]) return cb({ success: false, error: 'Aguardando resposta' });

    db.keepRequests[key] = { from, timestamp: Date.now() };
    saveDB();

    const toSid = userSockets.get(to);
    if (toSid) io.to(toSid).emit('keep:invite', { from, fromDisplayName: db.users[from]?.displayName || from, chatKey: key });

    cb({ success: true, message: 'Convite enviado!' });
  });

  socket.on('keep:accept', (data, cb) => {
    const { username, chatKey } = data;
    if (!db.keepRequests[chatKey]) return cb({ success: false });

    db.keptChats[chatKey] = true;
    const requester = db.keepRequests[chatKey].from;
    delete db.keepRequests[chatKey];
    saveDB();

    const reqSid = userSockets.get(requester);
    const accSid = userSockets.get(username);
    if (reqSid) io.to(reqSid).emit('keep:accepted', { chatKey, with: username });
    if (accSid) io.to(accSid).emit('keep:accepted', { chatKey, with: requester });
    cb({ success: true });
  });

  socket.on('keep:reject', (data, cb) => {
    const { username, chatKey } = data;
    if (db.keepRequests[chatKey]) {
      const requester = db.keepRequests[chatKey].from;
      delete db.keepRequests[chatKey];
      saveDB();
      const reqSid = userSockets.get(requester);
      if (reqSid) io.to(reqSid).emit('keep:rejected', { chatKey, by: username });
    }
    cb({ success: true });
  });

  socket.on('keep:status', (data, cb) => {
    const key = getChatKey(data.user1, data.user2);
    cb({ kept: db.keptChats[key] === true, pending: db.keepRequests[key] || null });
  });

  // TYPING
  socket.on('user:typing', (data) => {
    const targetSid = userSockets.get(data.targetId);
    if (targetSid) io.to(targetSid).emit('user:typing', { userId: data.userId, isTyping: data.isTyping });
  });

  // SCREENSHOT DETECTION (client reports)
  socket.on('screenshot:detected', (data) => {
    const { username, chatWith } = data;
    const targetSid = userSockets.get(chatWith);
    if (targetSid) {
      io.to(targetSid).emit('screenshot:alert', { 
        by: username, 
        byDisplayName: db.users[username]?.displayName || username 
      });
    }
  });

  // DISCONNECT
  socket.on('disconnect', () => {
    const user = connectedUsers.get(socket.id);
    if (user) {
      const friends = db.friends[user.username] || [];
      friends.forEach(f => {
        const sid = userSockets.get(f);
        if (sid) io.to(sid).emit('user:status', { username: user.username, online: false });
      });
      userSockets.delete(user.username);
      connectedUsers.delete(socket.id);
    }
  });
});

// ============================================================
// Funções
// ============================================================

function acceptFriend(username, from) {
  if (!db.friends[username]) db.friends[username] = [];
  if (!db.friends[from]) db.friends[from] = [];
  if (!db.friends[username].includes(from)) db.friends[username].push(from);
  if (!db.friends[from].includes(username)) db.friends[from].push(username);
  if (db.friendRequests[username]) db.friendRequests[username] = db.friendRequests[username].filter(r => r.from !== from);
  saveDB();

  const uSid = userSockets.get(username);
  const fSid = userSockets.get(from);
  if (uSid) { io.to(uSid).emit('friends:list', getFriendsWithStatus(username)); io.to(uSid).emit('friends:requests', db.friendRequests[username] || []); }
  if (fSid) io.to(fSid).emit('friends:list', getFriendsWithStatus(from));
}

function deleteMessage(messageId) {
  const msg = activeMessages.get(messageId);
  if (!msg) return;
  activeMessages.delete(messageId);
  if (messageTimers.has(messageId)) { clearTimeout(messageTimers.get(messageId)); messageTimers.delete(messageId); }

  const sSid = userSockets.get(msg.senderId);
  const rSid = userSockets.get(msg.receiverId);
  if (sSid) io.to(sSid).emit('message:delete', { messageId });
  if (rSid) io.to(rSid).emit('message:delete', { messageId });
}

// ============================================================
// Start
// ============================================================

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ⬡ Nexa Server | Port ${PORT} | Users: ${Object.keys(db.users).length}\n`);
});
