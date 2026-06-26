// Plainsong analyzer core.
//
// A pure, DOM-free, dependency-free function. Give it text, get back character
// offsets for every highlight plus document stats. Both the web app and the
// Obsidian plugin map these offsets onto their own decoration systems.
//
// Sentence difficulty uses the Automated Readability Index (ARI), exactly as the
// real Hemingway Editor does:  grade = 4.71*(chars/word) + 0.5*(words/sentence) - 21.43
// counting raw characters, not syllables.

import {
  LY_WHITELIST, BE_VERBS, IRREGULAR_PARTICIPLES, QUALIFIERS, COMPLEX_WORDS,
} from "./wordlists.js";

// Mark types and the five-color taxonomy.
export const MARK = {
  HARD: "hard",            // sentence, yellow
  VERY_HARD: "veryHard",   // sentence, red
  ADVERB: "adverb",        // word, blue
  PASSIVE: "passive",      // phrase, green
  QUALIFIER: "qualifier",  // phrase, blue
  COMPLEX: "complex",      // word, purple
};

// --- tokenization -----------------------------------------------------------

// A "word" token: run of letters/digits/apostrophes. We keep offsets so every
// downstream mark can point back into the original string.
function tokenizeWords(text, base = 0) {
  const words = [];
  const re = /[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    words.push({ text: m[0], from: base + m.index, to: base + m.index + m[0].length });
  }
  return words;
}

// Split into sentences on . ! ? (and newlines as soft breaks), keeping offsets.
function splitSentences(text) {
  const sentences = [];
  const re = /[^.!?\n]+[.!?]*\n*|\n+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = m[0];
    if (!raw.trim()) continue;
    const from = m.index;
    const to = from + raw.length;
    sentences.push({ from, to, text: raw });
  }
  return sentences;
}

function countLetters(s) {
  const m = s.match(/[A-Za-z0-9]/g);
  return m ? m.length : 0;
}

function syllableEstimate(word) {
  // Rough vowel-group count, only used for the optional Flesch-Kincaid readout.
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const groups = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "")
    .match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}

// --- ARI sentence grading ---------------------------------------------------

// Per the Hemingway bundle. words/sentences term uses sentences = 1 here because
// we grade one sentence at a time.
function ariGrade(letters, words) {
  if (words === 0) return 0;
  const g = Math.round(4.71 * (letters / words) + 0.5 * words - 21.43);
  return g <= 0 ? 0 : g;
}

// words < 14 is always "normal" regardless of grade. This length gate is the
// part of Hemingway people most often get wrong.
function difficulty(words, grade) {
  if (words < 14) return null;
  if (grade >= 10 && grade < 14) return MARK.HARD;
  if (grade >= 14) return MARK.VERY_HARD;
  return null;
}

// --- word-level detectors ---------------------------------------------------

function isAdverb(word) {
  const w = word.toLowerCase();
  return /ly$/.test(w) && w.length > 2 && !LY_WHITELIST.has(w);
}

function isParticiple(word) {
  const w = word.toLowerCase();
  return /[a-z]ed$/.test(w) || IRREGULAR_PARTICIPLES.has(w);
}

// Build a lowercase-token view of a sentence for phrase matching.
function phraseMatches(sentenceText, baseOffset, phrase) {
  // Word-boundary, case-insensitive, returns [{from,to}] absolute offsets.
  const hits = [];
  const escaped = phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${escaped}\\b`, "gi");
  let m;
  while ((m = re.exec(sentenceText)) !== null) {
    hits.push({ from: baseOffset + m.index, to: baseOffset + m.index + m[0].length });
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return hits;
}

// --- main entry point -------------------------------------------------------

/**
 * analyze(text, opts) -> { sentences, marks, stats }
 *   marks:     [{ from, to, type, suggestion? }]  character offsets into `text`
 *   sentences: [{ from, to, words, grade, level }]
 *   stats:     { words, sentences, paragraphs, characters, readingTimeSec,
 *                grade, fleschKincaid, counts: { adverb, passive, qualifier,
 *                complex, hard, veryHard } }
 */
export function analyze(text, opts = {}) {
  const marks = [];
  const sentences = [];
  let totalWords = 0, totalLetters = 0, totalSyllables = 0;
  const counts = { adverb: 0, passive: 0, qualifier: 0, complex: 0, hard: 0, veryHard: 0 };

  for (const sent of splitSentences(text)) {
    const words = tokenizeWords(sent.text, sent.from);
    const letters = countLetters(sent.text);
    const grade = ariGrade(letters, words.length);
    const level = difficulty(words.length, grade);
    sentences.push({ from: sent.from, to: sent.to, words: words.length, grade, level });
    if (level === MARK.HARD) counts.hard++;
    if (level === MARK.VERY_HARD) counts.veryHard++;
    if (level) marks.push({ from: sent.from, to: sent.to, type: level });

    totalWords += words.length;
    totalLetters += letters;

    // adverbs
    for (const w of words) {
      totalSyllables += syllableEstimate(w.text);
      if (isAdverb(w.text)) {
        counts.adverb++;
        marks.push({ from: w.from, to: w.to, type: MARK.ADVERB });
      }
    }

    // passive voice: a "to be" verb followed by a participle (regular OR irregular)
    for (let i = 0; i < words.length - 1; i++) {
      if (BE_VERBS.has(words[i].text.toLowerCase()) && isParticiple(words[i + 1].text)) {
        counts.passive++;
        marks.push({ from: words[i].from, to: words[i + 1].to, type: MARK.PASSIVE });
      }
    }

    // qualifiers (phrase match within the sentence)
    for (const q of QUALIFIERS) {
      for (const hit of phraseMatches(sent.text, sent.from, q)) {
        counts.qualifier++;
        marks.push({ ...hit, type: MARK.QUALIFIER });
      }
    }

    // complex words / phrases
    for (const [phrase, alts] of Object.entries(COMPLEX_WORDS)) {
      for (const hit of phraseMatches(sent.text, sent.from, phrase)) {
        counts.complex++;
        marks.push({ ...hit, type: MARK.COMPLEX, suggestion: alts.join(", ") });
      }
    }
  }

  marks.sort((a, b) => a.from - b.from || a.to - b.to);

  const paragraphs = (text.split(/\n{2,}/).filter((p) => p.trim()).length) || (text.trim() ? 1 : 0);
  // Document-level ARI uses the real sentence count for the words/sentence term
  // (ariGrade() bakes in sentences=1 for per-sentence grading).
  const grade = totalWords === 0 || sentences.length === 0
    ? 0
    : Math.max(0, Math.round(4.71 * (totalLetters / totalWords) + 0.5 * (totalWords / sentences.length) - 21.43));
  const fleschKincaid = totalWords === 0 || sentences.length === 0
    ? 0
    : Math.round((0.39 * (totalWords / sentences.length) + 11.8 * (totalSyllables / totalWords) - 15.59) * 10) / 10;

  return {
    sentences,
    marks,
    stats: {
      words: totalWords,
      sentences: sentences.length,
      paragraphs,
      characters: text.length,
      readingTimeSec: Math.round((totalWords / 265) * 60), // ~265 wpm
      grade,
      fleschKincaid,
      counts,
    },
  };
}

// Color/legend metadata shared by both shells.
export const LEGEND = [
  { type: MARK.VERY_HARD, label: "Very hard sentence", color: "#f5a3a3" },
  { type: MARK.HARD,      label: "Hard sentence",      color: "#f5e0a3" },
  { type: MARK.PASSIVE,   label: "Passive voice",      color: "#a9d6a9" },
  { type: MARK.ADVERB,    label: "Adverb",             color: "#9ec5f0" },
  { type: MARK.QUALIFIER, label: "Qualifier",          color: "#c7b3e6" },
  { type: MARK.COMPLEX,   label: "Complex word",       color: "#d8b3e6" },
];

// Map an ARI grade to a friendly reading-level label.
export function gradeLabel(grade) {
  if (grade <= 0) return "—";
  if (grade >= 16) return "Post-graduate";
  if (grade >= 13) return "College";
  const map = ["", "1st grade", "2nd grade", "3rd grade", "4th grade", "5th grade",
    "6th grade", "7th grade", "8th grade", "9th grade", "10th grade", "11th grade", "12th grade"];
  return map[grade] || `Grade ${grade}`;
}
