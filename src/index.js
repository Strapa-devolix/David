import fs from 'node:fs/promises';
import path from 'node:path';
import * as baileysModule from '@whiskeysockets/baileys';
import P from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import { config } from './config.js';
import { generateReply } from './ai.js';
import { loadKnowledge } from './knowledge.js';
import { loadRegistry, rememberChat } from './registry.js';
import { setConnectionState, setLastError, setQr, startServer } from './server.js';
import { getSettings, loadSettings } from './settings.js';
import { getMentionedJids, getMessageText, looksLikeQuestion } from './text.js';

const logger = P({ level: process.env.LOG_LEVEL || 'info' });
const historyByChat = new Map();
const lastReplyByChat = new Map();
const groupNameByJid = new Map();
const baileysDefault =
  baileysModule.default && typeof baileysModule.default === 'object' ? baileysModule.default : {};
const makeWASocket =
  (typeof baileysModule.default === 'function' && baileysModule.default) ||
  baileysModule.makeWASocket ||
  baileysDefault.makeWASocket ||
  baileysDefault.default;
const Browsers = baileysModule.Browsers || baileysDefault.Browsers;
const DisconnectReason = baileysModule.DisconnectReason || baileysDefault.DisconnectReason;
const fetchLatestBaileysVersion =
  baileysModule.fetchLatestBaileysVersion || baileysDefault.fetchLatestBaileysVersion;
const jidNormalizedUser = baileysModule.jidNormalizedUser || baileysDefault.jidNormalizedUser;
const useMultiFileAuthState =
  baileysModule.useMultiFileAuthState || baileysDefault.useMultiFileAuthState;

if (typeof makeWASocket !== 'function') {
  throw new Error('Baileys socket factory was not found. Check the installed @whiskeysockets/baileys version.');
}

function isGroupJid(jid) {
  return jid.endsWith('@g.us');
}

function shouldObserveChat(jid, settings) {
  if (settings.blockedChatIds.includes(jid)) return false;
  if (settings.onlyGroups && !isGroupJid(jid)) return false;
  return true;
}

function shouldRespondInChat(jid, settings) {
  return settings.allowAllChats || settings.allowedChatIds.includes(jid);
}

function shouldReply({ text, message, ownJid, settings }) {
  if (!settings.autoReply) return false;

  const mentionedJids = getMentionedJids(message);
  const mentioned = mentionedJids.includes(ownJid);
  const question = looksLikeQuestion(text);

  switch (settings.replyTrigger) {
    case 'all':
      return true;
    case 'mention_only':
      return mentioned;
    case 'question_only':
      return question;
    case 'question_or_mention':
    default:
      return question || mentioned;
  }
}

function rememberMessage(jid, senderName, text) {
  const existing = historyByChat.get(jid) || [];
  existing.push(`${senderName || 'Someone'}: ${text}`);
  historyByChat.set(jid, existing.slice(-8));
}

function rateLimited(jid, settings) {
  const last = lastReplyByChat.get(jid) || 0;
  const elapsedSeconds = (Date.now() - last) / 1000;
  return elapsedSeconds < settings.minSecondsBetweenReplies;
}

async function getChatName(sock, jid, fallback) {
  if (!isGroupJid(jid)) return fallback;
  if (groupNameByJid.has(jid)) return groupNameByJid.get(jid);

  try {
    const metadata = await sock.groupMetadata(jid);
    const name = metadata.subject || fallback;
    groupNameByJid.set(jid, name);
    return name;
  } catch {
    return fallback;
  }
}

async function ensureDirectories() {
  await fs.mkdir(config.sessionDir, { recursive: true });
  await fs.mkdir(config.dataDir, { recursive: true });
  const knowledgeDir = path.dirname(path.resolve(config.knowledgePath));
  await fs.mkdir(knowledgeDir, { recursive: true });
}

async function handleMessage(sock, message) {
  const jid = message.key.remoteJid;
  if (!jid || message.key.fromMe) return;
  const settings = await getSettings();
  if (!shouldObserveChat(jid, settings)) return;

  const text = getMessageText(message).trim();
  if (!text) return;

  const isGroup = isGroupJid(jid);
  const senderName = message.pushName || message.key.participant || 'teammate';
  const chatName = await getChatName(sock, jid, senderName);
  await rememberChat({ jid, name: chatName, type: isGroup ? 'group' : 'direct' });
  rememberMessage(jid, senderName, text);

  if (!shouldRespondInChat(jid, settings)) {
    logger.info({ jid, chatName }, 'Observed chat. Allow it from the dashboard to enable replies.');
    return;
  }

  const ownJid = jidNormalizedUser(sock.user?.id || '');
  if (!shouldReply({ text, message, ownJid, settings })) return;
  if (rateLimited(jid, settings)) {
    logger.info({ jid }, 'Skipping reply because chat is rate limited');
    return;
  }

  try {
    await sock.sendPresenceUpdate('composing', jid);
    const reply = await generateReply({
      chatName,
      question: text,
      recentContext: historyByChat.get(jid) || [],
      settings,
    });

    if (!reply) return;
    await sock.sendMessage(jid, { text: reply }, { quoted: message });
    lastReplyByChat.set(jid, Date.now());
    logger.info({ jid }, 'Sent reply');
  } catch (error) {
    setLastError(error);
    logger.error({ err: error, jid }, 'Failed to generate or send reply');
  } finally {
    await sock.sendPresenceUpdate('paused', jid).catch(() => {});
  }
}

async function connect() {
  await ensureDirectories();
  await loadSettings({ force: true });
  await loadRegistry();
  await loadKnowledge({ force: true });

  const { state, saveCreds } = await useMultiFileAuthState(config.sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    version,
    logger: P({ level: process.env.BAILEYS_LOG_LEVEL || 'silent' }),
    browser: Browsers.macOS('Desktop'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      setQr(qr);
      logger.info('New WhatsApp QR generated. Open /qr?token=ADMIN_TOKEN or scan from logs.');
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection) {
      setConnectionState(connection);
      logger.info({ connection }, 'WhatsApp connection state changed');
    }

    if (connection === 'close') {
      const error = lastDisconnect?.error;
      setLastError(error);
      const statusCode = error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;

      if (loggedOut) {
        logger.error('WhatsApp logged out. Delete the session directory and scan a new QR.');
        return;
      }

      logger.warn('WhatsApp disconnected. Reconnecting shortly.');
      setTimeout(() => {
        connect().catch((reconnectError) => {
          setLastError(reconnectError);
          logger.error({ err: reconnectError }, 'Reconnect failed');
        });
      }, 5000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const message of messages) {
      await handleMessage(sock, message);
    }
  });

  return sock;
}

startServer();

connect().catch((error) => {
  setLastError(error);
  logger.error({ err: error }, 'Failed to start David');
  process.exitCode = 1;
});
