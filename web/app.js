import { analyze, LEGEND, gradeLabel, advise, applyEdit } from "../core/plainsong.js";

const input = document.getElementById("input");
const backdrop = document.getElementById("backdrop");
const legendEl = document.getElementById("legend");

let currentMarks = [];

const SAMPLE = `Hemingway was a writer who used short sentences. This tool was built to help you do the same.

It is often the case that writers, in an effort to sound authoritative, will utilize an abundance of complex words and construct extraordinarily long sentences that wander across multiple clauses before they finally arrive at whatever point was originally intended, which leaves the reader exhausted.

I think that is a mistake. The fix is simple. Cut the adverbs that creep in needlessly. Watch for passive voice, because ideas are weakened when the subject is hidden. Prefer plain words.

Bold writing is clear writing.`;

// Build the legend rows once.
const legendRows = {};
for (const item of LEGEND) {
  const li = document.createElement("li");
  li.className = "zero";
  const sw = document.createElement("span");
  sw.className = "swatch";
  sw.style.background = item.color;
  const name = document.createElement("span");
  name.className = "lname";
  name.textContent = item.label;
  const count = document.createElement("span");
  count.className = "lcount";
  count.textContent = "0";
  li.append(sw, name, count);
  legendEl.appendChild(li);
  legendRows[item.type] = { li, count };
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// Segment-based renderer: split the text at every mark boundary and emit one
// span per segment carrying the classes of all marks covering it. Handles any
// overlap (sentence background + word underline) without nesting headaches.
function render(text, marks) {
  if (!marks.length) {
    backdrop.textContent = text;
    return;
  }
  const bounds = new Set([0, text.length]);
  for (const m of marks) { bounds.add(m.from); bounds.add(m.to); }
  const points = [...bounds].sort((a, b) => a - b);

  let html = "";
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i], to = points[i + 1];
    if (from === to) continue;
    const classes = marks.filter((m) => m.from <= from && m.to >= to).map((m) => m.type);
    const chunk = escapeHtml(text.slice(from, to));
    html += classes.length ? `<span class="seg ${classes.join(" ")}">${chunk}</span>` : chunk;
  }
  // trailing newline needs a guard so the backdrop keeps the textarea's height
  backdrop.innerHTML = html + (text.endsWith("\n") ? "\n" : "");
}

function fmtTime(sec) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

function run() {
  const text = input.value;
  const { marks, stats } = analyze(text);
  currentMarks = marks;
  render(text, marks);

  document.getElementById("grade-num").textContent = stats.grade > 0 ? stats.grade : "—";
  document.getElementById("grade-label").textContent =
    stats.words ? gradeLabel(stats.grade) + " reading level" : "Readability grade";
  document.getElementById("words").textContent = stats.words;
  document.getElementById("sentences").textContent = stats.sentences;
  document.getElementById("reading").textContent = fmtTime(stats.readingTimeSec);

  for (const [type, { li, count }] of Object.entries(legendRows)) {
    const n = stats.counts[type] || 0;
    count.textContent = n;
    li.classList.toggle("zero", n === 0);
  }
}

// keep backdrop scroll synced with the textarea
input.addEventListener("scroll", () => {
  backdrop.scrollTop = input.scrollTop;
  backdrop.scrollLeft = input.scrollLeft;
});

let raf = 0;
input.addEventListener("input", () => {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(run);
});

document.getElementById("sample").addEventListener("click", () => {
  input.value = SAMPLE;
  run();
  input.focus();
});

document.getElementById("toggle").addEventListener("click", (e) => {
  const off = document.body.classList.toggle("hl-off");
  e.target.setAttribute("aria-pressed", String(!off));
  e.target.textContent = `Highlights: ${off ? "off" : "on"}`;
});

// ---- click-to-suggest popover ----
const pop = document.createElement("div");
pop.className = "ps-popover";
pop.hidden = true;
document.body.appendChild(pop);

function closePop() { pop.hidden = true; }

function applyFixAndClose(fix) {
  const { text, caret } = applyEdit(input.value, fix.from, fix.to, fix.insert);
  input.value = text;
  run();
  closePop();
  input.focus();
  input.setSelectionRange(caret, caret);
}

function openPop(mark, x, y) {
  const a = advise(mark, input.value);
  pop.replaceChildren();

  const head = document.createElement("div");
  head.className = "ps-pop-head";
  const dot = document.createElement("span");
  dot.className = "ps-pop-dot";
  dot.style.background = a.color;
  const title = document.createElement("span");
  title.textContent = a.heading;
  head.append(dot, title);
  pop.append(head);

  const msg = document.createElement("div");
  msg.className = "ps-pop-msg";
  msg.textContent = a.message;
  pop.append(msg);

  if (a.fixes.length) {
    const fixes = document.createElement("div");
    fixes.className = "ps-pop-fixes";
    for (const f of a.fixes) {
      const b = document.createElement("button");
      b.className = "ps-pop-fix";
      b.textContent = f.label;
      b.onclick = () => applyFixAndClose(f);
      fixes.append(b);
    }
    pop.append(fixes);
  }

  pop.hidden = false;
  const pw = pop.offsetWidth, ph = pop.offsetHeight;
  let px = x, py = y + 16;
  if (px + pw > window.innerWidth - 12) px = window.innerWidth - pw - 12;
  if (py + ph > window.innerHeight - 12) py = y - ph - 16;
  pop.style.left = `${Math.max(12, px)}px`;
  pop.style.top = `${Math.max(12, py)}px`;
}

// pick the most specific (smallest) mark under the caret
function markAt(pos) {
  return currentMarks
    .filter((m) => pos >= m.from && pos <= m.to)
    .sort((a, b) => (a.to - a.from) - (b.to - b.from))[0];
}

input.addEventListener("click", (e) => {
  const hit = markAt(input.selectionStart);
  if (hit) openPop(hit, e.clientX, e.clientY);
  else closePop();
});

document.addEventListener("mousedown", (e) => {
  if (!pop.hidden && !pop.contains(e.target) && e.target !== input) closePop();
});
window.addEventListener("keydown", (e) => { if (e.key === "Escape") closePop(); });

input.value = SAMPLE;
run();
