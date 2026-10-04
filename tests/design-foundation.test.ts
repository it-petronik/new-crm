import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("foundation loads first and owns global theme values", () => {
  assert.match(read("src/app/globals.css"), /^@import "\.\/foundation\.css";/);
  for (const file of readdirSync(new URL("../src/app", import.meta.url)).filter(f => f.endsWith(".css") && f !== "foundation.css")) {
    // The print-only neutral reset is intentionally separate from UI themes.
    const screen = read(`src/app/${file}`).split("@media print")[0];
    assert.doesNotMatch(screen, /--(?:ink|muted|surface|bg|brand-action|brand-hover|brand-text|brand-highlight)\s*:/, `${file} must not redefine the app palette`);
  }
});

test("shared layout styles use semantic colors and no specificity escapes", () => {
  const css = read("src/components/ui/layout.module.css");
  assert.doesNotMatch(css, /!important|#[\da-f]{3,8}\b|rgba?\(/i);
  assert.match(css, /var\(--e-control-h-touch\)/);
  assert.match(css, /minmax\(min\(100%, 230px\), 1fr\)/);
});

test("chart series and compatibility aliases resolve from the same foundation", () => {
  const css = read("src/app/foundation.css");
  for (const token of ["--e-chart-1", "--e-chart-2", "--e-chart-3", "--e-chart-4", "--e-danger", "--e-control-h-touch", "--f-h", "--l-gutter", "--shell-sidebar"]) assert.ok(css.includes(`${token}:`), token);
  assert.match(css, /--accent: var\(--e-accent\)/);
  assert.match(css, /--text: var\(--e-text\)/);
  assert.doesNotMatch(read("src/components/insight-chart.tsx"), /#[\da-f]{6}\b/i);
});

test("typed components have active consumers, not just a disconnected library", () => {
  assert.match(read("src/components/workspace.tsx"), /<Surface padding="none" className=\{`record-list-surface \$\{recordStyles\.surface\}`\}>/);
  assert.match(read("src/components/pagination.tsx"), /<Toolbar className="list-query-controls"/);
  assert.match(read("src/components/content-calendar.tsx"), /<FormGrid>/);
  assert.match(read("src/components/mail-hub.tsx"), /<PageHeader title="Email"/);
});

test("Studio owns the new frame, navigation and tables without legacy geometry classes", () => {
  const workspace = read("src/components/workspace.tsx");
  assert.match(workspace, /data-design="studio"/);
  assert.match(workspace, /<StudioDashboard /);
  assert.match(workspace, /<table className=\{recordStyles.table\}>/);
  assert.doesNotMatch(workspace, /className="(?:main-shell|topbar|e-record-table e-table-balanced)"/);
  const sidebar = read("src/components/sidebar.tsx");
  assert.match(sidebar, /\.\/studio\/navigation.module.css/);
  assert.match(sidebar, /entries.filter\(entryAllowed\)/);
  assert.match(read("src/app/shell.css"), /\.app-shell:not\(\[data-design="studio"\]\) \.main-content.is-collaboration/);
});

test("Studio charts retain currency scope, permission gates and real zero baselines", () => {
  const source = read("src/components/studio/dashboard.tsx");
  assert.match(source, /filter\(\(r\) => r.currency === currency\)/);
  assert.match(source, /allowed.includes\("orders"\)/);
  assert.match(source, /allowed.includes\("leads"\)/);
  assert.match(source, /attentionItems\(actor, currentRecords\)/);
  assert.match(read("src/components/studio/dashboard.module.css"), /min-height: 0/);
  assert.match(read("src/components/studio/dashboard.module.css"), /prefers-reduced-motion: reduce/);
});

test("V2 inner pages own their layouts instead of reusing conflicting legacy containers", () => {
  const prospecting = read("src/components/commercial/prospecting.tsx");
  assert.match(prospecting, /className=\{styles.search\}/);
  assert.match(prospecting, /className=\{styles.query\}/);
  assert.doesNotMatch(prospecting, /className=[^\n]*apollo-(?:search-hero|query-form)/);
  assert.match(read("src/components/record/record-workspace.tsx"), /detailStyles.header/);
  assert.match(read("src/components/ai/action-center.tsx"), /studio\/action-center.module.css/);
  assert.doesNotMatch(read("src/components/studio/frame.module.css"), /global\(\.rw-header\)/);
  assert.doesNotMatch(read("src/components/workspace.tsx"), /className="bar-chart"/);
  assert.match(read("src/components/ui/controls.tsx"), /DialogLayerContext/);
});

test("new settings and time controls use shared theme roles rather than fixed colors", () => {
  for (const path of ["src/components/ui/time-picker.module.css", "src/components/workspace-settings.module.css", "src/components/studio/action-center.module.css"]) {
    assert.doesNotMatch(read(path), /#[\da-f]{3,8}\b|rgba?\(/i, path);
  }
  assert.match(read("src/components/ui/controls.tsx"), /type === "time"/);
  assert.match(read("src/components/workspace.tsx"), /<WorkspaceSettings /);
});

test("motion has explicit durations and preserves reduced-motion and theme-change overrides", () => {
  const css = read("src/app/interaction-system.css");
  assert.doesNotMatch(css, /transition\s*:\s*all\b/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(read("src/app/foundation.css"), /data-appearance-changing/);
  for (const token of ["--motion-fast", "--motion-enter", "--motion-layout", "--motion-chart"]) assert.ok(read("src/app/foundation.css").includes(`${token}:`));
});
