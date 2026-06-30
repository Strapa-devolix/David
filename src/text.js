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

export function truncateText(text, maxChars) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}
