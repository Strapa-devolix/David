import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

const issuePatterns = [
  /\berreur\b/i,
  /\bbug\b/i,
  /\bprobleme\b/i,
  /\bbloque\b/i,
  /\bimpossible\b/i,
  /\bne fonctionne pas\b/i,
  /\bfonctionne pas\b/i,
  /\bmarche pas\b/i,
  /\bcrash\b/i,
  /\bfailed\b/i,
  /\berror\b/i,
  /\bissue\b/i,
  /\bblocked\b/i,
  /\bmakhdamch\b/i,
  /\bma khdamch\b/i,
  /\bmachi khdam\b/i,
  /\bmouchkil\b/i,
  /\bmochkil\b/i,
];

function issuesPath() {
  return path.join(config.dataDir, 'issues.jsonl');
}

export function looksLikeIssue(text) {
  const normalized = String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return issuePatterns.some((pattern) => pattern.test(normalized));
}

export async function saveIssue({ chatJid, chatName, senderName, text, source }) {
  await fs.mkdir(config.dataDir, { recursive: true });
  const issue = {
    id: `ISSUE-${Date.now().toString(36).toUpperCase()}`,
    createdAt: new Date().toISOString(),
    chatJid,
    chatName,
    senderName,
    source,
    text,
  };

  await fs.appendFile(issuesPath(), `${JSON.stringify(issue)}\n`);
  return issue;
}

export function formatIssueSummary(issue) {
  return [
    `Nouveau ticket ${issue.id}`,
    `Groupe/client: ${issue.chatName || issue.chatJid}`,
    `De: ${issue.senderName || 'client'}`,
    `Source: ${issue.source || 'texte'}`,
    '',
    'Resume:',
    issue.text,
  ].join('\n');
}
