/**
 * Ephemeral Chat - Frontend Application
 * 
 * Gerencia autenticação, sessões persistentes, sistema de Almas,
 * mensagens em tempo real, temas e navegação.
 */

// ============================================================
// Estado da aplicação
// ============================================================

const state = {
  socket: null,
  token: null,
  username: null,
  displayName: null,
  currentChat: null,    // username da Alma no chat atual
  friends: [],
  friendRequests: [],
  isTyping: false,
  typingTimeout: null,
  theme: 'dark'
};

// ============================================================
// Elementos do DOM
// ============================================================

const DOM = {
  // Screens
  loginScreen: document.getElementById('login-screen'),
  registerScreen: document.getElementById('register-screen'),
  mainScreen: document.getElementById('main-screen'),
  addSoulScreen: document.getElementById('add-soul-screen'),
  chatScreen: document.getElementById('chat-screen'),

  // Login
  loginForm: document.getElementById('login-form'),
  loginUsername: document.getElementById('login-username'),
  loginPassword: document.getElementById('login-password'),
  loginError: document.getElementById('login-error'),
  showRegister: document.getElementById('show-register'),

  // Register
  registerForm: document.getElementById('register-form'),
  registerUsername: document.getElementById('register-username'),
  registerPassword: document.getElementById('register-password'),
  registerConfirm: document.getElementById('register-confirm'),
  registerError: document.getElementById('register-error'),
  showLogin: document.getElementById('show-login'),

  // Main
  myAvatar: document.getElementById('my-avatar'),
  myDisplayName: document.getElementById('my-display-name'),
  menuBtn: document.getElementById('menu-btn'),
  requestsSection: document.getElementById('requests-section'),
  requestsContainer: document.getElementById('requests-container'),
  soulsContainer: document.getElementById('souls-container'),
  emptySouls: document.getElementById('empty-souls'),

  // Settings Panel
  settingsPanel: document.getElementById('settings-panel'),
  closeSettings: document.getElementById('close-settings'),
  themeLightBtn: document.getElementById('theme-light-btn'),
  themeDarkBtn: document.getElementById('theme-dark-btn'),
  addSoulBtn: document.getElementById('add-soul-btn'),
  logoutBtn: document.getElementById('logout-btn'),

  // Add Soul
  backFromAdd: document.getElementById('back-from-add'),
  addSoulInput: document.getElementById('add-soul-input'),
  addSoulSubmit: document.getElementById('add-soul-submit'),
  addSoulMessage: document.getElementById('add-soul-message'),

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
  loadTheme();
  setupEventListeners();
  connectSocket();
}

// ============================================================
// Conexão Socket.IO
// ============================================================

function connectSocket() {
  const serverUrl = getServerUrl();
  state.socket = serverUrl ? io(serverUrl, { transports: ['websocket', 'polling'] }) : io();

  state.socket.on('connect', () => {
    console.log('[Ephemeral] Conectado ao servidor');
    // Se já tem sessão, validar e entrar
    checkExistingSession();
  });

  state.socket.on('disconnect', () => {
    console.log('[Ephemeral] Desconectado');
  });

  state.socket.on('connect_error', (err) => {
    console.error('[Ephemeral] Erro de conexão:', err.message);
  });

  // -- Lista de amigos atualizada
  state.socket.on('friends:list', (friends) => {
    state.friends = friends;
    renderSouls();
    // Atualizar status no chat se estiver aberto
    if (state.currentChat) {
      const friend = friends.find(f => f.username === state.currentChat);
      if (friend) {
        updateChatStatus(friend.online);
      }
    }
  });

  // -- Solicitações de amizade atualizadas
  state.socket.on('friends:requests', (requests) => {
    state.friendRequests = requests;
    renderRequests();
  });

  // -- Nova mensagem recebida
  state.socket.on('message:new', (message) => {
    // Só mostrar se estiver no chat com essa pessoa
    if (state.currentChat === message.senderId || state.currentChat === message.receiverId) {
      addMessageToUI(message, 3000);
      scrollToBottom();
    }
  });

  // -- Mensagem deletada
  state.socket.on('message:delete', ({ messageId }) => {
    removeMessageFromUI(messageId);
  });

  // -- Status de usuário (online/offline)
  state.socket.on('user:status', ({ username, online }) => {
    // Atualizar na lista de amigos
    const friend = state.friends.find(f => f.username === username);
    if (friend) {
      friend.online = online;
      renderSouls();
    }
    // Atualizar no chat se aberto
    if (state.currentChat === username) {
      updateChatStatus(online);
    }
  });

  // -- Indicador de digitando
  state.socket.on('user:typing', ({ userId, isTyping }) => {
    if (state.currentChat === userId) {
      toggleTypingIndicator(isTyping);
    }
  });
}

// ============================================================
// Sessão Persistente
// ============================================================

function checkExistingSession() {
  const savedToken = localStorage.getItem('ephemeral_token');
  if (savedToken) {
    state.socket.emit('auth:validate', { token: savedToken }, (response) => {
      if (response.success) {
        // Sessão válida - entrar direto
        state.token = savedToken;
        state.username = response.user.username;
        state.displayName = response.user.displayName;
        enterApp();
      } else {
        // Token inválido - limpar e mostrar login
        localStorage.removeItem('ephemeral_token');
        navigateToScreen('login');
      }
    });
  } else {
    navigateToScreen('login');
  }
}

function saveSession(token) {
  state.token = token;
  localStorage.setItem('ephemeral_token', token);
}

function clearSession() {
  state.token = null;
  state.username = null;
  state.displayName = null;
  localStorage.removeItem('ephemeral_token');
}

// ============================================================
// Event Listeners
// ============================================================

function setupEventListeners() {
  // Auth - Login
  DOM.loginForm.addEventListener('submit', handleLogin);
  DOM.showRegister.addEventListener('click', (e) => {
    e.preventDefault();
    navigateToScreen('register');
  });

  // Auth - Register
  DOM.registerForm.addEventListener('submit', handleRegister);
  DOM.showLogin.addEventListener('click', (e) => {
    e.preventDefault();
    navigateToScreen('login');
  });

  // Settings
  DOM.menuBtn.addEventListener('click', openSettings);
  DOM.closeSettings.addEventListener('click', closeSettings);
  DOM.settingsPanel.querySelector('.panel-backdrop').addEventListener('click', closeSettings);
  DOM.themeLightBtn.addEventListener('click', () => setTheme('light'));
  DOM.themeDarkBtn.addEventListener('click', () => setTheme('dark'));
  DOM.addSoulBtn.addEventListener('click', () => { closeSettings(); navigateToScreen('add-soul'); });
  DOM.logoutBtn.addEventListener('click', handleLogout);

  // Add Soul
  DOM.backFromAdd.addEventListener('click', () => navigateToScreen('main'));
  DOM.addSoulSubmit.addEventListener('click', handleAddSoul);
  DOM.addSoulInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAddSoul();
  });

  // Chat
  DOM.backBtn.addEventListener('click', () => {
    state.currentChat = null;
    navigateToScreen('main');
  });
  DOM.messageInput.addEventListener('input', handleMessageInput);
  DOM.messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !DOM.sendBtn.disabled) handleSendMessage();
  });
  DOM.sendBtn.addEventListener('click', handleSendMessage);
}

// ============================================================
// Auth Handlers
// ============================================================

function handleLogin(e) {
  e.preventDefault();
  const username = DOM.loginUsername.value.trim();
  const password = DOM.loginPassword.value;

  if (!username || !password) {
    showError(DOM.loginError, 'Preencha todos os campos');
    return;
  }

  DOM.loginError.textContent = '';

  state.socket.emit('auth:login', { username, password }, (response) => {
    if (response.success) {
      state.username = response.user.username;
      state.displayName = response.user.displayName;
      saveSession(response.token);
      enterApp();
    } else {
      showError(DOM.loginError, response.error);
    }
  });
}

function handleRegister(e) {
  e.preventDefault();
  const username = DOM.registerUsername.value.trim();
  const password = DOM.registerPassword.value;
  const confirm = DOM.registerConfirm.value;

  if (!username || !password || !confirm) {
    showError(DOM.registerError, 'Preencha todos os campos');
    return;
  }
  if (password !== confirm) {
    showError(DOM.registerError, 'As senhas não coincidem');
    return;
  }
  if (password.length < 4) {
    showError(DOM.registerError, 'Senha deve ter pelo menos 4 caracteres');
    return;
  }

  DOM.registerError.textContent = '';

  state.socket.emit('auth:register', { username, password }, (response) => {
    if (response.success) {
      state.username = response.user.username;
      state.displayName = response.user.displayName;
      saveSession(response.token);
      enterApp();
    } else {
      showError(DOM.registerError, response.error);
    }
  });
}

function handleLogout() {
  state.socket.emit('auth:logout', { token: state.token });
  clearSession();
  closeSettings();
  // Limpar formulários
  DOM.loginUsername.value = '';
  DOM.loginPassword.value = '';
  DOM.loginError.textContent = '';
  navigateToScreen('login');
}

// ============================================================
// Entrar no app (após login/registro/sessão válida)
// ============================================================

function enterApp() {
  // Atualizar UI com dados do usuário
  DOM.myDisplayName.textContent = state.displayName;
  DOM.myAvatar.textContent = getInitials(state.displayName);

  // Registrar no servidor para receber eventos em tempo real
  state.socket.emit('user:join', { username: state.username });

  // Navegar para tela principal
  navigateToScreen('main');
}

// ============================================================
// Settings
// ============================================================

function openSettings() {
  DOM.settingsPanel.classList.remove('hidden');
  updateThemeButtons();
}

function closeSettings() {
  DOM.settingsPanel.classList.add('hidden');
}

// ============================================================
// Tema
// ============================================================

function loadTheme() {
  const saved = localStorage.getItem('ephemeral_theme') || 'dark';
  setTheme(saved);
}

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('ephemeral_theme', theme);
  updateThemeButtons();
}

function updateThemeButtons() {
  DOM.themeLightBtn.classList.toggle('active', state.theme === 'light');
  DOM.themeDarkBtn.classList.toggle('active', state.theme === 'dark');
}

// ============================================================
// Almas (Friends)
// ============================================================

function handleAddSoul() {
  const targetUsername = DOM.addSoulInput.value.trim();
  if (!targetUsername) {
    showError(DOM.addSoulMessage, 'Digite um nome de usuário');
    return;
  }

  DOM.addSoulMessage.textContent = '';

  state.socket.emit('friends:request', { from: state.username, to: targetUsername }, (response) => {
    if (response.success) {
      DOM.addSoulMessage.textContent = response.message;
      DOM.addSoulMessage.classList.add('success');
      DOM.addSoulInput.value = '';
      // Voltar para main após 1.5s
      setTimeout(() => {
        DOM.addSoulMessage.textContent = '';
        DOM.addSoulMessage.classList.remove('success');
        navigateToScreen('main');
      }, 1500);
    } else {
      DOM.addSoulMessage.classList.remove('success');
      showError(DOM.addSoulMessage, response.error);
    }
  });
}

function handleAcceptRequest(from) {
  state.socket.emit('friends:accept', { username: state.username, from }, (response) => {
    if (response.success) {
      // As listas serão atualizadas via eventos do servidor
    }
  });
}

function handleRejectRequest(from) {
  state.socket.emit('friends:reject', { username: state.username, from }, (response) => {
    if (response.success) {
      // Atualizado via evento
    }
  });
}

// ============================================================
// Renderização
// ============================================================

function renderSouls() {
  const container = DOM.soulsContainer;

  // Limpar (preservar o empty state)
  const items = container.querySelectorAll('.soul-item');
  items.forEach(i => i.remove());

  if (state.friends.length === 0) {
    DOM.emptySouls.classList.remove('hidden');
    return;
  }

  DOM.emptySouls.classList.add('hidden');

  state.friends.forEach((friend) => {
    const item = document.createElement('div');
    item.className = 'soul-item';
    item.innerHTML = `
      <div class="soul-avatar">
        ${getInitials(friend.displayName)}
        ${friend.online ? '<div class="online-dot"></div>' : ''}
      </div>
      <div class="soul-info">
        <div class="soul-name">${escapeHtml(friend.displayName)}</div>
        <div class="soul-status ${friend.online ? 'online' : ''}">${friend.online ? 'Online' : 'Offline'}</div>
      </div>
    `;
    item.addEventListener('click', () => openChat(friend));
    container.appendChild(item);
  });
}

function renderRequests() {
  const container = DOM.requestsContainer;
  container.innerHTML = '';

  if (state.friendRequests.length === 0) {
    DOM.requestsSection.classList.add('hidden');
    return;
  }

  DOM.requestsSection.classList.remove('hidden');

  state.friendRequests.forEach((req) => {
    const item = document.createElement('div');
    item.className = 'request-item';
    item.innerHTML = `
      <div class="soul-avatar">${getInitials(req.fromDisplayName || req.from)}</div>
      <div class="request-info">
        <div class="request-name">${escapeHtml(req.fromDisplayName || req.from)}</div>
      </div>
      <div class="request-actions">
        <button class="btn-accept" data-from="${req.from}">Aceitar</button>
        <button class="btn-reject" data-from="${req.from}">Recusar</button>
      </div>
    `;
    item.querySelector('.btn-accept').addEventListener('click', () => handleAcceptRequest(req.from));
    item.querySelector('.btn-reject').addEventListener('click', () => handleRejectRequest(req.from));
    container.appendChild(item);
  });
}

// ============================================================
// Chat
// ============================================================

function openChat(friend) {
  state.currentChat = friend.username;

  DOM.chatContactName.textContent = friend.displayName;
  DOM.chatAvatar.textContent = getInitials(friend.displayName);
  updateChatStatus(friend.online);

  // Limpar mensagens anteriores
  DOM.messagesList.innerHTML = '';

  navigateToScreen('chat');
  DOM.messageInput.focus();
}

function updateChatStatus(online) {
  DOM.chatContactStatus.textContent = online ? 'online' : 'offline';
  DOM.chatContactStatus.className = `status-text ${online ? 'online' : ''}`;
}

function handleMessageInput() {
  const value = DOM.messageInput.value.trim();
  DOM.sendBtn.disabled = value.length === 0;

  // Indicador de digitando
  if (!state.isTyping && value.length > 0) {
    state.isTyping = true;
    state.socket.emit('user:typing', { userId: state.username, targetId: state.currentChat, isTyping: true });
  }

  clearTimeout(state.typingTimeout);
  state.typingTimeout = setTimeout(() => {
    state.isTyping = false;
    state.socket.emit('user:typing', { userId: state.username, targetId: state.currentChat, isTyping: false });
  }, 1500);
}

function handleSendMessage() {
  const content = DOM.messageInput.value.trim();
  if (!content || !state.currentChat) return;

  state.socket.emit('message:send', {
    senderId: state.username,
    receiverId: state.currentChat,
    content
  });

  DOM.messageInput.value = '';
  DOM.sendBtn.disabled = true;

  // Parar indicador de digitando
  state.isTyping = false;
  state.socket.emit('user:typing', { userId: state.username, targetId: state.currentChat, isTyping: false });

  DOM.messageInput.focus();
}

// ============================================================
// Mensagens - UI
// ============================================================

function addMessageToUI(message, remainingTime) {
  const { id, senderId, content, delivered } = message;
  const isSent = senderId === state.username;

  const template = DOM.messageTemplate.content.cloneNode(true);
  const bubble = template.querySelector('.message-bubble');

  bubble.classList.add(isSent ? 'sent' : 'received');
  bubble.dataset.messageId = id;

  bubble.querySelector('.message-content').textContent = content;

  const statusEl = bubble.querySelector('.message-status');
  statusEl.textContent = isSent ? (delivered ? '✓✓' : '✓') : '';

  const timerEl = bubble.querySelector('.message-timer');
  const timerBarFill = bubble.querySelector('.timer-bar-fill');

  const remainingSec = Math.ceil(remainingTime / 1000);
  timerEl.textContent = `${remainingSec}s`;
  timerBarFill.style.animationDuration = `${remainingTime}ms`;

  DOM.messagesList.appendChild(bubble);
  startCountdown(bubble, remainingTime);
}

function startCountdown(bubble, remainingTime) {
  const timerEl = bubble.querySelector('.message-timer');
  let remaining = remainingTime;

  const interval = setInterval(() => {
    remaining -= 100;
    const sec = Math.max(0, Math.ceil(remaining / 1000));
    timerEl.textContent = `${sec}s`;
    if (remaining <= 0) clearInterval(interval);
  }, 100);

  bubble.dataset.intervalId = interval;
}

function removeMessageFromUI(messageId) {
  const bubble = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!bubble) return;

  if (bubble.dataset.intervalId) {
    clearInterval(parseInt(bubble.dataset.intervalId));
  }

  bubble.classList.add('fading');
  setTimeout(() => bubble.remove(), 400);
}

function toggleTypingIndicator(show) {
  if (show) {
    DOM.typingIndicator.classList.remove('hidden');
  } else {
    DOM.typingIndicator.classList.add('hidden');
  }
  scrollToBottom();
}

// ============================================================
// Navegação
// ============================================================

function navigateToScreen(screenName) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

  switch (screenName) {
    case 'login':
      DOM.loginScreen.classList.add('active');
      break;
    case 'register':
      DOM.registerScreen.classList.add('active');
      break;
    case 'main':
      DOM.mainScreen.classList.add('active');
      break;
    case 'add-soul':
      DOM.addSoulScreen.classList.add('active');
      DOM.addSoulInput.value = '';
      DOM.addSoulMessage.textContent = '';
      break;
    case 'chat':
      DOM.chatScreen.classList.add('active');
      break;
  }
}

// ============================================================
// Utilidades
// ============================================================

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(' ');
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return parts[0].substring(0, 2).toUpperCase();
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    DOM.messagesContainer.scrollTop = DOM.messagesContainer.scrollHeight;
  });
}

function showError(element, message) {
  element.textContent = message;
  element.classList.remove('success');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================================
// Iniciar
// ============================================================

document.addEventListener('DOMContentLoaded', init);
