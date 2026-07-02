import fs from 'node:fs/promises';
import path from 'node:path';
import * as baileysModule from '@whiskeysockets/baileys';
import P from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import { config } from './config.js';
import { generateReply } from './ai.js';
import {
  buildIssueContext,
  findIssue,
  formatIssueLine,
  formatIssueSummary,
  listIssues,
  looksLikeIssue,
  parseIssueCommand,
  resolveActiveIssues,
  saveIssue,
  statusLabel,
  updateIssueStatus,
} from './issues.js';
import {
  findDecaissement,
  formatDecaissementAlert,
  formatDecaissementLine,
  listDecaissements,
  looksLikeDecaissement,
  parseDecaissementCommand,
  saveDecaissement,
  statusLabel as decaissementStatusLabel,
  updateDecaissementStatus,
} from './decaissements.js';
import { loadKnowledge } from './knowledge.js';
import { buildMemoryContext, loadMemory, rememberInteraction } from './memory.js';
import { loadRegistry, rememberChat } from './registry.js';
import { enqueueSend } from './send-queue.js';
import { setConnectionState, setDecaissementNotifier, setLastError, setQr, startServer } from './server.js';
import { getSettings, loadSettings } from './settings.js';
import { hasAudioMessage, transcribeAudioMessage } from './transcription.js';
import {
  getMentionedJids,
  getMessageText,
  looksLikeQuestion,
  looksLikeResolutionAck,
  looksLikeSimpleGreeting,
} from './text.js';

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

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textMentionsBot(text, settings) {
  const botName = String(settings.botName || 'David').trim() || 'David';
  const pattern = new RegExp(`(^|[\\s@])${escapeRegExp(botName)}\\b`, 'i');
  return pattern.test(text);
}

function shouldReply({ text, message, ownJid, settings, issueDetected, mentioned, question }) {
  if (!settings.autoReply) return false;

  const isMentioned = mentioned ?? (getMentionedJids(message).includes(ownJid) || textMentionsBot(text, settings));
  const isQuestion = question ?? looksLikeQuestion(text);
  if (issueDetected) return true;

  switch (settings.replyTrigger) {
    case 'all':
      return true;
    case 'mention_only':
      return isMentioned;
    case 'question_only':
      return isQuestion;
    case 'question_or_mention':
    default:
      return isQuestion || isMentioned;
  }
}

function rememberMessage(jid, senderName, text) {
  const existing = historyByChat.get(jid) || [];
  existing.push(`${senderName || 'Someone'}: ${text}`);
  historyByChat.set(jid, existing.slice(-8));
}

function closeTopicHistory(jid, senderName) {
  historyByChat.set(jid, [
    `${senderName || 'Someone'}: Le sujet precedent est resolu. Ne le relance pas sauf si la personne en reparle.`,
  ]);
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

function canRunEscalationCommand({ jid, senderJid, settings }) {
  if (!isGroupJid(jid)) return true;
  return settings.commandSenderIds.includes(senderJid);
}

// Owner/admin ticket commands in the escalation chat:
// /tickets, /ticket ISSUE-XXX, /encours ISSUE-XXX, /regle ISSUE-XXX [note]
async function handleEscalationCommand(sock, jid, senderJid, text, settings) {
  const command = parseIssueCommand(text);
  if (!command) return false;

  if (!canRunEscalationCommand({ jid, senderJid, settings })) {
    await sock.sendMessage(jid, {
      text: 'Commande ticket reservee aux IDs autorises. Ajoute ton sender ID dans le dashboard si besoin.',
    });
    return true;
  }

  if (command.action === 'list') {
    const open = (await listIssues({ limit: 20 })).filter((issue) => issue.status !== 'resolved');
    const body = open.length
      ? ['Tickets ouverts:', ...open.map((issue) => `- ${formatIssueLine(issue)}`), '', 'Cloturer: /regle ISSUE-XXX [note]'].join('\n')
      : 'Aucun ticket ouvert.';
    await sock.sendMessage(jid, { text: body });
    return true;
  }

  if (command.action === 'show') {
    const issue = await findIssue(command.id);
    await sock.sendMessage(jid, {
      text: issue ? formatIssueSummary(issue) : `Ticket ${command.id || ''} introuvable.`,
    });
    return true;
  }

  if (command.action === 'resolve' || command.action === 'progress') {
    if (!command.id) {
      await sock.sendMessage(jid, { text: "Donne l'ID. Ex: /regle ISSUE-XXXX [note]" });
      return true;
    }
    const status = command.action === 'resolve' ? 'resolved' : 'in_progress';
    const issue = await updateIssueStatus(command.id, status, command.note);
    if (!issue) {
      await sock.sendMessage(jid, { text: `Ticket ${command.id} introuvable.` });
      return true;
    }
    const who = issue.senderName || issue.chatName || '';
    const note = issue.resolution ? `\nNote: ${issue.resolution}` : '';
    await sock.sendMessage(jid, { text: `${issue.id} - ${statusLabel(issue.status)}${who ? ` (${who})` : ''}.${note}` });
    return true;
  }

  return false;
}

// Omar handles cash-out requests in the escalation chat:
// /decs, /dec DEC-XXX, /decsaisi DEC-XXX, /decfait DEC-XXX [note], /decrefus DEC-XXX [note]
async function handleDecaissementCommand(sock, jid, senderJid, text, settings) {
  const command = parseDecaissementCommand(text);
  if (!command) return false;

  if (!canRunEscalationCommand({ jid, senderJid, settings })) {
    await sock.sendMessage(jid, {
      text: 'Commande decaissement reservee aux IDs autorises. Ajoute ton sender ID dans le dashboard si besoin.',
    });
    return true;
  }

  if (command.action === 'list') {
    const open = (await listDecaissements({ limit: 20 })).filter((request) => request.status === 'requested' || request.status === 'entered');
    const body = open.length
      ? ['Demandes de decaissement:', ...open.map((request) => `- ${formatDecaissementLine(request)}`), '', 'Traiter: /decfait DEC-XXX [note]'].join('\n')
      : 'Aucune demande de decaissement en attente.';
    await sock.sendMessage(jid, { text: body });
    return true;
  }

  if (command.action === 'show') {
    const request = await findDecaissement(command.id);
    await sock.sendMessage(jid, {
      text: request ? formatDecaissementAlert(request) : `Demande ${command.id || ''} introuvable.`,
    });
    return true;
  }

  if (!command.id) {
    await sock.sendMessage(jid, { text: "Donne l'ID. Ex: /decfait DEC-XXXX [note]" });
    return true;
  }
  const request = await updateDecaissementStatus(command.id, command.action, command.note);
  if (!request) {
    await sock.sendMessage(jid, { text: `Demande ${command.id} introuvable.` });
    return true;
  }
  const who = request.senderName || request.gymHint || request.chatName || '';
  const note = request.note ? `\nNote: ${request.note}` : '';
  await sock.sendMessage(jid, {
    text: `${request.id} - ${decaissementStatusLabel(request.status)}${who ? ` (${who})` : ''}.${note}`,
  });
  return true;
}

async function handleMessage(sock, message) {
  const jid = message.key.remoteJid;
  if (!jid || message.key.fromMe) return;
  const settings = await getSettings();
  const senderJid = message.key.participant || jid;

  let text = getMessageText(message).trim();
  let audioTranscript = false;

  // Ticket & décaissement commands must work even when the command chat is private and onlyGroups is enabled.
  const isCommandChat =
    (settings.escalationChatId && jid === settings.escalationChatId) ||
    (settings.decaissementChatId && jid === settings.decaissementChatId);
  if (text && isCommandChat) {
    try {
      if (await handleEscalationCommand(sock, jid, senderJid, text, settings)) return;
      if (await handleDecaissementCommand(sock, jid, senderJid, text, settings)) return;
    } catch (error) {
      setLastError(error);
      logger.error({ err: error, jid }, 'Failed to handle escalation command');
    }
  }

  if (!shouldObserveChat(jid, settings)) return;

  if (!text && hasAudioMessage(message)) {
    try {
      text = (await transcribeAudioMessage({ sock, message, settings, logger })).trim();
      audioTranscript = Boolean(text);
    } catch (error) {
      setLastError(error);
      logger.error({ err: error, jid }, 'Failed to transcribe audio message');
    }
  }

  if (!text) return;

  const isGroup = isGroupJid(jid);
  const senderName = message.pushName || message.key.participant || 'teammate';
  const chatName = await getChatName(sock, jid, senderName);
  await rememberChat({ jid, name: chatName, type: isGroup ? 'group' : 'direct' });
  await rememberInteraction({
    chatJid: jid,
    chatName,
    chatType: isGroup ? 'group' : 'direct',
    senderJid,
    senderName,
    text,
    source: audioTranscript ? 'audio' : 'text',
  });
  rememberMessage(jid, senderName, text);

  if (!shouldRespondInChat(jid, settings)) {
    logger.info({ jid, chatName }, 'Observed chat. Allow it from the dashboard to enable replies.');
    return;
  }

  const ownJid = jidNormalizedUser(sock.user?.id || '');
  const mentioned = getMentionedJids(message).includes(ownJid) || textMentionsBot(text, settings);
  const question = looksLikeQuestion(text);
  const simpleGreeting = looksLikeSimpleGreeting(text);
  const resolutionAck = looksLikeResolutionAck(text);
  const issueDetected = !resolutionAck && looksLikeIssue(text);
  const decaissementDetected = !resolutionAck && isGroup && looksLikeDecaissement(text);
  if (resolutionAck) {
    try {
      await resolveActiveIssues({
        chatJid: jid,
        senderJid,
        resolution: text,
      });
      closeTopicHistory(jid, senderName);
    } catch (error) {
      setLastError(error);
      logger.error({ err: error, jid }, 'Failed to close resolved topic');
    }
  }
  if (!shouldReply({ text, message, ownJid, settings, issueDetected: issueDetected || decaissementDetected, mentioned, question })) return;
  if (!(mentioned || question || issueDetected || decaissementDetected) && rateLimited(jid, settings)) {
    logger.info({ jid }, 'Skipping reply because chat is rate limited');
    return;
  }

  try {
    const issue = issueDetected
      ? await saveIssue({
          chatJid: jid,
          chatName,
          senderJid,
          senderName,
          text,
          source: audioTranscript ? 'audio' : 'texte',
        })
      : null;

    const decaissement = decaissementDetected
      ? await saveDecaissement({
          chatJid: jid,
          chatName,
          senderJid,
          senderName,
          text,
          source: audioTranscript ? 'audio' : 'texte',
        })
      : null;

    const isolateContext = simpleGreeting || resolutionAck;
    let reply = await generateReply({
      chatName,
      senderName,
      question: text,
      recentContext: isolateContext ? [] : historyByChat.get(jid) || [],
      memoryContext: isolateContext ? '' : await buildMemoryContext({ senderJid, chatJid: jid }),
      issuesContext: isolateContext ? '' : await buildIssueContext({ chatJid: jid, senderJid }),
      settings,
      issueDetected,
      decaissementDetected,
      audioTranscript,
    });

    if (!reply) return;
    await enqueueSend({
      sock,
      jid,
      content: { text: reply },
      options: { quoted: message },
      settings,
      logger,
      delayProfile: mentioned || issueDetected || question || simpleGreeting || resolutionAck ? 'fast' : 'normal',
    });
    lastReplyByChat.set(jid, Date.now());

    if (issue && settings.escalationChatId) {
      await enqueueSend({
        sock,
        jid: settings.escalationChatId,
        content: { text: formatIssueSummary(issue) },
        settings,
        logger,
      });
    }

    const decaissementChat = settings.decaissementChatId || settings.escalationChatId;
    if (decaissement && decaissementChat) {
      await enqueueSend({
        sock,
        jid: decaissementChat,
        content: { text: formatDecaissementAlert(decaissement) },
        settings,
        logger,
        delayProfile: 'fast',
      });
    }

    logger.info({ jid }, 'Sent reply');
  } catch (error) {
    setLastError(error);
    logger.error({ err: error, jid }, 'Failed to generate or send reply');
  }
}

async function connect() {
  await ensureDirectories();
  await loadSettings({ force: true });
  await loadRegistry();
  await loadKnowledge({ force: true });
  await loadMemory({ force: true });

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

  // Let the HTTP server push dashboard décaissements to the selected WhatsApp group.
  setDecaissementNotifier(async (text) => {
    const currentSettings = await getSettings();
    const target = currentSettings.decaissementChatId || currentSettings.escalationChatId;
    if (!target) throw new Error('No décaissement/escalation group configured');
    await enqueueSend({ sock, jid: target, content: { text }, settings: currentSettings, logger, delayProfile: 'fast' });
    return target;
  });

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
