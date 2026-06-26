// Minimal assertions for the analyzer. Run: node core/plainsong.test.mjs
import { analyze, MARK, gradeLabel, advise, applyFix, applyEdit } from "./plainsong.js";

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

// 9. advise(): complex word offers a "Use X" fix
{
  const t = "We will utilize it.";
  const m = analyze(t).marks.find((x) => x.type === MARK.COMPLEX);
  const a = advise(m, t);
  ok("complex advice heading", a.heading.toLowerCase().includes("complex"));
  ok("complex offers a 'Use \"use\"' fix", a.fixes.some((f) => f.insert === "use"));
}

// 10. advise(): adverb gets a remove fix
{
  const t = "She ran quickly.";
  const m = analyze(t).marks.find((x) => x.type === MARK.ADVERB);
  const a = advise(m, t);
  ok("adverb has a remove fix", a.fixes.some((f) => f.insert === "" && f.label === "Remove it"));
}

// 11. advise(): passive with named agent yields an active-voice rewrite
{
  const t = "The cake was baked by Maria.";
  const m = analyze(t).marks.find((x) => x.type === MARK.PASSIVE);
  const a = advise(m, t);
  const fix = a.fixes.find((f) => /active/i.test(f.label));
  ok("passive offers an active rewrite", !!fix);
  const r = fix && applyEdit(t, fix.from, fix.to, fix.insert);
  ok("active rewrite is correct", r && r.text === "Maria baked the cake.");
}

// 11b. irregular participle conjugates back to simple past
{
  const t = "The novel was written by a recluse.";
  const m = analyze(t).marks.find((x) => x.type === MARK.PASSIVE);
  const fix = advise(m, t).fixes.find((f) => /active/i.test(f.label));
  const r = fix && applyEdit(t, fix.from, fix.to, fix.insert);
  ok("irregular passive rewrite", r && r.text === "A recluse wrote the novel.");
}

// 11c. agentless passive gives guidance, no rewrite fix
{
  const t = "Mistakes were made.";
  const m = analyze(t).marks.find((x) => x.type === MARK.PASSIVE);
  const a = advise(m, t);
  ok("agentless passive has no rewrite fix", !a.fixes.some((f) => /active/i.test(f.label)));
}

// 11d. hard sentence proposes a split at a conjunction
{
  const t = "We shipped the feature on Friday, and the whole team celebrated the launch " +
            "with a long dinner downtown afterward.";
  const m = analyze(t).marks.find((x) => x.type === MARK.HARD || x.type === MARK.VERY_HARD);
  const a = advise(m, t);
  const fix = a.fixes.find((f) => /split/i.test(f.label));
  ok("hard sentence offers a split", !!fix);
  const r = fix && applyEdit(t, fix.from, fix.to, fix.insert);
  ok("split produces two sentences", r && /Friday\. The whole team/.test(r.text));
}

// 12. applyEdit replaces a range
{
  const t = "We will utilize it.";
  const m = analyze(t).marks.find((x) => x.type === MARK.COMPLEX);
  const r = applyEdit(t, m.from, m.to, "use");
  ok("applyEdit swaps the word", r.text === "We will use it.");

  const t2 = "She ran quickly today.";
  const m2 = analyze(t2).marks.find((x) => x.type === MARK.ADVERB);
  const r2 = applyFix(t2, m2, "remove");
  ok("remove deletes word + a space", r2.text === "She ran today.");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
