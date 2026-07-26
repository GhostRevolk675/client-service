/**
 * Ephemeral Chat - Frontend Application
 * 
 * Gerencia autenticação, sessões persistentes, sistema de Almas,
 * mensagens em tempo real com TTL dinâmico, temas,
 * e sistema "Manter Conversa" com consentimento mútuo.
 */

// ============================================================
// Estado da aplicação
// ============================================================

const state = {
  socket: null,
  connected: false,
  token: null,
  username: null,
  displayName: null,
  currentChat: null,
  currentChatKept: false,  // se a conversa atual está em modo "manter"
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
  loginBtn: document.getElementById('login-btn'),
  loginUsername: document.getElementById('login-username'),
  loginPassword: document.getElementById('login-password'),
  loginError: document.getElementById('login-error'),
  showRegister: document.getElementById('show-register'),

  // Register
  registerBtn: document.getElementById('register-btn'),
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

  // Chat menu
  chatMenuBtn: document.getElementById('chat-menu-btn'),
  chatMenuDropdown: document.getElementById('chat-menu-dropdown'),
  keepChatBtn: document.getElementById('keep-chat-btn'),
  keptChatNotice: document.getElementById('kept-chat-notice'),

  // Keep modal
  keepModal: document.getElementById('keep-modal'),
  keepModalCancel: document.getElementById('keep-modal-cancel'),
  keepModalConfirm: document.getElementById('keep-modal-confirm'),

  // Templates
  messageTemplate: document.getElementById('message-template'),
  keepInviteTemplate: document.getElementById('keep-invite-template')
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
  state.socket = serverUrl 
    ? io(serverUrl, { 
        transports: ['websocket', 'polling'],
        reconnectionAttempts: 10,
        reconnectionDelay: 2000,
        timeout: 30000
      }) 
    : io();

  state.socket.on('connect', () => {
    console.log('[Ephemeral] Conectado ao servidor');
    state.connected = true;
    checkExistingSession();
  });

  state.socket.on('disconnect', () => {
    console.log('[Ephemeral] Desconectado');
    state.connected = false;
  });

  state.socket.on('connect_error', (err) => {
    console.error('[Ephemeral] Erro de conexão:', err.message);
    state.connected = false;
    navigateToScreen('login');
  });

  // -- Lista de amigos atualizada
  state.socket.on('friends:list', (friends) => {
    state.friends = friends;
    renderSouls();
    if (state.currentChat) {
      const friend = friends.find(f => f.username === state.currentChat);
      if (friend) updateChatStatus(friend.online);
    }
  });

  // -- Solicitações de amizade
  state.socket.on('friends:requests', (requests) => {
    state.friendRequests = requests;
    renderRequests();
  });

  // -- Nova mensagem recebida
  state.socket.on('message:new', (message) => {
    if (state.currentChat === message.senderId || state.currentChat === message.receiverId) {
      addMessageToUI(message);
      scrollToBottom();
    }
  });

  // -- Mensagem deletada
  state.socket.on('message:delete', ({ messageId }) => {
    removeMessageFromUI(messageId);
  });

  // -- Status de usuário
  state.socket.on('user:status', ({ username, online }) => {
    const friend = state.friends.find(f => f.username === username);
    if (friend) {
      friend.online = online;
      renderSouls();
    }
    if (state.currentChat === username) updateChatStatus(online);
  });

  // -- Indicador de digitando
  state.socket.on('user:typing', ({ userId, isTyping }) => {
    if (state.currentChat === userId) toggleTypingIndicator(isTyping);
  });

  // -- Convite "Manter conversa" recebido
  state.socket.on('keep:invite', ({ from, fromDisplayName, chatKey }) => {
    if (state.currentChat === from) {
      showKeepInviteInChat(fromDisplayName, chatKey);
    }
  });

  // -- "Manter conversa" aceito
  state.socket.on('keep:accepted', ({ chatKey, with: withUser }) => {
    if (state.currentChat === withUser) {
      state.currentChatKept = true;
      DOM.keptChatNotice.classList.remove('hidden');
    }
  });

  // -- "Manter conversa" recusado
  state.socket.on('keep:rejected', ({ chatKey, by }) => {
    // Opcional: mostrar notificação de recusa
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
        state.token = savedToken;
        state.username = response.user.username;
        state.displayName = response.user.displayName;
        enterApp();
      } else {
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
  DOM.loginBtn.addEventListener('click', handleLogin);
  DOM.loginPassword.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleLogin(); }
  });
  DOM.showRegister.addEventListener('click', (e) => {
    e.preventDefault();
    navigateToScreen('register');
  });

  // Auth - Register
  DOM.registerBtn.addEventListener('click', handleRegister);
  DOM.registerConfirm.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleRegister(); }
  });
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
    state.currentChatKept = false;
    closeChatMenu();
    navigateToScreen('main');
  });
  DOM.messageInput.addEventListener('input', handleMessageInput);
  DOM.messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !DOM.sendBtn.disabled) handleSendMessage();
  });
  DOM.sendBtn.addEventListener('click', handleSendMessage);

  // Chat menu (3 pontos)
  DOM.chatMenuBtn.addEventListener('click', toggleChatMenu);
  DOM.keepChatBtn.addEventListener('click', () => {
    closeChatMenu();
    if (state.currentChatKept) return; // Já está mantida
    openKeepModal();
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!DOM.chatMenuBtn.contains(e.target) && !DOM.chatMenuDropdown.contains(e.target)) {
      closeChatMenu();
    }
  });

  // Keep modal
  DOM.keepModalCancel.addEventListener('click', closeKeepModal);
  DOM.keepModal.querySelector('.modal-backdrop').addEventListener('click', closeKeepModal);
  DOM.keepModalConfirm.addEventListener('click', handleKeepRequest);
}

// ============================================================
// Auth Handlers
// ============================================================

function handleLogin(e) {
  if (e) e.preventDefault();
  const username = DOM.loginUsername.value.trim();
  const password = DOM.loginPassword.value;

  if (!username || !password) {
    showError(DOM.loginError, 'Preencha todos os campos');
    return;
  }

  if (!state.socket || !state.socket.connected) {
    showError(DOM.loginError, 'Conectando ao servidor... Tente novamente em alguns segundos.');
    if (state.socket) state.socket.connect();
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
  if (e) e.preventDefault();
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

  if (!state.socket || !state.socket.connected) {
    showError(DOM.registerError, 'Conectando ao servidor... Tente novamente em alguns segundos.');
    if (state.socket) state.socket.connect();
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
  DOM.loginUsername.value = '';
  DOM.loginPassword.value = '';
  DOM.loginError.textContent = '';
  navigateToScreen('login');
}

// ============================================================
// Entrar no app
// ============================================================

function enterApp() {
  DOM.myDisplayName.textContent = state.displayName;
  DOM.myAvatar.textContent = getInitials(state.displayName);
  state.socket.emit('user:join', { username: state.username });
  navigateToScreen('main');
}

// ============================================================
// Settings
// ============================================================

function openSettings() { DOM.settingsPanel.classList.remove('hidden'); updateThemeButtons(); }
function closeSettings() { DOM.settingsPanel.classList.add('hidden'); }

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
  state.socket.emit('friends:accept', { username: state.username, from }, () => {});
}

function handleRejectRequest(from) {
  state.socket.emit('friends:reject', { username: state.username, from }, () => {});
}

// ============================================================
// Renderização
// ============================================================

function renderSouls() {
  const container = DOM.soulsContainer;
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
        <button class="btn-accept">Aceitar</button>
        <button class="btn-reject">Recusar</button>
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
  state.currentChatKept = false;

  DOM.chatContactName.textContent = friend.displayName;
  DOM.chatAvatar.textContent = getInitials(friend.displayName);
  updateChatStatus(friend.online);

  DOM.messagesList.innerHTML = '';
  DOM.keptChatNotice.classList.add('hidden');

  // Verificar se a conversa está mantida
  state.socket.emit('keep:status', { user1: state.username, user2: friend.username }, (response) => {
    if (response.kept) {
      state.currentChatKept = true;
      DOM.keptChatNotice.classList.remove('hidden');
    }
  });

  navigateToScreen('chat');
  DOM.messageInput.focus();
}

function updateChatStatus(online) {
  DOM.chatContactStatus.textContent = online ? 'online' : 'offline';
  DOM.chatContactStatus.className = `status-text ${online ? 'online' : ''}`;
}

// ============================================================
// Chat Menu (3 pontos)
// ============================================================

function toggleChatMenu() {
  DOM.chatMenuDropdown.classList.toggle('hidden');
}

function closeChatMenu() {
  DOM.chatMenuDropdown.classList.add('hidden');
}

// ============================================================
// Manter Conversa
// ============================================================

function openKeepModal() {
  DOM.keepModal.classList.remove('hidden');
}

function closeKeepModal() {
  DOM.keepModal.classList.add('hidden');
}

function handleKeepRequest() {
  closeKeepModal();

  state.socket.emit('keep:request', { from: state.username, to: state.currentChat }, (response) => {
    if (response.success) {
      // Se já foi aceita automaticamente (outro já pediu antes)
      if (response.message === 'Conversa mantida!') {
        state.currentChatKept = true;
        DOM.keptChatNotice.classList.remove('hidden');
      }
    }
  });
}

function showKeepInviteInChat(fromDisplayName, chatKey) {
  const template = DOM.keepInviteTemplate.content.cloneNode(true);
  const invite = template.querySelector('.system-message');

  invite.querySelector('strong').textContent = fromDisplayName;

  invite.querySelector('.btn-invite-accept').addEventListener('click', () => {
    state.socket.emit('keep:accept', { username: state.username, chatKey }, (response) => {
      if (response.success) {
        state.currentChatKept = true;
        DOM.keptChatNotice.classList.remove('hidden');
        invite.remove();
      }
    });
  });

  invite.querySelector('.btn-invite-reject').addEventListener('click', () => {
    state.socket.emit('keep:reject', { username: state.username, chatKey }, () => {
      invite.remove();
    });
  });

  DOM.messagesList.appendChild(invite);
  scrollToBottom();
}

// ============================================================
// Mensagens
// ============================================================

function handleMessageInput() {
  const value = DOM.messageInput.value.trim();
  DOM.sendBtn.disabled = value.length === 0;

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

  state.isTyping = false;
  state.socket.emit('user:typing', { userId: state.username, targetId: state.currentChat, isTyping: false });

  DOM.messageInput.focus();
}

// ============================================================
// Mensagens - UI
// ============================================================

function addMessageToUI(message) {
  const { id, senderId, content, delivered, ttl, kept } = message;
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
  const timerBar = bubble.querySelector('.timer-bar');

  if (kept || state.currentChatKept) {
    // Conversa mantida - sem timer
    timerEl.textContent = '✓ mantida';
    timerBar.style.display = 'none';
  } else {
    // TTL dinâmico
    const messageTTL = ttl || 3000;
    const remainingSec = Math.ceil(messageTTL / 1000);
    timerEl.textContent = `${remainingSec}s`;
    timerBarFill.style.animationDuration = `${messageTTL}ms`;
    startCountdown(bubble, messageTTL);
  }

  DOM.messagesList.appendChild(bubble);
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
  if (show) DOM.typingIndicator.classList.remove('hidden');
  else DOM.typingIndicator.classList.add('hidden');
  scrollToBottom();
}

// ============================================================
// Navegação
// ============================================================

function navigateToScreen(screenName) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));

  switch (screenName) {
    case 'login': DOM.loginScreen.classList.add('active'); break;
    case 'register': DOM.registerScreen.classList.add('active'); break;
    case 'main': DOM.mainScreen.classList.add('active'); break;
    case 'add-soul':
      DOM.addSoulScreen.classList.add('active');
      DOM.addSoulInput.value = '';
      DOM.addSoulMessage.textContent = '';
      break;
    case 'chat': DOM.chatScreen.classList.add('active'); break;
  }
}

// ============================================================
// Utilidades
// ============================================================

function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(' ');
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
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
