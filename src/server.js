import http from 'node:http';
import { URL } from 'node:url';
import qrcode from 'qrcode';
import { config, requireAdminToken } from './config.js';
import { getChats } from './registry.js';

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

function isAuthorized(url) {
  requireAdminToken();
  return url.searchParams.get('token') === config.adminToken;
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

      if (url.pathname === '/qr') {
        if (!isAuthorized(url)) {
          sendJson(res, 401, { ok: false, error: 'Unauthorized' });
          return;
        }
        await sendQrPage(res);
        return;
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
