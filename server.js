/**
 * Ephemeral Chat Server
 * 
 * Servidor de mensagens efêmeras com Socket.IO.
 * Inclui: autenticação, sistema de amigos (Almas),
 * mensagens em tempo real com auto-destruição dinâmica,
 * sistema "Manter Conversa" com consentimento mútuo.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

// ============================================================
// Configuração do servidor
// ============================================================

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

const PORT = process.env.PORT || 3000;

// ============================================================
// TTL Dinâmico baseado no tamanho da mensagem
// ============================================================

/**
 * Calcula o tempo de vida da mensagem baseado no número de caracteres.
 * Mínimo: 2 segundos | Máximo: 20 segundos
 * 
 * Escala:
 *   10 chars = 2s
 *   40 chars = 4s
 *   100 chars = 7s
 *   200 chars = 12s
 *   300 chars = 17s
 */
function calculateTTL(contentLength) {
  if (contentLength <= 10) return 2000;
  if (contentLength <= 40) return Math.round(2000 + ((contentLength - 10) / 30) * 2000);
  if (contentLength <= 100) return Math.round(4000 + ((contentLength - 40) / 60) * 3000);
  if (contentLength <= 200) return Math.round(7000 + ((contentLength - 100) / 100) * 5000);
  if (contentLength <= 300) return Math.round(12000 + ((contentLength - 200) / 100) * 5000);
  return 20000; // máximo
}

// ============================================================
// CORS middleware
// ============================================================

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// ============================================================
// Servir arquivos estáticos do frontend
// ============================================================

app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    dirname: __dirname,
    publicExists: fs.existsSync(path.join(__dirname, 'public')),
    files: fs.existsSync(path.join(__dirname, 'public')) 
      ? fs.readdirSync(path.join(__dirname, 'public')) 
      : []
  });
});

// ============================================================
// Banco de dados em memória (persistido em arquivo JSON)
// ============================================================

const DB_PATH = path.join(__dirname, 'data.json');

let db = {
  users: {},           // { username: { username, password, createdAt } }
  friends: {},         // { username: [friendUsername, ...] }
  friendRequests: {},  // { username: [{ from, timestamp }, ...] }
  sessions: {},        // { token: { username, createdAt } }
  keptChats: {},       // { "user1:user2": true } - conversas mantidas (ambos aceitaram)
  keepRequests: {}     // { "user1:user2": { from, timestamp } } - solicitações pendentes
};

function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH, 'utf-8');
      const loaded = JSON.parse(data);
      db = { ...db, ...loaded };
      // Garantir que campos novos existam
      if (!db.keptChats) db.keptChats = {};
      if (!db.keepRequests) db.keepRequests = {};
      console.log('[DB] Banco de dados carregado');
    }
  } catch (err) {
    console.error('[DB] Erro ao carregar:', err.message);
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
// Armazenamento em memória
// ============================================================

const activeMessages = new Map();
const messageTimers = new Map();
const connectedUsers = new Map();
const userSockets = new Map();

// Mensagens mantidas (não expiram): { "user1:user2": [message, ...] }
const keptMessages = new Map();

// ============================================================
// Funções auxiliares para "Manter Conversa"
// ============================================================

/**
 * Gera chave única para um par de usuários (ordem alfabética)
 */
function getChatKey(user1, user2) {
  return [user1, user2].sort().join(':');
}

/**
 * Verifica se uma conversa está no modo "manter"
 */
function isChatKept(user1, user2) {
  const key = getChatKey(user1, user2);
  return db.keptChats[key] === true;
}

// ============================================================
// Lógica de Socket.IO
// ============================================================

io.on('connection', (socket) => {
  console.log(`[+] Conexão: ${socket.id}`);

  // ----------------------------------------------------------
  // AUTENTICAÇÃO: Registro
  // ----------------------------------------------------------
  socket.on('auth:register', (data, callback) => {
    const { username, password } = data;

    if (!username || username.trim().length < 2) {
      return callback({ success: false, error: 'Nome de usuário deve ter pelo menos 2 caracteres' });
    }
    if (!password || password.length < 4) {
      return callback({ success: false, error: 'Senha deve ter pelo menos 4 caracteres' });
    }

    const normalizedUsername = username.trim().toLowerCase();

    if (db.users[normalizedUsername]) {
      return callback({ success: false, error: 'Esse nome de usuário já está em uso' });
    }

    db.users[normalizedUsername] = {
      username: username.trim(),
      displayName: username.trim(),
      password: password,
      createdAt: Date.now()
    };

    db.friends[normalizedUsername] = [];
    db.friendRequests[normalizedUsername] = [];

    const token = uuidv4();
    db.sessions[token] = { username: normalizedUsername, createdAt: Date.now() };

    saveDB();
    console.log(`[auth] Novo usuário: ${username.trim()}`);

    callback({ success: true, token, user: { username: normalizedUsername, displayName: username.trim() } });
  });

  // ----------------------------------------------------------
  // AUTENTICAÇÃO: Login
  // ----------------------------------------------------------
  socket.on('auth:login', (data, callback) => {
    const { username, password } = data;

    if (!username || !password) {
      return callback({ success: false, error: 'Preencha todos os campos' });
    }

    const normalizedUsername = username.trim().toLowerCase();
    const user = db.users[normalizedUsername];

    if (!user || user.password !== password) {
      return callback({ success: false, error: 'Usuário ou senha incorretos' });
    }

    const token = uuidv4();
    db.sessions[token] = { username: normalizedUsername, createdAt: Date.now() };
    saveDB();

    console.log(`[auth] Login: ${normalizedUsername}`);
    callback({ success: true, token, user: { username: normalizedUsername, displayName: user.displayName || user.username } });
  });

  // ----------------------------------------------------------
  // AUTENTICAÇÃO: Validar sessão
  // ----------------------------------------------------------
  socket.on('auth:validate', (data, callback) => {
    const { token } = data;

    if (!token || !db.sessions[token]) {
      return callback({ success: false, error: 'Sessão inválida' });
    }

    const session = db.sessions[token];
    const user = db.users[session.username];

    if (!user) {
      delete db.sessions[token];
      saveDB();
      return callback({ success: false, error: 'Usuário não encontrado' });
    }

    callback({ success: true, user: { username: session.username, displayName: user.displayName || user.username } });
  });

  // ----------------------------------------------------------
  // AUTENTICAÇÃO: Logout
  // ----------------------------------------------------------
  socket.on('auth:logout', (data) => {
    const { token } = data;
    if (token && db.sessions[token]) {
      delete db.sessions[token];
      saveDB();
    }
  });

  // ----------------------------------------------------------
  // USUÁRIO: Entrar
  // ----------------------------------------------------------
  socket.on('user:join', (data) => {
    const { username } = data;

    connectedUsers.set(socket.id, { username, online: true });
    userSockets.set(username, socket.id);

    // Notificar amigos
    const friends = db.friends[username] || [];
    friends.forEach((friendUsername) => {
      const friendSocketId = userSockets.get(friendUsername);
      if (friendSocketId) {
        io.to(friendSocketId).emit('user:status', { username, online: true });
      }
    });

    socket.emit('friends:list', getFriendsWithStatus(username));
    socket.emit('friends:requests', db.friendRequests[username] || []);

    console.log(`[i] ${username} entrou`);
  });

  // ----------------------------------------------------------
  // ALMAS: Solicitação de amizade
  // ----------------------------------------------------------
  socket.on('friends:request', (data, callback) => {
    const { from, to } = data;
    const normalizedTo = to.trim().toLowerCase();

    if (!db.users[normalizedTo]) {
      return callback({ success: false, error: 'Usuário não encontrado' });
    }
    if (normalizedTo === from) {
      return callback({ success: false, error: 'Você não pode adicionar a si mesmo' });
    }

    const friends = db.friends[from] || [];
    if (friends.includes(normalizedTo)) {
      return callback({ success: false, error: 'Vocês já são Almas conectadas' });
    }

    const requests = db.friendRequests[normalizedTo] || [];
    if (requests.some(r => r.from === from)) {
      return callback({ success: false, error: 'Solicitação já enviada' });
    }

    // Auto-aceitar se a outra pessoa já mandou
    const myRequests = db.friendRequests[from] || [];
    const existingRequest = myRequests.find(r => r.from === normalizedTo);
    if (existingRequest) {
      acceptFriendRequest(from, normalizedTo);
      return callback({ success: true, message: 'Alma conectada!' });
    }

    if (!db.friendRequests[normalizedTo]) db.friendRequests[normalizedTo] = [];
    db.friendRequests[normalizedTo].push({
      from,
      fromDisplayName: db.users[from]?.displayName || from,
      timestamp: Date.now()
    });
    saveDB();

    const targetSocketId = userSockets.get(normalizedTo);
    if (targetSocketId) {
      io.to(targetSocketId).emit('friends:requests', db.friendRequests[normalizedTo]);
    }

    console.log(`[almas] ${from} -> ${normalizedTo} (solicitação)`);
    callback({ success: true, message: 'Solicitação enviada!' });
  });

  socket.on('friends:accept', (data, callback) => {
    const { username, from } = data;
    acceptFriendRequest(username, from);
    callback({ success: true });
  });

  socket.on('friends:reject', (data, callback) => {
    const { username, from } = data;
    if (db.friendRequests[username]) {
      db.friendRequests[username] = db.friendRequests[username].filter(r => r.from !== from);
    }
    saveDB();
    socket.emit('friends:requests', db.friendRequests[username] || []);
    callback({ success: true });
  });

  // ----------------------------------------------------------
  // MENSAGENS: Enviar
  // ----------------------------------------------------------
  socket.on('message:send', (data) => {
    const { senderId, receiverId, content } = data;

    const message = {
      id: uuidv4(),
      senderId,
      receiverId,
      content,
      timestamp: Date.now(),
      delivered: true
    };

    // Calcular TTL dinâmico baseado no tamanho
    const ttl = calculateTTL(content.length);
    message.ttl = ttl;

    // Verificar se a conversa está em modo "manter"
    const kept = isChatKept(senderId, receiverId);
    message.kept = kept;

    // Armazenar mensagem ativa
    activeMessages.set(message.id, message);

    // Enviar para ambos
    const senderSocketId = userSockets.get(senderId);
    const receiverSocketId = userSockets.get(receiverId);

    if (senderSocketId) io.to(senderSocketId).emit('message:new', message);
    if (receiverSocketId) io.to(receiverSocketId).emit('message:new', message);

    console.log(`[msg] ${senderId} -> ${receiverId}: "${content}" (TTL: ${ttl}ms, kept: ${kept})`);

    // Se a conversa NÃO está mantida, agendar exclusão
    if (!kept) {
      const timer = setTimeout(() => {
        deleteMessage(message.id);
      }, ttl);
      messageTimers.set(message.id, timer);
    } else {
      // Armazenar em mensagens mantidas
      const chatKey = getChatKey(senderId, receiverId);
      if (!keptMessages.has(chatKey)) keptMessages.set(chatKey, []);
      keptMessages.get(chatKey).push(message);
    }
  });

  // ----------------------------------------------------------
  // MANTER CONVERSA: Solicitar
  // ----------------------------------------------------------
  socket.on('keep:request', (data, callback) => {
    const { from, to } = data;
    const chatKey = getChatKey(from, to);

    // Verificar se já está mantida
    if (db.keptChats[chatKey]) {
      return callback({ success: false, error: 'Esta conversa já está sendo mantida' });
    }

    // Verificar se já existe solicitação
    if (db.keepRequests[chatKey]) {
      // Se a outra pessoa já solicitou, aceitar automaticamente
      if (db.keepRequests[chatKey].from === to) {
        db.keptChats[chatKey] = true;
        delete db.keepRequests[chatKey];
        saveDB();

        // Notificar ambos
        const fromSocketId = userSockets.get(from);
        const toSocketId = userSockets.get(to);
        if (fromSocketId) io.to(fromSocketId).emit('keep:accepted', { chatKey, with: to });
        if (toSocketId) io.to(toSocketId).emit('keep:accepted', { chatKey, with: from });

        return callback({ success: true, message: 'Conversa mantida!' });
      }
      return callback({ success: false, error: 'Aguardando resposta do outro participante' });
    }

    // Criar solicitação
    db.keepRequests[chatKey] = { from, timestamp: Date.now() };
    saveDB();

    // Enviar convite para a outra pessoa via mensagem do sistema
    const toSocketId = userSockets.get(to);
    if (toSocketId) {
      io.to(toSocketId).emit('keep:invite', { 
        from, 
        fromDisplayName: db.users[from]?.displayName || from,
        chatKey 
      });
    }

    console.log(`[keep] ${from} solicitou manter conversa com ${to}`);
    callback({ success: true, message: 'Convite enviado! A outra pessoa precisa aceitar.' });
  });

  // ----------------------------------------------------------
  // MANTER CONVERSA: Aceitar
  // ----------------------------------------------------------
  socket.on('keep:accept', (data, callback) => {
    const { username, chatKey } = data;

    if (!db.keepRequests[chatKey]) {
      return callback({ success: false, error: 'Solicitação não encontrada' });
    }

    // Ativar modo manter
    db.keptChats[chatKey] = true;
    const requester = db.keepRequests[chatKey].from;
    delete db.keepRequests[chatKey];
    saveDB();

    // Notificar ambos
    const requesterSocketId = userSockets.get(requester);
    const accepterSocketId = userSockets.get(username);

    if (requesterSocketId) io.to(requesterSocketId).emit('keep:accepted', { chatKey, with: username });
    if (accepterSocketId) io.to(accepterSocketId).emit('keep:accepted', { chatKey, with: requester });

    console.log(`[keep] ${username} aceitou manter conversa (${chatKey})`);
    callback({ success: true });
  });

  // ----------------------------------------------------------
  // MANTER CONVERSA: Recusar
  // ----------------------------------------------------------
  socket.on('keep:reject', (data, callback) => {
    const { username, chatKey } = data;

    if (db.keepRequests[chatKey]) {
      const requester = db.keepRequests[chatKey].from;
      delete db.keepRequests[chatKey];
      saveDB();

      // Notificar quem solicitou
      const requesterSocketId = userSockets.get(requester);
      if (requesterSocketId) {
        io.to(requesterSocketId).emit('keep:rejected', { chatKey, by: username });
      }
    }

    callback({ success: true });
  });

  // ----------------------------------------------------------
  // MANTER CONVERSA: Verificar status
  // ----------------------------------------------------------
  socket.on('keep:status', (data, callback) => {
    const { user1, user2 } = data;
    const chatKey = getChatKey(user1, user2);
    const kept = db.keptChats[chatKey] === true;
    const pending = db.keepRequests[chatKey] || null;
    callback({ kept, pending });
  });

  // ----------------------------------------------------------
  // Indicador de "digitando..."
  // ----------------------------------------------------------
  socket.on('user:typing', (data) => {
    const { userId, targetId, isTyping } = data;
    const targetSocketId = userSockets.get(targetId);
    if (targetSocketId) {
      io.to(targetSocketId).emit('user:typing', { userId, isTyping });
    }
  });

  // ----------------------------------------------------------
  // Desconexão
  // ----------------------------------------------------------
  socket.on('disconnect', () => {
    const user = connectedUsers.get(socket.id);
    if (user) {
      const friends = db.friends[user.username] || [];
      friends.forEach((friendUsername) => {
        const friendSocketId = userSockets.get(friendUsername);
        if (friendSocketId) {
          io.to(friendSocketId).emit('user:status', { username: user.username, online: false });
        }
      });
      userSockets.delete(user.username);
      connectedUsers.delete(socket.id);
      console.log(`[-] ${user.username} desconectou`);
    }
  });
});

// ============================================================
// Funções auxiliares
// ============================================================

function acceptFriendRequest(username, from) {
  if (!db.friends[username]) db.friends[username] = [];
  if (!db.friends[from]) db.friends[from] = [];

  if (!db.friends[username].includes(from)) db.friends[username].push(from);
  if (!db.friends[from].includes(username)) db.friends[from].push(username);

  if (db.friendRequests[username]) {
    db.friendRequests[username] = db.friendRequests[username].filter(r => r.from !== from);
  }
  saveDB();

  const userSocketId = userSockets.get(username);
  const fromSocketId = userSockets.get(from);

  if (userSocketId) {
    io.to(userSocketId).emit('friends:list', getFriendsWithStatus(username));
    io.to(userSocketId).emit('friends:requests', db.friendRequests[username] || []);
  }
  if (fromSocketId) {
    io.to(fromSocketId).emit('friends:list', getFriendsWithStatus(from));
  }

  console.log(`[almas] ${username} <-> ${from} (conectados!)`);
}

function getFriendsWithStatus(username) {
  const friends = db.friends[username] || [];
  return friends.map((friendUsername) => {
    const user = db.users[friendUsername];
    return {
      username: friendUsername,
      displayName: user?.displayName || friendUsername,
      online: userSockets.has(friendUsername)
    };
  });
}

function deleteMessage(messageId) {
  const message = activeMessages.get(messageId);
  if (!message) return;

  activeMessages.delete(messageId);

  if (messageTimers.has(messageId)) {
    clearTimeout(messageTimers.get(messageId));
    messageTimers.delete(messageId);
  }

  const senderSocketId = userSockets.get(message.senderId);
  const receiverSocketId = userSockets.get(message.receiverId);

  if (senderSocketId) io.to(senderSocketId).emit('message:delete', { messageId });
  if (receiverSocketId) io.to(receiverSocketId).emit('message:delete', { messageId });

  console.log(`[x] Mensagem ${messageId} apagada`);
}

// ============================================================
// Iniciar servidor
// ============================================================

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║       EPHEMERAL CHAT - Servidor          ║
  ║                                          ║
  ║   Rodando em: http://localhost:${PORT}      ║
  ║   TTL: dinâmico (2s-20s)                ║
  ║   Usuários: ${Object.keys(db.users).length}                          ║
  ╚══════════════════════════════════════════╝
  `);
});
