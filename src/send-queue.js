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

function timingSettings(settings, delayProfile) {
  if (delayProfile !== 'fast') return settings;

  const minDelay = Math.min(Number(settings.replyDelayMinSeconds || 0), 2);
  const maxDelay = Math.min(Number(settings.replyDelayMaxSeconds || 0), 8);
  return {
    ...settings,
    replyDelayMinSeconds: minDelay,
    replyDelayMaxSeconds: Math.max(minDelay, maxDelay),
  };
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

async function showComposing(sock, jid, timing) {
  try {
    await sock.sendPresenceUpdate('composing', jid);
    await sleep(timing.safeSendMode ? randomBetween(700, 1500) : 0);
  } catch {
    // Presence is best-effort.
  }
}

async function sendWithSafety({ sock, jid, content, options, settings, logger, delayProfile = 'normal' }) {
  const timing = timingSettings(settings, delayProfile);
  const state = await loadState();
  normalizeState(state);
  assertLimits(state, timing);

  const now = Date.now();
  const queuedDelay = Math.max(0, state.nextSendAt - now);
  const effectiveQueuedDelay = delayProfile === 'fast' ? 0 : queuedDelay;
  const randomDelay = timing.safeSendMode
    ? randomBetween(timing.replyDelayMinSeconds, timing.replyDelayMaxSeconds) * 1000
    : 0;
  const waitMs = effectiveQueuedDelay + randomDelay;

  if (delayProfile === 'fast') {
    await showComposing(sock, jid, timing);
  }

  if (waitMs > 0) {
    logger?.info?.({ jid, waitMs }, 'Waiting before safe send');
    await sleep(waitMs);
  }

  if (delayProfile !== 'fast') {
    await showComposing(sock, jid, timing);
  }

  const result = await sock.sendMessage(jid, content, options);
  await sock.sendPresenceUpdate('paused', jid).catch(() => {});

  state.sentToday += 1;
  state.sentThisHour += 1;
  state.burstCount += 1;

  let cooldownMs = 0;
  if (timing.safeSendMode && timing.burstSize > 0 && state.burstCount >= timing.burstSize) {
    state.burstCount = 0;
    cooldownMs = randomBetween(timing.burstCooldownMinSeconds, timing.burstCooldownMaxSeconds) * 1000;
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
