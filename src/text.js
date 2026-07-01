export function getMessageText(message) {
  const content = message.message;
  if (!content) return '';

  if (content.conversation) return content.conversation;
  if (content.extendedTextMessage?.text) return content.extendedTextMessage.text;
  if (content.imageMessage?.caption) return content.imageMessage.caption;
  if (content.videoMessage?.caption) return content.videoMessage.caption;
  if (content.documentMessage?.caption) return content.documentMessage.caption;
  if (content.buttonsResponseMessage?.selectedDisplayText) {
    return content.buttonsResponseMessage.selectedDisplayText;
  }
  if (content.listResponseMessage?.title) return content.listResponseMessage.title;
  if (content.templateButtonReplyMessage?.selectedDisplayText) {
    return content.templateButtonReplyMessage.selectedDisplayText;
  }

  return '';
}

export function getMentionedJids(message) {
  const content = message.message;
  return (
    content?.extendedTextMessage?.contextInfo?.mentionedJid ||
    content?.imageMessage?.contextInfo?.mentionedJid ||
    content?.videoMessage?.contextInfo?.mentionedJid ||
    []
  );
}

export function looksLikeQuestion(text) {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;

  return (
    normalized.includes('?') ||
    /^(who|what|when|where|why|how|can|could|do|does|did|is|are|will|should|would|est-ce|quoi|comment|pourquoi|quand|ou|wach|chno|kifach|fin|3lach)\b/.test(
      normalized,
    )
  );
}

function stripAccents(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizedTokens(text) {
  return stripAccents(text)
    .toLowerCase()
    .replace(/@\S+/g, ' ')
    .replace(/\bdavid\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function looksLikeSimpleGreeting(text) {
  const tokens = normalizedTokens(text);
  if (!tokens.length || tokens.length > 8) return false;

  const joined = tokens.join(' ');
  if (/\b(erreur|bug|probleme|contrat|membre|dashboard|tablette|auralix|manager|commercial|suppression|supprimer)\b/.test(joined)) {
    return false;
  }

  const greetingWords = new Set([
    'salut',
    'slt',
    'salam',
    'slm',
    'bonjour',
    'bonsoir',
    'cc',
    'coucou',
    'hello',
    'hi',
    'hey',
    'merci',
    'thanks',
    'ok',
    'okay',
    'top',
    'parfait',
    'choukran',
    'shukran',
    'labass',
    'labas',
    'labes',
    'ca',
    'cava',
    'cv',
    'va',
    'nta',
    'nti',
    'ntiya',
    'wach',
    'bien',
  ]);

  return tokens.some((token) => greetingWords.has(token)) && tokens.every((token) => greetingWords.has(token));
}

export function looksLikeResolutionAck(text) {
  const normalized = stripAccents(text).toLowerCase();
  if (!normalized.trim()) return false;
  if (/\b(encore|toujours|reste|pas encore|pas resolu|pas regle|marche pas|fonctionne pas)\b/.test(normalized)) {
    return false;
  }

  return (
    /\b(c'?est|c est|cest|c)\s+(bon|ok|resolu|regle)\b/.test(normalized) ||
    /\b(resolu|regle|fixed|done|corrigee?)\b/.test(normalized)
  );
}

export function truncateText(text, maxChars) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}
