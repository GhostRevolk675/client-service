/**
 * Ephemeral Chat - Frontend Application
 * 
 * Gerencia a conexão Socket.IO, navegação entre telas,
 * envio/recebimento de mensagens e timers de expiração.
 */

// ============================================================
// Estado da aplicação
// ============================================================

const state = {
  socket: null,
  userId: null,
  username: null,
  currentContact: null,
  contacts: [],
  isTyping: false,
  typingTimeout: null
};

// ============================================================
// Elementos do DOM
// ============================================================

const DOM = {
  // Telas
  loginScreen: document.getElementById('login-screen'),
  contactsScreen: document.getElementById('contacts-screen'),
  chatScreen: document.getElementById('chat-screen'),

  // Login
  usernameInput: document.getElementById('username-input'),
  loginBtn: document.getElementById('login-btn'),

  // Contatos
  myAvatar: document.getElementById('my-avatar'),
  myUsername: document.getElementById('my-username'),
  contactsContainer: document.getElementById('contacts-container'),
  logoutBtn: document.getElementById('logout-btn'),

  // Chat
  backBtn: document.getElementById('back-btn'),
  chatAvatar: document.getElementById('chat-avatar'),
  chatContactName: document.getElementById('chat-contact-name'),
  chatContactStatus: document.getElementById('chat-contact-status'),
  messagesContainer: document.getElementById('messages-container'),
  messagesList: document.getElementById('messages-list'),
  messageInput: document.getElementById('message-input'),
  sendBtn: document.getElementById('send-btn'),
  typingIndicator: document.getElementById('typing-indicator'),

  // Template
  messageTemplate: document.getElementById('message-template')
};

// ============================================================
// Inicialização
// ============================================================

function init() {
  setupEventListeners();
  connectSocket();
}

// ============================================================
// Conexão Socket.IO
// ============================================================

function connectSocket() {
  // Conectar ao servidor (usa config.js para determinar a URL)
  const serverUrl = getServerUrl();
  state.socket = serverUrl ? io(serverUrl, { transports: ['websocket', 'polling'] }) : io();

  // -- Receber lista de contatos
  state.socket.on('contacts:list', (contacts) => {
    state.contacts = contacts;
    renderContacts();
  });

  // -- Receber mensagens ativas (ao conectar)
  state.socket.on('messages:active', (messages) => {
    messages.forEach((msg) => {
      if (msg.remainingTime > 0) {
        addMessageToUI(msg, msg.remainingTime);
      }
    });
    scrollToBottom();
  });

  // -- Nova mensagem recebida
  state.socket.on('message:new', (message) => {
    addMessageToUI(message, 3000);
    scrollToBottom();

    // Notificação sonora se a janela não está focada (opcional)
    if (document.hidden && message.senderId !== state.userId) {
      notifyUser(message);
    }
  });

  // -- Mensagem deletada (expirou)
  state.socket.on('message:delete', ({ messageId }) => {
    removeMessageFromUI(messageId);
  });

  // -- Status do usuário (online/offline)
  state.socket.on('user:status', ({ userId, online }) => {
    updateContactStatus(userId, online);
  });

  // -- Indicador de digitando
  state.socket.on('user:typing', ({ userId, isTyping }) => {
    if (userId !== state.userId) {
      toggleTypingIndicator(isTyping);
    }
  });

  // -- Eventos de conexão (importante para app nativo)
  state.socket.on('connect', () => {
    console.log('[Ephemeral] Conectado ao servidor');
    // Re-registrar usuário se já estava logado (reconexão)
    if (state.userId && state.username) {
      state.socket.emit('user:join', {
        userId: state.userId,
        username: state.username
      });
    }
  });

  state.socket.on('disconnect', () => {
    console.log('[Ephemeral] Desconectado do servidor');
  });

  state.socket.on('connect_error', (err) => {
    console.error('[Ephemeral] Erro de conexão:', err.message);
  });
}

// ============================================================
// Event Listeners
// ============================================================

function setupEventListeners() {
  // Login
  DOM.usernameInput.addEventListener('input', handleUsernameInput);
  DOM.usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !DOM.loginBtn.disabled) {
      handleLogin();
    }
  });
  DOM.loginBtn.addEventListener('click', handleLogin);

  // Chat
  DOM.backBtn.addEventListener('click', navigateToContacts);
  DOM.messageInput.addEventListener('input', handleMessageInput);
  DOM.messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !DOM.sendBtn.disabled) {
      handleSendMessage();
    }
  });
  DOM.sendBtn.addEventListener('click', handleSendMessage);

  // Logout
  DOM.logoutBtn.addEventListener('click', handleLogout);
}

// ============================================================
// Handlers
// ============================================================

/**
 * Valida input do username e habilita/desabilita botão
 */
function handleUsernameInput() {
  const value = DOM.usernameInput.value.trim();
  DOM.loginBtn.disabled = value.length < 2;
}

/**
 * Realiza o login e registra o usuário no servidor
 */
function handleLogin() {
  const username = DOM.usernameInput.value.trim();
  if (username.length < 2) return;

  // Gerar ID único para o usuário
  state.userId = 'user-' + generateId();
  state.username = username;

  // Registrar no servidor
  state.socket.emit('user:join', {
    userId: state.userId,
    username: state.username
  });

  // Atualizar UI
  DOM.myUsername.textContent = username;
  DOM.myAvatar.textContent = getInitials(username);

  // Navegar para contatos
  navigateToScreen('contacts');
}

/**
 * Logout - volta para a tela de login
 */
function handleLogout() {
  state.userId = null;
  state.username = null;
  DOM.usernameInput.value = '';
  DOM.loginBtn.disabled = true;
  navigateToScreen('login');
}

/**
 * Gerencia input de mensagem (habilitar envio + indicador digitando)
 */
function handleMessageInput() {
  const value = DOM.messageInput.value.trim();
  DOM.sendBtn.disabled = value.length === 0;

  // Emitir indicador de "digitando"
  if (!state.isTyping && value.length > 0) {
    state.isTyping = true;
    state.socket.emit('user:typing', { userId: state.userId, isTyping: true });
  }

  // Resetar timeout de "digitando"
  clearTimeout(state.typingTimeout);
  state.typingTimeout = setTimeout(() => {
    state.isTyping = false;
    state.socket.emit('user:typing', { userId: state.userId, isTyping: false });
  }, 1500);
}

/**
 * Envia a mensagem para o servidor
 */
function handleSendMessage() {
  const content = DOM.messageInput.value.trim();
  if (!content) return;

  state.socket.emit('message:send', {
    senderId: state.userId,
    receiverId: state.currentContact,
    content
  });

  // Limpar input
  DOM.messageInput.value = '';
  DOM.sendBtn.disabled = true;

  // Parar indicador de digitando
  state.isTyping = false;
  state.socket.emit('user:typing', { userId: state.userId, isTyping: false });

  // Foco de volta no input
  DOM.messageInput.focus();
}

// ============================================================
// Navegação entre telas
// ============================================================

function navigateToScreen(screenName) {
  // Remover active de todas as telas
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));

  // Ativar a tela alvo
  switch (screenName) {
    case 'login':
      DOM.loginScreen.classList.add('active');
      break;
    case 'contacts':
      DOM.contactsScreen.classList.add('active');
      break;
    case 'chat':
      DOM.chatScreen.classList.add('active');
      DOM.messageInput.focus();
      break;
  }
}

function navigateToContacts() {
  state.currentContact = null;
  navigateToScreen('contacts');
}

function openChat(contact) {
  state.currentContact = contact.id;

  // Atualizar header do chat
  DOM.chatContactName.textContent = contact.name;
  DOM.chatAvatar.textContent = getInitials(contact.name);

  // Limpar mensagens anteriores da UI
  DOM.messagesList.innerHTML = '';

  // Navegar
  navigateToScreen('chat');
}

// ============================================================
// Renderização de contatos
// ============================================================

function renderContacts() {
  DOM.contactsContainer.innerHTML = '';

  // Filtrar contatos (não mostrar a si mesmo)
  const otherContacts = state.contacts.filter((c) => c.id !== state.userId);

  // Se não há outros contatos reais, mostrar o contato padrão
  const contactsToShow = otherContacts.length > 0 ? otherContacts : [
    { id: 'contact-default', name: 'Contato', avatar: null }
  ];

  contactsToShow.forEach((contact) => {
    const item = document.createElement('div');
    item.className = 'contact-item';
    item.innerHTML = `
      <div class="contact-avatar">
        ${getInitials(contact.name)}
        <div class="online-indicator" id="status-${contact.id}"></div>
      </div>
      <div class="contact-info">
        <div class="contact-name">${contact.name}</div>
        <div class="contact-preview">Toque para conversar</div>
      </div>
    `;
    item.addEventListener('click', () => openChat(contact));
    DOM.contactsContainer.appendChild(item);
  });
}

// ============================================================
// Mensagens - UI
// ============================================================

/**
 * Adiciona uma mensagem na tela com timer de expiração
 */
function addMessageToUI(message, remainingTime) {
  const { id, senderId, content, delivered } = message;
  const isSent = senderId === state.userId;

  // Clonar template
  const template = DOM.messageTemplate.content.cloneNode(true);
  const bubble = template.querySelector('.message-bubble');

  // Configurar classes e dados
  bubble.classList.add(isSent ? 'sent' : 'received');
  bubble.dataset.messageId = id;

  // Conteúdo
  bubble.querySelector('.message-content').textContent = content;

  // Status (✓ ou ✓✓)
  const statusEl = bubble.querySelector('.message-status');
  if (isSent) {
    statusEl.textContent = delivered ? '✓✓' : '✓';
  } else {
    statusEl.textContent = '';
  }

  // Timer visual
  const timerEl = bubble.querySelector('.message-timer');
  const timerBarFill = bubble.querySelector('.timer-bar-fill');

  // Ajustar animação da barra ao tempo restante
  const remainingSec = Math.ceil(remainingTime / 1000);
  timerEl.textContent = `${remainingSec}s`;
  timerBarFill.style.animationDuration = `${remainingTime}ms`;

  // Adicionar ao DOM
  DOM.messagesList.appendChild(bubble);

  // Iniciar countdown do texto
  startCountdown(bubble, remainingTime);
}

/**
 * Inicia contagem regressiva visual na mensagem
 */
function startCountdown(bubble, remainingTime) {
  const timerEl = bubble.querySelector('.message-timer');
  let remaining = remainingTime;

  const interval = setInterval(() => {
    remaining -= 100;
    const sec = Math.max(0, Math.ceil(remaining / 1000));
    timerEl.textContent = `${sec}s`;

    if (remaining <= 0) {
      clearInterval(interval);
    }
  }, 100);

  // Guardar referência para limpar se a mensagem for removida antes
  bubble.dataset.intervalId = interval;
}

/**
 * Remove mensagem da UI com animação
 */
function removeMessageFromUI(messageId) {
  const bubble = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!bubble) return;

  // Limpar interval do countdown
  if (bubble.dataset.intervalId) {
    clearInterval(parseInt(bubble.dataset.intervalId));
  }

  // Adicionar classe de fade-out
  bubble.classList.add('fading');

  // Remover do DOM após animação
  setTimeout(() => {
    bubble.remove();
  }, 400);
}

// ============================================================
// Indicador de digitando
// ============================================================

function toggleTypingIndicator(show) {
  if (show) {
    DOM.typingIndicator.classList.remove('hidden');
  } else {
    DOM.typingIndicator.classList.add('hidden');
  }
  scrollToBottom();
}

// ============================================================
// Status do contato
// ============================================================

function updateContactStatus(userId, online) {
  // Atualizar indicador na lista de contatos
  const indicator = document.getElementById(`status-${userId}`);
  if (indicator) {
    indicator.style.display = online ? 'block' : 'none';
  }

  // Atualizar header do chat se estiver na conversa com esse contato
  if (state.currentContact === userId || state.currentContact === 'contact-default') {
    DOM.chatContactStatus.textContent = online ? 'online' : 'offline';
    DOM.chatContactStatus.className = `status-text ${online ? 'online' : ''}`;
  }
}

// ============================================================
// Utilidades
// ============================================================

/**
 * Gera iniciais a partir do nome
 */
function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(' ');
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return parts[0].substring(0, 2).toUpperCase();
}

/**
 * Gera ID simples
 */
function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * Scroll automático para o final das mensagens
 */
function scrollToBottom() {
  requestAnimationFrame(() => {
    DOM.messagesContainer.scrollTop = DOM.messagesContainer.scrollHeight;
  });
}

/**
 * Notificação de nova mensagem (quando a aba não está focada)
 */
function notifyUser(message) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification('Nova mensagem efêmera', {
      body: 'Você tem uma mensagem que desaparecerá em 3s',
      icon: '/favicon.ico'
    });
  }
}

// Solicitar permissão de notificação ao carregar
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission();
}

// ============================================================
// Iniciar aplicação
// ============================================================

document.addEventListener('DOMContentLoaded', init);
