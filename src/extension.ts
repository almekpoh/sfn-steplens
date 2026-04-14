import * as vscode from 'vscode';
import { AslParser, ParsedSfn } from './aslParser';
import { AslLinter, findLineForStateName } from './linter';
import { PreviewPanel } from './preview';

const SUPPORTED_LANGUAGES = ['yaml', 'json'];

export function activate(context: vscode.ExtensionContext) {
  const diagnostics = vscode.languages.createDiagnosticCollection('steplens');
  context.subscriptions.push(diagnostics);

  // ── Status bar item ────────────────────────────────────────────────────────
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = 'workbench.action.problems.focus';
  statusBar.tooltip = 'StepLens — cliquer pour ouvrir le panneau Problèmes';
  context.subscriptions.push(statusBar);

  // ── Command: open graph preview ────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('steplens.preview', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const parsed = AslParser.parse(editor.document.getText(), editor.document.languageId);
      if (!parsed) {
        vscode.window.showWarningMessage('StepLens: pas de définition Step Functions détectée.');
        return;
      }

      PreviewPanel.create(context, editor.document);
    })
  );

  // ── Command: manual lint ───────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('steplens.lint', () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) runLint(editor.document, diagnostics, statusBar);
    })
  );

  // ── Hover provider: show lint errors on the underlined range ─────────────
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(SUPPORTED_LANGUAGES, {
      provideHover(doc, position) {
        const diags = vscode.languages.getDiagnostics(doc.uri).filter(
          d => d.source === 'StepLens' && d.range.contains(position)
        );
        if (!diags.length) return;

        const md = new vscode.MarkdownString(undefined, true);
        md.supportThemeIcons = true;
        md.appendMarkdown('**StepLens**\n\n');
        for (const d of diags) {
          const icon = d.severity === vscode.DiagnosticSeverity.Error
            ? '$(error)'
            : '$(warning)';
          md.appendMarkdown(`${icon} ${d.message}\n\n`);
        }
        return new vscode.Hover(md);
      },
    })
  );

  // ── Auto-lint on keystroke ─────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(e => {
      const cfg = vscode.workspace.getConfiguration('steplens');
      if (SUPPORTED_LANGUAGES.includes(e.document.languageId)) {
        const isActive = vscode.window.activeTextEditor?.document === e.document;
        if (isActive) updateSfnContext(vscode.window.activeTextEditor);
        if (cfg.get('lintOnType')) {
          runLint(e.document, diagnostics, isActive ? statusBar : undefined);
        }
        if (PreviewPanel.currentPanel) {
          PreviewPanel.currentPanel.update(e.document);
        }
      }
    })
  );

  // ── Auto-lint on save ──────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(doc => {
      const cfg = vscode.workspace.getConfiguration('steplens');
      if (cfg.get('lintOnSave') && SUPPORTED_LANGUAGES.includes(doc.languageId)) {
        const isActive = vscode.window.activeTextEditor?.document === doc;
        runLint(doc, diagnostics, isActive ? statusBar : undefined);
      }
    })
  );

  // ── Clear diagnostics on close ─────────────────────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument(doc => diagnostics.delete(doc.uri))
  );

  // ── Cursor movement → highlight state in graph ────────────────────────────
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(e => {
      if (!PreviewPanel.currentPanel) return;
      const stateName = getStateNameAtCursor(e.textEditor);
      if (stateName) PreviewPanel.currentPanel.highlightState(stateName);
    })
  );

  // ── Active editor change → update icon + status bar ──────────────────────
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      updateSfnContext(editor);
      if (editor && SUPPORTED_LANGUAGES.includes(editor.document.languageId)) {
        runLint(editor.document, diagnostics, statusBar);
      } else {
        statusBar.hide();
      }
    })
  );

  // Set context for already-active editor on startup
  updateSfnContext(vscode.window.activeTextEditor);

  // Lint all already-open documents on activation
  vscode.workspace.textDocuments.forEach(doc => {
    if (SUPPORTED_LANGUAGES.includes(doc.languageId)) {
      const isActive = vscode.window.activeTextEditor?.document === doc;
      runLint(doc, diagnostics, isActive ? statusBar : undefined);
    }
  });
}

/**
 * Set the `steplens.isSfnFile` context key so the editor/title icon is shown
 * only when the active file contains a Step Functions definition.
 */
function updateSfnContext(editor: vscode.TextEditor | undefined) {
  const isSfn = editor != null
    && SUPPORTED_LANGUAGES.includes(editor.document.languageId)
    && AslParser.parse(editor.document.getText(), editor.document.languageId) != null;

  vscode.commands.executeCommand('setContext', 'steplens.isSfnFile', isSfn);
}

export function deactivate() {}

// ── Helpers ────────────────────────────────────────────────────────────────

function runLint(
  doc: vscode.TextDocument,
  col: vscode.DiagnosticCollection,
  statusBar?: vscode.StatusBarItem
) {
  const cfg = vscode.workspace.getConfiguration('steplens');
  if (!cfg.get('autoDetect')) return;

  const parsed = AslParser.parse(doc.getText(), doc.languageId);
  if (!parsed) {
    col.delete(doc.uri);
    statusBar?.hide();
    return;
  }

  const errors = AslLinter.lint(parsed.definition);

  const diags = errors.map(err => {
    const line = err.searchKey ? findLineForStateName(doc, err.searchKey) : 0;
    const range = new vscode.Range(
      new vscode.Position(line, 0),
      new vscode.Position(line, doc.lineAt(line).text.length)
    );
    const diag = new vscode.Diagnostic(range, err.message, err.severity);
    diag.source = 'StepLens';
    return diag;
  });

  col.set(doc.uri, diags);

  if (statusBar) {
    const errCount  = errors.filter(e => e.severity === vscode.DiagnosticSeverity.Error).length;
    const warnCount = errors.filter(e => e.severity === vscode.DiagnosticSeverity.Warning).length;

    if (errCount > 0) {
      statusBar.text = `$(error) StepLens: ${errCount} erreur${errCount > 1 ? 's' : ''}`;
      statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (warnCount > 0) {
      statusBar.text = `$(warning) StepLens: ${warnCount} alerte${warnCount > 1 ? 's' : ''}`;
      statusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      statusBar.text = '$(check) StepLens';
      statusBar.backgroundColor = undefined;
    }
    statusBar.show();
  }
}

/**
 * Walk backwards from lineIdx to find which state block the line belongs to.
 * Matches both YAML (`  StateName:`) and JSON (`  "StateName":`) formats.
 */
function stateAtLine(
  doc: vscode.TextDocument,
  parsed: ParsedSfn,
  lineIdx: number
): string | null {
  const stateNames = AslParser.allStateNames(parsed.definition);
  const lines = doc.getText().split('\n');
  for (let i = lineIdx; i >= 0; i--) {
    const line = lines[i];
    for (const name of stateNames) {
      if (new RegExp(`^\\s+(${name}|"${name}")\\s*:`).test(line)) {
        return name;
      }
    }
  }
  return null;
}

function getStateNameAtCursor(editor: vscode.TextEditor): string | null {
  const doc = editor.document;
  const parsed = AslParser.parse(doc.getText(), doc.languageId);
  if (!parsed) return null;
  return stateAtLine(doc, parsed, editor.selection.active.line);
}
