import {
  Plugin, PluginSettingTab, Setting, ItemView, WorkspaceLeaf,
  MarkdownView, debounce, addIcon, Notice, Menu,
} from "obsidian";
import { ViewPlugin, Decoration, DecorationSet, EditorView, ViewUpdate } from "@codemirror/view";
import { Range, StateEffect } from "@codemirror/state";

// Dispatched to every editor when settings change, so the decorations rebuild
// immediately (toggling no longer depends on CSS alone).
const refreshEffect = StateEffect.define<void>();
import { syntaxTree } from "@codemirror/language";
// Shared, framework-agnostic engine (same file the web app uses).
import { analyze, LEGEND, gradeLabel, MARK, advise } from "../../core/plainsong.js";

const VIEW_TYPE = "plainsong-panel";
const ICON_ID = "plainsong";
// Monochrome ribbon glyph: lines of text with one highlighted passage.
const ICON_SVG =
  '<g fill="currentColor">' +
  '<rect x="14" y="18" width="64" height="8"/>' +
  '<rect x="14" y="33" width="50" height="8"/>' +
  '<rect x="14" y="47" width="46" height="13"/>' +
  '<rect x="14" y="66" width="58" height="8"/>' +
  '<rect x="14" y="81" width="40" height="8"/>' +
  "</g>";
const CATEGORIES = ["veryHard", "hard", "passive", "adverb", "qualifier", "complex"] as const;
type Category = typeof CATEGORIES[number];

interface PlainsongSettings {
  enabled: boolean;
  style: "underline" | "background";
  show: Record<Category, boolean>;
}

const DEFAULT_SETTINGS: PlainsongSettings = {
  enabled: false, // load quiet; user opts in via the ribbon, command, or settings
  style: "underline",
  show: { veryHard: true, hard: true, passive: true, adverb: true, qualifier: true, complex: true },
};

// Don't flag prose inside code, inline code, or YAML frontmatter.
function inExcludedNode(view: EditorView, pos: number): boolean {
  const node = syntaxTree(view.state).resolveInner(pos, 1);
  for (let n: any = node; n; n = n.parent) {
    const name = (n.type?.name || "").toLowerCase();
    if (name.includes("code") || name.includes("frontmatter") || name.includes("math") || name.includes("hashtag")) {
      return true;
    }
  }
  return false;
}

export default class PlainsongPlugin extends Plugin {
  settings!: PlainsongSettings;
  private statusEl!: HTMLElement;
  lastStats: any = null;

  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    addIcon(ICON_ID, ICON_SVG);
    this.applyBodyClasses();

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("plainsong-status");

    this.registerEditorExtension(this.buildExtension());
    this.registerView(VIEW_TYPE, (leaf) => new PlainsongView(leaf, this));
    this.addSettingTab(new PlainsongSettingTab(this.app, this));

    // The ribbon opens the panel, which holds the on/off toggle, the grade, and
    // the counts. One discoverable entry point in the right sidebar.
    this.addRibbonIcon(ICON_ID, "Open Plainsong panel", () => this.activatePanel());
    this.addCommand({ id: "open-panel", name: "Open readability panel", callback: () => this.activatePanel() });
    this.addCommand({
      id: "toggle-highlights", name: "Toggle highlights on/off",
      callback: () => this.toggleHighlights(),
    });

    // Refresh the panel/status when the user switches notes.
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refreshActive()));
    this.app.workspace.onLayoutReady(() => this.refreshActive());
  }

  onunload() {
    document.body.removeClasses([
      "plainsong-on", "plainsong-style-underline", "plainsong-style-background",
      ...CATEGORIES.map((c) => `plainsong-hide-${c}`),
    ]);
  }

  // The CM6 extension. When highlights are disabled (or a category is hidden) we
  // emit no decorations at all, so "off" is genuinely off, not just CSS-hidden.
  // A refreshEffect dispatched on settings change forces an immediate rebuild.
  buildExtension() {
    const plugin = this;
    const viewPlugin = ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) { this.decorations = this.build(view); }
        update(u: ViewUpdate) {
          const refreshed = u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshEffect)));
          if (u.docChanged || u.viewportChanged || refreshed) {
            this.decorations = this.build(u.view);
            plugin.pushStats(u.view);
          }
        }
        build(view: EditorView): DecorationSet {
          if (!plugin.settings.enabled) return Decoration.none;
          const text = view.state.doc.toString();
          const { marks } = analyze(text) as { marks: any[] };
          const ranges: Range<Decoration>[] = [];
          for (const m of marks) {
            if (m.from >= m.to) continue;
            if (!plugin.settings.show[m.type as Category]) continue;
            if (inExcludedNode(view, m.from)) continue;
            const attrs: Record<string, string> = {};
            if (m.suggestion) attrs["aria-label"] = `Try: ${m.suggestion}`;
            ranges.push(
              Decoration.mark({
                class: `plainsong-mark plainsong-${m.type}`,
                attributes: attrs,
              }).range(m.from, m.to)
            );
          }
          return Decoration.set(ranges, true);
        }
      },
      { decorations: (v) => v.decorations }
    );

    // Click a highlight -> a menu explaining the issue with one-click fixes.
    const clickHandler = EditorView.domEventHandlers({
      click: (e, view) => plugin.handleClick(e as MouseEvent, view),
    });

    return [viewPlugin, clickHandler];
  }

  // Find the most specific highlighted mark under the click and open a fix menu.
  handleClick(e: MouseEvent, view: EditorView): boolean {
    if (!this.settings.enabled) return false;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos == null) return false;
    const { marks } = analyze(view.state.doc.toString()) as { marks: any[] };
    const hit = marks
      .filter((m) => pos >= m.from && pos <= m.to && this.settings.show[m.type as Category])
      .sort((a, b) => (a.to - a.from) - (b.to - b.from))[0];
    if (!hit || inExcludedNode(view, hit.from)) return false;
    this.showSuggestMenu(hit, e, view);
    return false; // let the normal click place the caret too
  }

  showSuggestMenu(mark: any, e: MouseEvent, view: EditorView) {
    const a = (advise as any)(mark, view.state.doc.toString());
    const menu = new Menu();
    menu.addItem((i) => i.setTitle(a.heading).setIsLabel(true));
    menu.addItem((i) => i.setTitle(a.message).setIsLabel(true));

    if (a.fixes.length) menu.addSeparator();
    for (const f of a.fixes) {
      const icon = f.insert === "" ? "trash" : "check";
      menu.addItem((i) =>
        i.setTitle(f.label).setIcon(icon).onClick(() => {
          view.dispatch({
            changes: { from: f.from, to: f.to, insert: f.insert },
            selection: { anchor: f.from + f.insert.length },
          });
        })
      );
    }

    menu.showAtMouseEvent(e);
  }

  // Force every open editor to rebuild its decorations now.
  refreshEditors() {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const cm = (leaf.view as any)?.editor?.cm as EditorView | undefined;
      cm?.dispatch({ effects: refreshEffect.of() });
    }
  }

  pushStats = debounce((view: EditorView) => {
    const { stats } = analyze(view.state.doc.toString());
    this.lastStats = stats;
    this.renderStatus(stats);
    this.panel?.render(stats);
  }, 150, true);

  refreshActive() {
    const mv = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!mv) { this.renderStatus(null); this.panel?.render(null); return; }
    const stats = analyze(mv.editor.getValue()).stats;
    this.lastStats = stats;
    this.renderStatus(stats);
    this.panel?.render(stats);
  }

  renderStatus(stats: any) {
    if (!stats || !stats.words) { this.statusEl.setText(""); return; }
    this.statusEl.setText(`Grade ${stats.grade} · ${stats.words} words`);
  }

  get panel(): PlainsongView | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    return (leaf?.view as PlainsongView) ?? null;
  }

  async activatePanel() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false)!;
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    this.refreshActive();
  }

  applyBodyClasses() {
    const b = document.body;
    b.toggleClass("plainsong-on", this.settings.enabled);
    b.toggleClass("plainsong-style-underline", this.settings.style === "underline");
    b.toggleClass("plainsong-style-background", this.settings.style === "background");
    for (const c of CATEGORIES) b.toggleClass(`plainsong-hide-${c}`, !this.settings.show[c]);
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.applyBodyClasses();
    this.refreshEditors();
  }

  async toggleHighlights() {
    this.settings.enabled = !this.settings.enabled;
    await this.saveSettings();
    this.panel?.render(this.lastStats);
    new Notice(`Plainsong highlights ${this.settings.enabled ? "on" : "off"}`);
  }
}

// Right-side readability panel.
class PlainsongView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: PlainsongPlugin) { super(leaf); }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Plainsong"; }
  getIcon() { return ICON_ID; }

  async onOpen() { this.render(this.plugin.lastStats); }

  render(stats: any) {
    const c = this.contentEl;
    c.empty();
    c.addClass("plainsong-panel");

    const on = this.plugin.settings.enabled;
    const toggle = c.createEl("button", {
      cls: `ps-toggle ${on ? "is-on" : "is-off"}`,
      text: on ? "Highlights on" : "Highlights off",
    });
    toggle.onclick = () => this.plugin.toggleHighlights();

    const grade = c.createDiv({ cls: "ps-grade" });
    grade.createDiv({ cls: "ps-grade-num", text: stats && stats.words ? String(stats.grade) : "—" });
    grade.createDiv({
      cls: "ps-grade-label",
      text: stats && stats.words ? `${gradeLabel(stats.grade)} reading level` : "Readability grade",
    });

    const readout = c.createDiv({ cls: "ps-readout" });
    const stat = (n: string | number, l: string) => {
      const row = readout.createDiv({ cls: "ps-row" });
      row.createSpan({ cls: "ps-num", text: String(n) });
      row.createSpan({ cls: "ps-lab", text: l });
    };
    stat(stats?.words ?? 0, "words");
    stat(stats?.sentences ?? 0, "sentences");
    stat(fmtTime(stats?.readingTimeSec ?? 0), "read time");

    const list = c.createDiv({ cls: "ps-legend" });
    for (const item of LEGEND) {
      const n = stats?.counts?.[item.type] ?? 0;
      const row = list.createDiv({ cls: `ps-leg ${n === 0 ? "ps-zero" : ""}` });
      const sw = row.createSpan({ cls: "ps-swatch" });
      sw.style.background = item.color;
      row.createSpan({ cls: "ps-name", text: item.label });
      row.createSpan({ cls: "ps-count", text: String(n) });
    }
  }
}

function fmtTime(sec: number) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

class PlainsongSettingTab extends PluginSettingTab {
  constructor(app: any, private plugin: PlainsongPlugin) { super(app, plugin); }
  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Enable highlights")
      .setDesc("Show readability highlights live in the editor.")
      .addToggle((t) => t.setValue(this.plugin.settings.enabled).onChange(async (v) => {
        this.plugin.settings.enabled = v; await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Highlight style")
      .setDesc("Underline keeps rendered markdown clean; background mimics the classic look.")
      .addDropdown((d) => d
        .addOption("underline", "Underline")
        .addOption("background", "Background")
        .setValue(this.plugin.settings.style)
        .onChange(async (v) => {
          this.plugin.settings.style = v as PlainsongSettings["style"]; await this.plugin.saveSettings();
        }));

    containerEl.createEl("h4", { text: "Categories" });
    const labels: Record<Category, string> = {
      veryHard: "Very hard sentences", hard: "Hard sentences", passive: "Passive voice",
      adverb: "Adverbs", qualifier: "Qualifiers", complex: "Complex words",
    };
    for (const c of CATEGORIES) {
      new Setting(containerEl).setName(labels[c]).addToggle((t) =>
        t.setValue(this.plugin.settings.show[c]).onChange(async (v) => {
          this.plugin.settings.show[c] = v; await this.plugin.saveSettings();
        }));
    }
  }
}
