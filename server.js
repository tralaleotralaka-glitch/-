const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATABASE_PATH = path.join(DATA_DIR, 'store.json');
const PORT = Number(process.env.PORT) || 3000;
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const PASSWORD_KEY_LENGTH = 64;
const MAX_BODY_BYTES = 64 * 1024;

let database = { users: [], conversations: [], messages: [] };
let writeQueue = Promise.resolve();
const sessions = new Map();
const streamsByUser = new Map();
const allStreams = new Set();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function publicUser(user) {
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

async function initializeDatabase() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const saved = JSON.parse(await fs.readFile(DATABASE_PATH, 'utf8'));
    database = {
      users: Array.isArray(saved.users) ? saved.users : [],
      conversations: Array.isArray(saved.conversations) ? saved.conversations : [],
      messages: Array.isArray(saved.messages) ? saved.messages : [],
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Could not read the local message store:', error.message);
      throw error;
    }
    await persistDatabase();
  }
}

function persistDatabase() {
  const snapshot = JSON.stringify(database, null, 2);
  writeQueue = writeQueue
    .catch((error) => console.error('A previous database write failed:', error.message))
    .then(async () => {
      const temporaryPath = `${DATABASE_PATH}.${process.pid}.tmp`;
      await fs.writeFile(temporaryPath, snapshot, { mode: 0o600 });
      await fs.rename(temporaryPath, DATABASE_PATH);
    });
  return writeQueue;
}

function sendJson(res, status, payload) {
  if (res.writableEnded) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function readCookies(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookies = {};
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    cookies[name] = value;
  }
  return cookies;
}

function authenticatedUser(req) {
  const token = readCookies(req).sid;
  if (!token || token.length > 256) return null;
  const tokenHash = sha256(token);
  const session = sessions.get(tokenHash);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(tokenHash);
    return null;
  }
  return database.users.find((user) => user.id === session.userId) || null;
}

function setSessionCookie(req, res, token) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_MAX_AGE / 1000)}${secure}`);
}

function clearSessionCookie(req, res) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function createSession(req, res, user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(sha256(token), { userId: user.id, expiresAt: Date.now() + SESSION_MAX_AGE });
  setSessionCookie(req, res, token);
}

async function readJsonBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Запрос слишком большой.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Expected an object');
    }
    return value;
  } catch {
    throw new HttpError(400, 'Не удалось прочитать запрос.');
  }
}

function normalizeUsername(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function validateUsername(username) {
  return /^[a-z0-9_]{3,20}$/.test(username);
}

async function passwordHash(password, salt) {
  return scrypt(password, salt, PASSWORD_KEY_LENGTH);
}

function requireUser(req) {
  const user = authenticatedUser(req);
  if (!user) throw new HttpError(401, 'Сессия закончилась. Войдите снова.');
  return user;
}

function getConversationForUser(conversationId, userId) {
  const conversation = database.conversations.find((item) => item.id === conversationId);
  if (!conversation || !conversation.members.includes(userId)) {
    throw new HttpError(404, 'Диалог не найден.');
  }
  return conversation;
}

function isUserOnline(userId) {
  return Boolean(streamsByUser.get(userId)?.size);
}

function sendEventToUser(userId, event) {
  const streams = streamsByUser.get(userId);
  if (!streams) return;
  const frame = `event: update\ndata: ${JSON.stringify(event)}\n\n`;
  for (const response of [...streams]) {
    if (response.destroyed || response.writableEnded) {
      removeStream(userId, response);
      continue;
    }
    try {
      response.write(frame);
    } catch {
      removeStream(userId, response);
    }
  }
}

function notifyConversation(conversation, event) {
  for (const userId of conversation.members) sendEventToUser(userId, event);
}

function publishPresence(userId, online) {
  const seen = new Set();
  for (const conversation of database.conversations) {
    if (!conversation.members.includes(userId)) continue;
    const otherUserId = conversation.members.find((memberId) => memberId !== userId);
    if (!otherUserId || seen.has(otherUserId)) continue;
    seen.add(otherUserId);
    sendEventToUser(otherUserId, { type: 'presence', userId, online });
  }
}

function removeStream(userId, response) {
  allStreams.delete(response);
  const streams = streamsByUser.get(userId);
  if (!streams) return;
  streams.delete(response);
  if (streams.size === 0) {
    streamsByUser.delete(userId);
    publishPresence(userId, false);
  }
}

function openEventStream(req, res, user) {
  const alreadyOnline = isUserOnline(user.id);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 4000\nevent: update\ndata: {"type":"connected"}\n\n');
  req.socket.setTimeout(0);
  let streams = streamsByUser.get(user.id);
  if (!streams) {
    streams = new Set();
    streamsByUser.set(user.id, streams);
  }
  streams.add(res);
  allStreams.add(res);
  if (!alreadyOnline) publishPresence(user.id, true);
  req.on('close', () => removeStream(user.id, res));
}

function listConversations(user) {
  return database.conversations
    .filter((conversation) => conversation.members.includes(user.id))
    .map((conversation) => {
      const partnerId = conversation.members.find((memberId) => memberId !== user.id);
      const partner = database.users.find((candidate) => candidate.id === partnerId);
      const conversationMessages = database.messages.filter((message) => message.conversationId === conversation.id);
      const lastMessage = conversationMessages.at(-1) || null;
      const lastReadAt = conversation.readAt?.[user.id] || '';
      const unreadCount = conversationMessages.filter((message) =>
        message.senderId !== user.id && message.createdAt > lastReadAt
      ).length;
      return {
        id: conversation.id,
        partner: partner ? { ...publicUser(partner), isOnline: isUserOnline(partner.id) } : null,
        lastMessage: lastMessage ? {
          content: lastMessage.content,
          senderId: lastMessage.senderId,
          createdAt: lastMessage.createdAt,
        } : null,
        unreadCount,
        updatedAt: conversation.updatedAt,
        readAt: conversation.readAt || {},
      };
    })
    .filter((conversation) => conversation.partner)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (req.method === 'POST' && pathname === '/api/register') {
    const body = await readJsonBody(req);
    const username = normalizeUsername(body.username);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!validateUsername(username)) {
      throw new HttpError(400, 'Имя пользователя: 3–20 символов, только латинские буквы, цифры и _.');
    }
    if (password.length < 8 || password.length > 128) {
      throw new HttpError(400, 'Пароль должен содержать от 8 до 128 символов.');
    }
    if (database.users.some((user) => user.username === username)) {
      throw new HttpError(409, 'Это имя уже занято. Попробуйте другое.');
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await passwordHash(password, salt);
    // Scrypt yields control to the event loop; re-check uniqueness in case two sign-ups raced.
    if (database.users.some((user) => user.username === username)) {
      throw new HttpError(409, 'Это имя уже занято. Попробуйте другое.');
    }
    const user = {
      id: crypto.randomUUID(),
      username,
      passwordSalt: salt,
      passwordHash: hash.toString('hex'),
      createdAt: nowIso(),
    };
    database.users.push(user);
    await persistDatabase();
    createSession(req, res, user);
    sendJson(res, 201, { user: publicUser(user) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/login') {
    const body = await readJsonBody(req);
    const username = normalizeUsername(body.username);
    const password = typeof body.password === 'string' ? body.password : '';
    const user = database.users.find((candidate) => candidate.username === username);
    const salt = user?.passwordSalt || 'nit-messenger-dummy-salt';
    const expected = user?.passwordHash || '0'.repeat(PASSWORD_KEY_LENGTH * 2);
    const supplied = await passwordHash(password.slice(0, 128), salt);
    const expectedBuffer = Buffer.from(expected, 'hex');
    const passwordMatches = expectedBuffer.length === supplied.length && crypto.timingSafeEqual(expectedBuffer, supplied);
    if (!user || !passwordMatches || password.length > 128) {
      throw new HttpError(401, 'Неверное имя пользователя или пароль.');
    }
    createSession(req, res, user);
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/logout') {
    const token = readCookies(req).sid;
    if (token) sessions.delete(sha256(token));
    clearSessionCookie(req, res);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname.startsWith('/api/')) {
    const user = requireUser(req);

    if (req.method === 'GET' && pathname === '/api/me') {
      sendJson(res, 200, { user: publicUser(user) });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/users') {
      const query = normalizeUsername(url.searchParams.get('q') || '');
      if (query.length < 2) {
        sendJson(res, 200, { users: [] });
        return;
      }
      const users = database.users
        .filter((candidate) => candidate.id !== user.id && candidate.username.includes(query))
        .slice(0, 12)
        .map((candidate) => ({ ...publicUser(candidate), isOnline: isUserOnline(candidate.id) }));
      sendJson(res, 200, { users });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/conversations') {
      sendJson(res, 200, { conversations: listConversations(user) });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/conversations') {
      const body = await readJsonBody(req);
      const username = normalizeUsername(body.username);
      if (!validateUsername(username)) throw new HttpError(400, 'Укажите имя пользователя от 3 до 20 символов.');
      const partner = database.users.find((candidate) => candidate.username === username);
      if (!partner) throw new HttpError(404, 'Пользователь с таким именем не найден.');
      if (partner.id === user.id) throw new HttpError(400, 'Нельзя создать диалог с самим собой.');
      let conversation = database.conversations.find((candidate) =>
        candidate.members.length === 2 && candidate.members.includes(user.id) && candidate.members.includes(partner.id)
      );
      let created = false;
      if (!conversation) {
        const timestamp = nowIso();
        conversation = {
          id: crypto.randomUUID(),
          members: [user.id, partner.id],
          createdAt: timestamp,
          updatedAt: timestamp,
          readAt: { [user.id]: timestamp, [partner.id]: timestamp },
        };
        database.conversations.push(conversation);
        await persistDatabase();
        created = true;
        notifyConversation(conversation, { type: 'conversation', conversationId: conversation.id });
      }
      sendJson(res, created ? 201 : 200, {
        conversation: {
          id: conversation.id,
          partner: { ...publicUser(partner), isOnline: isUserOnline(partner.id) },
        },
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/events') {
      openEventStream(req, res, user);
      return;
    }

    const messagePath = pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (messagePath && req.method === 'GET') {
      const conversationId = decodeURIComponent(messagePath[1]);
      const conversation = getConversationForUser(conversationId, user.id);
      const allMessages = database.messages.filter((message) => message.conversationId === conversation.id);
      const messages = allMessages.map((message) => {
        const otherUserId = conversation.members.find((memberId) => memberId !== message.senderId);
        const partnerReadAt = conversation.readAt?.[otherUserId] || '';
        return { ...message, isRead: message.senderId === user.id && partnerReadAt >= message.createdAt };
      });
      const previousReadAt = conversation.readAt?.[user.id] || '';
      const latestMessageAt = allMessages.at(-1)?.createdAt || '';
      if (latestMessageAt && latestMessageAt > previousReadAt) {
        conversation.readAt = { ...(conversation.readAt || {}), [user.id]: nowIso() };
        await persistDatabase();
        sendEventToUser(conversation.members.find((memberId) => memberId !== user.id), {
          type: 'read',
          conversationId: conversation.id,
        });
      }
      sendJson(res, 200, { messages });
      return;
    }

    const postMessagePath = pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (postMessagePath && req.method === 'POST') {
      const conversationId = decodeURIComponent(postMessagePath[1]);
      const conversation = getConversationForUser(conversationId, user.id);
      const body = await readJsonBody(req);
      const content = typeof body.content === 'string' ? body.content.trim() : '';
      if (!content) throw new HttpError(400, 'Напишите сообщение перед отправкой.');
      if (content.length > 4000) throw new HttpError(400, 'Сообщение не должно быть длиннее 4000 символов.');
      const message = {
        id: crypto.randomUUID(),
        conversationId: conversation.id,
        senderId: user.id,
        content,
        createdAt: nowIso(),
      };
      database.messages.push(message);
      conversation.updatedAt = message.createdAt;
      await persistDatabase();
      notifyConversation(conversation, { type: 'message', conversationId: conversation.id });
      sendJson(res, 201, { message: { ...message, isRead: false } });
      return;
    }

    throw new HttpError(404, 'Маршрут не найден.');
  }

  throw new HttpError(404, 'Маршрут не найден.');
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Метод не поддерживается.');
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, 'Некорректный адрес.');
  }
  const requestedPath = decodedPath === '/' ? '/index.html' : decodedPath;
  const filePath = path.resolve(PUBLIC_DIR, `.${requestedPath}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) throw new HttpError(404, 'Файл не найден.');
  let content;
  try {
    content = await fs.readFile(filePath);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') throw new HttpError(404, 'Файл не найден.');
    throw error;
  }
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
    'Content-Length': content.length,
    'Cache-Control': path.extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  res.end(req.method === 'HEAD' ? undefined : content);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");

  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(req, res, url.pathname);
    }
  } catch (error) {
    if (res.writableEnded || res.headersSent) {
      if (!res.writableEnded) res.end();
      return;
    }
    if (error instanceof HttpError) {
      sendJson(res, error.status, { error: error.message });
      return;
    }
    console.error('Request failed:', error);
    sendJson(res, 500, { error: 'Что-то пошло не так. Попробуйте ещё раз.' });
  }
});

const heartbeat = setInterval(() => {
  for (const response of allStreams) {
    if (response.destroyed || response.writableEnded) continue;
    try {
      response.write(': ping\n\n');
    } catch {
      // A closing browser will be removed by the request's close handler.
    }
  }
}, 25_000);
heartbeat.unref();

initializeDatabase()
  .then(() => {
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Нить запущена: http://0.0.0.0:${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Could not start the messenger:', error);
    process.exitCode = 1;
  });

function shutdown() {
  clearInterval(heartbeat);
  for (const response of allStreams) response.end();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
