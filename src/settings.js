import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const truthy = new Set(['1', 'true', 'yes', 'y', 'on']);
const replyTriggers = new Set(['all', 'mention_only', 'question_only', 'question_or_mention']);
const aiProviders = new Set(['groq', 'openai', 'local']);
let cachedSettings = null;

const defaults = {
  maxReplyChars: 1200,
  minSecondsBetweenReplies: 20,
  replyDelayMinSeconds: 8,
  replyDelayMaxSeconds: 20,
  burstSize: 5,
  burstCooldownMinSeconds: 600,
  burstCooldownMaxSeconds: 1200,
  hourlyReplyLimit: 40,
  dailyReplyLimit: 120,
};

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
      : 'mention_only',
    allowedChatIds: listEnv('ALLOWED_CHAT_IDS'),
    blockedChatIds: listEnv('BLOCKED_CHAT_IDS'),
    commandSenderIds: listEnv('COMMAND_SENDER_IDS'),
    maxReplyChars: intEnv('MAX_REPLY_CHARS', defaults.maxReplyChars),
    minSecondsBetweenReplies: intEnv('MIN_SECONDS_BETWEEN_REPLIES', defaults.minSecondsBetweenReplies),
    aiProvider: defaultProvider(),
    groqModel: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
    openaiModel: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
    transcribeAudio: boolEnv('TRANSCRIBE_AUDIO', true),
    transcriptionModel: process.env.TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo',
    transcriptionLanguage: defaultTranscriptionLanguage(),
    escalationChatId: process.env.ESCALATION_CHAT_ID || '',
    decaissementChatId: process.env.DECAISSEMENT_CHAT_ID || '',
    voiceReplies: boolEnv('VOICE_REPLIES', true),
    safeSendMode: boolEnv('SAFE_SEND_MODE', true),
    replyDelayMinSeconds: intEnv('REPLY_DELAY_MIN_SECONDS', defaults.replyDelayMinSeconds),
    replyDelayMaxSeconds: intEnv('REPLY_DELAY_MAX_SECONDS', defaults.replyDelayMaxSeconds),
    burstSize: intEnv('BURST_SIZE', defaults.burstSize),
    burstCooldownMinSeconds: intEnv('BURST_COOLDOWN_MIN_SECONDS', defaults.burstCooldownMinSeconds),
    burstCooldownMaxSeconds: intEnv('BURST_COOLDOWN_MAX_SECONDS', defaults.burstCooldownMaxSeconds),
    hourlyReplyLimit: intEnv('HOURLY_REPLY_LIMIT', defaults.hourlyReplyLimit),
    dailyReplyLimit: intEnv('DAILY_REPLY_LIMIT', defaults.dailyReplyLimit),
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
  if (Object.hasOwn(input, 'commandSenderIds')) settings.commandSenderIds = normalizeList(input.commandSenderIds);
  if (Object.hasOwn(input, 'maxReplyChars')) {
    settings.maxReplyChars = clampNumber(input.maxReplyChars, defaults.maxReplyChars, 200, 4000);
  }
  if (Object.hasOwn(input, 'minSecondsBetweenReplies')) {
    settings.minSecondsBetweenReplies = clampNumber(
      input.minSecondsBetweenReplies,
      defaults.minSecondsBetweenReplies,
      0,
      3600,
    );
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
  if (Object.hasOwn(input, 'decaissementChatId')) {
    settings.decaissementChatId = String(input.decaissementChatId || '').trim();
  }
  if (Object.hasOwn(input, 'voiceReplies')) settings.voiceReplies = Boolean(input.voiceReplies);
  if (Object.hasOwn(input, 'safeSendMode')) settings.safeSendMode = Boolean(input.safeSendMode);
  if (Object.hasOwn(input, 'replyDelayMinSeconds')) {
    settings.replyDelayMinSeconds = clampNumber(input.replyDelayMinSeconds, defaults.replyDelayMinSeconds, 0, 3600);
  }
  if (Object.hasOwn(input, 'replyDelayMaxSeconds')) {
    settings.replyDelayMaxSeconds = clampNumber(input.replyDelayMaxSeconds, defaults.replyDelayMaxSeconds, 0, 7200);
  }
  if (settings.replyDelayMaxSeconds < settings.replyDelayMinSeconds) {
    settings.replyDelayMaxSeconds = settings.replyDelayMinSeconds;
  }
  if (Object.hasOwn(input, 'burstSize')) settings.burstSize = clampNumber(input.burstSize, defaults.burstSize, 0, 100);
  if (Object.hasOwn(input, 'burstCooldownMinSeconds')) {
    settings.burstCooldownMinSeconds = clampNumber(
      input.burstCooldownMinSeconds,
      defaults.burstCooldownMinSeconds,
      0,
      7200,
    );
  }
  if (Object.hasOwn(input, 'burstCooldownMaxSeconds')) {
    settings.burstCooldownMaxSeconds = clampNumber(
      input.burstCooldownMaxSeconds,
      defaults.burstCooldownMaxSeconds,
      0,
      14400,
    );
  }
  if (settings.burstCooldownMaxSeconds < settings.burstCooldownMinSeconds) {
    settings.burstCooldownMaxSeconds = settings.burstCooldownMinSeconds;
  }
  if (Object.hasOwn(input, 'hourlyReplyLimit')) {
    settings.hourlyReplyLimit = clampNumber(input.hourlyReplyLimit, defaults.hourlyReplyLimit, 0, 1000);
  }
  if (Object.hasOwn(input, 'dailyReplyLimit')) {
    settings.dailyReplyLimit = clampNumber(input.dailyReplyLimit, defaults.dailyReplyLimit, 0, 10000);
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
