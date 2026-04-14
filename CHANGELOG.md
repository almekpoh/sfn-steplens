# Changelog

## [Unreleased]

### Added
- **‖N** suffix in Parallel node labels — shows the number of branches at a glance
- **‖N** entry added to the in-graph legend

---

All notable changes to StepLens are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.1.0] — 2026-04-14

### Added
- Initial release
- Interactive Cytoscape.js graph preview with dagre layout
- Color-coded nodes by state type
- Click-to-navigate (node → editor line)
- Serverless Framework YAML support
- **Raw JSON ASL** format support (previously only YAML)
- Serverless Framework flat wrapper format: `{ definition: { StartAt, States } }`
- **Cursor-to-graph highlight** — moving the cursor in the editor highlights the corresponding node in the graph preview
- `steplens.isSfnFile` context key controls toolbar icon visibility
- **Real-time linter** with rules R-1 through R-8 and W-1
- Inline diagnostics (squiggly underlines) via `vscode.DiagnosticCollection`
- `steplens.lintOnType`, `steplens.lintOnSave`, `steplens.autoDetect` settings
- **JSONata Choice condition** support — `Condition: "{% … %}"` used as edge label instead of `Variable` path
- Choice node color: yellow diamond (was a plain rectangle)
- Catch edge labels show full `ErrorEquals` array
- **Hover tooltips** on linter underlines — shows error/warning message with `$(error)` / `$(warning)` icons
- **Status bar item** — displays `✓ StepLens`, `⚠ N alertes`, or `✗ N erreurs`; click to open the Problems panel
- **Sub-graph tabs** for Parallel branches and Map iterators — each branch opens in its own tab beside "Main"
- All Cytoscape instances initialised upfront with `visibility:hidden` (keeps real container dimensions, fixing the 0×0 sizing issue that caused empty sub-graph views)
- **Export** to PNG and JPEG via ⬇ PNG / ⬇ JPEG buttons in the graph toolbar
- **Map `ItemProcessor`** support — newer ASL format (SDK v2 / AWS Console export) used `ItemProcessor` instead of `Iterator`; sub-graph tabs now appear for both
- **Double-click** to navigate into Parallel / Map sub-graph tabs (was single-click)
- Hint text updated: "Double-click Parallel/Map to explore sub-graph"
- **R-9** — Map `Iterator` / `ItemProcessor` validation (recursive lint, like R-7 for Parallel)
- **R-10** — `MaxConcurrency: 0` warning on Map states (unlimited concurrency)
- **← Main** back button — appears automatically when viewing a sub-graph tab
- **⊡ Fit** button in toolbar — recenters the graph
- **State count** badge on each tab (`Main (8)`, `ProcessBatch — Iterator (4)`)
- **↺** suffix in node label for states that have `Retry` configured
- **×N** suffix in Map node labels for `MaxConcurrency` (`×∞` when 0)
- `Assign`, `MaxConcurrency`, `InputPath`, `OutputPath`, `QueryLanguage` added to `AslState` interface
- **J-1** — Detects wrong fields per query language: `Parameters`↔`Arguments`, `OutputPath`↔`Output`, `InputPath`, `ResultPath` in JSONata mode
- **J-2** — Choice branches: `Variable` vs `Condition` per mode; warns when `Condition` is missing `{%…%}` delimiters
- **J-3** — Validates every `{%…%}` expression: empty, unclosed delimiters, `$eval()`, JSONPath `$.` inside JSONata, trailing operator
- **J-4** — `$states.result` scope check: error when used in Pass, Choice, Wait, Succeed, or Fail states
- `QueryLanguage` per-state override supported (`AslState.QueryLanguage`)
- Parallel branches and Map iterators inherit parent `QueryLanguage` for recursive linting
- **Syntax highlighting** for `{% … %}` JSONata expressions inside YAML and JSON files (TextMate grammar injection — colors adapt to your theme)
- **Keybinding** `Ctrl+Alt+G` / `Cmd+Alt+G` to open the graph preview
- **CHANGELOG.md**

### Fixed
- Parser now handles the Serverless Framework *named wrapper* format (`machineName: { definition: { States } }`), which was silently ignored before — example files now parse and lint correctly
- JSON state name detection: line-finder regex now matches both `StateName:` (YAML) and `"StateName":` (JSON)
- Choice branch edge labels no longer show `b1`, `b2` when `Variable` path is available
- `Catch` edge labels now show the full error name (`States.ALL`, `States.TaskFailed`) — the `States.` prefix was incorrectly stripped
- Cursor highlight now works for states inside Parallel branches and Map iterators — `stateAtLine()` previously only searched top-level states
- Highlight color reverted to orange (`#f5a623`) — it had been changed to cyan to avoid a conflict with Choice yellow, but the user preferred orange
- Preview no longer dezoom on every keystroke — structural change detection sends a lightweight `update` message that preserves zoom/pan instead of rebuilding the full HTML
- Choice node color changed to yellow (`#ffe033`) — was the same orange as the cursor highlight, causing confusion
- Single-click on Parallel/Map nodes previously switched to the sub-graph tab — now requires **double-click** (single-click still jumps to the line in the editor)
- Node `goto` and `nodeToTab` lookup now use the node `id` (= state name), not the display label, so `↺`/`×N` suffixes don't break navigation

### Improved
- Description updated to reflect 14 linter rules
- Added `jsonata` and `workflow` keywords for Marketplace discoverability
