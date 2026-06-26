// Minimal assertions for the analyzer. Run: node core/plainsong.test.mjs
import { analyze, MARK, gradeLabel } from "./plainsong.js";

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`); }
}
function has(marks, type, snippet, text) {
  return marks.some((m) => m.type === type && text.slice(m.from, m.to).toLowerCase().includes(snippet.toLowerCase()));
}

// 1. Adverb detection + whitelist
{
  const t = "She quickly ran. The reply only came early.";
  const { marks } = analyze(t);
  ok("flags 'quickly' as adverb", has(marks, MARK.ADVERB, "quickly", t));
  ok("does NOT flag 'reply' (whitelist)", !has(marks, MARK.ADVERB, "reply", t));
  ok("does NOT flag 'only' (whitelist)", !has(marks, MARK.ADVERB, "only", t));
  ok("does NOT flag 'early' (whitelist)", !has(marks, MARK.ADVERB, "early", t));
}

// 2. Passive voice: regular AND irregular participles (our upgrade)
{
  const t = "The ball was thrown. The book was written. The cake was baked.";
  const { marks } = analyze(t);
  ok("flags regular passive 'was baked'", has(marks, MARK.PASSIVE, "was baked", t));
  ok("flags irregular passive 'was written'", has(marks, MARK.PASSIVE, "was written", t));
  ok("flags irregular passive 'was thrown'", has(marks, MARK.PASSIVE, "was thrown", t));
}

// 3. Qualifiers
{
  const t = "I think this is maybe correct.";
  const { marks } = analyze(t);
  ok("flags 'I think' qualifier", has(marks, MARK.QUALIFIER, "i think", t));
  ok("flags 'maybe' qualifier", has(marks, MARK.QUALIFIER, "maybe", t));
}

// 4. Complex words carry suggestions
{
  const t = "We will utilize the system in order to win.";
  const { marks } = analyze(t);
  const utilize = marks.find((m) => m.type === MARK.COMPLEX && t.slice(m.from, m.to) === "utilize");
  ok("flags 'utilize' as complex", !!utilize);
  ok("'utilize' suggests 'use'", utilize && utilize.suggestion.includes("use"));
  ok("flags 'in order to' phrase", has(marks, MARK.COMPLEX, "in order to", t));
}

// 5. Sentence difficulty: short sentence is never hard
{
  const t = "The cat sat on the mat.";
  const { sentences } = analyze(t);
  ok("short sentence is normal (null level)", sentences[0].level === null);
}

// 6. Sentence difficulty: a long, dense sentence grades hard or very hard
{
  const t = "The comprehensive institutional framework necessitates substantial bureaucratic " +
            "intervention because numerous organizational stakeholders consistently demonstrate " +
            "considerable resistance toward transformational administrative initiatives.";
  const { sentences } = analyze(t);
  ok("long dense sentence is hard/veryHard",
    sentences[0].level === MARK.HARD || sentences[0].level === MARK.VERY_HARD);
}

// 7. Stats sanity
{
  const t = "Hello world. This is a test.";
  const { stats } = analyze(t);
  ok("counts words", stats.words === 6);
  ok("counts sentences", stats.sentences === 2);
  ok("produces a grade label", typeof gradeLabel(stats.grade) === "string");
}

// 8. Offsets are valid and in range
{
  const t = "I think the document was reviewed quickly by the committee yesterday.";
  const { marks } = analyze(t);
  ok("all marks have valid offsets", marks.every((m) => m.from >= 0 && m.to <= t.length && m.from < m.to));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
