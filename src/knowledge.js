import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

let cachedKnowledge = '';
let cachedSections = [];
let lastLoadedAt = 0;
const bundledKnowledgePath = path.resolve('data', 'knowledge.md');
const defaultKnowledge = `# Platform Knowledge

Add answers about your platform and apps here.
Keep answers short, factual, and safe to send to teammates.
`;

function sectionize(markdown) {
  const sections = [];
  let current = { title: 'General', body: [] };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      if (current.body.join('\n').trim()) sections.push(current);
      current = { title: heading[1].trim(), body: [] };
    } else {
      current.body.push(line);
    }
  }

  if (current.body.join('\n').trim()) sections.push(current);
  return sections.map((section) => ({
    title: section.title,
    body: section.body.join('\n').trim(),
  }));
}

export async function loadKnowledge({ force = false } = {}) {
  const shouldReload = force || Date.now() - lastLoadedAt > 30_000;
  if (!shouldReload && cachedKnowledge) {
    return { markdown: cachedKnowledge, sections: cachedSections };
  }

  try {
    const absolutePath = path.isAbsolute(config.knowledgePath)
      ? config.knowledgePath
      : path.resolve(config.knowledgePath);
    await ensureKnowledgeFile(absolutePath);
    cachedKnowledge = await fs.readFile(absolutePath, 'utf8');
  } catch (error) {
    cachedKnowledge = '';
  }

  cachedSections = sectionize(cachedKnowledge);
  lastLoadedAt = Date.now();
  return { markdown: cachedKnowledge, sections: cachedSections };
}

async function ensureKnowledgeFile(absolutePath) {
  try {
    await fs.access(absolutePath);
    return;
  } catch {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  }

  try {
    if (path.resolve(absolutePath) !== bundledKnowledgePath) {
      const bundled = await fs.readFile(bundledKnowledgePath, 'utf8');
      await fs.writeFile(absolutePath, bundled);
      return;
    }
  } catch {
    // Fall through to the default starter knowledge.
  }

  await fs.writeFile(absolutePath, defaultKnowledge);
}

export async function saveKnowledge(markdown) {
  const absolutePath = path.isAbsolute(config.knowledgePath)
    ? config.knowledgePath
    : path.resolve(config.knowledgePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, String(markdown || ''));
  cachedKnowledge = '';
  lastLoadedAt = 0;
  return loadKnowledge({ force: true });
}

function tokenize(text) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 2),
  );
}

export function findLocalAnswer(question, sections) {
  const queryTokens = tokenize(question);
  if (!queryTokens.size) return '';

  let best = null;
  for (const section of sections) {
    const haystack = tokenize(`${section.title}\n${section.body}`);
    let score = 0;
    for (const token of queryTokens) {
      if (haystack.has(token)) score += 1;
    }

    if (!best || score > best.score) {
      best = { score, section };
    }
  }

  if (!best || best.score < 2) {
    return "I don't want to guess on that. I'll check and get back to you.";
  }

  return best.section.body;
}
