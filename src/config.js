import 'dotenv/config';
import path from 'node:path';

const truthy = new Set(['1', 'true', 'yes', 'y', 'on']);

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return truthy.has(String(raw).trim().toLowerCase());
}

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function listEnv(name) {
  return new Set(
    String(process.env[name] || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function arrayEnv(...names) {
  const values = [];
  for (const name of names) {
    values.push(
      ...String(process.env[name] || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    );
  }

  return [...new Set(values)];
}

function resolveAiProvider() {
  const explicit = String(process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (explicit) return explicit;
  if (process.env.GROQ_API_KEY || process.env.GROQ_API_KEYS) return 'groq';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return 'local';
}

export const config = {
  port: intEnv('PORT', 3000),
  adminToken: process.env.ADMIN_TOKEN || '',
  sessionDir: process.env.SESSION_DIR || path.resolve('sessions'),
  dataDir: process.env.DATA_DIR || path.resolve('data'),
  knowledgePath: process.env.KNOWLEDGE_PATH || path.resolve('data', 'knowledge.md'),
  botName: process.env.BOT_NAME || 'David',
  ownerName: process.env.OWNER_NAME || 'me',
  autoReply: boolEnv('AUTO_REPLY', true),
  onlyGroups: boolEnv('ONLY_GROUPS', true),
  allowAllChats: boolEnv('ALLOW_ALL_CHATS', false),
  replyTrigger: process.env.REPLY_TRIGGER || 'question_or_mention',
  allowedChatIds: listEnv('ALLOWED_CHAT_IDS'),
  blockedChatIds: listEnv('BLOCKED_CHAT_IDS'),
  maxReplyChars: intEnv('MAX_REPLY_CHARS', 1200),
  minSecondsBetweenReplies: intEnv('MIN_SECONDS_BETWEEN_REPLIES', 15),
  aiProvider: resolveAiProvider(),
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
  groqApiKeys: arrayEnv('GROQ_API_KEY', 'GROQ_API_KEYS'),
  groqModel: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
};

export function requireAdminToken() {
  if (!config.adminToken) {
    throw new Error('ADMIN_TOKEN is required before exposing QR or chat admin endpoints.');
  }
}
