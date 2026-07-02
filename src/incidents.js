import { config } from './config.js';

// Detects when someone asks about incidents and fetches them from megafit-api,
// so David can answer with a natural, human summary.

function stripAccents(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

const incidentWord = /\bincident/i;

const gymKeywords = [
  { id: 'dokarat', re: /\b(dokk|dukk|dokar|dukar)/i },
  { id: 'marjane', re: /\b(saiss|marjane)/i },
  { id: 'casa1', re: /\b(anfa|casa ?1)/i },
  { id: 'casa2', re: /\b(lady|casa ?2)/i },
];

export function looksLikeIncidentQuery(text) {
  return incidentWord.test(stripAccents(text));
}

// Decide what the person is asking for.
export function parseIncidentQuery(text) {
  const t = stripAccents(text).toLowerCase();
  let scope = 'open';
  if (/aujourd|\btoday\b|\bce jour\b|\bdu jour\b|\blyoum\b|\blyoma\b/.test(t)) scope = 'today';
  else if (/\b(tous|toutes|tout|all|resume|resumer|liste|historique|everything)\b/.test(t)) scope = 'all';
  let gymId = '';
  for (const g of gymKeywords) {
    if (g.re.test(t)) { gymId = g.id; break; }
  }
  return { scope, gymId };
}

export async function fetchIncidents({ scope = 'open', gymId = '' } = {}) {
  if (!config.megafitApiUrl || !config.megafitApiToken) {
    return { ok: false, reason: 'bridge_not_configured', incidents: [] };
  }
  const url = new URL('/api/david/incidents', config.megafitApiUrl);
  url.searchParams.set('scope', scope);
  if (gymId) url.searchParams.set('gymId', gymId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(url, {
      headers: { 'x-notify-token': config.megafitApiToken },
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}`, incidents: [] };
    const data = await res.json();
    return { ok: true, scope, incidents: Array.isArray(data.incidents) ? data.incidents : [] };
  } catch (err) {
    return { ok: false, reason: err.name === 'AbortError' ? 'timeout' : err.message, incidents: [] };
  } finally {
    clearTimeout(timer);
  }
}

// Build the data block fed to the AI so it can phrase a human summary.
export function buildIncidentContext({ scope, incidents }) {
  const scopeLabel = scope === 'today' ? "aujourd'hui" : scope === 'all' ? 'récents (tous)' : 'ouverts';
  if (!incidents.length) {
    return `Incidents ${scopeLabel}: aucun. (Réponds naturellement qu'il n'y a aucun incident ${scopeLabel}.)`;
  }
  const lines = incidents.slice(0, 12).map((i) => {
    const bits = [
      i.gym,
      i.emergency ? `urgence ${i.emergency}` : '',
      i.status,
      i.title,
      i.cause ? `cause: ${i.cause}` : '',
      i.date,
    ].filter(Boolean);
    return `- ${bits.join(' · ')}`;
  });
  return [
    `Incidents ${scopeLabel} (${incidents.length}). Fais un résumé clair et humain, court, par club si utile. Ne balance pas une liste brute robotique.`,
    ...lines,
  ].join('\n');
}

// Convenience: detect → fetch → context in one call. Returns '' if not an incident query.
export async function getIncidentContextForMessage(text) {
  if (!looksLikeIncidentQuery(text)) return '';
  const { scope, gymId } = parseIncidentQuery(text);
  const result = await fetchIncidents({ scope, gymId });
  if (!result.ok) {
    if (result.reason === 'bridge_not_configured') return '';
    return "Incidents: impossible de récupérer les données là maintenant. Dis que tu vérifies et reviens vite.";
  }
  return buildIncidentContext({ scope: result.scope, incidents: result.incidents });
}
