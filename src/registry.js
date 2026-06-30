import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const chats = new Map();

async function ensureDataDir() {
  await fs.mkdir(config.dataDir, { recursive: true });
}

function registryPath() {
  return path.join(config.dataDir, 'chats.json');
}

export async function loadRegistry() {
  try {
    const raw = await fs.readFile(registryPath(), 'utf8');
    const parsed = JSON.parse(raw);
    for (const chat of parsed.chats || []) {
      chats.set(chat.jid, chat);
    }
  } catch {
    // First run has no registry yet.
  }
}

export async function rememberChat({ jid, name, type }) {
  const previous = chats.get(jid) || {};
  chats.set(jid, {
    jid,
    name: name || previous.name || '',
    type: type || previous.type || (jid.endsWith('@g.us') ? 'group' : 'direct'),
    lastSeenAt: new Date().toISOString(),
  });

  await ensureDataDir();
  await fs.writeFile(registryPath(), JSON.stringify({ chats: getChats() }, null, 2));
}

export function getChats() {
  return [...chats.values()].sort((a, b) => {
    return String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || ''));
  });
}
