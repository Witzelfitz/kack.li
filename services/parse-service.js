import {
  cleanEpisodeTitle,
  normalizeChapters,
  normalizeFilmTitle,
  normalizeText,
  tryJsonObject,
  uniqueStrings,
} from '../lib/episode-utils.js';

const TITLE_PARSE_PROMPT = `Du ordnest Episoden des deutschen Podcasts "Kack & Sachgeschichten" dem zentralen Bezugswerk zu.
Die Episodentitel können direkte Werktitel, Wortspiele, eingedeutschte Varianten oder offensichtliche Anspielungen sein.
Antworte NUR mit validem JSON:

{
  "film_title": "kanonischer Titel oder null"
}

Regeln:
- Gib den kanonischen Titel des zentralen Films, der Serie, des Spiels oder der Franchise zurück, wenn die Folge klar diesem Werk gewidmet ist.
- Das gilt auch bei Wortspielen und Abwandlungen, z.B. "Der Top Gun Afterburner" → "Top Gun", "Der Mann in der scheissernen Maske" → "The Mask", "Die Shining Erscheinung" → "The Shining".
- Direkte Titel sollen ebenfalls erkannt werden, z.B. "Ghostbusters", "Harry Potter", "Black Panther", "Get Out", "Burn After Reading".
- Wenn die Folge mehrere Werke gleichwertig behandelt oder kein einzelner Titel klar im Mittelpunkt steht, gib null zurück.
- Ignoriere Episodennummern, "BONUS", "feat."-Zusätze und ähnliche Metadaten.
- Gib nur den Titel zurück, keine Erklärung.`;

const DETAILS_PARSE_PROMPT = `Du analysierst Beschreibungen des deutschen Podcasts "Kack & Sachgeschichten".
Extrahiere die folgenden Felder und antworte NUR mit validem JSON:

{
  "chapters": [ { "time": "HH:MM:SS", "title": "Kapitelname" } ],
  "guests":   [ "Name (ggf. mit Kontext)" ],
  "topics":   [ "Thema 1", "Thema 2" ]
}

Regeln:
- chapters: Nur bei expliziten Zeitstempeln (HH:MM:SS oder MM:SS), exakt übernehmen.
- guests: Nur echte Gäste, NICHT die Hosts Richard und Fred.
- guests: Zusätze wie Funktion, Podcast oder Künstlername dürfen erhalten bleiben, wenn sie im Text stehen.
- topics: 3–7 prägnante Stichworte zu den Hauptthemen.
- Leeres Array [] wenn nichts vorhanden.`;

export function createParseService(openai) {
  const enabled = !!openai;

  async function runJsonParse(systemPrompt, input) {
    if (!openai) throw new Error('OPENAI_API_KEY nicht gesetzt');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: input },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    });

    return tryJsonObject(completion.choices[0]?.message?.content);
  }

  async function extractFilmTitle(ep) {
    const input = [
      `Originaler Episodentitel: ${normalizeText(ep.title) || '(leer)'}`,
      `Bereinigter Episodentitel: ${cleanEpisodeTitle(ep.title) || '(leer)'}`,
      '',
      'Beschreibung:',
      ep.description || ep.summary || '(keine)',
    ].join('\n');

    const result = await runJsonParse(TITLE_PARSE_PROMPT, input);
    return normalizeFilmTitle(result.film_title);
  }

  async function extractEpisodeDetails(ep) {
    const input = `Titel: ${ep.title}\n\nBeschreibung:\n${ep.description || ep.summary || '(keine)'}`;
    const result = await runJsonParse(DETAILS_PARSE_PROMPT, input);

    return {
      chapters: normalizeChapters(result.chapters),
      guests: uniqueStrings(result.guests),
      topics: uniqueStrings(result.topics),
    };
  }

  async function parseEpisode(ep) {
    const film_title = await extractFilmTitle(ep);
    const details = await extractEpisodeDetails(ep);

    return {
      film_title,
      chapters: details.chapters,
      guests: details.guests,
      topics: details.topics,
    };
  }

  return {
    enabled,
    extractFilmTitle,
    parseEpisode,
  };
}
