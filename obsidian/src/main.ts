import {
  Plugin, PluginSettingTab, Setting, ItemView, WorkspaceLeaf,
  MarkdownView, debounce,
} from "obsidian";
import { ViewPlugin, Decoration, DecorationSet, EditorView, ViewUpdate } from "@codemirror/view";
import { Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
// Shared, framework-agnostic engine (same file the web app uses).
import { analyze, LEGEND, gradeLabel, MARK } from "../../core/plainsong.js";

const VIEW_TYPE = "plainsong-panel";
const CATEGORIES = ["veryHard", "hard", "passive", "adverb", "qualifier", "complex"] as const;
type Category = typeof CATEGORIES[number];

interface PlainsongSettings {
  enabled: boolean;
  style: "underline" | "background";
  show: Record<Category, boolean>;
}

const DEFAULT_SETTINGS: PlainsongSettings = {
  enabled: true,
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
    this.applyBodyClasses();

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("plainsong-status");

    this.registerEditorExtension(this.buildExtension());
    this.registerView(VIEW_TYPE, (leaf) => new PlainsongView(leaf, this));
    this.addSettingTab(new PlainsongSettingTab(this.app, this));

    this.addRibbonIcon("pencil", "Plainsong panel", () => this.activatePanel());
    this.addCommand({ id: "open-panel", name: "Open readability panel", callback: () => this.activatePanel() });
    this.addCommand({
      id: "toggle-highlights", name: "Toggle highlights",
      callback: async () => { this.settings.enabled = !this.settings.enabled; await this.saveSettings(); },
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

  // The CM6 extension: always emit every mark as a classed span. Visibility and
  // style are driven by body classes (see applyBodyClasses), so toggling a
  // setting is an instant CSS change with no editor rebuild.
  buildExtension() {
    const plugin = this;
    return ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) { this.decorations = this.build(view); }
        update(u: ViewUpdate) {
          if (u.docChanged || u.viewportChanged) {
            this.decorations = this.build(u.view);
            plugin.pushStats(u.view);
          }
        }
        build(view: EditorView): DecorationSet {
          const text = view.state.doc.toString();
          const { marks } = analyze(text);
          const ranges: Range<Decoration>[] = [];
          for (const m of marks) {
            if (m.from >= m.to) continue;
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
  }
}

// Right-side readability panel.
class PlainsongView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: PlainsongPlugin) { super(leaf); }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Plainsong"; }
  getIcon() { return "pencil"; }

  async onOpen() { this.render(this.plugin.lastStats); }

  render(stats: any) {
    const c = this.contentEl;
    c.empty();
    c.addClass("plainsong-panel");

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
