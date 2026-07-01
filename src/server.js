import http from 'node:http';
import { URL } from 'node:url';
import qrcode from 'qrcode';
import { config, requireAdminToken } from './config.js';
import { loadKnowledge, saveKnowledge } from './knowledge.js';
import { getMemoryDashboard, saveMemory } from './memory.js';
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

async function getQrImage() {
  if (!currentQr) return '';
  return qrcode.toDataURL(currentQr, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 356,
    color: {
      dark: '#123b3b',
      light: '#ffffff',
    },
  });
}

async function sendQrData(res) {
  sendJson(res, 200, {
    ok: true,
    service: 'david',
    connectionState,
    hasQr: Boolean(currentQr),
    image: await getQrImage(),
    lastError,
  });
}

async function sendQrPage(res, token) {
  const safeToken = escapeHtml(encodeURIComponent(token));
  const tokenJson = JSON.stringify(token).replaceAll('<', '\\u003c');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html>
<html>
  <head>
    <title>David QR</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: dark; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; min-height: 100vh; background: #1c1f1f; color: #f7f8f8; display: grid; place-items: center; }
      main { width: min(960px, calc(100vw - 32px)); background: #111414; border: 1px solid #2b3030; border-radius: 14px; padding: 28px; box-sizing: border-box; }
      .back { color: #b8c0c0; text-decoration: none; font-size: 28px; line-height: 1; }
      .layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 42px; align-items: center; padding: 26px 78px 18px; }
      h1 { margin: 0 0 30px; font-size: 30px; font-weight: 500; letter-spacing: 0; }
      ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 22px; }
      li { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 14px; align-items: start; font-size: 17px; line-height: 1.35; }
      .step { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: #f7f8f8; color: #111414; font-size: 13px; font-weight: 700; margin-top: 1px; }
      .help { display: inline-flex; color: #23d366; text-decoration: underline; text-underline-offset: 4px; margin-top: 22px; font-weight: 600; }
      .qrWrap { display: grid; justify-items: center; gap: 18px; }
      .qrFrame { width: 286px; height: 286px; border-radius: 8px; background: #ffffff; border: 6px solid #ffffff; display: grid; place-items: center; box-sizing: border-box; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2); }
      .qrFrame img { width: 100%; height: 100%; display: block; image-rendering: pixelated; border-radius: 3px; }
      .qrEmpty { color: #d0d5d5; text-align: center; padding: 24px; font-size: 15px; line-height: 1.45; }
      .status { min-height: 20px; color: #9ba5a5; font-size: 14px; text-align: center; }
      .phone { color: #23d366; text-decoration: none; font-weight: 600; }
      .actions { display: flex; justify-content: center; gap: 12px; margin-top: 24px; }
      .button { border: 1px solid #354040; color: #f7f8f8; background: transparent; border-radius: 6px; padding: 9px 12px; text-decoration: none; font-size: 14px; }
      @media (max-width: 820px) {
        body { place-items: start center; }
        main { border-radius: 0; border-left: 0; border-right: 0; width: 100%; min-height: 100vh; }
        .layout { grid-template-columns: 1fr; padding: 22px 4px; gap: 30px; }
        h1 { font-size: 26px; }
        .qrFrame { width: min(286px, calc(100vw - 72px)); height: min(286px, calc(100vw - 72px)); }
      }
    </style>
  </head>
  <body>
    <main>
      <a class="back" href="/dashboard?token=${safeToken}" aria-label="Back to dashboard">&lt;</a>
      <div class="layout">
        <section>
          <h1>Link David to WhatsApp</h1>
          <ol>
            <li><span class="step">1</span><span>Open WhatsApp on your phone.</span></li>
            <li><span class="step">2</span><span>Go to Settings, then Linked devices.</span></li>
            <li><span class="step">3</span><span>Tap Link a device and scan this QR code.</span></li>
          </ol>
          <a class="help" href="/health">Check connection status</a>
        </section>
        <section class="qrWrap">
          <div class="qrFrame" id="qrFrame">
            <div class="qrEmpty">Waiting for a QR code from David...</div>
          </div>
          <div class="status" id="status">Connecting...</div>
          <a class="phone" href="/dashboard?token=${safeToken}">Open dashboard</a>
        </section>
      </div>
      <div class="actions">
        <a class="button" href="/health">Health</a>
        <a class="button" href="/dashboard?token=${safeToken}">Dashboard</a>
      </div>
    </main>
    <script>
      const token = ${tokenJson};
      const qrFrame = document.getElementById('qrFrame');
      const statusEl = document.getElementById('status');

      async function refreshQr() {
        try {
          const response = await fetch('/qr-data?token=' + encodeURIComponent(token), { cache: 'no-store' });
          const data = await response.json();
          statusEl.textContent = data.connectionState === 'open'
            ? 'Connected. You can close this page.'
            : data.hasQr
              ? 'Scan this QR with WhatsApp Linked devices.'
              : 'Waiting for a fresh QR code...';

          if (data.image) {
            qrFrame.innerHTML = '<img alt="David WhatsApp linking QR" />';
            qrFrame.querySelector('img').src = data.image;
          } else if (data.connectionState === 'open') {
            qrFrame.innerHTML = '<div class="qrEmpty">David is already connected.</div>';
          } else {
            qrFrame.innerHTML = '<div class="qrEmpty">Waiting for a QR code from David...</div>';
          }
        } catch (error) {
          statusEl.textContent = 'Could not refresh QR. Reload the page.';
        }
      }

      refreshQr();
      setInterval(refreshQr, 3500);
    </script>
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
      .liveBar { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; border-top: 1px solid #2a2e36; padding: 16px 0 18px; }
      .metric { border: 1px solid #2a2e36; border-radius: 6px; padding: 10px 12px; background: #11151d; }
      .metric span { display: block; color: #99a2b3; font-size: 12px; margin-bottom: 5px; }
      .metric strong { font-size: 15px; font-weight: 600; overflow-wrap: anywhere; }
      .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #7b8494; margin-right: 8px; vertical-align: middle; }
      .dot.open { background: #23d366; }
      .dot.close, .dot.error { background: #f25f5c; }
      .dot.connecting, .dot.starting, .dot.reconnecting { background: #f5b841; }
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
      @media (max-width: 760px) { main { padding: 18px; } .grid, .checks, .liveBar { grid-template-columns: 1fr; } header { align-items: flex-start; flex-direction: column; } }
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

      <div class="liveBar">
        <div class="metric"><span>Connection</span><strong><i class="dot" id="connectionDot"></i><span id="connectionState">Loading</span></strong></div>
        <div class="metric"><span>Uptime</span><strong id="uptime">--</strong></div>
        <div class="metric"><span>Observed chats</span><strong id="chatCount">--</strong></div>
        <div class="metric"><span>Last update</span><strong id="lastUpdate">--</strong></div>
      </div>

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
          <label>Transcription model<input id="transcriptionModel" /></label>
          <label>Transcription language<input id="transcriptionLanguage" placeholder="empty/auto, fr, ar..." /></label>
          <label>Max reply characters<input id="maxReplyChars" type="number" min="200" max="4000" /></label>
          <label>Seconds between replies<input id="minSecondsBetweenReplies" type="number" min="0" max="3600" /></label>
          <label>Reply delay min seconds<input id="replyDelayMinSeconds" type="number" min="0" max="3600" /></label>
          <label>Reply delay max seconds<input id="replyDelayMaxSeconds" type="number" min="0" max="7200" /></label>
          <label>Burst size<input id="burstSize" type="number" min="0" max="100" /></label>
          <label>Burst cooldown min seconds<input id="burstCooldownMinSeconds" type="number" min="0" max="7200" /></label>
          <label>Burst cooldown max seconds<input id="burstCooldownMaxSeconds" type="number" min="0" max="14400" /></label>
          <label>Hourly reply limit<input id="hourlyReplyLimit" type="number" min="0" max="1000" /></label>
          <label>Daily reply limit<input id="dailyReplyLimit" type="number" min="0" max="10000" /></label>
        </div>
        <div class="checks" style="margin-top: 16px;">
          <label class="check"><input id="autoReply" type="checkbox" /> Auto reply</label>
          <label class="check"><input id="onlyGroups" type="checkbox" /> Groups only</label>
          <label class="check"><input id="allowAllChats" type="checkbox" /> Allow all chats</label>
          <label class="check"><input id="transcribeAudio" type="checkbox" /> Transcribe audio</label>
          <label class="check"><input id="safeSendMode" type="checkbox" /> Safe send queue</label>
        </div>
      </section>

      <section>
        <h2>Chats</h2>
        <div class="grid">
          <label>Allowed chat IDs<textarea id="allowedChatIds" placeholder="One chat ID per line"></textarea></label>
          <label>Blocked chat IDs<textarea id="blockedChatIds" placeholder="One chat ID per line"></textarea></label>
          <label>Issue summary chat ID<input id="escalationChatId" placeholder="Internal group or your private chat ID" /></label>
          <label>Ticket command sender IDs<textarea id="commandSenderIds" placeholder="One sender ID per line. Needed for group escalation chats."></textarea></label>
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

      <section>
        <h2>Memory</h2>
        <div class="status" id="memoryStats">Loading memory...</div>
        <textarea id="memoryJson" style="min-height: 260px;" spellcheck="false" placeholder="People and chat memory JSON"></textarea>
        <div class="actions">
          <button class="secondary" id="refreshMemory" type="button">Refresh memory</button>
        </div>
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
        'transcriptionModel', 'transcriptionLanguage', 'maxReplyChars', 'minSecondsBetweenReplies',
        'replyDelayMinSeconds', 'replyDelayMaxSeconds', 'burstSize', 'burstCooldownMinSeconds',
        'burstCooldownMaxSeconds', 'hourlyReplyLimit', 'dailyReplyLimit', 'autoReply', 'onlyGroups',
        'allowAllChats', 'transcribeAudio', 'safeSendMode', 'allowedChatIds', 'blockedChatIds',
        'escalationChatId', 'commandSenderIds', 'knowledge', 'memoryJson'
      ];
      const el = Object.fromEntries(ids.map(function (id) { return [id, document.getElementById(id)]; }));
      const statusEl = document.getElementById('status');
      const chatsEl = document.getElementById('chats');
      const connectionStateEl = document.getElementById('connectionState');
      const connectionDotEl = document.getElementById('connectionDot');
      const uptimeEl = document.getElementById('uptime');
      const chatCountEl = document.getElementById('chatCount');
      const lastUpdateEl = document.getElementById('lastUpdate');
      const memoryStatsEl = document.getElementById('memoryStats');
      let isDirty = false;
      let saving = false;

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

      function formatUptime(seconds) {
        const value = Number(seconds || 0);
        const hours = Math.floor(value / 3600);
        const minutes = Math.floor((value % 3600) / 60);
        const secs = value % 60;
        if (hours) return hours + 'h ' + minutes + 'm';
        if (minutes) return minutes + 'm ' + secs + 's';
        return secs + 's';
      }

      function setLiveStatus(health, chats) {
        const state = health.connectionState || 'unknown';
        connectionStateEl.textContent = state;
        connectionDotEl.className = 'dot ' + state;
        uptimeEl.textContent = formatUptime(health.uptimeSeconds);
        chatCountEl.textContent = String((chats || []).length);
        lastUpdateEl.textContent = new Date().toLocaleTimeString();
        if (health.lastError) setStatus('Last error: ' + health.lastError);
      }

      function fillSettings(settings, secrets) {
        el.botName.value = settings.botName;
        el.ownerName.value = settings.ownerName;
        el.replyTrigger.value = settings.replyTrigger;
        el.aiProvider.value = settings.aiProvider;
        el.groqModel.value = settings.groqModel;
        el.openaiModel.value = settings.openaiModel;
        el.transcriptionModel.value = settings.transcriptionModel;
        el.transcriptionLanguage.value = settings.transcriptionLanguage;
        el.maxReplyChars.value = settings.maxReplyChars;
        el.minSecondsBetweenReplies.value = settings.minSecondsBetweenReplies;
        el.replyDelayMinSeconds.value = settings.replyDelayMinSeconds;
        el.replyDelayMaxSeconds.value = settings.replyDelayMaxSeconds;
        el.burstSize.value = settings.burstSize;
        el.burstCooldownMinSeconds.value = settings.burstCooldownMinSeconds;
        el.burstCooldownMaxSeconds.value = settings.burstCooldownMaxSeconds;
        el.hourlyReplyLimit.value = settings.hourlyReplyLimit;
        el.dailyReplyLimit.value = settings.dailyReplyLimit;
        el.autoReply.checked = settings.autoReply;
        el.onlyGroups.checked = settings.onlyGroups;
        el.allowAllChats.checked = settings.allowAllChats;
        el.transcribeAudio.checked = settings.transcribeAudio;
        el.safeSendMode.checked = settings.safeSendMode;
        el.allowedChatIds.value = settings.allowedChatIds.join('\\n');
        el.blockedChatIds.value = settings.blockedChatIds.join('\\n');
        el.escalationChatId.value = settings.escalationChatId;
        el.commandSenderIds.value = (settings.commandSenderIds || []).join('\\n');
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
          const notifyButton = document.createElement('button');
          notifyButton.className = 'secondary';
          notifyButton.type = 'button';
          notifyButton.textContent = 'Notify here';
          notifyButton.addEventListener('click', function () {
            el.escalationChatId.value = chat.jid;
            setStatus('Issue summary chat selected. Save settings to apply it.');
          });
          const actions = document.createElement('div');
          actions.className = 'actions';
          actions.style.marginTop = '0';
          actions.append(button, notifyButton);
          row.append(info, actions);
          chatsEl.append(row);
        });
      }

      function fillMemory(response, updateTextarea) {
        const stats = response.stats || {};
        const updated = stats.updatedAt ? ', updated ' + stats.updatedAt : '';
        memoryStatsEl.textContent =
          String(stats.people || 0) + ' people, ' + String(stats.chats || 0) + ' chats' + updated;
        if (updateTextarea !== false) {
          el.memoryJson.value = JSON.stringify(response.memory || { version: 1, people: {}, chats: {} }, null, 2);
        }
      }

      async function loadAll() {
        setStatus('Loading...');
        const settingsResponse = await api('/settings');
        const knowledgeResponse = await api('/knowledge');
        const memoryResponse = await api('/memory');
        fillSettings(settingsResponse.settings, settingsResponse.secrets);
        el.knowledge.value = knowledgeResponse.markdown || '';
        fillMemory(memoryResponse);
        isDirty = false;
        await refreshLive();
        setStatus('Ready');
      }

      async function refreshChats() {
        const response = await api('/chats');
        renderChats(response.chats || []);
        chatCountEl.textContent = String((response.chats || []).length);
        lastUpdateEl.textContent = new Date().toLocaleTimeString();
        return response.chats || [];
      }

      async function refreshLive() {
        const healthPromise = fetch('/health', { cache: 'no-store' }).then(function (res) { return res.json(); });
        const chatsPromise = api('/chats');
        const settingsPromise = isDirty ? Promise.resolve(null) : api('/settings');
        const memoryPromise = isDirty ? Promise.resolve(null) : api('/memory');
        const responses = await Promise.all([healthPromise, chatsPromise, settingsPromise, memoryPromise]);
        const health = responses[0];
        const chats = responses[1].chats || [];
        const settingsResponse = responses[2];
        const memoryResponse = responses[3];
        if (settingsResponse && !isDirty) fillSettings(settingsResponse.settings, settingsResponse.secrets);
        if (memoryResponse && !isDirty) fillMemory(memoryResponse);
        renderChats(chats);
        setLiveStatus(health, chats);
      }

      async function saveAll() {
        saving = true;
        setStatus('Saving...');
        try {
          const memory = JSON.parse(el.memoryJson.value || '{}');
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
              transcriptionModel: el.transcriptionModel.value,
              transcriptionLanguage: el.transcriptionLanguage.value,
              maxReplyChars: el.maxReplyChars.value,
              minSecondsBetweenReplies: el.minSecondsBetweenReplies.value,
              replyDelayMinSeconds: el.replyDelayMinSeconds.value,
              replyDelayMaxSeconds: el.replyDelayMaxSeconds.value,
              burstSize: el.burstSize.value,
              burstCooldownMinSeconds: el.burstCooldownMinSeconds.value,
              burstCooldownMaxSeconds: el.burstCooldownMaxSeconds.value,
              hourlyReplyLimit: el.hourlyReplyLimit.value,
              dailyReplyLimit: el.dailyReplyLimit.value,
              autoReply: el.autoReply.checked,
              onlyGroups: el.onlyGroups.checked,
              allowAllChats: el.allowAllChats.checked,
              transcribeAudio: el.transcribeAudio.checked,
              safeSendMode: el.safeSendMode.checked,
              allowedChatIds: lines(el.allowedChatIds.value),
              blockedChatIds: lines(el.blockedChatIds.value),
              escalationChatId: el.escalationChatId.value,
              commandSenderIds: lines(el.commandSenderIds.value)
            })
          });
          await api('/knowledge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ markdown: el.knowledge.value })
          });
          await api('/memory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ memory: memory })
          });
          setStatus('Saved');
          isDirty = false;
          await refreshLive();
        } finally {
          saving = false;
        }
      }

      Object.values(el).forEach(function (field) {
        field.addEventListener('input', function () {
          if (!saving) {
            isDirty = true;
            setStatus('Unsaved changes');
          }
        });
        field.addEventListener('change', function () {
          if (!saving) {
            isDirty = true;
            setStatus('Unsaved changes');
          }
        });
      });
      document.getElementById('save').addEventListener('click', function () {
        saveAll().catch(function (error) { setStatus(error.message); });
      });
      document.getElementById('refreshChats').addEventListener('click', function () {
        refreshLive().catch(function (error) { setStatus(error.message); });
      });
      document.getElementById('refreshMemory').addEventListener('click', function () {
        api('/memory')
          .then(function (response) {
            fillMemory(response);
            setStatus('Memory refreshed');
          })
          .catch(function (error) { setStatus(error.message); });
      });
      loadAll().catch(function (error) { setStatus(error.message); });
      setInterval(function () {
        refreshLive().catch(function (error) { setStatus(error.message); });
      }, 5000);
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
        await sendQrPage(res, url.searchParams.get('token') || '');
        return;
      }

      if (url.pathname === '/qr-data') {
        if (!isAuthorized(url)) {
          sendJson(res, 401, { ok: false, error: 'Unauthorized' });
          return;
        }
        await sendQrData(res);
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

      if (url.pathname === '/memory') {
        if (!isAuthorized(url)) {
          sendJson(res, 401, { ok: false, error: 'Unauthorized' });
          return;
        }
        if (req.method === 'GET') {
          sendJson(res, 200, { ok: true, ...(await getMemoryDashboard()) });
          return;
        }
        if (req.method === 'POST') {
          const body = await readJson(req);
          const memory = await saveMemory(body.memory || body);
          const dashboard = await getMemoryDashboard();
          sendJson(res, 200, { ok: true, memory, stats: dashboard.stats });
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
