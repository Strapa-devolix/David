import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

let chain = Promise.resolve();
let stateCache = null;

function randomBetween(min, max) {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statePath() {
  return path.join(config.dataDir, 'send-state.json');
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function hourKey() {
  return new Date().toISOString().slice(0, 13);
}

function freshState() {
  return {
    day: todayKey(),
    hour: hourKey(),
    sentToday: 0,
    sentThisHour: 0,
    burstCount: 0,
    nextSendAt: 0,
  };
}

async function loadState() {
  if (stateCache) return stateCache;
  try {
    stateCache = JSON.parse(await fs.readFile(statePath(), 'utf8'));
  } catch {
    stateCache = freshState();
  }
  return normalizeState(stateCache);
}

function normalizeState(state) {
  const currentDay = todayKey();
  const currentHour = hourKey();
  if (state.day !== currentDay) {
    state.day = currentDay;
    state.sentToday = 0;
    state.burstCount = 0;
  }
  if (state.hour !== currentHour) {
    state.hour = currentHour;
    state.sentThisHour = 0;
  }
  state.nextSendAt = Number(state.nextSendAt || 0);
  state.sentToday = Number(state.sentToday || 0);
  state.sentThisHour = Number(state.sentThisHour || 0);
  state.burstCount = Number(state.burstCount || 0);
  return state;
}

async function saveState(state) {
  await fs.mkdir(config.dataDir, { recursive: true });
  await fs.writeFile(statePath(), JSON.stringify(state, null, 2));
}

function assertLimits(state, settings) {
  if (settings.dailyReplyLimit > 0 && state.sentToday >= settings.dailyReplyLimit) {
    throw new Error(`Daily reply limit reached (${settings.dailyReplyLimit}).`);
  }
  if (settings.hourlyReplyLimit > 0 && state.sentThisHour >= settings.hourlyReplyLimit) {
    throw new Error(`Hourly reply limit reached (${settings.hourlyReplyLimit}).`);
  }
}

async function sendWithSafety({ sock, jid, content, options, settings, logger }) {
  const state = await loadState();
  normalizeState(state);
  assertLimits(state, settings);

  const now = Date.now();
  const queuedDelay = Math.max(0, state.nextSendAt - now);
  const randomDelay = settings.safeSendMode
    ? randomBetween(settings.replyDelayMinSeconds, settings.replyDelayMaxSeconds) * 1000
    : 0;
  const waitMs = queuedDelay + randomDelay;

  if (waitMs > 0) {
    logger?.info?.({ jid, waitMs }, 'Waiting before safe send');
    await sleep(waitMs);
  }

  try {
    await sock.sendPresenceUpdate('composing', jid);
    await sleep(settings.safeSendMode ? randomBetween(900, 2400) : 0);
  } catch {
    // Presence is best-effort.
  }

  const result = await sock.sendMessage(jid, content, options);
  await sock.sendPresenceUpdate('paused', jid).catch(() => {});

  state.sentToday += 1;
  state.sentThisHour += 1;
  state.burstCount += 1;

  let cooldownMs = 0;
  if (settings.safeSendMode && settings.burstSize > 0 && state.burstCount >= settings.burstSize) {
    state.burstCount = 0;
    cooldownMs = randomBetween(settings.burstCooldownMinSeconds, settings.burstCooldownMaxSeconds) * 1000;
  }

  state.nextSendAt = Date.now() + cooldownMs;
  await saveState(state);
  return result;
}

export function enqueueSend(args) {
  const task = chain.then(() => sendWithSafety(args));
  chain = task.catch(() => {});
  return task;
}
