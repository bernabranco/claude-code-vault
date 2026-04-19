/**
 * HyDE (Hypothetical Document Embeddings) query expansion.
 *
 * At search time, ask an LLM to write a short passage that would answer the
 * user's query, then embed `${query}\n\n${passage}` instead of the raw query.
 * The hypothetical passage uses the same concrete vocabulary as real docs, so
 * cosine similarity with chunks climbs on vocabulary-gap queries (short
 * interrogative query vs. long declarative doc).
 *
 * Remote-only by design — requires ANTHROPIC_API_KEY. Falls back to the raw
 * query on missing key or API error, so enabling HyDE is never a hard failure.
 */

const HYDE_MODEL = "claude-haiku-4-5-20251001";
const HYDE_MAX_TOKENS = 200;
const HYDE_ENDPOINT = "https://api.anthropic.com/v1/messages";

const HYDE_SYSTEM =
  "You generate brief, concrete passages that sound like they came from engineering documentation. You use specific technical vocabulary (library names, protocol names, concrete verbs) rather than hedged or abstract language. You never preface or explain — you only emit the passage.";

const HYDE_USER = (query) =>
  `Write a 2-3 sentence passage from an engineering document that would answer this question:\n\n${query}\n\nReturn only the passage. No preamble, no quotes, no headings.`;

/**
 * Return either `${query}\n\n${hypoDoc}` (on success) or the raw query (on
 * missing key / API error). Never throws — callers can treat this as a
 * transparent upgrade.
 */
export async function expandWithHyde(query, opts = {}) {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    if (opts.warnIfNoKey !== false) {
      console.error(
        "[hyde] ANTHROPIC_API_KEY not set — falling back to raw query"
      );
    }
    return query;
  }

  try {
    const res = await fetch(HYDE_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: opts.model ?? HYDE_MODEL,
        max_tokens: HYDE_MAX_TOKENS,
        system: HYDE_SYSTEM,
        messages: [{ role: "user", content: HYDE_USER(query) }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `[hyde] API ${res.status} — falling back to raw query${
          body ? ` (${body.slice(0, 200)})` : ""
        }`
      );
      return query;
    }

    const data = await res.json();
    const passage = data?.content?.[0]?.text?.trim();
    if (!passage) return query;

    return `${query}\n\n${passage}`;
  } catch (err) {
    console.error(`[hyde] ${err.message} — falling back to raw query`);
    return query;
  }
}
