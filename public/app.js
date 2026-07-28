/**
 * Phantom - Frontend Application
 * Secure ephemeral messaging with dynamic TTL, profiles, blocking, and "Keep Chat" system.
 */

// ============================================================
// STATE
// ============================================================
const state = {
  socket: null, connected: false, token: null, username: null, displayName: null,
  currentChat: null, currentChatKept: false, friends: [], friendRequests: [],
  isTyping: false, typingTimeout: null, theme: 'dark', profile: {}
};

// ============================================================
// DOM
// ============================================================
const DOM = {};
function cacheDom() {
  const ids = [
    'splash-screen','login-screen','register-screen','main-screen','profile-screen',
    'add-soul-screen','blocked-screen','password-screen','chat-screen',
    'login-btn','login-username','login-password','login-error','show-register',
    'register-btn','register-username','register-password','register-confirm','register-error','show-login',
    'my-avatar','my-display-name','menu-btn','requests-section','requests-container',
    'souls-container','empty-souls',
    'settings-panel','close-settings','theme-light-btn','theme-dark-btn',
    'add-soul-btn','settings-profile-btn','blocked-list-btn','change-password-btn',
    'delete-account-btn','logout-btn',
    'profile-btn','back-from-profile','profile-avatar-large','profile-name-display',
    'profile-bio','profile-status','save-profile-btn','profile-message',
    'back-from-add','add-soul-input','add-soul-submit','add-soul-message',
    'back-from-blocked','blocked-container',
    'back-from-password','old-password','new-password','confirm-new-password','save-password-btn','password-message',
    'back-btn','chat-avatar','chat-contact-name','chat-contact-status',
    'messages-container','messages-list','message-input','send-btn','typing-indicator',
    'chat-menu-btn','chat-menu-dropdown','keep-chat-btn','block-user-btn','kept-chat-notice',
    'keep-modal','keep-modal-cancel','keep-modal-confirm',
    'delete-modal','delete-modal-cancel','delete-modal-confirm','delete-password','delete-error'
  ];
  ids.forEach(id => { DOM[id.replace(/-([a-z])/g,(_,c)=>c.toUpperCase())] = document.getElementById(id); });
  DOM.messageTemplate = document.getElementById('message-template');
  DOM.keepInviteTemplate = document.getElementById('keep-invite-template');
}

// ============================================================
// INIT
// ============================================================
function init() {
  cacheDom();
  loadTheme();
  setupEvents();
  connectSocket();
}

// ============================================================
// SOCKET
// ============================================================
function connectSocket() {
  const url = getServerUrl();
  state.socket = url ? io(url, { transports: ['websocket','polling'], reconnectionAttempts: 10, reconnectionDelay: 2000, timeout: 30000 }) : io();

  state.socket.on('connect', () => { state.connected = true; checkSession(); });
  state.socket.on('disconnect', () => { state.connected = false; });
  state.socket.on('connect_error', () => { state.connected = false; endSplash('login'); });

  state.socket.on('friends:list', (f) => { state.friends = f; renderSouls(); if(state.currentChat){const fr=f.find(x=>x.username===state.currentChat);if(fr)updateChatStatus(fr.online);} });
  state.socket.on('friends:requests', (r) => { state.friendRequests = r; renderRequests(); });
  state.socket.on('message:new', (m) => { if(state.currentChat===m.senderId||state.currentChat===m.receiverId){addMsg(m);scrollBottom();} });
  state.socket.on('message:delete', ({messageId}) => removeMsg(messageId));
  state.socket.on('user:status', ({username,online}) => { const f=state.friends.find(x=>x.username===username);if(f){f.online=online;renderSouls();}if(state.currentChat===username)updateChatStatus(online); });
  state.socket.on('user:typing', ({userId,isTyping}) => { if(state.currentChat===userId)toggleTyping(isTyping); });
  state.socket.on('keep:invite', ({from,fromDisplayName,chatKey}) => { if(state.currentChat===from)showKeepInvite(fromDisplayName,chatKey); });
  state.socket.on('keep:accepted', ({with:w}) => { if(state.currentChat===w){state.currentChatKept=true;DOM.keptChatNotice.classList.remove('hidden');} });
  state.socket.on('screenshot:alert', ({byDisplayName}) => { /* Future: show alert */ });
}

// ============================================================
// SESSION
// ============================================================
function checkSession() {
  const t = localStorage.getItem('phantom_token');
  if (t) {
    state.socket.emit('auth:validate', {token:t}, (r) => {
      if (r.success) { state.token=t; state.username=r.user.username; state.displayName=r.user.displayName; enterApp(); }
      else { localStorage.removeItem('phantom_token'); endSplash('login'); }
    });
  } else { endSplash('login'); }
}

function endSplash(screen) {
  setTimeout(() => nav(screen), 1800);
}

function enterApp() {
  DOM.myDisplayName.textContent = state.displayName;
  DOM.myAvatar.textContent = getInitials(state.displayName);
  state.socket.emit('user:join', {username: state.username});
  // Load profile
  state.socket.emit('profile:get', {username: state.username}, (r) => { if(r.success) state.profile = r.profile; });
  endSplash('main');
}

// ============================================================
// EVENTS
// ============================================================
function setupEvents() {
  // Auth
  DOM.loginBtn.addEventListener('click', doLogin);
  DOM.loginPassword.addEventListener('keypress', e => { if(e.key==='Enter'){e.preventDefault();doLogin();} });
  DOM.showRegister.addEventListener('click', e => { e.preventDefault(); nav('register'); });
  DOM.registerBtn.addEventListener('click', doRegister);
  DOM.registerConfirm.addEventListener('keypress', e => { if(e.key==='Enter'){e.preventDefault();doRegister();} });
  DOM.showLogin.addEventListener('click', e => { e.preventDefault(); nav('login'); });

  // Settings panel
  DOM.menuBtn.addEventListener('click', () => DOM.settingsPanel.classList.remove('hidden'));
  DOM.closeSettings.addEventListener('click', closePanel);
  DOM.settingsPanel.querySelector('.panel-backdrop').addEventListener('click', closePanel);
  DOM.themeLightBtn.addEventListener('click', () => setTheme('light'));
  DOM.themeDarkBtn.addEventListener('click', () => setTheme('dark'));
  DOM.addSoulBtn.addEventListener('click', () => { closePanel(); nav('add-soul'); });
  DOM.settingsProfileBtn.addEventListener('click', () => { closePanel(); openProfile(); });
  DOM.blockedListBtn.addEventListener('click', () => { closePanel(); openBlockedList(); });
  DOM.changePasswordBtn.addEventListener('click', () => { closePanel(); nav('password'); });
  DOM.deleteAccountBtn.addEventListener('click', () => { closePanel(); DOM.deleteModal.classList.remove('hidden'); });
  DOM.logoutBtn.addEventListener('click', doLogout);

  // Profile
  DOM.profileBtn.addEventListener('click', openProfile);
  DOM.backFromProfile.addEventListener('click', () => nav('main'));
  DOM.saveProfileBtn.addEventListener('click', saveProfile);

  // Add soul
  DOM.backFromAdd.addEventListener('click', () => nav('main'));
  DOM.addSoulSubmit.addEventListener('click', doAddSoul);
  DOM.addSoulInput.addEventListener('keypress', e => { if(e.key==='Enter') doAddSoul(); });

  // Blocked
  DOM.backFromBlocked.addEventListener('click', () => nav('main'));

  // Password
  DOM.backFromPassword.addEventListener('click', () => nav('main'));
  DOM.savePasswordBtn.addEventListener('click', doChangePassword);

  // Chat
  DOM.backBtn.addEventListener('click', () => { state.currentChat=null; state.currentChatKept=false; closeChatMenu(); nav('main'); });
  DOM.messageInput.addEventListener('input', onMsgInput);
  DOM.messageInput.addEventListener('keypress', e => { if(e.key==='Enter'&&!DOM.sendBtn.disabled)doSend(); });
  DOM.sendBtn.addEventListener('click', doSend);
  DOM.chatMenuBtn.addEventListener('click', () => DOM.chatMenuDropdown.classList.toggle('hidden'));
  DOM.keepChatBtn.addEventListener('click', () => { closeChatMenu(); if(!state.currentChatKept) DOM.keepModal.classList.remove('hidden'); });
  DOM.blockUserBtn.addEventListener('click', () => { closeChatMenu(); doBlockCurrent(); });
  document.addEventListener('click', e => { if(!DOM.chatMenuBtn.contains(e.target)&&!DOM.chatMenuDropdown.contains(e.target)) closeChatMenu(); });

  // Keep modal
  DOM.keepModalCancel.addEventListener('click', () => DOM.keepModal.classList.add('hidden'));
  DOM.keepModal.querySelector('.modal-backdrop').addEventListener('click', () => DOM.keepModal.classList.add('hidden'));
  DOM.keepModalConfirm.addEventListener('click', doKeepRequest);

  // Delete modal
  DOM.deleteModalCancel.addEventListener('click', () => DOM.deleteModal.classList.add('hidden'));
  DOM.deleteModal.querySelector('.modal-backdrop').addEventListener('click', () => DOM.deleteModal.classList.add('hidden'));
  DOM.deleteModalConfirm.addEventListener('click', doDeleteAccount);
}

function closePanel() { DOM.settingsPanel.classList.add('hidden'); }
function closeChatMenu() { DOM.chatMenuDropdown.classList.add('hidden'); }

// ============================================================
// AUTH
// ============================================================
function doLogin() {
  const u = DOM.loginUsername.value.trim(), p = DOM.loginPassword.value;
  if(!u||!p) return showErr(DOM.loginError,'Preencha todos os campos');
  if(!state.connected) return showErr(DOM.loginError,'Conectando... tente novamente em instantes.');
  DOM.loginError.textContent='';
  state.socket.emit('auth:login',{username:u,password:p},(r)=>{
    if(r.success){state.username=r.user.username;state.displayName=r.user.displayName;localStorage.setItem('phantom_token',r.token);state.token=r.token;enterAppDirect();}
    else showErr(DOM.loginError,r.error);
  });
}

function doRegister() {
  const u=DOM.registerUsername.value.trim(),p=DOM.registerPassword.value,c=DOM.registerConfirm.value;
  if(!u||!p||!c) return showErr(DOM.registerError,'Preencha todos os campos');
  if(p!==c) return showErr(DOM.registerError,'Senhas não coincidem');
  if(p.length<4) return showErr(DOM.registerError,'Senha: mínimo 4 caracteres');
  if(!state.connected) return showErr(DOM.registerError,'Conectando... tente novamente em instantes.');
  DOM.registerError.textContent='';
  state.socket.emit('auth:register',{username:u,password:p},(r)=>{
    if(r.success){state.username=r.user.username;state.displayName=r.user.displayName;localStorage.setItem('phantom_token',r.token);state.token=r.token;enterAppDirect();}
    else showErr(DOM.registerError,r.error);
  });
}

function enterAppDirect() {
  DOM.myDisplayName.textContent=state.displayName;
  DOM.myAvatar.textContent=getInitials(state.displayName);
  state.socket.emit('user:join',{username:state.username});
  state.socket.emit('profile:get',{username:state.username},(r)=>{if(r.success)state.profile=r.profile;});
  nav('main');
}

function doLogout() {
  state.socket.emit('auth:logout',{token:state.token});
  localStorage.removeItem('phantom_token');
  state.token=null;state.username=null;state.displayName=null;
  closePanel();
  nav('login');
}

function doDeleteAccount() {
  const p=DOM.deletePassword.value;
  if(!p) return showErr(DOM.deleteError,'Digite sua senha');
  state.socket.emit('auth:deleteAccount',{username:state.username,password:p},(r)=>{
    if(r.success){DOM.deleteModal.classList.add('hidden');doLogout();}
    else showErr(DOM.deleteError,r.error);
  });
}

// ============================================================
// PROFILE
// ============================================================
function openProfile() {
  DOM.profileAvatarLarge.textContent = getInitials(state.displayName);
  DOM.profileNameDisplay.textContent = state.displayName;
  DOM.profileBio.value = state.profile.bio || '';
  DOM.profileStatus.value = state.profile.status || '';
  DOM.profileMessage.textContent = '';
  nav('profile');
}

function saveProfile() {
  const bio = DOM.profileBio.value, status = DOM.profileStatus.value;
  state.socket.emit('profile:update', {username:state.username, bio, status}, (r) => {
    if(r.success) { state.profile=r.profile; DOM.profileMessage.textContent='Salvo!'; DOM.profileMessage.classList.add('success'); setTimeout(()=>{DOM.profileMessage.textContent='';DOM.profileMessage.classList.remove('success');},1500); }
  });
}

// ============================================================
// BLOCKED
// ============================================================
function openBlockedList() {
  state.socket.emit('block:list', {username:state.username}, (r) => {
    const c = DOM.blockedContainer;
    c.innerHTML = '';
    if(!r.blocked||r.blocked.length===0) { c.innerHTML='<div class="empty-state"><p>Nenhum usuário bloqueado</p></div>'; }
    else { r.blocked.forEach(u => {
      const el=document.createElement('div');el.className='blocked-item';
      el.innerHTML=`<span class="blocked-item-name">${esc(u)}</span><button class="btn-unblock">Desbloquear</button>`;
      el.querySelector('.btn-unblock').addEventListener('click',()=>{ state.socket.emit('block:remove',{username:state.username,target:u},()=>openBlockedList()); });
      c.appendChild(el);
    });}
    nav('blocked');
  });
}

function doBlockCurrent() {
  if(!state.currentChat) return;
  state.socket.emit('block:add', {username:state.username, target:state.currentChat}, () => {
    state.currentChat=null; nav('main');
    // Refresh friends
    state.socket.emit('user:join', {username:state.username});
  });
}

// ============================================================
// PASSWORD
// ============================================================
function doChangePassword() {
  const old=DOM.oldPassword.value, np=DOM.newPassword.value, cp=DOM.confirmNewPassword.value;
  if(!old||!np||!cp) return showErr(DOM.passwordMessage,'Preencha todos os campos');
  if(np!==cp) return showErr(DOM.passwordMessage,'Senhas não coincidem');
  state.socket.emit('auth:changePassword',{username:state.username,oldPassword:old,newPassword:np},(r)=>{
    if(r.success){DOM.passwordMessage.textContent='Senha alterada!';DOM.passwordMessage.classList.add('success');DOM.oldPassword.value='';DOM.newPassword.value='';DOM.confirmNewPassword.value='';setTimeout(()=>nav('main'),1500);}
    else showErr(DOM.passwordMessage,r.error);
  });
}

// ============================================================
// SOULS (Friends)
// ============================================================
function doAddSoul() {
  const t=DOM.addSoulInput.value.trim();
  if(!t) return showErr(DOM.addSoulMessage,'Digite um nome');
  DOM.addSoulMessage.textContent='';
  state.socket.emit('friends:request',{from:state.username,to:t},(r)=>{
    if(r.success){DOM.addSoulMessage.textContent=r.message;DOM.addSoulMessage.classList.add('success');DOM.addSoulInput.value='';setTimeout(()=>{DOM.addSoulMessage.textContent='';DOM.addSoulMessage.classList.remove('success');nav('main');},1500);}
    else{DOM.addSoulMessage.classList.remove('success');showErr(DOM.addSoulMessage,r.error);}
  });
}

function renderSouls() {
  const c=DOM.soulsContainer;
  c.querySelectorAll('.soul-item').forEach(i=>i.remove());
  if(state.friends.length===0){DOM.emptySouls.classList.remove('hidden');return;}
  DOM.emptySouls.classList.add('hidden');
  state.friends.forEach(f=>{
    const el=document.createElement('div');el.className='soul-item';
    el.innerHTML=`<div class="soul-avatar">${getInitials(f.displayName)}${f.online?'<div class="online-dot"></div>':''}</div><div class="soul-info"><div class="soul-name">${esc(f.displayName)}</div><div class="soul-status ${f.online?'online':''}">${f.online?'Online':'Offline'}</div></div>`;
    el.addEventListener('click',()=>openChat(f));
    c.appendChild(el);
  });
}

function renderRequests() {
  const c=DOM.requestsContainer;c.innerHTML='';
  if(state.friendRequests.length===0){DOM.requestsSection.classList.add('hidden');return;}
  DOM.requestsSection.classList.remove('hidden');
  state.friendRequests.forEach(r=>{
    const el=document.createElement('div');el.className='request-item';
    el.innerHTML=`<div class="soul-avatar">${getInitials(r.fromDisplayName||r.from)}</div><div class="request-info"><div class="request-name">${esc(r.fromDisplayName||r.from)}</div></div><div class="request-actions"><button class="btn-accept">Aceitar</button><button class="btn-reject">Recusar</button></div>`;
    el.querySelector('.btn-accept').addEventListener('click',()=>state.socket.emit('friends:accept',{username:state.username,from:r.from},()=>{}));
    el.querySelector('.btn-reject').addEventListener('click',()=>state.socket.emit('friends:reject',{username:state.username,from:r.from},()=>{}));
    c.appendChild(el);
  });
}

// ============================================================
// CHAT
// ============================================================
function openChat(friend) {
  state.currentChat=friend.username;state.currentChatKept=false;
  DOM.chatContactName.textContent=friend.displayName;
  DOM.chatAvatar.textContent=getInitials(friend.displayName);
  updateChatStatus(friend.online);
  DOM.messagesList.innerHTML='';
  DOM.keptChatNotice.classList.add('hidden');
  state.socket.emit('keep:status',{user1:state.username,user2:friend.username},(r)=>{if(r.kept){state.currentChatKept=true;DOM.keptChatNotice.classList.remove('hidden');}});
  nav('chat');DOM.messageInput.focus();
}

function updateChatStatus(on){DOM.chatContactStatus.textContent=on?'online':'offline';DOM.chatContactStatus.className=`status-text ${on?'online':''}`;}

function onMsgInput(){
  const v=DOM.messageInput.value.trim();
  DOM.sendBtn.disabled=v.length===0;
  if(!state.isTyping&&v.length>0){state.isTyping=true;state.socket.emit('user:typing',{userId:state.username,targetId:state.currentChat,isTyping:true});}
  clearTimeout(state.typingTimeout);
  state.typingTimeout=setTimeout(()=>{state.isTyping=false;state.socket.emit('user:typing',{userId:state.username,targetId:state.currentChat,isTyping:false});},1500);
}

function doSend(){
  const c=DOM.messageInput.value.trim();if(!c||!state.currentChat)return;
  state.socket.emit('message:send',{senderId:state.username,receiverId:state.currentChat,content:c});
  DOM.messageInput.value='';DOM.sendBtn.disabled=true;
  state.isTyping=false;state.socket.emit('user:typing',{userId:state.username,targetId:state.currentChat,isTyping:false});
  DOM.messageInput.focus();
}

// Keep chat
function doKeepRequest(){
  DOM.keepModal.classList.add('hidden');
  state.socket.emit('keep:request',{from:state.username,to:state.currentChat},(r)=>{
    if(r.success&&r.message==='Conversa mantida!'){state.currentChatKept=true;DOM.keptChatNotice.classList.remove('hidden');}
  });
}

function showKeepInvite(name,chatKey){
  const t=DOM.keepInviteTemplate.content.cloneNode(true);
  const el=t.querySelector('.system-message');
  el.querySelector('strong').textContent=name;
  el.querySelector('.btn-invite-accept').addEventListener('click',()=>{state.socket.emit('keep:accept',{username:state.username,chatKey},(r)=>{if(r.success){state.currentChatKept=true;DOM.keptChatNotice.classList.remove('hidden');el.remove();}});});
  el.querySelector('.btn-invite-reject').addEventListener('click',()=>{state.socket.emit('keep:reject',{username:state.username,chatKey},()=>el.remove());});
  DOM.messagesList.appendChild(el);scrollBottom();
}

// ============================================================
// MESSAGES UI
// ============================================================
function addMsg(m){
  const isSent=m.senderId===state.username;
  const t=DOM.messageTemplate.content.cloneNode(true);
  const b=t.querySelector('.message-bubble');
  b.classList.add(isSent?'sent':'received');
  b.dataset.messageId=m.id;
  b.querySelector('.message-content').textContent=m.content;
  b.querySelector('.message-status').textContent=isSent?(m.delivered?'✓✓':'✓'):'';
  const timer=b.querySelector('.message-timer');
  const barFill=b.querySelector('.timer-bar-fill');
  const bar=b.querySelector('.timer-bar');
  if(m.kept||state.currentChatKept){timer.textContent='✓ mantida';bar.style.display='none';}
  else{const ttl=m.ttl||3000;timer.textContent=Math.ceil(ttl/1000)+'s';barFill.style.animationDuration=ttl+'ms';startCountdown(b,ttl);}
  DOM.messagesList.appendChild(b);
}

function startCountdown(b,ttl){
  const el=b.querySelector('.message-timer');let r=ttl;
  const iv=setInterval(()=>{r-=100;el.textContent=Math.max(0,Math.ceil(r/1000))+'s';if(r<=0)clearInterval(iv);},100);
  b.dataset.iv=iv;
}

function removeMsg(id){
  const b=document.querySelector(`[data-message-id="${id}"]`);if(!b)return;
  if(b.dataset.iv)clearInterval(parseInt(b.dataset.iv));
  b.classList.add('fading');setTimeout(()=>b.remove(),350);
}

function toggleTyping(s){if(s)DOM.typingIndicator.classList.remove('hidden');else DOM.typingIndicator.classList.add('hidden');scrollBottom();}
function scrollBottom(){requestAnimationFrame(()=>{DOM.messagesContainer.scrollTop=DOM.messagesContainer.scrollHeight;});}

// ============================================================
// THEME
// ============================================================
function loadTheme(){setTheme(localStorage.getItem('phantom_theme')||'dark');}
function setTheme(t){state.theme=t;document.documentElement.setAttribute('data-theme',t);localStorage.setItem('phantom_theme',t);updateThemeBtns();}
function updateThemeBtns(){DOM.themeLightBtn.classList.toggle('active',state.theme==='light');DOM.themeDarkBtn.classList.toggle('active',state.theme==='dark');}

// ============================================================
// NAV
// ============================================================
function nav(s){
  document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));
  const el=document.getElementById(s+'-screen');if(el)el.classList.add('active');
}

// ============================================================
// UTILS
// ============================================================
function getInitials(n){if(!n)return'?';const p=n.trim().split(' ');return p.length>=2?(p[0][0]+p[1][0]).toUpperCase():p[0].substring(0,2).toUpperCase();}
function showErr(el,msg){el.textContent=msg;el.classList.remove('success');}
function esc(t){const d=document.createElement('div');d.textContent=t;return d.innerHTML;}

// ============================================================
// START
// ============================================================
document.addEventListener('DOMContentLoaded', init);
