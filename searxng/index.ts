/** Recherche web par une instance SearXNG auto-hébergée : aucun jeton, aucun compte. */
import { AddonCollectError, type AddonDefinition, type AddonHttpResponse } from '#cornelius/addons';
import { compile } from '#cornelius/validation';
import { clip, plainText } from '../_lib/flux.js';
import configSchema from './config.schema.json' with { type: 'json' };
import dataSchema from './data.schema.json' with { type: 'json' };

type SearxngConfig = {
  baseUrl: string;
  language: string;
  safesearch: 0 | 1 | 2;
  results: number;
};

type SearxngResult = {
  title: string;
  url: string;
  site: string;
  snippet: string | null;
  publishedAt: string | null;
};

type SearxngData =
  | {
      kind: 'results';
      query: string;
      answers: string[];
      infobox: { title: string; text: string; url: string | null } | null;
      results: SearxngResult[];
    }
  | { kind: 'status'; results: number; engines: number };

/**
 * Réponse de `GET /search?format=json` : seuls les champs utilisés sont contrôlés. Une
 * réponse directe est une chaîne dans les anciennes versions, un objet dans les récentes.
 */
type SearchPayload = {
  results: {
    url: string;
    title: string;
    content?: string | null;
    publishedDate?: string | null;
    engine?: string;
  }[];
  answers?: (string | { answer?: unknown })[];
  infoboxes?: { infobox?: unknown; content?: unknown; id?: unknown }[];
};

const validateSearch = compile<SearchPayload>({
  type: 'object',
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        required: ['url', 'title'],
        properties: {
          url: { type: 'string' },
          title: { type: 'string' },
          content: { type: ['string', 'null'] },
          publishedDate: { type: ['string', 'null'] },
          engine: { type: 'string' },
        },
      },
    },
    answers: { type: 'array' },
    infoboxes: { type: 'array', items: { type: 'object' } },
  },
});

const maxQueryChars = 400;
/** Plusieurs moteurs interrogés en parallèle : SearXNG attend le plus lent. */
const searchTimeoutMs = 10_000;

/** Précisions à la voix, traduites vers les paramètres de SearXNG. */
const periods = { jour: 'day', semaine: 'week', mois: 'month', annee: 'year' } as const;
const categories = { general: 'general', actualites: 'news' } as const;

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  // SearXNG surligne les mots trouvés (<b>, <span class="highlight">) : sans espace ajouté.
  const plain = plainText(value.replace(/<\/?(?:b|strong|em|i|mark|span)\b[^>]*>/giu, ''));
  return plain ? clip(plain, max) : null;
};

function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function day(value: string | null | undefined): string | null {
  return value && /^\d{4}-\d{2}-\d{2}/u.test(value) ? value.slice(0, 10) : null;
}

function frenchDate(iso: string): string {
  const [year, month, dayOfMonth] = iso.split('-');
  return `${dayOfMonth}/${month}/${year}`;
}

/** Traduit un statut d'erreur de SearXNG ; son message brut n'est jamais repris. */
function statusError(response: AddonHttpResponse): AddonCollectError {
  if (response.status === 403)
    return new AddonCollectError(
      'forbidden',
      'SearXNG refuse le format JSON : ajoutez « json » à search.formats dans settings.yml.',
    );
  if (response.status === 429)
    return new AddonCollectError(
      'quota',
      'SearXNG limite les requêtes : désactivez son limiteur pour l’adresse de Cornelius.',
      true,
    );
  if (response.status === 404)
    return new AddonCollectError('not_found', 'Aucune instance SearXNG à cette adresse.');
  if (response.status >= 500)
    return new AddonCollectError('unavailable', 'SearXNG a rencontré une erreur.', true);
  return new AddonCollectError(
    'upstream',
    `Réponse HTTP ${response.status} inattendue de SearXNG.`,
  );
}

const addon: AddonDefinition<SearxngConfig, SearxngData> = {
  id: 'searxng',
  apiVersion: 1,
  version: '1.0.0',
  minCoreVersion: '0.2.0',
  sourceLabel: 'SearXNG',
  display: {
    name: 'Recherche web',
    description: 'Cherche sur le web par votre instance SearXNG, sans jeton ni compte.',
    icon: 'book-open',
    keywords: ['recherche', 'web', 'internet', 'searxng', 'moteur', 'actualité', 'question'],
    example: { label: 'SearXNG de la maison', ref: 'web' },
    spoken: { head: 'la recherche', repeats: ['searxng', 'recherche'] },
  },
  configVersion: 1,
  configSchema,
  configDefaults: {
    baseUrl: 'http://127.0.0.1:8080',
    language: 'fr',
    safesearch: 1,
    results: 5,
  },
  dataVersion: 1,
  dataSchema,
  // Seul l'état de l'instance (Tester) est gardé ; une recherche ne passe jamais par le cache.
  freshMs: 5 * 60_000,
  tools: [
    {
      name: 'ask',
      description:
        'Chercher sur le web avec SearXNG et afficher les premiers résultats. Utiliser pour une ' +
        'information récente ou absente de tes connaissances : actualité, résultat sportif, ' +
        'horaires d’un lieu, sortie d’un film, prix, personne ou événement. query : quelques ' +
        'mots-clés précis en français, sans pronom (« et lui ? » devient « âge de Thomas ' +
        'Pesquet »). Répondre à partir des extraits seulement, en citant le site ; si aucun ' +
        'extrait ne répond, le dire, sans compléter.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['instanceRef', 'query'],
        properties: {
          instanceRef: { type: ['string', 'null'] },
          query: { type: 'string' },
        },
      },
      query: { maxLength: maxQueryChars },
      arguments: {
        periode: {
          type: 'string',
          enum: Object.keys(periods),
          description: 'Limiter aux pages récentes : jour, semaine, mois ou annee.',
        },
        categorie: {
          type: 'string',
          enum: Object.keys(categories),
          description: 'actualites pour les articles de presse ; general par défaut.',
        },
      },
    },
  ],
  async collect(context) {
    const { language, safesearch } = context.config;
    const baseUrl = context.config.baseUrl.replace(/\/+$/u, '');
    // Lecture ordinaire (Tester) : une recherche neutre vérifie l'adresse et le format JSON.
    const query = context.query?.slice(0, maxQueryChars) ?? 'SearXNG';
    const period = context.args?.periode as keyof typeof periods | undefined;
    const category = context.args?.categorie as keyof typeof categories | undefined;
    const params = new URLSearchParams({
      q: query,
      format: 'json',
      language,
      safesearch: String(safesearch),
      categories: categories[category ?? 'general'],
    });
    if (period) params.set('time_range', periods[period]);
    const response = await context.http.fetch({
      url: `${baseUrl}/search?${params}`,
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: context.signal,
      timeoutMs: searchTimeoutMs,
      maxBytes: 1024 * 1024,
    });
    if (response.status !== 200) throw statusError(response);
    let payload: unknown;
    try {
      payload = response.json();
    } catch {
      // Une page HTML à la place du JSON : souvent une page de connexion devant l'instance.
      throw new AddonCollectError('malformed', 'Réponse de SearXNG illisible (JSON attendu).');
    }
    if (!validateSearch(payload))
      throw new AddonCollectError('malformed', 'Réponse de SearXNG incomplète.');

    if (context.query === undefined) {
      const engines = new Set(payload.results.map((result) => result.engine).filter(Boolean));
      return {
        data: { kind: 'status', results: payload.results.length, engines: engines.size },
        empty: payload.results.length === 0,
        source: { provider: 'searxng', sourceId: 'instance' },
      };
    }

    // Une même page peut revenir de plusieurs moteurs : SearXNG les fusionne déjà, on
    // écarte seulement les adresses illisibles et les doublons restants.
    const seen = new Set<string>();
    const results: SearxngResult[] = [];
    for (const result of payload.results) {
      if (results.length === context.config.results) break;
      const url = httpUrl(result.url);
      const title = text(result.title, 200);
      if (!url || !title || seen.has(url)) continue;
      seen.add(url);
      results.push({
        title,
        url,
        site: clip(new URL(url).hostname.replace(/^www\./u, ''), 120),
        snippet: text(result.content, 400),
        publishedAt: day(result.publishedDate),
      });
    }
    const answers = (payload.answers ?? [])
      .map((answer) => text(typeof answer === 'string' ? answer : answer?.answer, 300))
      .filter((answer): answer is string => answer !== null)
      .slice(0, 3);
    const box = payload.infoboxes?.[0];
    const infoboxTitle = text(box?.infobox, 120);
    const infoboxText = text(box?.content, 600);
    return {
      data: {
        kind: 'results',
        query: clip(query, 500),
        answers,
        infobox:
          infoboxTitle && infoboxText
            ? { title: infoboxTitle, text: infoboxText, url: httpUrl(box?.id) }
            : null,
        results,
      },
      empty: results.length === 0 && answers.length === 0 && !infoboxText,
      source: { provider: 'searxng', sourceId: 'web' },
    };
  },
  present(snapshot) {
    const data = snapshot.data;
    if (!data) throw new Error('Aucun résultat à présenter.');
    if (data.kind === 'status')
      return {
        title: 'Recherche web',
        primaryValue: `${data.results} résultat${data.results > 1 ? 's' : ''}`,
        subtitle: `${data.engines} moteur${data.engines > 1 ? 's' : ''} ${data.engines > 1 ? 'ont' : 'a'} répondu`,
        description: null,
        items: [],
        summary:
          data.results > 0
            ? `SearXNG répond : ${data.results} résultats de ${data.engines} moteurs pour la recherche de test.`
            : 'SearXNG répond, mais aucun moteur n’a donné de résultat pour la recherche de test.',
        sources: ['searxng'],
      };
    const direct = data.answers[0] ?? data.infobox?.text ?? null;
    if (data.results.length === 0 && !direct)
      return {
        title: 'Recherche web',
        primaryValue: null,
        subtitle: clip(data.query, 120),
        description: null,
        items: [],
        summary: `Aucun résultat pour « ${clip(data.query, 200)} ».`,
        sources: ['searxng'],
      };
    // Le modèle reçoit aussi `data` (extraits complets) ; la phrase garde l'essentiel.
    const first = data.results[0];
    const facts = [
      data.answers[0] ? `Réponse directe : ${data.answers[0]}` : null,
      data.infobox ? `${data.infobox.title} : ${data.infobox.text}` : null,
      first ? `${first.site} : ${first.snippet ?? first.title}` : null,
    ].filter((fact): fact is string => fact !== null);
    return {
      title: 'Recherche web',
      primaryValue: null,
      subtitle: clip(data.query, 120),
      description: direct ? clip(direct, 500) : null,
      items: data.results.map((result) => ({
        label: clip(result.title, 80),
        value: result.publishedAt
          ? `${result.site} · ${frenchDate(result.publishedAt)}`
          : result.site,
      })),
      summary: clip(facts.join(' '), 500),
      sources: ['searxng'],
    };
  },
};

export default addon;
