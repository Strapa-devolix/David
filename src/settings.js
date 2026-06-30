import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const truthy = new Set(['1', 'true', 'yes', 'y', 'on']);
const replyTriggers = new Set(['all', 'mention_only', 'question_only', 'question_or_mention']);
const aiProviders = new Set(['groq', 'openai', 'local']);
let cachedSettings = null;

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
  return normalizeList(process.env[name] || '');
}

function normalizeList(value) {
  const items = Array.isArray(value) ? value : String(value || '').split(/[\n,]/);
  return [
    ...new Set(
      items
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  ];
}

function clampNumber(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function defaultProvider() {
  const explicit = String(process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (aiProviders.has(explicit)) return explicit;
  if (config.groqApiKeys.length) return 'groq';
  if (config.openaiApiKey) return 'openai';
  return 'local';
}

function defaultTranscriptionLanguage() {
  const language = String(process.env.TRANSCRIPTION_LANGUAGE || '').trim().toLowerCase();
  return language === 'auto' ? '' : language.slice(0, 8);
}

function defaultSettings() {
  return {
    botName: process.env.BOT_NAME || 'David',
    ownerName: process.env.OWNER_NAME || 'me',
    autoReply: boolEnv('AUTO_REPLY', true),
    onlyGroups: boolEnv('ONLY_GROUPS', true),
    allowAllChats: boolEnv('ALLOW_ALL_CHATS', false),
    replyTrigger: replyTriggers.has(process.env.REPLY_TRIGGER)
      ? process.env.REPLY_TRIGGER
      : 'question_or_mention',
    allowedChatIds: listEnv('ALLOWED_CHAT_IDS'),
    blockedChatIds: listEnv('BLOCKED_CHAT_IDS'),
    maxReplyChars: intEnv('MAX_REPLY_CHARS', 1200),
    minSecondsBetweenReplies: intEnv('MIN_SECONDS_BETWEEN_REPLIES', 15),
    aiProvider: defaultProvider(),
    groqModel: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
    openaiModel: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
    transcribeAudio: boolEnv('TRANSCRIBE_AUDIO', true),
    transcriptionModel: process.env.TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo',
    transcriptionLanguage: defaultTranscriptionLanguage(),
    escalationChatId: process.env.ESCALATION_CHAT_ID || '',
  };
}

function settingsPath() {
  return path.join(config.dataDir, 'settings.json');
}

function sanitizeSettings(input = {}, base = defaultSettings()) {
  const settings = { ...base };

  if (Object.hasOwn(input, 'botName')) settings.botName = String(input.botName || 'David').trim() || 'David';
  if (Object.hasOwn(input, 'ownerName')) settings.ownerName = String(input.ownerName || 'me').trim() || 'me';
  if (Object.hasOwn(input, 'autoReply')) settings.autoReply = Boolean(input.autoReply);
  if (Object.hasOwn(input, 'onlyGroups')) settings.onlyGroups = Boolean(input.onlyGroups);
  if (Object.hasOwn(input, 'allowAllChats')) settings.allowAllChats = Boolean(input.allowAllChats);
  if (replyTriggers.has(input.replyTrigger)) settings.replyTrigger = input.replyTrigger;
  if (Object.hasOwn(input, 'allowedChatIds')) settings.allowedChatIds = normalizeList(input.allowedChatIds);
  if (Object.hasOwn(input, 'blockedChatIds')) settings.blockedChatIds = normalizeList(input.blockedChatIds);
  if (Object.hasOwn(input, 'maxReplyChars')) {
    settings.maxReplyChars = clampNumber(input.maxReplyChars, 1200, 200, 4000);
  }
  if (Object.hasOwn(input, 'minSecondsBetweenReplies')) {
    settings.minSecondsBetweenReplies = clampNumber(input.minSecondsBetweenReplies, 15, 0, 3600);
  }
  if (aiProviders.has(input.aiProvider)) settings.aiProvider = input.aiProvider;
  if (Object.hasOwn(input, 'groqModel')) {
    settings.groqModel = String(input.groqModel || 'llama-3.1-8b-instant').trim() || 'llama-3.1-8b-instant';
  }
  if (Object.hasOwn(input, 'openaiModel')) {
    settings.openaiModel = String(input.openaiModel || 'gpt-5.4-mini').trim() || 'gpt-5.4-mini';
  }
  if (Object.hasOwn(input, 'transcribeAudio')) settings.transcribeAudio = Boolean(input.transcribeAudio);
  if (Object.hasOwn(input, 'transcriptionModel')) {
    settings.transcriptionModel =
      String(input.transcriptionModel || 'whisper-large-v3-turbo').trim() || 'whisper-large-v3-turbo';
  }
  if (Object.hasOwn(input, 'transcriptionLanguage')) {
    const language = String(input.transcriptionLanguage || '').trim().toLowerCase();
    settings.transcriptionLanguage = language === 'auto' ? '' : language.slice(0, 8);
  }
  if (Object.hasOwn(input, 'escalationChatId')) {
    settings.escalationChatId = String(input.escalationChatId || '').trim();
  }

  return settings;
}

export async function loadSettings({ force = false } = {}) {
  if (cachedSettings && !force) return cachedSettings;

  await fs.mkdir(config.dataDir, { recursive: true });
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8');
    cachedSettings = sanitizeSettings(JSON.parse(raw), defaultSettings());
  } catch {
    cachedSettings = defaultSettings();
    await saveSettings(cachedSettings);
  }

  return cachedSettings;
}

export async function getSettings() {
  return loadSettings();
}

export async function saveSettings(nextSettings) {
  await fs.mkdir(config.dataDir, { recursive: true });
  cachedSettings = sanitizeSettings(nextSettings, defaultSettings());
  await fs.writeFile(settingsPath(), JSON.stringify(cachedSettings, null, 2));
  return cachedSettings;
}

export async function updateSettings(partialSettings) {
  const current = await loadSettings();
  return saveSettings({ ...current, ...partialSettings });
}

export function getSecretStatus() {
  return {
    groqKeys: config.groqApiKeys.length,
    openai: Boolean(config.openaiApiKey),
  };
}
