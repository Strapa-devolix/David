import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { truncateText } from './text.js';

// A manager/commercial asking to take cash out of the register (décaissement).
const requestPatterns = [
  // Explicit French terms.
  /\bdecaiss/i,
  /\bsortie de caisse\b/i,
  /\bsortie caisse\b/i,
  /\bsortie d ?argent\b/i,
  /\bsortie d ?especes?\b/i,
  /\bretrait de caisse\b/i,
  /\bavance de caisse\b/i,
  /\bavance caisse\b/i,
  // Money verbs combined with a cash word.
  /\bsortir\b[^\n]*\b(cash|argent|especes?|flous|caisse)\b/i,
  /\bprendre\b[^\n]*\b(de la caisse|dans la caisse|cash|especes?)\b/i,
  /\b(cash|argent|especes?)\b[^\n]*\bde la caisse\b/i,
  // "j'ai besoin de 500 dh", "il me faut 800 dh".
  /\bbesoin\b[^\n]*\d[^\n]*\b(dh|dhs|mad|dirham|درهم)\b/i,
  /\bil me faut\b[^\n]*\d[^\n]*\b(dh|dhs|mad|dirham|درهم)\b/i,
  // Darija.
  /\bkhrouj\b[^\n]*\bflous\b/i,
  /\bn5rj\b[^\n]*\bflous\b/i,
  /\bnkharrej\b[^\n]*\bflous\b/i,
  /\bkhass(ni|na)?\b[^\n]*\bflous\b/i,
  /\bn7ta?j\b[^\n]*\bflous\b/i,
  /\b3tini\b[^\n]*\bflous\b/i,
];

const statusLabels = {
  requested: 'demandé',
  entered: 'saisi dashboard',
  done: 'traité',
  rejected: 'refusé',
};

// name (lowercased) -> club label. Used to hint Omar which gym asks.
const gymByName = new Map([
  ['sara', 'Fès Saïss (Marjane)'],
  ['ahlam', 'Fès Saïss (Marjane)'],
  ['reda', 'Fès Saïss (Marjane)'],
  ['saber', 'Fès Saïss (Marjane)'],
  ['souffiane', 'Fès Dukkarate'],
  ['soufiane', 'Fès Dukkarate'],
  ['hajar', 'Fès Dukkarate'],
  ['wissale', 'Fès Dukkarate'],
  ['bader', 'Casa Anfa'],
  ['moussa', 'Casa Anfa'],
  ['jaber', 'Casa Anfa'],
  ['oumaima', 'Casa Anfa'],
  ['sahar', 'Casa Lady'],
  ['hiba', 'Casa Lady'],
  ['dalal', 'Casa Lady'],
  ['khadija', 'Casa Lady'],
]);

let cachedStore = null;

function storePath() {
  return path.join(config.dataDir, 'decaissements.json');
}

function defaultStore() {
  return { version: 1, updatedAt: null, requests: {} };
}

function normalizeStore(input) {
  if (!input || typeof input !== 'object' || !input.requests || typeof input.requests !== 'object') {
    return defaultStore();
  }
  return { version: 1, updatedAt: input.updatedAt || null, requests: input.requests };
}

function stripAccents(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function statusLabel(status) {
  return statusLabels[status] || status || 'demandé';
}

export function looksLikeDecaissement(text) {
  const normalized = stripAccents(text).toLowerCase();
  return requestPatterns.some((pattern) => pattern.test(normalized));
}

// Best-effort amount extraction, e.g. "500 dh", "1 200 DH", "montant 800".
export function extractAmount(text) {
  const raw = String(text || '');
  const currency = /(\d[\d\s.,]*)\s*(dh|dhs|mad|dirham|درهم)/i.exec(raw);
  if (currency) return `${currency[1].replace(/\s+/g, ' ').trim()} DH`;
  const montant = /\bmontant\b[^\d]{0,10}(\d[\d\s.,]*)/i.exec(raw);
  if (montant) return `${montant[1].replace(/\s+/g, ' ').trim()} DH`;
  return '';
}

function inferGym(senderName, chatName) {
  const name = stripAccents(senderName).toLowerCase();
  for (const [key, label] of gymByName) {
    if (name.includes(key)) return label;
  }
  const chat = stripAccents(chatName).toLowerCase();
  if (/(saiss|marjane)/.test(chat)) return 'Fès Saïss (Marjane)';
  if (/(dokk|dukk|dokar)/.test(chat)) return 'Fès Dukkarate';
  if (/(anfa|casa 1|casa1)/.test(chat)) return 'Casa Anfa';
  if (/(lady|casa 2|casa2)/.test(chat)) return 'Casa Lady';
  return '';
}

export async function loadDecaissements({ force = false } = {}) {
  if (cachedStore && !force) return cachedStore;
  await fs.mkdir(config.dataDir, { recursive: true });
  try {
    const raw = await fs.readFile(storePath(), 'utf8');
    cachedStore = normalizeStore(JSON.parse(raw));
  } catch {
    cachedStore = defaultStore();
    await persist();
  }
  return cachedStore;
}

async function persist() {
  await fs.mkdir(config.dataDir, { recursive: true });
  cachedStore.updatedAt = new Date().toISOString();
  await fs.writeFile(storePath(), JSON.stringify(cachedStore, null, 2));
  return cachedStore;
}

export async function saveDecaissement({ chatJid, chatName, senderJid, senderName, text, source }) {
  const store = await loadDecaissements();
  const now = new Date().toISOString();
  const request = {
    id: `DEC-${Date.now().toString(36).toUpperCase()}`,
    createdAt: now,
    updatedAt: now,
    chatJid: chatJid || '',
    chatName: chatName || '',
    senderJid: senderJid || '',
    senderName: senderName || '',
    gymHint: inferGym(senderName, chatName),
    amount: extractAmount(text),
    source: source || 'texte',
    text: truncateText(String(text || ''), 500),
    status: 'requested',
    note: '',
  };
  store.requests[request.id] = request;
  await persist();
  return request;
}

export async function findDecaissement(id) {
  if (!id) return null;
  const store = await loadDecaissements();
  return store.requests[String(id).toUpperCase()] || null;
}

export async function updateDecaissementStatus(id, status, note = '') {
  const store = await loadDecaissements();
  const key = String(id || '').toUpperCase();
  const request = store.requests[key];
  if (!request || !statusLabels[status]) return null;
  request.status = status;
  if (note) request.note = truncateText(String(note), 400);
  request.updatedAt = new Date().toISOString();
  await persist();
  return request;
}

export async function listDecaissements({ status, limit = 30 } = {}) {
  const store = await loadDecaissements();
  let items = Object.values(store.requests);
  if (status) items = items.filter((request) => request.status === status);
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
}

// WhatsApp alert sent to Omar / the escalation chat.
export function formatDecaissementAlert(request) {
  return [
    `💸 Demande de décaissement ${request.id}`,
    `Demandeur: ${request.senderName || 'inconnu'}`,
    `Club: ${request.gymHint || request.chatName || 'à préciser'}`,
    `Montant: ${request.amount || 'non précisé'}`,
    '',
    'Demande:',
    request.text,
    '',
    'À saisir dans le dashboard Décaissement.',
    `Saisi: /decsaisi ${request.id}   ·   Traité: /decfait ${request.id} [note]`,
  ].join('\n');
}

const gymLabels = {
  dokarat: 'Fès Dukkarate',
  marjane: 'Fès Saïss (Marjane)',
  casa1: 'Casa Anfa',
  casa2: 'Casa Lady',
};

const dashboardStatusLabels = {
  pending: 'EN ATTENTE ⏳',
  approved: 'APPROUVÉ ✅',
  rejected: 'REFUSÉ ❌',
};

// Message posted to the WhatsApp group when a décaissement happens in the dashboard.
export function formatDashboardDecaissement({ montant, raison, requestedBy, gymId, status, event } = {}) {
  const gym = gymLabels[gymId] || gymId || '';
  const head =
    event === 'approved'
      ? '✅ Décaissement approuvé (dashboard)'
      : event === 'rejected'
        ? '❌ Décaissement refusé (dashboard)'
        : '💸 Nouveau décaissement (dashboard)';
  const amount = montant === 0 || montant ? `${montant} DH` : 'non précisé';
  return [
    head,
    `Montant: ${amount}`,
    raison ? `Raison: ${raison}` : '',
    requestedBy ? `Demandé par: ${requestedBy}` : '',
    gym ? `Club: ${gym}` : '',
    `Statut: ${dashboardStatusLabels[status] || status || ''}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function formatDecaissementLine(request) {
  const club = request.gymHint || request.chatName || '';
  return `${request.id} [${statusLabel(request.status)}] ${request.senderName || ''}${club ? ` · ${club}` : ''} · ${request.amount || 'montant ?'}`;
}

// Omar commands in the escalation chat:
// /decs · /dec DEC-XXX · /decsaisi DEC-XXX · /decfait DEC-XXX [note] · /decrefus DEC-XXX [note]
export function parseDecaissementCommand(text) {
  const raw = String(text || '').trim();
  if (!raw.startsWith('/')) return null;
  const [rawCmd, ...rest] = raw.slice(1).split(/\s+/);
  const cmd = stripAccents(rawCmd).toLowerCase();

  const listCmds = new Set(['decs', 'decaissements', 'decaissement']);
  const showCmds = new Set(['dec', 'decshow', 'decvoir']);
  const enteredCmds = new Set(['decsaisi', 'decsaisie', 'decentered']);
  const doneCmds = new Set(['decfait', 'decdone', 'dectraite']);
  const rejectCmds = new Set(['decrefus', 'decrefuse', 'decreject']);

  if (listCmds.has(cmd)) return { action: 'list' };

  const idToken = rest[0] ? normalizeId(rest[0]) : '';
  const note = rest.slice(1).join(' ').trim();

  if (showCmds.has(cmd)) return { action: 'show', id: idToken };
  if (enteredCmds.has(cmd)) return { action: 'entered', id: idToken, note };
  if (doneCmds.has(cmd)) return { action: 'done', id: idToken, note };
  if (rejectCmds.has(cmd)) return { action: 'rejected', id: idToken, note };
  return null;
}

function normalizeId(token) {
  const clean = String(token || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!clean) return '';
  return clean.startsWith('DEC-') ? clean : `DEC-${clean}`;
}
