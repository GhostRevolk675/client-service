/**
 * Ephemeral Chat Server
 * 
 * Servidor de mensagens efêmeras com Socket.IO.
 * Inclui: autenticação, sistema de amigos (Almas),
 * mensagens em tempo real com auto-destruição em 3s.
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

// Tempo de vida das mensagens em milissegundos
const MESSAGE_TTL = 3000;

// ============================================================
// CORS middleware (para o app Android se conectar via HTTP)
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
    publicExists: require('fs').existsSync(path.join(__dirname, 'public')),
    files: require('fs').existsSync(path.join(__dirname, 'public')) 
      ? require('fs').readdirSync(path.join(__dirname, 'public')) 
      : []
  });
});

// ============================================================
// Banco de dados em memória (persistido em arquivo JSON)
// ============================================================

const DB_PATH = path.join(__dirname, 'data.json');

// Estrutura do banco de dados
let db = {
  users: {},          // { username: { username, password, createdAt } }
  friends: {},        // { username: [friendUsername, ...] }
  friendRequests: {}, // { username: [{ from, timestamp }, ...] }
  sessions: {}        // { token: { username, createdAt } }
};

// Carregar banco de dados do arquivo se existir
function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH, 'utf-8');
      db = JSON.parse(data);
      console.log('[DB] Banco de dados carregado');
    }
  } catch (err) {
    console.error('[DB] Erro ao carregar:', err.message);
  }
}

// Salvar banco de dados no arquivo
function saveDB() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('[DB] Erro ao salvar:', err.message);
  }
}

// Carregar ao iniciar
loadDB();

// ============================================================
// Armazenamento em memória (mensagens e usuários online)
// ============================================================

// Mensagens ativas (ainda não expiraram)
const activeMessages = new Map();

// Timers de exclusão de mensagens
const messageTimers = new Map();

// Usuários conectados: socketId -> { username, online }
const connectedUsers = new Map();

// Mapeamento username -> socketId (para envio direto)
const userSockets = new Map();

// ============================================================
// Lógica de Socket.IO
// ============================================================

io.on('connection', (socket) => {
  console.log(`[+] Conexão: ${socket.id}`);

  // ----------------------------------------------------------
  // AUTENTICAÇÃO: Registro de conta
  // ----------------------------------------------------------
  socket.on('auth:register', (data, callback) => {
    const { username, password } = data;

    // Validações
    if (!username || username.trim().length < 2) {
      return callback({ success: false, error: 'Nome de usuário deve ter pelo menos 2 caracteres' });
    }
    if (!password || password.length < 4) {
      return callback({ success: false, error: 'Senha deve ter pelo menos 4 caracteres' });
    }

    const normalizedUsername = username.trim().toLowerCase();

    // Verificar se já existe
    if (db.users[normalizedUsername]) {
      return callback({ success: false, error: 'Esse nome de usuário já está em uso' });
    }

    // Criar usuário
    db.users[normalizedUsername] = {
      username: username.trim(),
      displayName: username.trim(),
      password: password, // Em produção, usar bcrypt
      createdAt: Date.now()
    };

    // Inicializar listas
    db.friends[normalizedUsername] = [];
    db.friendRequests[normalizedUsername] = [];

    // Criar sessão
    const token = uuidv4();
    db.sessions[token] = {
      username: normalizedUsername,
      createdAt: Date.now()
    };

    saveDB();

    console.log(`[auth] Novo usuário registrado: ${username.trim()}`);

    callback({
      success: true,
      token,
      user: {
        username: normalizedUsername,
        displayName: username.trim()
      }
    });
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

    // Criar sessão
    const token = uuidv4();
    db.sessions[token] = {
      username: normalizedUsername,
      createdAt: Date.now()
    };

    saveDB();

    console.log(`[auth] Login: ${normalizedUsername}`);

    callback({
      success: true,
      token,
      user: {
        username: normalizedUsername,
        displayName: user.displayName || user.username
      }
    });
  });

  // ----------------------------------------------------------
  // AUTENTICAÇÃO: Validar sessão (token)
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

    callback({
      success: true,
      user: {
        username: session.username,
        displayName: user.displayName || user.username
      }
    });
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
  // USUÁRIO: Entrar (após autenticação)
  // ----------------------------------------------------------
  socket.on('user:join', (data) => {
    const { username } = data;

    connectedUsers.set(socket.id, {
      username,
      online: true
    });

    userSockets.set(username, socket.id);

    // Notificar amigos que este usuário está online
    const friends = db.friends[username] || [];
    friends.forEach((friendUsername) => {
      const friendSocketId = userSockets.get(friendUsername);
      if (friendSocketId) {
        io.to(friendSocketId).emit('user:status', { username, online: true });
      }
    });

    // Enviar lista de amigos e solicitações pendentes
    socket.emit('friends:list', getFriendsWithStatus(username));
    socket.emit('friends:requests', db.friendRequests[username] || []);

    console.log(`[i] ${username} entrou`);
  });

  // ----------------------------------------------------------
  // ALMAS: Enviar solicitação de amizade
  // ----------------------------------------------------------
  socket.on('friends:request', (data, callback) => {
    const { from, to } = data;
    const normalizedTo = to.trim().toLowerCase();

    // Verificar se o usuário destino existe
    if (!db.users[normalizedTo]) {
      return callback({ success: false, error: 'Usuário não encontrado' });
    }

    // Não pode adicionar a si mesmo
    if (normalizedTo === from) {
      return callback({ success: false, error: 'Você não pode adicionar a si mesmo' });
    }

    // Verificar se já são amigos
    const friends = db.friends[from] || [];
    if (friends.includes(normalizedTo)) {
      return callback({ success: false, error: 'Vocês já são Almas conectadas' });
    }

    // Verificar se já existe solicitação pendente
    const requests = db.friendRequests[normalizedTo] || [];
    if (requests.some(r => r.from === from)) {
      return callback({ success: false, error: 'Solicitação já enviada' });
    }

    // Verificar se a outra pessoa já mandou solicitação (aceitar automaticamente)
    const myRequests = db.friendRequests[from] || [];
    const existingRequest = myRequests.find(r => r.from === normalizedTo);
    if (existingRequest) {
      // Aceitar automaticamente (ambos se adicionaram)
      acceptFriendRequest(from, normalizedTo);
      return callback({ success: true, message: 'Alma conectada!' });
    }

    // Adicionar solicitação
    if (!db.friendRequests[normalizedTo]) {
      db.friendRequests[normalizedTo] = [];
    }
    db.friendRequests[normalizedTo].push({
      from,
      fromDisplayName: db.users[from]?.displayName || from,
      timestamp: Date.now()
    });

    saveDB();

    // Notificar o destinatário em tempo real se estiver online
    const targetSocketId = userSockets.get(normalizedTo);
    if (targetSocketId) {
      io.to(targetSocketId).emit('friends:requests', db.friendRequests[normalizedTo]);
    }

    console.log(`[almas] ${from} -> ${normalizedTo} (solicitação enviada)`);

    callback({ success: true, message: 'Solicitação enviada!' });
  });

  // ----------------------------------------------------------
  // ALMAS: Aceitar solicitação
  // ----------------------------------------------------------
  socket.on('friends:accept', (data, callback) => {
    const { username, from } = data;
    acceptFriendRequest(username, from);
    callback({ success: true });
  });

  // ----------------------------------------------------------
  // ALMAS: Rejeitar solicitação
  // ----------------------------------------------------------
  socket.on('friends:reject', (data, callback) => {
    const { username, from } = data;

    // Remover solicitação
    if (db.friendRequests[username]) {
      db.friendRequests[username] = db.friendRequests[username].filter(r => r.from !== from);
    }
    saveDB();

    // Atualizar lista de solicitações
    socket.emit('friends:requests', db.friendRequests[username] || []);

    callback({ success: true });
  });

  // ----------------------------------------------------------
  // MENSAGENS: Enviar nova mensagem
  // ----------------------------------------------------------
  socket.on('message:send', (data) => {
    const { senderId, receiverId, content } = data;

    // Criar mensagem com ID único e timestamp
    const message = {
      id: uuidv4(),
      senderId,
      receiverId,
      content,
      timestamp: Date.now(),
      delivered: true
    };

    // Armazenar mensagem ativa
    activeMessages.set(message.id, message);

    // Enviar para o remetente
    const senderSocketId = userSockets.get(senderId);
    if (senderSocketId) {
      io.to(senderSocketId).emit('message:new', message);
    }

    // Enviar para o destinatário
    const receiverSocketId = userSockets.get(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit('message:new', message);
    }

    console.log(`[msg] ${senderId} -> ${receiverId}: "${content}"`);

    // Agendar exclusão automática após 3 segundos
    const timer = setTimeout(() => {
      deleteMessage(message.id);
    }, MESSAGE_TTL);

    messageTimers.set(message.id, timer);
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
      // Notificar amigos que este usuário saiu
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

/**
 * Aceita uma solicitação de amizade e conecta ambos como Almas
 */
function acceptFriendRequest(username, from) {
  // Adicionar como amigos mutuamente
  if (!db.friends[username]) db.friends[username] = [];
  if (!db.friends[from]) db.friends[from] = [];

  if (!db.friends[username].includes(from)) {
    db.friends[username].push(from);
  }
  if (!db.friends[from].includes(username)) {
    db.friends[from].push(username);
  }

  // Remover solicitação
  if (db.friendRequests[username]) {
    db.friendRequests[username] = db.friendRequests[username].filter(r => r.from !== from);
  }

  saveDB();

  // Notificar ambos com a lista atualizada
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

/**
 * Retorna lista de amigos com status online/offline
 */
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

/**
 * Deleta uma mensagem (chamada pelo timer)
 */
function deleteMessage(messageId) {
  const message = activeMessages.get(messageId);
  if (!message) return;

  // Remover do armazenamento
  activeMessages.delete(messageId);

  // Limpar timer
  if (messageTimers.has(messageId)) {
    clearTimeout(messageTimers.get(messageId));
    messageTimers.delete(messageId);
  }

  // Notificar remetente e destinatário
  const senderSocketId = userSockets.get(message.senderId);
  const receiverSocketId = userSockets.get(message.receiverId);

  if (senderSocketId) {
    io.to(senderSocketId).emit('message:delete', { messageId });
  }
  if (receiverSocketId) {
    io.to(receiverSocketId).emit('message:delete', { messageId });
  }

  console.log(`[x] Mensagem ${messageId} apagada permanentemente`);
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
  ║   Mensagens expiram em: ${MESSAGE_TTL / 1000}s            ║
  ║   Usuários cadastrados: ${Object.keys(db.users).length}              ║
  ╚══════════════════════════════════════════╝
  `);
});
