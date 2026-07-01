import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { truncateText } from './text.js';

const issuePatterns = [
  /\berreur\b/i,
  /\bbug\b/i,
  /\bprobleme\b/i,
  /\bbloque\b/i,
  /\bimpossible\b/i,
  /\bne fonctionne pas\b/i,
  /\bfonctionne pas\b/i,
  /\bmarche pas\b/i,
  /\bcrash\b/i,
  /\bfailed\b/i,
  /\berror\b/i,
  /\bissue\b/i,
  /\bblocked\b/i,
  /\bmakhdamch\b/i,
  /\bma khdamch\b/i,
  /\bmachi khdam\b/i,
  /\bmouchkil\b/i,
  /\bmochkil\b/i,
];

const statusLabels = {
  open: 'ouvert',
  in_progress: 'en cours',
  resolved: 'regle',
};

let cachedIssues = null;

function issuesPath() {
  return path.join(config.dataDir, 'issues.json');
}

function legacyPath() {
  return path.join(config.dataDir, 'issues.jsonl');
}

function defaultStore() {
  return { version: 1, updatedAt: null, tickets: {} };
}

function normalizeStore(input) {
  if (!input || typeof input !== 'object' || !input.tickets || typeof input.tickets !== 'object') {
    return defaultStore();
  }
  return { version: 1, updatedAt: input.updatedAt || null, tickets: input.tickets };
}

function stripAccents(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function looksLikeIssue(text) {
  const normalized = stripAccents(text);
  return issuePatterns.some((pattern) => pattern.test(normalized));
}

export function statusLabel(status) {
  return statusLabels[status] || status || 'ouvert';
}

async function importLegacy(store) {
  try {
    const raw = await fs.readFile(legacyPath(), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const old = JSON.parse(trimmed);
        if (old.id && !store.tickets[old.id]) {
          store.tickets[old.id] = {
            id: old.id,
            createdAt: old.createdAt || new Date().toISOString(),
            updatedAt: old.createdAt || new Date().toISOString(),
            chatJid: old.chatJid || '',
            chatName: old.chatName || '',
            senderJid: old.senderJid || '',
            senderName: old.senderName || '',
            source: old.source || 'texte',
            text: old.text || '',
            status: 'open',
            resolution: '',
          };
        }
      } catch {
        // Skip malformed legacy lines.
      }
    }
  } catch {
    // First run, no legacy file.
  }
  return store;
}

export async function loadIssues({ force = false } = {}) {
  if (cachedIssues && !force) return cachedIssues;
  await fs.mkdir(config.dataDir, { recursive: true });

  try {
    const raw = await fs.readFile(issuesPath(), 'utf8');
    cachedIssues = normalizeStore(JSON.parse(raw));
  } catch {
    cachedIssues = await importLegacy(defaultStore());
    await persist();
  }

  return cachedIssues;
}

async function persist() {
  await fs.mkdir(config.dataDir, { recursive: true });
  cachedIssues.updatedAt = new Date().toISOString();
  await fs.writeFile(issuesPath(), JSON.stringify(cachedIssues, null, 2));
  return cachedIssues;
}

export async function saveIssue({ chatJid, chatName, senderJid, senderName, text, source }) {
  const store = await loadIssues();
  const now = new Date().toISOString();
  const issue = {
    id: `ISSUE-${Date.now().toString(36).toUpperCase()}`,
    createdAt: now,
    updatedAt: now,
    chatJid: chatJid || '',
    chatName: chatName || '',
    senderJid: senderJid || '',
    senderName: senderName || '',
    source: source || 'texte',
    text: text || '',
    status: 'open',
    resolution: '',
  };
  store.tickets[issue.id] = issue;
  await persist();
  return issue;
}

export async function findIssue(id) {
  if (!id) return null;
  const store = await loadIssues();
  return store.tickets[String(id).toUpperCase()] || null;
}

export async function updateIssueStatus(id, status, resolution = '') {
  const store = await loadIssues();
  const key = String(id || '').toUpperCase();
  const issue = store.tickets[key];
  if (!issue || !statusLabels[status]) return null;
  issue.status = status;
  if (resolution) issue.resolution = truncateText(String(resolution), 400);
  issue.updatedAt = new Date().toISOString();
  await persist();
  return issue;
}

function activeStatus(issue) {
  return issue.status === 'open' || issue.status === 'in_progress';
}

function matchesRequester(issue, { chatJid, senderJid } = {}) {
  const groupChat = Boolean(chatJid && chatJid.endsWith('@g.us') && senderJid && senderJid !== chatJid);
  if (groupChat) return Boolean(senderJid && issue.senderJid === senderJid);
  if (senderJid && issue.senderJid === senderJid) return true;
  if (chatJid && issue.chatJid === chatJid) return true;
  return false;
}

export async function getActiveIssues({ chatJid, senderJid } = {}) {
  const store = await loadIssues();
  return Object.values(store.tickets)
    .filter(activeStatus)
    .filter((issue) => matchesRequester(issue, { chatJid, senderJid }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getRecentlyResolved({ chatJid, senderJid, sinceHours = 72 } = {}) {
  const store = await loadIssues();
  const cutoff = Date.now() - sinceHours * 3600 * 1000;
  return Object.values(store.tickets)
    .filter((issue) => issue.status === 'resolved')
    .filter((issue) => new Date(issue.updatedAt).getTime() >= cutoff)
    .filter((issue) => matchesRequester(issue, { chatJid, senderJid }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function listIssues({ status, limit = 30 } = {}) {
  const store = await loadIssues();
  let items = Object.values(store.tickets);
  if (status) items = items.filter((issue) => issue.status === status);
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit);
}

export async function buildIssueContext({ chatJid, senderJid }) {
  const active = await getActiveIssues({ chatJid, senderJid });
  const resolved = await getRecentlyResolved({ chatJid, senderJid });
  if (!active.length && !resolved.length) return '';

  const lines = [];
  if (active.length) {
    lines.push("Tickets encore ouverts pour cette personne. Tu peux relancer, mais ne dis pas que c'est regle.");
    for (const issue of active.slice(0, 4)) {
      lines.push(`- [${statusLabel(issue.status)}] ${truncateText(issue.text, 120)}`);
    }
  }
  if (resolved.length) {
    lines.push('Tickets recemment REGLES pour cette personne. Tu peux le lui annoncer naturellement.');
    for (const issue of resolved.slice(0, 4)) {
      const fix = issue.resolution ? ` - ${truncateText(issue.resolution, 120)}` : '';
      lines.push(`- [regle] ${truncateText(issue.text, 100)}${fix}`);
    }
  }
  return lines.join('\n');
}

export function parseIssueCommand(text) {
  const raw = String(text || '').trim();
  if (!raw.startsWith('/')) return null;
  const [rawCmd, ...rest] = raw.slice(1).split(/\s+/);
  const cmd = stripAccents(rawCmd).toLowerCase();

  const listCmds = new Set(['tickets', 'issues', 'open', 'ouverts']);
  const resolveCmds = new Set(['regle', 'resolu', 'done', 'fait', 'close', 'ok']);
  const progressCmds = new Set(['encours', 'wip', 'progress']);
  const showCmds = new Set(['ticket', 'show', 'voir']);

  if (listCmds.has(cmd)) return { action: 'list' };

  const idToken = rest[0] ? normalizeId(rest[0]) : '';
  const note = rest.slice(1).join(' ').trim();

  if (resolveCmds.has(cmd)) return { action: 'resolve', id: idToken, note };
  if (progressCmds.has(cmd)) return { action: 'progress', id: idToken, note };
  if (showCmds.has(cmd)) return { action: 'show', id: idToken };
  return null;
}

function normalizeId(token) {
  const clean = String(token || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!clean) return '';
  return clean.startsWith('ISSUE-') ? clean : `ISSUE-${clean}`;
}

export function formatIssueSummary(issue) {
  return [
    `Nouveau ticket ${issue.id} [${statusLabel(issue.status)}]`,
    `Groupe/client: ${issue.chatName || issue.chatJid}`,
    `De: ${issue.senderName || 'client'}`,
    `Source: ${issue.source || 'texte'}`,
    '',
    'Resume:',
    issue.text,
    '',
    `Pour cloturer: /regle ${issue.id} [note]`,
  ].join('\n');
}

export function formatIssueLine(issue) {
  return `${issue.id} [${statusLabel(issue.status)}] ${issue.chatName || issue.senderName || ''} - ${truncateText(issue.text, 90)}`;
}
