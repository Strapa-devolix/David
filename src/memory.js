import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { truncateText } from './text.js';

const maxSnippets = 8;
let cachedMemory = null;

function memoryPath() {
  return path.join(config.dataDir, 'memory.json');
}

function defaultMemory() {
  return {
    version: 1,
    updatedAt: null,
    people: {},
    chats: {},
  };
}

function cleanText(value, max = 500) {
  return truncateText(String(value || '').replace(/\s+/g, ' ').trim(), max);
}

function cleanName(value) {
  const cleaned = cleanText(value, 80);
  if (!cleaned || cleaned.includes('@')) return '';
  return cleaned;
}

function normalizeMemory(input) {
  const base = defaultMemory();
  if (!input || typeof input !== 'object') return base;
  return {
    version: 1,
    updatedAt: input.updatedAt || null,
    people: input.people && typeof input.people === 'object' ? input.people : {},
    chats: input.chats && typeof input.chats === 'object' ? input.chats : {},
  };
}

function extractDeclaredName(text) {
  const patterns = [
    /\b(?:je m[' ]?appelle|moi c[' ]?est|mon nom est|je suis)\s+([\p{L}][\p{L} .'-]{1,50})/iu,
    /\b(?:ana|smiti|smit dyali)\s+([\p{L}][\p{L} .'-]{1,50})/iu,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text || '');
    if (match?.[1]) {
      return cleanName(match[1].split(/[,.!?;:]/)[0]);
    }
  }

  return '';
}

async function ensureMemory() {
  await fs.mkdir(config.dataDir, { recursive: true });
}

export async function loadMemory({ force = false } = {}) {
  if (cachedMemory && !force) return cachedMemory;

  await ensureMemory();
  try {
    const raw = await fs.readFile(memoryPath(), 'utf8');
    cachedMemory = normalizeMemory(JSON.parse(raw));
  } catch {
    cachedMemory = defaultMemory();
    await saveMemory(cachedMemory);
  }

  return cachedMemory;
}

export async function saveMemory(nextMemory) {
  await ensureMemory();
  cachedMemory = normalizeMemory(nextMemory);
  cachedMemory.updatedAt = new Date().toISOString();
  await fs.writeFile(memoryPath(), JSON.stringify(cachedMemory, null, 2));
  return cachedMemory;
}

export async function rememberInteraction({
  chatJid,
  chatName,
  chatType,
  senderJid,
  senderName,
  text,
  source = 'text',
}) {
  const memory = await loadMemory();
  const now = new Date().toISOString();
  const safeChatJid = String(chatJid || '').trim();
  const safeSenderJid = String(senderJid || safeChatJid).trim();
  if (!safeChatJid || !safeSenderJid) return memory;

  const previousChat = memory.chats[safeChatJid] || {};
  memory.chats[safeChatJid] = {
    jid: safeChatJid,
    name: cleanName(chatName) || previousChat.name || '',
    type: chatType || previousChat.type || (safeChatJid.endsWith('@g.us') ? 'group' : 'direct'),
    firstSeenAt: previousChat.firstSeenAt || now,
    lastSeenAt: now,
    messageCount: Number(previousChat.messageCount || 0) + 1,
  };

  const previousPerson = memory.people[safeSenderJid] || {};
  const declaredName = extractDeclaredName(text);
  const snippets = Array.isArray(previousPerson.lastMessages) ? previousPerson.lastMessages : [];
  snippets.push({
    at: now,
    chatJid: safeChatJid,
    chatName: cleanName(chatName) || previousChat.name || '',
    source,
    text: cleanText(text, 220),
  });

  memory.people[safeSenderJid] = {
    jid: safeSenderJid,
    displayName: cleanName(senderName) || previousPerson.displayName || '',
    learnedName: declaredName || previousPerson.learnedName || '',
    firstSeenAt: previousPerson.firstSeenAt || now,
    lastSeenAt: now,
    messageCount: Number(previousPerson.messageCount || 0) + 1,
    chats: [...new Set([...(previousPerson.chats || []), safeChatJid])],
    notes: cleanText(previousPerson.notes || '', 2000),
    lastMessages: snippets.slice(-maxSnippets),
  };

  await saveMemory(memory);
  return memory;
}

export async function buildMemoryContext({ senderJid, chatJid }) {
  const memory = await loadMemory();
  const person = memory.people[String(senderJid || '')] || null;
  const chat = memory.chats[String(chatJid || '')] || null;
  const lines = [];

  if (person) {
    const name = person.learnedName || person.displayName || '';
    lines.push(`Known person: ${name || person.jid}`);
    lines.push(`Person message count: ${person.messageCount || 0}`);
    if (person.notes) lines.push(`Person notes: ${person.notes}`);
    const recent = (person.lastMessages || [])
      .slice(-3)
      .map((item) => `- ${item.text}`)
      .filter(Boolean);
    if (recent.length) lines.push(`Recent person memory:\n${recent.join('\n')}`);
  }

  if (chat) {
    lines.push(`Known chat: ${chat.name || chat.jid}`);
    lines.push(`Chat type: ${chat.type || 'chat'}, messages seen: ${chat.messageCount || 0}`);
  }

  return lines.join('\n');
}

export async function getMemoryDashboard() {
  const memory = await loadMemory();
  return {
    memory,
    stats: {
      people: Object.keys(memory.people || {}).length,
      chats: Object.keys(memory.chats || {}).length,
      updatedAt: memory.updatedAt || '',
    },
  };
}
