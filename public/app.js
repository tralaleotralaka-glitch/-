const state = {
  mode: 'login',
  user: null,
  conversations: [],
  activeConversationId: null,
  messages: [],
  eventSource: null,
  messageRequest: 0,
  sendingMessage: false,
  searchTimer: null,
  searchRequest: 0,
  searchController: null,
  toastTimer: null,
};

const byId = (id) => document.getElementById(id);
const authScreen = byId('auth-screen');
const messengerScreen = byId('messenger-screen');
const authForm = byId('auth-form');
const authError = byId('auth-error');
const authUsername = byId('auth-username');
const authPassword = byId('auth-password');
const confirmField = byId('confirm-field');
const authConfirm = byId('auth-confirm');
const authSubmit = byId('auth-submit');
const chatShell = byId('chat-shell');
const conversationList = byId('conversation-list');
const sidebarEmpty = byId('sidebar-empty');
const welcomeState = byId('welcome-state');
const activeChat = byId('active-chat');
const messagesList = byId('messages-list');
const messagesViewport = byId('messages-viewport');
const composerForm = byId('composer-form');
const messageInput = byId('message-input');
const sendButton = byId('send-button');
const composerFeedback = byId('composer-feedback');
const modal = byId('new-chat-modal');
const userSearchInput = byId('user-search-input');
const userSearchResults = byId('user-search-results');

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(url, {
      credentials: 'same-origin',
      ...options,
      headers,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError('Не удалось подключиться. Проверьте соединение и попробуйте снова.', 0);
  }
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    // A useful status-based error is shown below if the server returned no JSON.
  }
  if (!response.ok) {
    throw new ApiError(payload.error || 'Что-то пошло не так. Попробуйте ещё раз.', response.status);
  }
  return payload;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function avatarColor(username) {
  let hash = 0;
  for (const character of String(username)) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % 12;
}

function initials(username) {
  return Array.from(String(username || 'н').trim()).slice(0, 2).join('').toLocaleUpperCase('ru-RU') || 'Н';
}

function avatarMarkup(username, extraClass = '', online = false) {
  const name = String(username || 'н');
  return `<span class="avatar hue-${avatarColor(name)} ${extraClass}${online ? ' is-online' : ''}" aria-hidden="true">${escapeHtml(initials(name))}</span>`;
}

function setAuthMode(mode) {
  state.mode = mode;
  const isRegister = mode === 'register';
  byId('login-tab').classList.toggle('is-active', !isRegister);
  byId('register-tab').classList.toggle('is-active', isRegister);
  byId('login-tab').setAttribute('aria-selected', String(!isRegister));
  byId('register-tab').setAttribute('aria-selected', String(isRegister));
  byId('auth-title').textContent = isRegister ? 'Создайте свой уголок' : 'С возвращением';
  byId('auth-subtitle').textContent = isRegister
    ? 'Придумайте имя пользователя и пароль.'
    : 'Войдите, чтобы продолжить разговор.';
  byId('auth-submit-label').textContent = isRegister ? 'Создать аккаунт' : 'Войти в аккаунт';
  authPassword.autocomplete = isRegister ? 'new-password' : 'current-password';
  confirmField.hidden = !isRegister;
  authConfirm.disabled = !isRegister;
  authConfirm.required = isRegister;
  authConfirm.value = '';
  authError.hidden = true;
  authError.textContent = '';
}

function showAuth(message = '') {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  state.user = null;
  state.conversations = [];
  state.activeConversationId = null;
  state.messages = [];
  authScreen.hidden = false;
  messengerScreen.hidden = true;
  chatShell.classList.remove('has-active');
  modal.hidden = true;
  setAuthMode(state.mode || 'login');
  if (message) {
    authError.textContent = message;
    authError.hidden = false;
  }
}

function validateAuthForm() {
  const username = authUsername.value.trim();
  const password = authPassword.value;
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    throw new Error('Имя пользователя: 3–20 символов, только латиница, цифры и _.');
  }
  if (password.length < 8 || password.length > 128) {
    throw new Error('Пароль должен содержать от 8 до 128 символов.');
  }
  if (state.mode === 'register' && authConfirm.value !== password) {
    throw new Error('Пароли не совпадают. Проверьте и попробуйте ещё раз.');
  }
  return { username, password };
}

async function submitAuth(event) {
  event.preventDefault();
  authError.hidden = true;
  authError.textContent = '';
  let credentials;
  try {
    credentials = validateAuthForm();
  } catch (error) {
    authError.textContent = error.message;
    authError.hidden = false;
    return;
  }

  const isRegister = state.mode === 'register';
  authSubmit.disabled = true;
  byId('auth-submit-label').textContent = isRegister ? 'Создаём аккаунт…' : 'Входим…';
  try {
    const result = await api(isRegister ? '/api/register' : '/api/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
    await enterMessenger(result.user);
  } catch (error) {
    authError.textContent = error.message;
    authError.hidden = false;
  } finally {
    authSubmit.disabled = false;
    byId('auth-submit-label').textContent = isRegister ? 'Создать аккаунт' : 'Войти в аккаунт';
  }
}

async function enterMessenger(user) {
  state.user = user;
  state.conversations = [];
  state.activeConversationId = null;
  state.messages = [];
  state.sendingMessage = false;
  messageInput.disabled = false;
  messageInput.value = '';
  resizeComposer();
  authScreen.hidden = true;
  messengerScreen.hidden = false;
  modal.hidden = true;
  byId('profile-name').textContent = `@${user.username}`;
  byId('profile-avatar').textContent = initials(user.username);
  byId('profile-avatar').className = `profile-avatar avatar hue-${avatarColor(user.username)}`;
  renderConversationList();
  showWelcome();
  try {
    await refreshConversations();
  } catch (error) {
    if (error.status === 401) {
      showAuth('Сессия закончилась. Войдите снова.');
      return;
    }
    showToast('Не удалось загрузить диалоги. Проверьте соединение и попробуйте обновить страницу.');
  }
  connectEvents();
  if (state.conversations.length) {
    try {
      await openConversation(state.conversations[0].id);
    } catch (error) {
      showToast(error.message);
    }
  }
}

function connectEvents() {
  if (state.eventSource) state.eventSource.close();
  state.eventSource = new EventSource('/api/events');
  state.eventSource.addEventListener('update', (event) => {
    let update;
    try { update = JSON.parse(event.data); } catch { return; }
    handleLiveUpdate(update);
  });
}

async function handleLiveUpdate(update) {
  if (!update || !state.user) return;
  if (update.type === 'presence') {
    state.conversations = state.conversations.map((conversation) =>
      conversation.partner?.id === update.userId
        ? { ...conversation, partner: { ...conversation.partner, isOnline: update.online } }
        : conversation
    );
    renderConversationList();
    updateActiveHeader();
    return;
  }
  if (update.type === 'connected') return;
  try {
    await refreshConversations();
    if (update.conversationId && update.conversationId === state.activeConversationId) {
      await loadMessages(update.conversationId);
    }
  } catch (error) {
    if (error.status === 401) showAuth('Сессия закончилась. Войдите снова.');
  }
}

async function refreshConversations() {
  const result = await api('/api/conversations');
  state.conversations = result.conversations || [];
  byId('conversation-total').textContent = state.conversations.length > 99 ? '99+' : String(state.conversations.length);
  renderConversationList();
  updateActiveHeader();
}

function formatClock(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatConversationTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return formatClock(value);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'вчера';
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit' }).format(date);
}

function dayLabel(value) {
  const date = new Date(value);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return 'Сегодня';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Вчера';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(date);
}

function renderConversationList() {
  const query = byId('conversation-search-input').value.trim().toLocaleLowerCase('ru-RU');
  const conversations = state.conversations.filter((conversation) => {
    if (!query) return true;
    const username = conversation.partner?.username?.toLocaleLowerCase('ru-RU') || '';
    const preview = conversation.lastMessage?.content?.toLocaleLowerCase('ru-RU') || '';
    return username.includes(query) || preview.includes(query);
  });
  sidebarEmpty.hidden = state.conversations.length > 0 || query.length > 0;
  if (!state.conversations.length && query) {
    conversationList.innerHTML = '<div class="search-state"><span>Не нашли подходящий диалог</span></div>';
    return;
  }
  if (!conversations.length) {
    conversationList.innerHTML = '';
    if (query) conversationList.innerHTML = '<div class="search-state"><span>Не нашли подходящий диалог</span></div>';
    return;
  }

  conversationList.innerHTML = conversations.map((conversation) => {
    const username = conversation.partner.username;
    const lastMessage = conversation.lastMessage;
    const preview = lastMessage
      ? `${lastMessage.senderId === state.user?.id ? 'Вы: ' : ''}${lastMessage.content}`.replace(/\s+/g, ' ').trim()
      : 'Начните разговор';
    const time = lastMessage?.createdAt || conversation.updatedAt;
    const unread = conversation.unreadCount > 0;
    const selected = conversation.id === state.activeConversationId;
    return `<button class="conversation-item${selected ? ' is-active' : ''}" type="button" data-conversation-id="${escapeHtml(conversation.id)}" aria-current="${selected ? 'true' : 'false'}">
      ${avatarMarkup(username, '', conversation.partner.isOnline)}
      <span class="conversation-copy">
        <span class="conversation-name-row"><span class="conversation-name">@${escapeHtml(username)}</span></span>
        <span class="conversation-preview${unread ? ' is-unread' : ''}">${escapeHtml(preview)}</span>
      </span>
      <span class="conversation-meta"><span class="conversation-time">${escapeHtml(formatConversationTime(time))}</span>${unread ? `<span class="unread-badge">${conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</span>` : ''}</span>
    </button>`;
  }).join('');
}

function findActiveConversation() {
  return state.conversations.find((conversation) => conversation.id === state.activeConversationId) || null;
}

function updateActiveHeader() {
  const conversation = findActiveConversation();
  if (!conversation?.partner) return;
  const partner = conversation.partner;
  byId('chat-username').textContent = `@${partner.username}`;
  byId('chat-avatar').textContent = initials(partner.username);
  byId('chat-avatar').className = `chat-avatar avatar hue-${avatarColor(partner.username)}${partner.isOnline ? ' is-online' : ''}`;
  byId('chat-avatar').classList.toggle('is-online', Boolean(partner.isOnline));
  const presence = byId('chat-presence');
  presence.classList.toggle('is-online', Boolean(partner.isOnline));
  presence.querySelector('span').textContent = partner.isOnline ? 'в сети' : 'не в сети';
}

function showWelcome() {
  state.activeConversationId = null;
  state.messages = [];
  chatShell.classList.remove('has-active');
  activeChat.hidden = true;
  welcomeState.hidden = false;
  composerFeedback.textContent = '';
  renderConversationList();
}

async function openConversation(conversationId) {
  const conversation = state.conversations.find((item) => item.id === conversationId);
  if (!conversation) return;
  state.activeConversationId = conversationId;
  state.messages = [];
  state.messageRequest += 1;
  chatShell.classList.add('has-active');
  welcomeState.hidden = true;
  activeChat.hidden = false;
  composerFeedback.textContent = '';
  messageInput.value = '';
  resizeComposer();
  updateActiveHeader();
  renderConversationList();
  await loadMessages(conversationId);
}

async function loadMessages(conversationId = state.activeConversationId) {
  if (!conversationId || conversationId !== state.activeConversationId) return;
  const requestNumber = ++state.messageRequest;
  const result = await api(`/api/conversations/${encodeURIComponent(conversationId)}/messages`);
  if (requestNumber !== state.messageRequest || conversationId !== state.activeConversationId) return;
  state.messages = result.messages || [];
  renderMessages();
  // Fetching the thread marks it as read on the server, so refresh the unread badge too.
  const currentConversation = findActiveConversation();
  if (currentConversation?.unreadCount) {
    currentConversation.unreadCount = 0;
    renderConversationList();
  }
}

function renderMessages() {
  if (!state.messages.length) {
    messagesList.innerHTML = '<div class="empty-chat"><span class="empty-chat-icon" aria-hidden="true">✳</span><strong>Здесь начнётся ваш разговор</strong><p>Напишите первое сообщение — оно останется только между вами.</p></div>';
    messagesViewport.scrollTop = messagesViewport.scrollHeight;
    return;
  }
  let lastDay = '';
  const html = [];
  for (const message of state.messages) {
    const date = new Date(message.createdAt);
    const dayKey = Number.isNaN(date.getTime()) ? '' : date.toDateString();
    if (dayKey && dayKey !== lastDay) {
      html.push(`<div class="day-divider"><span>${escapeHtml(dayLabel(message.createdAt))}</span></div>`);
      lastDay = dayKey;
    }
    const own = message.senderId === state.user?.id;
    const partnerName = findActiveConversation()?.partner?.username || 'собеседник';
    const avatar = own ? '' : avatarMarkup(partnerName, 'message-avatar');
    const tick = own ? `<span class="read-tick" aria-label="${message.isRead ? 'Прочитано' : 'Отправлено'}">${message.isRead ? '✓✓' : '✓'}</span>` : '';
    html.push(`<div class="message-row${own ? ' is-mine' : ''}">${avatar}<div class="message-body"><div class="message-bubble">${escapeHtml(message.content)}</div><div class="message-meta">${escapeHtml(formatClock(message.createdAt))}${tick}</div></div></div>`);
  }
  messagesList.innerHTML = html.join('');
  messagesViewport.scrollTop = messagesViewport.scrollHeight;
}

function resizeComposer() {
  sendButton.disabled = state.sendingMessage || !messageInput.value.trim();
}

async function sendMessage(event) {
  event.preventDefault();
  const content = messageInput.value.trim();
  const conversationId = state.activeConversationId;
  if (!content || !conversationId || state.sendingMessage) return;
  composerFeedback.textContent = '';
  state.sendingMessage = true;
  messageInput.disabled = true;
  resizeComposer();
  try {
    await api(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
    if (conversationId !== state.activeConversationId) return;
    messageInput.value = '';
    await Promise.all([loadMessages(conversationId), refreshConversations()]);
  } catch (error) {
    composerFeedback.textContent = error.message;
  } finally {
    state.sendingMessage = false;
    messageInput.disabled = false;
    resizeComposer();
  }
}

function openNewChat() {
  modal.hidden = false;
  userSearchInput.value = '';
  userSearchResults.innerHTML = '<div class="search-prompt"><span class="prompt-glyph">⌕</span><span>Введите хотя бы 2 символа,<br>чтобы найти собеседника</span></div>';
  window.setTimeout(() => userSearchInput.focus(), 30);
}

function closeNewChat() {
  modal.hidden = true;
  state.searchRequest += 1;
  window.clearTimeout(state.searchTimer);
  if (state.searchController) state.searchController.abort();
  state.searchController = null;
}

function searchMessageMarkup(title, detail = '') {
  return `<div class="search-state"><strong>${escapeHtml(title)}</strong>${detail ? `<span>${escapeHtml(detail)}</span>` : ''}</div>`;
}

function searchForUsers() {
  window.clearTimeout(state.searchTimer);
  const query = userSearchInput.value.trim();
  const requestNumber = ++state.searchRequest;
  if (state.searchController) state.searchController.abort();
  if (query.length < 2) {
    userSearchResults.innerHTML = '<div class="search-prompt"><span class="prompt-glyph">⌕</span><span>Введите хотя бы 2 символа,<br>чтобы найти собеседника</span></div>';
    return;
  }
  userSearchResults.innerHTML = searchMessageMarkup('Ищем человека…');
  state.searchTimer = window.setTimeout(async () => {
    const controller = new AbortController();
    state.searchController = controller;
    try {
      const result = await api(`/api/users?q=${encodeURIComponent(query)}`, { signal: controller.signal });
      if (requestNumber !== state.searchRequest || modal.hidden) return;
      if (!result.users.length) {
        userSearchResults.innerHTML = searchMessageMarkup('Пока никого не нашли', 'Проверьте имя или попробуйте ещё раз.');
        return;
      }
      userSearchResults.innerHTML = result.users.map((user) => `
        <button class="user-result" type="button" data-username="${escapeHtml(user.username)}">
          ${avatarMarkup(user.username, '', user.isOnline)}
          <span class="user-result-copy"><span class="user-result-name">@${escapeHtml(user.username)}</span><span class="user-result-status${user.isOnline ? ' is-online' : ''}"><i></i>${user.isOnline ? 'в сети' : 'начать разговор'}</span></span>
          <span class="user-result-arrow" aria-hidden="true">↗</span>
        </button>`).join('');
    } catch (error) {
      if (error.name === 'AbortError' || requestNumber !== state.searchRequest) return;
      userSearchResults.innerHTML = searchMessageMarkup('Не удалось выполнить поиск', error.message);
    }
  }, 220);
}

async function createConversation(username, button) {
  button.disabled = true;
  try {
    const result = await api('/api/conversations', {
      method: 'POST',
      body: JSON.stringify({ username }),
    });
    closeNewChat();
    await refreshConversations();
    await openConversation(result.conversation.id);
  } catch (error) {
    button.disabled = false;
    showToast(error.message);
  }
}

function showToast(message) {
  const toast = byId('toast');
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3500);
}

async function logout() {
  byId('logout-button').disabled = true;
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {
    // The session may already have expired; clear the local view either way.
  }
  byId('logout-button').disabled = false;
  state.mode = 'login';
  showAuth();
  authForm.reset();
}

byId('login-tab').addEventListener('click', () => setAuthMode('login'));
byId('register-tab').addEventListener('click', () => setAuthMode('register'));
authForm.addEventListener('submit', submitAuth);
byId('password-toggle').addEventListener('click', () => {
  const reveal = authPassword.type === 'password';
  authPassword.type = reveal ? 'text' : 'password';
  byId('password-toggle').setAttribute('aria-label', reveal ? 'Скрыть пароль' : 'Показать пароль');
  byId('password-toggle').title = reveal ? 'Скрыть пароль' : 'Показать пароль';
});

conversationList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-conversation-id]');
  if (button) openConversation(button.dataset.conversationId).catch((error) => showToast(error.message));
});
byId('conversation-search-input').addEventListener('input', renderConversationList);
byId('new-chat-button').addEventListener('click', openNewChat);
byId('empty-new-chat').addEventListener('click', openNewChat);
byId('welcome-new-chat').addEventListener('click', openNewChat);
byId('modal-close').addEventListener('click', closeNewChat);
modal.addEventListener('click', (event) => { if (event.target === modal) closeNewChat(); });
userSearchInput.addEventListener('input', searchForUsers);
userSearchResults.addEventListener('click', (event) => {
  const button = event.target.closest('[data-username]');
  if (button) createConversation(button.dataset.username, button);
});
byId('back-button').addEventListener('click', showWelcome);
byId('logout-button').addEventListener('click', logout);
composerForm.addEventListener('submit', sendMessage);
messageInput.addEventListener('input', resizeComposer);
messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    composerForm.requestSubmit();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !modal.hidden) closeNewChat();
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !messengerScreen.hidden) {
    event.preventDefault();
    openNewChat();
  }
});

async function boot() {
  setAuthMode('login');
  try {
    const result = await api('/api/me');
    await enterMessenger(result.user);
  } catch (error) {
    if (error.status !== 401 && error.status !== 0) {
      authError.textContent = error.message;
      authError.hidden = false;
    } else if (error.status === 0) {
      authError.textContent = error.message;
      authError.hidden = false;
    }
  }
}

boot();
