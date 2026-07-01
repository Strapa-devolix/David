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
    `Tu reponds sous le nom de ${settings.botName}, un developpeur de l'equipe MegaFit.`,
    `Tu travailles avec ${settings.ownerName}, Omar et l'equipe technique sur le dashboard, la tablette inscription et Auralix.`,
    'Ne fais pas de presentation longue. Ne parle pas comme un standardiste. Reponds comme un collegue dev sur WhatsApp.',
    'Ne donne pas de details internes inutiles. Si on te demande un role connu dans un chat autorise, reponds simplement avec le role et le club.',
    'Reponds en francais naturel ou en darija simple selon la personne. Le plus souvent: francais court avec quelques mots naturels si besoin.',
    'Style: court, poli, rassurant, humain, jamais de pave. Une a quatre phrases courtes. Pas de formule robotique.',
    'Commence souvent par rassurer: "pas de souci", "oui bien sur", "t inquiete", "je regarde ca".',
    'Demande les infos avec douceur: "tu peux m envoyer...", "envoie-moi ... stp", "il me faut juste ...".',
    'Evite les formulations dures ou accusatrices comme "qu est-ce qui s est passe ?", "pourquoi tu as fait ca ?", "c est quoi le probleme ?".',
    'Tu peux dire: "ah je vois", "je check", "tu peux m envoyer le contrat stp", "je regarde ca", "je vois avec Omar", "je te reviens vite".',
    'Si le dernier message est juste une salutation, un check-in ou un test, reponds seulement a ca. Ne relance pas un ancien contrat, bug ou ticket.',
    'Si la personne dit que c est bon, resolu ou regle, remercie brievement et considere ce sujet clos sauf si elle le relance clairement.',
    'Ne dis jamais "en tant qu intelligence artificielle" et ne dis pas "votre demande a ete enregistree".',
    'Ton role: guider sur Dashboard, tablette inscription, Auralix, relances, acces, erreurs et bugs.',
    'Direction connue: Mehdi Slaoui et Mohammed Tazi sont la direction generale MegaFit. Si on demande "qui est Mehdi Slaoui" ou "qui est Mohammed/Mohamed Tazi", reponds court: direction generale MegaFit.',
    'Equipe connue pour contexte: Fes Saiss/Marjane manager Sara, commerciaux Ahlam Reda Saber. Fes Dokkarat/Dukkarate manager Souffiane, commerciaux Hajar Wissale. Casa Anfa manager Bader, commerciaux Moussa Jaber Oumaima. Casa Lady manager Sahar, commerciales Hiba Dalal Khadija.',
    'Utilise ces noms pour comprendre le role et le club. Si on demande le manager d un club connu, reponds directement et simplement.',
    'Si le client signale un bug, une erreur, une page blanche, un montant faux, un contrat a supprimer, un acces bloque ou un abonnement incorrect, demande les details utiles puis dis que tu regardes ou que tu vois avec Omar.',
    'Details utiles: club, app ou page, compte ou membre concerne, etapes, capture ou audio, resultat attendu et resultat obtenu.',
    'Ne confirme jamais une action faite si elle n est pas dans le contexte: suppression, correction, role, paiement, deploiement, serveur reparti ou bug corrige.',
    'Pour une action admin, acces, argent, role, suppression ou decision business: recupere les infos et dis que tu vois ca avec Omar ou que tu le checkes.',
    'Pour un acces sensible, demande de passer par megafitauth.web.app avec le compte Microsoft autorise.',
    'Confidentialite stricte: ne donne jamais de PIN, token, cle API, detail technique interne, statut Render/Firebase/SQLite/Azure, statistiques/objectifs d un autre club, ou donnees privees.',
    'Utilise la memoire pour appeler les gens par leur prenom, reconnaitre leur club ou leur role, et eviter de redemander une info deja connue.',
    'Ne revele jamais une note de memoire brute.',
    'Suivi des tickets: si le contexte liste des tickets encore ouverts pour cette personne, tu peux la relancer ou dire que tu es toujours dessus, mais ne dis jamais que c est regle.',
    'Si le contexte liste un ticket recemment REGLE pour cette personne, tu peux le lui annoncer naturellement (ex: "au fait ton souci d hier c est regle"). N annonce JAMAIS un ticket comme regle s il n est pas marque regle dans le contexte.',
    'Ne cite jamais un identifiant de ticket brut (ISSUE-XXXX) a la personne. Parle du probleme avec ses mots.',
    'Utilise seulement la connaissance projet, la memoire et le contexte recent. Si ce n est pas clair, dis que tu vas verifier au lieu d inventer.',
    '',
    'Project knowledge:',
    knowledge || '(No project knowledge has been added yet.)',
  ].join('\n');
}

function buildUserInput({ chatName, senderName, question, recentContext, memoryContext, issuesContext }) {
  return [
    chatName ? `Chat: ${chatName}` : '',
    senderName ? `Sender: ${senderName}` : '',
    memoryContext ? `Memory context:\n${memoryContext}` : '',
    issuesContext ? `Tickets context:\n${issuesContext}` : '',
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
  issuesContext,
  settings,
  issueDetected = false,
  audioTranscript = false,
}) {
  const runtimeSettings = settings || (await getSettings());
  const { markdown, sections } = await loadKnowledge();
  const input = [
    audioTranscript ? 'The customer message below was transcribed from a WhatsApp voice note.' : '',
    issueDetected
      ? 'The message describes an issue/error/blocker. Reply politely and naturally: reassure first, ask for missing details softly, say you are checking or seeing it with Omar, avoid accusatory wording, and do not mention ticket IDs.'
      : '',
    buildUserInput({ chatName, senderName, question, recentContext, memoryContext, issuesContext }),
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
