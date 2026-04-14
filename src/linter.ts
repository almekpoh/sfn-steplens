import * as vscode from 'vscode';
import { AslDefinition, AslParser } from './aslParser';

export interface LintError {
  message: string;
  severity: vscode.DiagnosticSeverity;
  /** Key to locate in the document (best-effort) */
  searchKey?: string;
}

export class AslLinter {
  static lint(def: AslDefinition): LintError[] {
    const errors: LintError[] = [];
    const states = def.States ?? {};
    const stateNames = new Set(Object.keys(states));

    // ── R-1: StartAt must exist ─────────────────────────────────────────────
    if (!stateNames.has(def.StartAt)) {
      errors.push({
        message: `StartAt "${def.StartAt}" n'existe pas dans States`,
        severity: vscode.DiagnosticSeverity.Error,
        searchKey: 'StartAt',
      });
    }

    for (const [name, state] of Object.entries(states)) {

      // ── R-2: Next must point to an existing state ─────────────────────────
      if (state.Next && !stateNames.has(state.Next)) {
        errors.push({
          message: `"${name}": Next "${state.Next}" introuvable`,
          severity: vscode.DiagnosticSeverity.Error,
          searchKey: name,
        });
      }

      // ── R-3: Non-terminal states must have Next or End ────────────────────
      const isTerminal = state.Type === 'Succeed' || state.Type === 'Fail';
      const isChoice = state.Type === 'Choice';
      if (!isTerminal && !isChoice && !state.Next && !state.End) {
        errors.push({
          message: `"${name}" (${state.Type}): ni "Next" ni "End" défini`,
          severity: vscode.DiagnosticSeverity.Error,
          searchKey: name,
        });
      }

      // ── R-4: Catch.Next must exist ────────────────────────────────────────
      state.Catch?.forEach((c, i) => {
        if (!stateNames.has(c.Next)) {
          errors.push({
            message: `"${name}": Catch[${i}].Next "${c.Next}" introuvable`,
            severity: vscode.DiagnosticSeverity.Error,
            searchKey: name,
          });
        }
      });

      // ── R-5: Choice branches must have valid Next ─────────────────────────
      if (state.Type === 'Choice') {
        if (!state.Choices || state.Choices.length === 0) {
          errors.push({
            message: `"${name}" (Choice): aucune branche définie`,
            severity: vscode.DiagnosticSeverity.Error,
            searchKey: name,
          });
        }
        state.Choices?.forEach((c, i) => {
          if (!c.Next) {
            errors.push({
              message: `"${name}": Choices[${i}] sans "Next"`,
              severity: vscode.DiagnosticSeverity.Error,
              searchKey: name,
            });
          } else if (!stateNames.has(c.Next)) {
            errors.push({
              message: `"${name}": Choices[${i}].Next "${c.Next}" introuvable`,
              severity: vscode.DiagnosticSeverity.Error,
              searchKey: name,
            });
          }
        });
        if (state.Default && !stateNames.has(state.Default)) {
          errors.push({
            message: `"${name}": Default "${state.Default}" introuvable`,
            severity: vscode.DiagnosticSeverity.Error,
            searchKey: name,
          });
        }
      }

      // ── R-6: Parallel/Map must have End or Next ───────────────────────────
      if ((state.Type === 'Parallel' || state.Type === 'Map') && !state.Next && !state.End) {
        errors.push({
          message: `"${name}" (${state.Type}): ni "Next" ni "End"`,
          severity: vscode.DiagnosticSeverity.Error,
          searchKey: name,
        });
      }

      // ── R-7: Parallel branches are valid sub-state-machines ───────────────
      state.Branches?.forEach((branch, i) => {
        if (!branch.StartAt || !branch.States) {
          errors.push({
            message: `"${name}": Branches[${i}] invalide (StartAt/States manquants)`,
            severity: vscode.DiagnosticSeverity.Error,
            searchKey: name,
          });
        } else {
          AslLinter.lint({ StartAt: branch.StartAt, States: branch.States, QueryLanguage: def.QueryLanguage })
            .forEach(e => errors.push({ ...e, message: `[Branch ${i}] ${e.message}` }));
        }
      });

      // ── R-9: Map iterator/ItemProcessor must be a valid sub-state-machine ──
      if (state.Type === 'Map') {
        const iterator = state.Iterator ?? state.ItemProcessor;
        if (!iterator) {
          errors.push({
            message: `"${name}" (Map): aucun Iterator ou ItemProcessor défini`,
            severity: vscode.DiagnosticSeverity.Error,
            searchKey: name,
          });
        } else if (!iterator.StartAt || !iterator.States) {
          errors.push({
            message: `"${name}": Iterator invalide (StartAt/States manquants)`,
            severity: vscode.DiagnosticSeverity.Error,
            searchKey: name,
          });
        } else {
          AslLinter.lint({ StartAt: iterator.StartAt, States: iterator.States, QueryLanguage: def.QueryLanguage })
            .forEach(e => errors.push({ ...e, message: `[Iterator] ${e.message}` }));
        }
      }

      // ── R-10: MaxConcurrency: 0 on Map = unlimited (warning) ─────────────
      if (state.Type === 'Map' && state.MaxConcurrency === 0) {
        errors.push({
          message: `"${name}": MaxConcurrency: 0 signifie une concurrence illimitée — vérifiez que c'est intentionnel`,
          severity: vscode.DiagnosticSeverity.Warning,
          searchKey: name,
        });
      }

      // ── R-8: waitForTaskToken must have a Catch for HeartbeatTimeout ──────
      const resource = state.Resource ?? '';
      if (resource.includes('waitForTaskToken')) {
        const catchesHeartbeat = state.Catch?.some(c =>
          c.ErrorEquals.includes('States.HeartbeatTimeout') ||
          c.ErrorEquals.includes('States.ALL')
        ) ?? false;

        if (!catchesHeartbeat) {
          errors.push({
            message: `"${name}": utilise waitForTaskToken mais n'a pas de Catch pour States.HeartbeatTimeout — risque de blocage permanent`,
            severity: vscode.DiagnosticSeverity.Warning,
            searchKey: name,
          });
        }

        // HeartbeatSeconds absent = pas de timeout = blocage potentiel infini
        if (!state.HeartbeatSeconds) {
          errors.push({
            message: `"${name}": waitForTaskToken sans HeartbeatSeconds — l'exécution peut bloquer indéfiniment`,
            severity: vscode.DiagnosticSeverity.Warning,
            searchKey: name,
          });
        }
      }

      // ── JSONata rules ────────────────────────────────────────────────────
      const jsonata = (state.QueryLanguage ?? def.QueryLanguage ?? 'JSONPath') === 'JSONata';

      // ── J-1: Wrong fields for current query language ──────────────────────
      if (jsonata) {
        if (state.Parameters !== undefined) {
          errors.push({ message: `"${name}": "Parameters" est un champ JSONPath — utilisez "Arguments" en mode JSONata`, severity: vscode.DiagnosticSeverity.Error, searchKey: name });
        }
        if (state.OutputPath !== undefined) {
          errors.push({ message: `"${name}": "OutputPath" est un champ JSONPath — utilisez "Output" en mode JSONata`, severity: vscode.DiagnosticSeverity.Error, searchKey: name });
        }
        if (state.InputPath !== undefined) {
          errors.push({ message: `"${name}": "InputPath" n'est pas disponible en mode JSONata`, severity: vscode.DiagnosticSeverity.Error, searchKey: name });
        }
        if (state.ResultPath !== undefined) {
          errors.push({ message: `"${name}": "ResultPath" n'est pas disponible en mode JSONata — utilisez "Output"`, severity: vscode.DiagnosticSeverity.Error, searchKey: name });
        }
      } else {
        if (state.Arguments !== undefined) {
          errors.push({ message: `"${name}": "Arguments" est un champ JSONata — utilisez "Parameters" en mode JSONPath`, severity: vscode.DiagnosticSeverity.Warning, searchKey: name });
        }
        if (state.Output !== undefined) {
          errors.push({ message: `"${name}": "Output" est un champ JSONata — utilisez "OutputPath" en mode JSONPath`, severity: vscode.DiagnosticSeverity.Warning, searchKey: name });
        }
      }

      // ── J-2: Choice — Condition vs Variable per query language ───────────
      if (state.Type === 'Choice') {
        state.Choices?.forEach((c, i) => {
          if (jsonata) {
            if ((c as any).Variable !== undefined) {
              errors.push({ message: `"${name}": Choices[${i}] utilise "Variable" (JSONPath) — en mode JSONata utilisez "Condition"`, severity: vscode.DiagnosticSeverity.Error, searchKey: name });
            }
            if (c.Condition && !/^\{%/.test(c.Condition)) {
              errors.push({ message: `"${name}": Choices[${i}].Condition doit être entouré de {%...%} — ex: "{% $states.input.field = 'valeur' %}"`, severity: vscode.DiagnosticSeverity.Error, searchKey: name });
            }
          } else {
            if (c.Condition !== undefined) {
              errors.push({ message: `"${name}": Choices[${i}] utilise "Condition" (JSONata) — en mode JSONPath utilisez "Variable"`, severity: vscode.DiagnosticSeverity.Error, searchKey: name });
            }
          }
        });
      }

      // ── J-3: Validate {% ... %} expression syntax ─────────────────────────
      // ── J-4: $states.result only in Task / Parallel / Map ─────────────────
      if (jsonata) {
        const fieldsToScan: Array<[unknown, string]> = [
          [state.Arguments, 'Arguments'],
          [state.Output,    'Output'],
          [state.Assign,    'Assign'],
        ];
        state.Choices?.forEach((c, i) => {
          if (c.Condition) fieldsToScan.push([c.Condition, `Choices[${i}].Condition`]);
        });

        const allowsResult = state.Type === 'Task' || state.Type === 'Parallel' || state.Type === 'Map';
        for (const [obj, fieldName] of fieldsToScan) {
          if (obj == null) continue;
          for (const { path, expr } of findJsonataExprs(obj, fieldName)) {
            const exprErr = validateJsonataExpr(expr);
            if (exprErr) {
              errors.push({ message: `"${name}": ${path} — ${exprErr}`, severity: vscode.DiagnosticSeverity.Error, searchKey: name });
            }
            if (!allowsResult && expr.includes('$states.result')) {
              errors.push({ message: `"${name}": ${path} — $states.result n'est disponible que dans Task, Parallel et Map (pas dans ${state.Type})`, severity: vscode.DiagnosticSeverity.Error, searchKey: name });
            }
          }
        }
      }
    }

    // ── W-1: Unreachable states ───────────────────────────────────────────────
    const reachable = AslParser.reachableStates(def);
    for (const name of stateNames) {
      if (!reachable.has(name)) {
        errors.push({
          message: `"${name}" est inaccessible (jamais référencé depuis StartAt)`,
          severity: vscode.DiagnosticSeverity.Warning,
          searchKey: name,
        });
      }
    }

    return errors;
  }
}

/**
 * Find the 0-based line number of a state definition in the document.
 *
 * Looks for `  <name>:` at the States indentation level (2+ spaces followed
 * by the exact name and a colon). Avoids matching `Next: <name>` lines.
 */
export function findLineForStateName(doc: vscode.TextDocument, stateName: string): number {
  const lines = doc.getText().split('\n');
  const esc = escapeRegex(stateName);
  // Match YAML `  StateName:` or JSON `  "StateName":` (quoted key)
  const pattern = new RegExp(`^\\s+(${esc}|"${esc}")\\s*:`);
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) return i;
  }
  return 0;
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Recursively find all {% ... %} expressions inside a nested JSON value.
 * Returns the raw inner content (between {% and %}) and its dot-path.
 */
function findJsonataExprs(
  obj: unknown,
  path: string
): Array<{ path: string; expr: string }> {
  if (typeof obj === 'string') {
    const m = obj.match(/^\{%([\s\S]*?)%\}$/);
    if (m) return [{ path, expr: m[1] }];
  } else if (Array.isArray(obj)) {
    return (obj as unknown[]).flatMap((v, i) =>
      findJsonataExprs(v, `${path}[${i}]`)
    );
  } else if (obj !== null && typeof obj === 'object') {
    return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
      findJsonataExprs(v, `${path}.${k}`)
    );
  }
  return [];
}

/**
 * Validate the raw inner content of a {% ... %} expression.
 * Returns a French error message if invalid, or null if OK.
 */
function validateJsonataExpr(raw: string): string | null {
  const expr = raw.trim();

  if (!expr)
    return 'expression JSONata vide — {%  %} est invalide';
  if (expr.includes('{%'))
    return 'délimiteurs {%...%} imbriqués (non autorisé)';
  if (/\$eval\s*\(/.test(expr))
    return '$eval() n\'est pas supporté par AWS Step Functions';
  if (/\$\./.test(expr))
    return 'syntaxe JSONPath "$." dans une expression JSONata — utilisez $states.input.champ au lieu de $.champ';
  if (/[\+\-\*\/\%\&]$/.test(expr))
    return 'expression incomplète (se termine par un opérateur)';
  if (/\.$/.test(expr))
    return 'expression incomplète (se termine par ".")';

  // Balance check (ignoring content inside string literals)
  let inSQ = false, inDQ = false;
  const d = { brace: 0, bracket: 0, paren: 0 };
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i], p = i > 0 ? expr[i - 1] : '';
    if      (c === "'" && !inDQ && p !== '\\') inSQ = !inSQ;
    else if (c === '"' && !inSQ && p !== '\\') inDQ = !inDQ;
    if (!inSQ && !inDQ) {
      if      (c === '{') d.brace++;
      else if (c === '}') { if (--d.brace < 0) return 'accolade "}" inattendue'; }
      else if (c === '[') d.bracket++;
      else if (c === ']') { if (--d.bracket < 0) return 'crochet "]" inattendu'; }
      else if (c === '(') d.paren++;
      else if (c === ')') { if (--d.paren < 0) return 'parenthèse ")" inattendue'; }
    }
  }
  if (inSQ)       return 'guillemet simple non fermé';
  if (inDQ)       return 'guillemet double non fermé';
  if (d.brace)    return `accolade ouvrante non fermée (${d.brace} manquante${d.brace > 1 ? 's' : ''})`;
  if (d.bracket)  return `crochet ouvrant non fermé (${d.bracket} manquant${d.bracket > 1 ? 's' : ''})`;
  if (d.paren)    return `parenthèse ouvrante non fermée (${d.paren} manquante${d.paren > 1 ? 's' : ''})`;

  return null;
}
