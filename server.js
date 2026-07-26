/**
 * Ephemeral Chat Server
 * 
 * Servidor de mensagens efêmeras com Socket.IO.
 * As mensagens são sincronizadas em tempo real e automaticamente
 * removidas após 3 segundos, sem possibilidade de recuperação.
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

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

// ============================================================
// Armazenamento em memória (mensagens e usuários conectados)
// ============================================================

// Mensagens ativas (ainda não expiraram)
const activeMessages = new Map();

// Usuários conectados: socketId -> { userId, username, online }
const connectedUsers = new Map();

// Timers de exclusão de mensagens
const messageTimers = new Map();

// ============================================================
// Contatos disponíveis (simulação de contato único)
// ============================================================

const contacts = [
  {
    id: 'user-1',
    name: 'Você',
    avatar: null // Gerado no frontend com iniciais
  },
  {
    id: 'user-2',
    name: 'Contato',
    avatar: null
  }
];

// ============================================================
// Lógica de Socket.IO
// ============================================================

io.on('connection', (socket) => {
  console.log(`[+] Usuário conectado: ${socket.id}`);

  // ----------------------------------------------------------
  // Registro do usuário ao entrar
  // ----------------------------------------------------------
  socket.on('user:join', (data) => {
    const { userId, username } = data;

    connectedUsers.set(socket.id, {
      userId,
      username,
      online: true
    });

    // Notificar todos que o usuário está online
    io.emit('user:status', { userId, online: true });

    // Enviar contatos disponíveis
    socket.emit('contacts:list', contacts);

    // Enviar mensagens ativas (que ainda não expiraram)
    const currentMessages = Array.from(activeMessages.values()).map((msg) => ({
      ...msg,
      remainingTime: Math.max(0, MESSAGE_TTL - (Date.now() - msg.timestamp))
    }));
    socket.emit('messages:active', currentMessages);

    console.log(`[i] ${username} (${userId}) registrado`);
  });

  // ----------------------------------------------------------
  // Receber nova mensagem
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

    // Enviar mensagem para todos os participantes da conversa
    io.emit('message:new', message);

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
    const { userId, isTyping } = data;
    // Repassar para os outros usuários
    socket.broadcast.emit('user:typing', { userId, isTyping });
  });

  // ----------------------------------------------------------
  // Desconexão
  // ----------------------------------------------------------
  socket.on('disconnect', () => {
    const user = connectedUsers.get(socket.id);

    if (user) {
      user.online = false;
      io.emit('user:status', { userId: user.userId, online: false });
      connectedUsers.delete(socket.id);
      console.log(`[-] ${user.username} desconectado`);
    }
  });
});

// ============================================================
// Função para deletar mensagem (chamada pelo timer)
// ============================================================

function deleteMessage(messageId) {
  // Remover do armazenamento
  activeMessages.delete(messageId);

  // Limpar timer
  if (messageTimers.has(messageId)) {
    clearTimeout(messageTimers.get(messageId));
    messageTimers.delete(messageId);
  }

  // Notificar todos os clientes para remover a mensagem
  io.emit('message:delete', { messageId });

  console.log(`[x] Mensagem ${messageId} apagada permanentemente`);
}

// ============================================================
// Iniciar servidor
// ============================================================

server.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║       EPHEMERAL CHAT - Servidor          ║
  ║                                          ║
  ║   Rodando em: http://localhost:${PORT}      ║
  ║   Mensagens expiram em: ${MESSAGE_TTL / 1000}s            ║
  ╚══════════════════════════════════════════╝
  `);
});
