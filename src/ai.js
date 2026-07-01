import { config } from './config.js';
import { findLocalAnswer, loadKnowledge } from './knowledge.js';
import { getSettings } from './settings.js';
import { truncateText } from './text.js';

function extractOutputText(response) {
  if (typeof response.output_text === 'string') return response.output_text.trim();

  const chunks = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) chunks.push(content.text);
      if (content.type === 'text' && content.text) chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

function extractChatText(response) {
  return response.choices?.[0]?.message?.content?.trim() || '';
}

function buildInstructions(knowledge, settings) {
  return [
    `Tu es ${settings.botName}, un developpeur support francais pour MegaFit.`,
    `Tu travailles avec ${settings.ownerName} et l'equipe dev pour aider les clubs et remonter les vrais problemes.`,
    'Reponds surtout en francais naturel de WhatsApp. Comprends le darija marocain simple, mais reponds en francais sauf si une petite expression darija aide.',
    'Style: court, humain, direct, pas centre d appel. Une a cinq phrases courtes. Pas de roman.',
    'Ton role: guider sur Dashboard, tablette inscription, Auralix, relances, acces, erreurs et bugs.',
    'Si le client signale un bug, une erreur, une page blanche, un montant faux, un contrat a supprimer, un acces bloque ou un abonnement incorrect, demande les details utiles puis dis que le point est note pour traitement par l equipe dev.',
    'Details utiles: club, app ou page, compte ou membre concerne, etapes, capture ou audio, resultat attendu et resultat obtenu.',
    'Tu ne peux pas modifier directement les donnees, supprimer un contrat, changer un role, recuperer un mot de passe, debloquer un compte, confirmer un paiement ou promettre une date.',
    'Pour une action admin ou sensible, demande de passer par le dashboard officiel megafitauth.web.app avec le compte Microsoft autorise, puis indique que tu peux transmettre le cas.',
    'Confidentialite stricte: ne donne jamais de PIN, token, cle API, detail technique interne, statut Render/Firebase/SQLite/Azure, statistiques/objectifs d un autre club, ou donnees privees.',
    'Utilise la memoire seulement pour personnaliser doucement la reponse, par exemple se souvenir du prenom ou du club habituel. Ne revele jamais une note de memoire brute.',
    'Utilise seulement la connaissance projet, la memoire et le contexte recent. Si ce n est pas clair, dis que tu vas verifier au lieu d inventer.',
    '',
    'Project knowledge:',
    knowledge || '(No project knowledge has been added yet.)',
  ].join('\n');
}

function buildUserInput({ chatName, senderName, question, recentContext, memoryContext }) {
  return [
    chatName ? `Chat: ${chatName}` : '',
    senderName ? `Sender: ${senderName}` : '',
    memoryContext ? `Memory context:\n${memoryContext}` : '',
    recentContext?.length ? `Recent context:\n${recentContext.join('\n')}` : '',
    `Question to answer:\n${question}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function generateOpenAIReply({ instructions, input, settings }) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: settings.openaiModel,
      instructions,
      input,
      max_output_tokens: 260,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI request failed ${response.status}: ${detail.slice(0, 500)}`);
  }

  const data = await response.json();
  return extractOutputText(data);
}

async function generateGroqReply({ instructions, input, settings }) {
  let lastStatus = '';

  for (let index = 0; index < config.groqApiKeys.length; index += 1) {
    const apiKey = config.groqApiKeys[index];
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: settings.groqModel,
        messages: [
          { role: 'system', content: instructions },
          { role: 'user', content: input },
        ],
        temperature: 0.2,
        max_tokens: 260,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      return extractChatText(data);
    }

    lastStatus = `${response.status} ${response.statusText}`.trim();
  }

  throw new Error(`Groq request failed for all configured keys. Last status: ${lastStatus || 'unknown'}`);
}

export async function generateReply({
  chatName,
  senderName,
  question,
  recentContext,
  memoryContext,
  settings,
  issueDetected = false,
  audioTranscript = false,
}) {
  const runtimeSettings = settings || (await getSettings());
  const { markdown, sections } = await loadKnowledge();
  const input = [
    audioTranscript ? 'The customer message below was transcribed from a WhatsApp voice note.' : '',
    issueDetected ? 'An issue/error/blocker was detected. Tell the customer the issue has been saved for the dev team.' : '',
    buildUserInput({ chatName, senderName, question, recentContext, memoryContext }),
  ]
    .filter(Boolean)
    .join('\n\n');
  const instructions = buildInstructions(markdown, runtimeSettings);

  if (runtimeSettings.aiProvider === 'local') {
    return truncateText(findLocalAnswer(question, sections), runtimeSettings.maxReplyChars);
  }

  let reply = '';
  if (runtimeSettings.aiProvider === 'groq' && config.groqApiKeys.length) {
    reply = await generateGroqReply({ instructions, input, settings: runtimeSettings });
  } else if (runtimeSettings.aiProvider === 'openai' && config.openaiApiKey) {
    reply = await generateOpenAIReply({ instructions, input, settings: runtimeSettings });
  } else {
    reply = findLocalAnswer(question, sections);
  }

  if (!reply) reply = "Je prefere verifier avant de te dire une betise. Je note ca et je reviens vers toi.";
  return truncateText(reply, runtimeSettings.maxReplyChars);
}
