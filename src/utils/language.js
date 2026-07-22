/**
 * Language code normalization between ISO 639-1, ISO 639-2/B, and full
 * English names. The mapping covers the most common subtitle languages.
 */

/** @type {Map<string, string>} lowercase key → ISO 639-1 */
const TO_639_1 = new Map();

/**
 * Seed the lookup table. Each entry is [iso639_1, iso639_2, englishName].
 * All three forms (plus the 639-1 itself) map back to the 639-1 code.
 */
const LANGUAGES = [
  ['en', 'eng', 'english'],
  ['fr', 'fra', 'french'],
  ['de', 'deu', 'german'],
  ['es', 'spa', 'spanish'],
  ['it', 'ita', 'italian'],
  ['pt', 'por', 'portuguese'],
  ['nl', 'nld', 'dutch'],
  ['pl', 'pol', 'polish'],
  ['ru', 'rus', 'russian'],
  ['ja', 'jpn', 'japanese'],
  ['ko', 'kor', 'korean'],
  ['zh', 'zho', 'chinese'],
  ['ar', 'ara', 'arabic'],
  ['tr', 'tur', 'turkish'],
  ['sv', 'swe', 'swedish'],
  ['da', 'dan', 'danish'],
  ['nb', 'nob', 'norwegian'],
  ['fi', 'fin', 'finnish'],
  ['cs', 'ces', 'czech'],
  ['el', 'ell', 'greek'],
  ['he', 'heb', 'hebrew'],
  ['hi', 'hin', 'hindi'],
  ['th', 'tha', 'thai'],
  ['vi', 'vie', 'vietnamese'],
  ['id', 'ind', 'indonesian'],
  ['ro', 'ron', 'romanian'],
  ['hu', 'hun', 'hungarian'],
  ['uk', 'ukr', 'ukrainian'],
  ['bg', 'bul', 'bulgarian'],
  ['hr', 'hrv', 'croatian'],
  ['sr', 'srp', 'serbian'],
  ['sk', 'slk', 'slovak'],
  ['sl', 'slv', 'slovenian'],
  ['ms', 'msa', 'malay'],
  ['fa', 'fas', 'persian'],
  ['bn', 'ben', 'bengali'],
  ['ta', 'tam', 'tamil'],
  ['te', 'tel', 'telugu'],
  ['ur', 'urd', 'urdu'],
  ['ca', 'cat', 'catalan'],
  ['et', 'est', 'estonian'],
  ['lv', 'lav', 'latvian'],
  ['lt', 'lit', 'lithuanian'],
  ['is', 'isl', 'icelandic'],
  ['mk', 'mkd', 'macedonian'],
  ['sq', 'sqi', 'albanian'],
  ['bs', 'bos', 'bosnian'],
  ['ka', 'kat', 'georgian'],
  ['az', 'aze', 'azerbaijani'],
  ['kk', 'kaz', 'kazakh'],
  ['uz', 'uzb', 'uzbek'],
  ['mn', 'mon', 'mongolian'],
  ['my', 'mya', 'burmese'],
  ['km', 'khm', 'khmer'],
  ['sw', 'swa', 'swahili'],
  ['af', 'afr', 'afrikaans'],
  ['eu', 'eus', 'basque'],
  ['gl', 'glg', 'galician'],
  ['cy', 'cym', 'welsh'],
  ['ga', 'gle', 'irish'],
  ['mt', 'mlt', 'maltese'],
  ['fil', 'fil', 'filipino'],
  ['lo', 'lao', 'lao'],
  ['si', 'sin', 'sinhala'],
  ['ne', 'nep', 'nepali'],
  ['am', 'amh', 'amharic'],
  ['so', 'som', 'somali'],
  ['ha', 'hau', 'hausa'],
  ['yo', 'yor', 'yoruba'],
  ['zu', 'zul', 'zulu'],
];

for (const [iso1, iso2, name] of LANGUAGES) {
  TO_639_1.set(iso1, iso1);
  TO_639_1.set(iso2, iso1);
  TO_639_1.set(name, iso1);
}

// Common aliases that don't follow the pattern above.
const ALIASES = new Map([
  ['fre', 'fr'],   // ISO 639-2/T for French
  ['ger', 'de'],   // ISO 639-2/T for German
  ['dut', 'nl'],   // ISO 639-2/T for Dutch
  ['cze', 'cs'],   // ISO 639-2/T for Czech
  ['gre', 'el'],   // ISO 639-2/T for Greek
  ['rum', 'ro'],   // ISO 639-2/T for Romanian
  ['slo', 'sk'],   // ISO 639-2/T for Slovak
  ['chi', 'zh'],   // ISO 639-2/T for Chinese
  ['per', 'fa'],   // ISO 639-2/T for Persian
  ['baq', 'eu'],   // ISO 639-2/T for Basque
  ['ice', 'is'],   // ISO 639-2/T for Icelandic
  ['mac', 'mk'],   // ISO 639-2/T for Macedonian
  ['may', 'ms'],   // ISO 639-2/T for Malay
  ['bur', 'my'],   // ISO 639-2/T for Burmese
  ['arm', 'hy'],   // ISO 639-2/T for Armenian
  ['geo', 'ka'],   // ISO 639-2/T for Georgian
  ['tib', 'bo'],   // ISO 639-2/T for Tibetan
  ['wel', 'cy'],   // ISO 639-2/T for Welsh
  ['pt-br', 'pt'], // Brazilian Portuguese
  ['pt-br', 'pt'],
  ['zh-cn', 'zh'], // Simplified Chinese
  ['zh-tw', 'zh'], // Traditional Chinese
  ['zh-hans', 'zh'],
  ['zh-hant', 'zh'],
  ['sr-latn', 'sr'],
  ['sr-cyrl', 'sr'],
  ['no', 'nb'],    // generic Norwegian → Bokmål
  ['nor', 'nb'],
  ['iw', 'he'],    // legacy Hebrew code
  ['in', 'id'],    // legacy Indonesian code
  ['ji', 'yi'],    // legacy Yiddish code
  ['jw', 'jv'],    // legacy Javanese code
  ['mo', 'ro'],    // legacy Moldavian
  ['sh', 'sr'],    // legacy Serbo-Croatian
]);

for (const [alias, iso1] of ALIASES) {
  TO_639_1.set(alias, iso1);
}

/**
 * Normalize a language code or name to ISO 639-1.
 *
 * Accepts ISO 639-1 ("en"), ISO 639-2/B ("eng"), ISO 639-2/T ("fre"),
 * full English names ("English"), and common aliases ("pt-br", "zh-cn").
 * Matching is case-insensitive.
 *
 * @param {string} code - Language code or name.
 * @returns {string} ISO 639-1 code, or the lowercased input if unrecognized.
 */
export function normalizeLang(code) {
  if (typeof code !== 'string' || code.trim() === '') return '';
  const key = code.trim().toLowerCase();
  return TO_639_1.get(key) ?? key;
}

/**
 * Alias for {@link normalizeLang} — explicitly named for the 639-1 target.
 *
 * @param {string} code
 * @returns {string}
 */
export function langTo639_1(code) {
  return normalizeLang(code);
}
