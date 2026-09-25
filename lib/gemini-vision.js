// Gemini Vision API wrapper for card code recognition.
// Runs in the service worker (imported via importScripts) so the API key
// never appears in page-level JS. Depends on constants.js being loaded
// first (GEMINI_API_URL, STORAGE_KEYS).

const GEMINI_CARD_CODE_PROMPT = `You are a Pokemon TCG card code reader. Look at this Pokemon TCG card image and find the card code printed at the bottom-left of the card.

The code line format is: [RegulationMark] [SetCode] [CardNumber]/[SetTotal] [RarityCode]
Examples: "H M2a 017/193 RR", "H SV2D 069/071 U", "F S12 077/098 RRR", "H SV-P 161/SV-P P"

Also identify the Pokemon/card name printed on the card and return it in ENGLISH (e.g. "Pikachu", "Charizard ex", "Mewtwo VSTAR"). Even if the card is Japanese, translate the name to its English equivalent.

Also provide the Japanese name of this Pokemon/card (e.g. "ピカチュウ", "リザードンex", "ミューツーVSTAR", "フシギダネ"). If the card is already Japanese, use the exact name printed on it. If it is English, translate to the Japanese name. This is used to find the Japanese version of the card. If you cannot determine the Japanese name, set to null.

Also identify the full expansion/set name of this card (e.g. "Mega Evolution", "Scarlet & Violet", "Scarlet & Violet 151", "Pokemon 151", "McDonald's 25th Anniversary Promos"). Use the official English set name. This helps match the card to the correct set in databases.

Also determine the card's print language: "ja" if the card text is in Japanese (kana/kanji), "en" if in English.

If this card has a counterpart version in the OTHER language, provide the counterpart's set code, set name, and card number. "Counterpart" means the same card released in the other language — it will have the SAME artwork (same illustration, same pose, same character, same background) as the card you are looking at, just with text translated to the other language. The artwork is the key matching criterion: if the illustration is different (different pose, different background, different artist), it is NOT a counterpart even if it is the same Pokemon.
- If this is a JP (Japanese) card, the counterpart is the EN (English) version of the same card with the same artwork.
- If this is an EN (English) card, the counterpart is the JP (Japanese) version of the same card with the same artwork.
Examples:
  - JP card "SV2a 017/193" → EN counterpart is "MEW 017/165" (same artwork, different set code and total)
  - JP card "SV-P 197" → EN counterpart is "SVP 190" (same artwork, promo with different numbering)
  - EN card "MEW 006/165" → JP counterpart is "SV2a 006/193" (same artwork)
  - EN card "SVP 190" → JP counterpart is "SV-P 197" (same artwork)
Use your knowledge of Pokemon TCG to identify the counterpart with the same artwork. For main expansion sets the card number is usually the same between JP and EN; for high-class sets (suffix "a") and for promo sets it may differ. The app resolves JP↔EN set mappings from its own bundled card data, so do not spend effort recalling set mapping lists. If you know the counterpart set but not the exact card number, still provide crossSetCode and crossSetName, and set crossCardNumber to null.

Return ONLY a JSON object with these fields (no markdown, no explanation):
{"setCode": "M2a", "setName": "MEGA Dream ex", "cardNumber": "017/193", "rarityCode": "RR", "cardName": "Pikachu", "cardNameJp": "ピカチュウ", "language": "ja", "isPromo": false, "crossSetCode": null, "crossSetName": null, "crossCardNumber": null}

Rules:
- setCode: the expansion code printed on the card (e.g. M2a, SV2D, S12, SM10a, SV-P, swsh3). NOT the regulation mark letter. If the card is a promo card without a standard set code (like McDonald's promos, celebration promos, or special promotional cards), look carefully for any code printed on the card. If no set code is printed, set to null.
- setName: the full expansion/set name in English (e.g. "Mega Evolution", "Scarlet & Violet", "Pokemon 151", "McDonald's 25th Anniversary Promos", "McDonald's Collection 2021"). If you cannot determine it, set to null.
- cardNumber: the full number including slash (e.g. "017/193", "1/25"). Keep leading zeros.
- rarityCode: the rarity abbreviation (e.g. RR, SR, SAR, U, C, RRR, AR, HR, P). If not visible, set to null.
- cardName: the Pokemon or card name in ENGLISH (e.g. "Pikachu" even if the card says ピカチュウ). Exclude set name and card number.
- cardNameJp: the Japanese name of this Pokemon/card (e.g. "ピカチュウ", "リザードンex"). If you cannot determine it, set to null.
- language: "ja" for Japanese cards, "en" for English cards.
- isPromo: true if this is a promotional card (e.g. SV-P, SVP, SM-P, SMP, BPR, McDonald's, celebration promos, special promotional cards). false for main expansion sets. Promo cards typically have a single card number without a slash (e.g. "074" instead of "074/182"). Look for a small "PROMO" logo printed near the bottom-left corner of the card, around the card number and rarity area — this is a strong indicator that isPromo should be true.
- crossSetCode: the set code of the counterpart in the OTHER language (e.g. "SVP" for EN, "SV-P" for JP). Use your Pokemon TCG knowledge. This is CRITICAL for cross-version matching — always try to provide it even if you are not 100% sure. If truly unknown, set to null.
- crossSetName: the set name of the counterpart in the OTHER language (e.g. "SVP Black Star Promos", "Scarlet & Violet 151"). If unknown, set to null.
- crossCardNumber: the card number of the counterpart (e.g. "190", "017/193"). For main sets this is usually the same as the source card. For high-class sets (suffix "a") and promo sets it may differ. If unknown, set to null.
- If you cannot read any field, set it to null.
- Do NOT guess — only return what you can actually read from the card.
- Pay special attention to the set name printed on the card or card back. Common promo sets include: McDonald's Collection, McDonald's 25th Anniversary Promos, Celebrations, Pokemon 151, Shiny Vault, etc.
- If the card has a logo or set name printed on it (e.g. "McDonald's", "25th Anniversary", "Celebrations"), use that as the setName.`;

/**
 * Sends a card image to the Gemini Vision API and returns the structured
 * card code. Returns { success: false, error: 'NO_API_KEY' } when no API
 * key is configured so the caller can fall back to local OCR.
 *
 * @param {string} imageBase64 - raw base64 JPEG string (no data: prefix)
 * @returns {Promise<{success: boolean, data?: {setCode: ?string, cardNumber: ?string, rarityCode: ?string}, error?: string}>}
 */
async function recognizeCardWithGemini(imageBase64) {
  const settings = await getGeminiSettings();
  if (!settings.geminiApiKey) {
    return { success: false, error: 'NO_API_KEY' };
  }

  const requestBody = {
    contents: [{
      parts: [
        { text: GEMINI_CARD_CODE_PROMPT },
        {
          inline_data: {
            mime_type: 'image/jpeg',
            data: imageBase64,
          },
        },
      ],
    }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 256,
    },
  };

  const url = `${GEMINI_API_URL}?key=${settings.geminiApiKey}`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
  } catch (fetchErr) {
    return { success: false, error: `Network error: ${fetchErr.message}` };
  }

  if (!response.ok) {
    const errorBody = await response.text();
    return { success: false, error: `Gemini API error ${response.status}: ${errorBody}` };
  }

  const result = await response.json();
  const textOutput = result.candidates?.[0]?.content?.parts?.[0]?.text;
  console.log('[gemini] raw text output:', textOutput);
  if (!textOutput) {
    return { success: false, error: 'Gemini returned no text output' };
  }

  const outcome = parseGeminiTextOutput(textOutput);
  if (outcome.error) return { success: false, error: outcome.error };
  return { success: true, data: outcome.data };
}

/**
 * Gemini occasionally emits a malformed escape — observed: a truncated `\u30b`
 * inside the Japanese name — which makes JSON.parse throw "Bad Unicode escape".
 * Drop the backslash of any escape that is not valid JSON, so the rest of the
 * object still parses (the affected field keeps the raw characters).
 * @param {string} text
 * @returns {string}
 */
function repairJsonEscapes(text) {
  const validSingleEscapes = '"\\/bfnrt';
  let repaired = '';
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char !== '\\') {
      repaired += char;
      continue;
    }
    const next = text[i + 1];
    // Escapes are consumed in pairs: a valid one is copied whole (so the second
    // backslash of "\\\\" is not re-examined and dropped), an invalid one loses
    // only its backslash.
    if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
      repaired += text.slice(i, i + 6);
      i += 5;
    } else if (next && validSingleEscapes.includes(next)) {
      repaired += text.slice(i, i + 2);
      i += 1;
    }
  }
  return repaired;
}

/**
 * Maps the model's parsed object to the fields the app uses.
 * @param {object} parsed
 * @returns {object}
 */
function buildGeminiFields(parsed) {
  return {
    setCode: parsed.setCode || null,
    setName: parsed.setName || null,
    cardNumber: parsed.cardNumber || null,
    rarityCode: parsed.rarityCode || null,
    cardName: parsed.cardName || null,
    cardNameJp: parsed.cardNameJp || null,
    language: parsed.language || null,
    isPromo: parsed.isPromo === true,
    crossSetCode: parsed.crossSetCode || null,
    crossSetName: parsed.crossSetName || null,
    crossCardNumber: parsed.crossCardNumber || null,
  };
}

/**
 * Parses the JSON object out of the model's text output, retrying once with
 * repaired escapes.
 * @param {string} textOutput
 * @returns {{data?: object, error?: string}}
 */
function parseGeminiTextOutput(textOutput) {
  const jsonMatch = textOutput.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { error: `Could not parse Gemini response as JSON: ${textOutput}` };
  }
  const jsonText = jsonMatch[0];
  const repaired = repairJsonEscapes(jsonText);
  const candidates = repaired === jsonText ? [jsonText] : [jsonText, repaired];
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      // A plain log, not a warning: this recovery is expected, and console.warn
      // prints a stack trace that reads like a failure.
      if (candidate !== jsonText) console.log('[gemini] parsed after repairing invalid JSON escapes');
      console.log('[gemini] parsed fields:', parsed);
      return { data: buildGeminiFields(parsed) };
    } catch (parseErr) {
      lastError = parseErr;
    }
  }
  return { error: `JSON parse error: ${lastError.message}` };
}

/**
 * Reads the geminiApiKey from chrome.storage.local.
 * @returns {Promise<{geminiApiKey?: string, defaultLanguage?: string}>}
 */
async function getGeminiSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return result[STORAGE_KEYS.SETTINGS] || {};
}
