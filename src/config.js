import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const truthy = new Set(['1', 'true', 'yes', 'y', 'on']);

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
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

const isRender =
  truthy.has(String(process.env.RENDER || '').trim().toLowerCase()) ||
  Boolean(process.env.RENDER_SERVICE_ID) ||
  fs.existsSync('/var/data');
const defaultDataDir = isRender ? '/var/data/data' : path.resolve('data');
const defaultSessionDir = isRender ? '/var/data/session' : path.resolve('sessions');
const dataDir = process.env.DATA_DIR || defaultDataDir;

export const config = {
  port: intEnv('PORT', 3000),
  adminToken: process.env.ADMIN_TOKEN || '',
  notifyToken: process.env.NOTIFY_TOKEN || '',
  megafitApiUrl: process.env.MEGAFIT_API_URL || '',
  megafitApiToken: process.env.MEGAFIT_API_TOKEN || '',
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || '',
  elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID || '',
  elevenLabsModel: process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2',
  sessionDir: process.env.SESSION_DIR || defaultSessionDir,
  dataDir,
  knowledgePath: process.env.KNOWLEDGE_PATH || path.join(dataDir, 'knowledge.md'),
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  groqApiKeys: arrayEnv('GROQ_API_KEY', 'GROQ_API_KEYS'),
};

export function requireAdminToken() {
  if (!config.adminToken) {
    throw new Error('ADMIN_TOKEN is required before exposing QR or chat admin endpoints.');
  }
}
