import { spawn } from 'node:child_process';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import { config } from './config.js';

const ffmpegBin = ffmpeg.path;
const maxChars = 800; // cap length to control ElevenLabs cost / latency

export function voiceConfigured() {
  return Boolean(config.elevenLabsApiKey && config.elevenLabsVoiceId);
}

async function elevenLabsMp3(text) {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${config.elevenLabsVoiceId}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': config.elevenLabsApiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: config.elevenLabsModel,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`ElevenLabs ${res.status}: ${detail.slice(0, 200)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// Transcode MP3 -> OGG/Opus (WhatsApp voice-note format) using the bundled ffmpeg.
function mp3ToOpusOgg(mp3Buffer) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1',
      '-f', 'ogg', 'pipe:1',
    ];
    const proc = spawn(ffmpegBin, args);
    const out = [];
    const err = [];
    proc.stdout.on('data', (d) => out.push(d));
    proc.stderr.on('data', (d) => err.push(d));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(err).toString().slice(0, 200)}`));
    });
    proc.stdin.on('error', () => {}); // ignore EPIPE if ffmpeg dies early
    proc.stdin.write(mp3Buffer);
    proc.stdin.end();
  });
}

// Returns an OGG/Opus buffer ready to send as a WhatsApp voice note, or null on any failure.
export async function synthesizeVoiceNote(text, logger) {
  if (!voiceConfigured()) return null;
  const clean = String(text || '').trim().slice(0, maxChars);
  if (!clean) return null;
  try {
    const mp3 = await elevenLabsMp3(clean);
    const ogg = await mp3ToOpusOgg(mp3);
    return ogg?.length ? ogg : null;
  } catch (error) {
    logger?.warn?.({ err: error }, 'Voice synthesis failed, falling back to text');
    return null;
  }
}
