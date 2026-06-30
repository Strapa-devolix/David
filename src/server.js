import http from 'node:http';
import { URL } from 'node:url';
import qrcode from 'qrcode';
import { config, requireAdminToken } from './config.js';
import { loadKnowledge, saveKnowledge } from './knowledge.js';
import { getChats } from './registry.js';
import { getSecretStatus, getSettings, updateSettings } from './settings.js';

let currentQr = '';
let connectionState = 'starting';
let lastError = '';
let startedAt = new Date();

export function setQr(qr) {
  currentQr = qr || '';
}

export function setConnectionState(state) {
  connectionState = state;
  if (state === 'open') currentQr = '';
}

export function setLastError(error) {
  lastError = error ? String(error.message || error) : '';
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendHtml(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function isAuthorized(url) {
  requireAdminToken();
  return url.searchParams.get('token') === config.adminToken;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function sendQrPage(res) {
  if (!currentQr) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>David</h1><p>No QR is pending. The service may already be connected.</p>');
    return;
  }

  const image = await qrcode.toDataURL(currentQr, { margin: 1, width: 320 });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html>
<html>
  <head><title>David QR</title></head>
  <body style="font-family: system-ui, sans-serif; margin: 40px;">
    <h1>Scan with WhatsApp Linked Devices</h1>
    <p>Open WhatsApp on your phone, go to Linked devices, and scan this QR.</p>
    <img alt="WhatsApp login QR" src="${image}" />
  </body>
</html>`);
}

function dashboardPage(token) {
  const safeToken = escapeHtml(token);
  return `<!doctype html>
<html>
  <head>
    <title>David Dashboard</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: dark; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; background: #0d0f12; color: #f6f7fb; }
      main { max-width: 1180px; margin: 0 auto; padding: 28px; }
      header { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 22px; }
      h1 { margin: 0; font-size: 28px; }
      h2 { margin: 0 0 14px; font-size: 18px; }
      section { border-top: 1px solid #2a2e36; padding: 22px 0; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
      label { display: grid; gap: 8px; color: #c9ced8; font-size: 13px; }
      input, select, textarea { width: 100%; box-sizing: border-box; border: 1px solid #343946; background: #151922; color: #f6f7fb; border-radius: 6px; padding: 10px 12px; font: inherit; }
      textarea { min-height: 120px; resize: vertical; }
      input[type="checkbox"] { width: 18px; height: 18px; }
      .checks { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
      .check { display: flex; align-items: center; gap: 10px; border: 1px solid #2a2e36; border-radius: 6px; padding: 12px; color: #f6f7fb; }
      button, a.button { border: 1px solid #596170; background: #f6f7fb; color: #0d0f12; border-radius: 6px; padding: 10px 14px; font: inherit; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
      button.secondary, a.secondary { background: transparent; color: #f6f7fb; }
      .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
      .status { color: #99a2b3; font-size: 13px; }
      .chat { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; border: 1px solid #2a2e36; border-radius: 6px; padding: 12px; margin-bottom: 10px; }
      .chat strong { display: block; margin-bottom: 4px; }
      .chat code { color: #b8c7ff; word-break: break-all; }
      @media (max-width: 760px) { main { padding: 18px; } .grid, .checks { grid-template-columns: 1fr; } header { align-items: flex-start; flex-direction: column; } }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>David</h1>
          <div class="status" id="secretStatus">Loading settings...</div>
        </div>
        <div class="actions">
          <a class="button secondary" href="/qr?token=${safeToken}">QR</a>
          <a class="button secondary" href="/health">Health</a>
        </div>
      </header>

      <section>
        <h2>Behavior</h2>
        <div class="grid">
          <label>Assistant name<input id="botName" /></label>
          <label>Owner name<input id="ownerName" /></label>
          <label>Reply trigger
            <select id="replyTrigger">
              <option value="question_or_mention">Question or mention</option>
              <option value="question_only">Question only</option>
              <option value="mention_only">Mention only</option>
              <option value="all">All messages</option>
            </select>
          </label>
          <label>AI provider
            <select id="aiProvider">
              <option value="groq">Groq</option>
              <option value="openai">OpenAI</option>
              <option value="local">Local knowledge only</option>
            </select>
          </label>
          <label>Groq model<input id="groqModel" /></label>
          <label>OpenAI model<input id="openaiModel" /></label>
          <label>Max reply characters<input id="maxReplyChars" type="number" min="200" max="4000" /></label>
          <label>Seconds between replies<input id="minSecondsBetweenReplies" type="number" min="0" max="3600" /></label>
        </div>
        <div class="checks" style="margin-top: 16px;">
          <label class="check"><input id="autoReply" type="checkbox" /> Auto reply</label>
          <label class="check"><input id="onlyGroups" type="checkbox" /> Groups only</label>
          <label class="check"><input id="allowAllChats" type="checkbox" /> Allow all chats</label>
        </div>
      </section>

      <section>
        <h2>Chats</h2>
        <div class="grid">
          <label>Allowed chat IDs<textarea id="allowedChatIds" placeholder="One chat ID per line"></textarea></label>
          <label>Blocked chat IDs<textarea id="blockedChatIds" placeholder="One chat ID per line"></textarea></label>
        </div>
        <div class="actions">
          <button class="secondary" id="refreshChats" type="button">Refresh chats</button>
        </div>
        <div id="chats" style="margin-top: 16px;"></div>
      </section>

      <section>
        <h2>Knowledge</h2>
        <textarea id="knowledge" style="min-height: 260px;" placeholder="Add platform and app answers here"></textarea>
      </section>

      <div class="actions">
        <button id="save" type="button">Save dashboard settings</button>
        <span class="status" id="status"></span>
      </div>
    </main>
    <script>
      const token = new URLSearchParams(location.search).get('token') || '';
      const ids = [
        'botName', 'ownerName', 'replyTrigger', 'aiProvider', 'groqModel', 'openaiModel',
        'maxReplyChars', 'minSecondsBetweenReplies', 'autoReply', 'onlyGroups', 'allowAllChats',
        'allowedChatIds', 'blockedChatIds', 'knowledge'
      ];
      const el = Object.fromEntries(ids.map(function (id) { return [id, document.getElementById(id)]; }));
      const statusEl = document.getElementById('status');
      const chatsEl = document.getElementById('chats');

      function api(path, options) {
        const separator = path.includes('?') ? '&' : '?';
        return fetch(path + separator + 'token=' + encodeURIComponent(token), options || {}).then(async function (res) {
          const contentType = res.headers.get('content-type') || '';
          const body = contentType.includes('application/json') ? await res.json() : await res.text();
          if (!res.ok) throw new Error(body.error || res.statusText);
          return body;
        });
      }

      function lines(value) {
        return String(value || '').split(/\\n|,/).map(function (item) { return item.trim(); }).filter(Boolean);
      }

      function setStatus(text) {
        statusEl.textContent = text;
      }

      function fillSettings(settings, secrets) {
        el.botName.value = settings.botName;
        el.ownerName.value = settings.ownerName;
        el.replyTrigger.value = settings.replyTrigger;
        el.aiProvider.value = settings.aiProvider;
        el.groqModel.value = settings.groqModel;
        el.openaiModel.value = settings.openaiModel;
        el.maxReplyChars.value = settings.maxReplyChars;
        el.minSecondsBetweenReplies.value = settings.minSecondsBetweenReplies;
        el.autoReply.checked = settings.autoReply;
        el.onlyGroups.checked = settings.onlyGroups;
        el.allowAllChats.checked = settings.allowAllChats;
        el.allowedChatIds.value = settings.allowedChatIds.join('\\n');
        el.blockedChatIds.value = settings.blockedChatIds.join('\\n');
        document.getElementById('secretStatus').textContent =
          'Secrets loaded: ' + secrets.groqKeys + ' Groq key(s), OpenAI ' + (secrets.openai ? 'set' : 'not set');
      }

      function renderChats(chats) {
        chatsEl.innerHTML = '';
        if (!chats.length) {
          chatsEl.innerHTML = '<div class="status">No chats observed yet. Send a message in the target group, then refresh.</div>';
          return;
        }
        chats.forEach(function (chat) {
          const row = document.createElement('div');
          row.className = 'chat';
          const info = document.createElement('div');
          info.innerHTML = '<strong></strong><code></code><div class="status"></div>';
          info.querySelector('strong').textContent = chat.name || chat.type || 'Chat';
          info.querySelector('code').textContent = chat.jid;
          info.querySelector('.status').textContent = (chat.type || 'chat') + ' - last seen ' + (chat.lastSeenAt || '');
          const button = document.createElement('button');
          button.className = 'secondary';
          button.type = 'button';
          button.textContent = 'Allow';
          button.addEventListener('click', function () {
            const current = new Set(lines(el.allowedChatIds.value));
            current.add(chat.jid);
            el.allowedChatIds.value = Array.from(current).join('\\n');
            setStatus('Chat added. Save settings to apply it.');
          });
          row.append(info, button);
          chatsEl.append(row);
        });
      }

      async function loadAll() {
        setStatus('Loading...');
        const settingsResponse = await api('/settings');
        const knowledgeResponse = await api('/knowledge');
        fillSettings(settingsResponse.settings, settingsResponse.secrets);
        el.knowledge.value = knowledgeResponse.markdown || '';
        await refreshChats();
        setStatus('Ready');
      }

      async function refreshChats() {
        const response = await api('/chats');
        renderChats(response.chats || []);
      }

      async function saveAll() {
        setStatus('Saving...');
        await api('/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            botName: el.botName.value,
            ownerName: el.ownerName.value,
            replyTrigger: el.replyTrigger.value,
            aiProvider: el.aiProvider.value,
            groqModel: el.groqModel.value,
            openaiModel: el.openaiModel.value,
            maxReplyChars: el.maxReplyChars.value,
            minSecondsBetweenReplies: el.minSecondsBetweenReplies.value,
            autoReply: el.autoReply.checked,
            onlyGroups: el.onlyGroups.checked,
            allowAllChats: el.allowAllChats.checked,
            allowedChatIds: lines(el.allowedChatIds.value),
            blockedChatIds: lines(el.blockedChatIds.value)
          })
        });
        await api('/knowledge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown: el.knowledge.value })
        });
        setStatus('Saved');
      }

      document.getElementById('save').addEventListener('click', function () {
        saveAll().catch(function (error) { setStatus(error.message); });
      });
      document.getElementById('refreshChats').addEventListener('click', function () {
        refreshChats().catch(function (error) { setStatus(error.message); });
      });
      loadAll().catch(function (error) { setStatus(error.message); });
    </script>
  </body>
</html>`;
}

export function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

      if (url.pathname === '/' || url.pathname === '/health') {
        sendJson(res, 200, {
          ok: true,
          service: 'david',
          connectionState,
          uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
          lastError,
        });
        return;
      }

      if (url.pathname === '/dashboard' || url.pathname === '/admin') {
        if (!isAuthorized(url)) {
          sendJson(res, 401, { ok: false, error: 'Unauthorized' });
          return;
        }
        sendHtml(res, 200, dashboardPage(url.searchParams.get('token') || ''));
        return;
      }

      if (url.pathname === '/qr') {
        if (!isAuthorized(url)) {
          sendJson(res, 401, { ok: false, error: 'Unauthorized' });
          return;
        }
        await sendQrPage(res);
        return;
      }

      if (url.pathname === '/settings') {
        if (!isAuthorized(url)) {
          sendJson(res, 401, { ok: false, error: 'Unauthorized' });
          return;
        }
        if (req.method === 'GET') {
          sendJson(res, 200, { ok: true, settings: await getSettings(), secrets: getSecretStatus() });
          return;
        }
        if (req.method === 'POST') {
          const settings = await updateSettings(await readJson(req));
          sendJson(res, 200, { ok: true, settings, secrets: getSecretStatus() });
          return;
        }
      }

      if (url.pathname === '/knowledge') {
        if (!isAuthorized(url)) {
          sendJson(res, 401, { ok: false, error: 'Unauthorized' });
          return;
        }
        if (req.method === 'GET') {
          const { markdown } = await loadKnowledge();
          sendJson(res, 200, { ok: true, markdown });
          return;
        }
        if (req.method === 'POST') {
          const body = await readJson(req);
          const { markdown } = await saveKnowledge(body.markdown || '');
          sendJson(res, 200, { ok: true, markdown });
          return;
        }
      }

      if (url.pathname === '/chats') {
        if (!isAuthorized(url)) {
          sendJson(res, 401, { ok: false, error: 'Unauthorized' });
          return;
        }
        sendJson(res, 200, { ok: true, chats: getChats() });
        return;
      }

      sendJson(res, 404, { ok: false, error: 'Not found' });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: String(error.message || error) });
    }
  });

  server.listen(config.port, () => {
    console.log(`Health server listening on port ${config.port}`);
  });

  return server;
}
