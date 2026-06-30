import * as baileysModule from '@whiskeysockets/baileys';
import { config } from './config.js';

const maxFreeTierAudioBytes = 25 * 1024 * 1024;
const baileysDefault =
  baileysModule.default && typeof baileysModule.default === 'object' ? baileysModule.default : {};
const downloadMediaMessage = baileysModule.downloadMediaMessage || baileysDefault.downloadMediaMessage;

if (typeof downloadMediaMessage !== 'function') {
  throw new Error('Baileys media downloader was not found. Check the installed @whiskeysockets/baileys version.');
}

function audioMessage(message) {
  return message.message?.audioMessage || null;
}

function extensionForMime(mimetype = '') {
  if (mimetype.includes('mpeg') || mimetype.includes('mp3')) return 'mp3';
  if (mimetype.includes('mp4') || mimetype.includes('m4a')) return 'm4a';
  if (mimetype.includes('wav')) return 'wav';
  if (mimetype.includes('webm')) return 'webm';
  return 'ogg';
}

export function hasAudioMessage(message) {
  return Boolean(audioMessage(message));
}

function extractTranscriptionText(response) {
  if (typeof response === 'string') return response.trim();
  return response.text?.trim() || '';
}

async function transcribeWithGroq({ buffer, mimetype, settings }) {
  let lastStatus = '';
  const extension = extensionForMime(mimetype);

  for (const apiKey of config.groqApiKeys) {
    const form = new FormData();
    form.append('model', settings.transcriptionModel);
    form.append('response_format', 'json');
    form.append('temperature', '0');
    if (settings.transcriptionLanguage) form.append('language', settings.transcriptionLanguage);
    form.append(
      'prompt',
      'Conversation de support client en francais, avec parfois un peu de darija marocaine. Garder les noms de produits tels quels.',
    );
    form.append('file', new Blob([buffer], { type: mimetype || 'audio/ogg' }), `voice-note.${extension}`);

    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (response.ok) {
      return extractTranscriptionText(await response.json());
    }

    lastStatus = `${response.status} ${response.statusText}`.trim();
  }

  throw new Error(`Groq transcription failed for all configured keys. Last status: ${lastStatus || 'unknown'}`);
}

export async function transcribeAudioMessage({ sock, message, settings, logger }) {
  if (!settings.transcribeAudio || !config.groqApiKeys.length) return '';

  const audio = audioMessage(message);
  if (!audio) return '';
  if (Number(audio.fileLength || 0) > maxFreeTierAudioBytes) {
    throw new Error('Audio file is larger than the Groq free-tier direct upload limit.');
  }

  const buffer = await downloadMediaMessage(
    message,
    'buffer',
    {},
    { logger, reuploadRequest: sock.updateMediaMessage },
  );

  if (!buffer?.length) return '';
  if (buffer.length > maxFreeTierAudioBytes) {
    throw new Error('Downloaded audio is larger than the Groq free-tier direct upload limit.');
  }

  return transcribeWithGroq({ buffer, mimetype: audio.mimetype || 'audio/ogg', settings });
}
