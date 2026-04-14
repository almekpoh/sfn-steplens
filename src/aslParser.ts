import * as yaml from 'yaml';

export interface AslCatchClause {
  ErrorEquals: string[];
  Next: string;
  Output?: string;
  ResultPath?: string;
}

export interface AslChoiceBranch {
  // JSONata style
  Condition?: string;
  // Classic ASL style (Variable / comparison operators)
  Variable?: string;
  Next: string;
  [key: string]: unknown;
}

export interface AslBranch {
  StartAt: string;
  States: Record<string, AslState>;
}

export interface AslState {
  Type: string;
  Next?: string;
  End?: boolean;
  Comment?: string;
  QueryLanguage?: 'JSONata' | 'JSONPath';  // per-state override
  // Task
  Resource?: string;
  Arguments?: Record<string, unknown>;    // JSONata mode
  Parameters?: Record<string, unknown>;   // JSONPath mode
  Output?: string;                        // JSONata mode (replaces OutputPath)
  OutputPath?: string;                    // JSONPath mode
  InputPath?: string;                     // JSONPath mode
  ResultPath?: string;                    // JSONPath mode (unavailable in JSONata)
  Retry?: Array<{ ErrorEquals: string[]; IntervalSeconds?: number; MaxAttempts?: number; BackoffRate?: number }>;
  Catch?: AslCatchClause[];
  HeartbeatSeconds?: number;
  // Choice
  Choices?: AslChoiceBranch[];
  Default?: string;
  // Wait
  Seconds?: number;
  Timestamp?: string;
  // JSONata
  Assign?: Record<string, unknown>;
  // Parallel / Map
  Branches?: AslBranch[];
  Iterator?: AslBranch;       // classic ASL Map format
  ItemProcessor?: AslBranch;  // newer ASL Map format (SDK v2 / console export)
  MaxConcurrency?: number;    // Map: 0 = unlimited
}

export interface AslDefinition {
  Comment?: string;
  QueryLanguage?: 'JSONata' | 'JSONPath';
  StartAt: string;
  States: Record<string, AslState>;
}

export interface ParsedSfn {
  definition: AslDefinition;
  /** true if wrapped in a Serverless Framework config (role/tags/name/definition) */
  isWrapped: boolean;
}

// ── Graph data types for Cytoscape rendering ───────────────────────────────

export interface GraphNode {
  id: string;
  label: string;  // display label — may include ↺ / ×N suffixes
  type: string;   // Task | Choice | Wait | Pass | Succeed | Fail | Parallel | Map | START | END
  hasRetry?: boolean;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  edgeType: 'normal' | 'catch' | 'branch' | 'default';
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface SubGraph {
  id: string;
  label: string;
  type: string;        // 'Parallel' | 'Map'
  parentStateName: string;
  data: GraphData;
}

export class AslParser {
  /**
   * Parse a YAML or JSON file and extract the ASL definition.
   *
   * Supported formats:
   *  - Raw ASL                        { StartAt, States }
   *  - Serverless Framework wrapper   { role, tags, name, definition: { StartAt, States } }
   */
  static parse(text: string, languageId: string): ParsedSfn | null {
    try {
      const raw = languageId === 'json'
        ? JSON.parse(text)
        : yaml.parse(text);

      if (!raw || typeof raw !== 'object') return null;

      // Raw ASL  { StartAt, States }
      if (raw.States) {
        return { definition: raw as AslDefinition, isWrapped: false };
      }

      // Serverless Framework flat wrapper  { definition: { StartAt, States } }
      if (raw.definition?.States) {
        return { definition: raw.definition as AslDefinition, isWrapped: true };
      }

      // Serverless Framework named wrapper  { machineName: { definition: { StartAt, States } } }
      // (also handles a single-machine file where the outer key is the SF resource name)
      for (const value of Object.values(raw)) {
        if (value && typeof value === 'object' && (value as any).definition?.States) {
          return { definition: (value as any).definition as AslDefinition, isWrapped: true };
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Collect all state names reachable from StartAt via DFS.
   * Follows Next, Default, Choices[*].Next, Catch[*].Next, and branch StartAt.
   */
  static reachableStates(def: AslDefinition): Set<string> {
    const visited = new Set<string>();
    const stack = [def.StartAt];

    while (stack.length) {
      const name = stack.pop()!;
      if (visited.has(name)) continue;
      visited.add(name);

      const state = def.States[name];
      if (!state) continue;

      if (state.Next) stack.push(state.Next);
      if (state.Default) stack.push(state.Default);
      state.Catch?.forEach(c => stack.push(c.Next));
      state.Choices?.forEach(c => { if (c.Next) stack.push(c.Next); });
      // Parallel branches
      state.Branches?.forEach(b => {
        if (b.StartAt) stack.push(b.StartAt);
        Object.keys(b.States ?? {}).forEach(s => stack.push(s));
      });
    }

    return visited;
  }

  /**
   * Convert an ASL definition to a Mermaid flowchart string.
   * Node shapes vary by Type; edges carry labels for Catch/Choice branches.
   */
  /**
   * Convert an ASL definition to Cytoscape-compatible nodes + edges.
   */
  static toGraphData(def: { StartAt: string; States: Record<string, AslState> }): GraphData {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    let edgeIdx = 0;
    const eid = () => `e${edgeIdx++}`;

    // Synthetic start/end nodes
    nodes.push({ id: '__START__', label: 'Start', type: 'START' });

    for (const [name, state] of Object.entries(def.States)) {
      let label = name;
      if (state.Type === 'Map' && state.MaxConcurrency !== undefined) {
        label += state.MaxConcurrency === 0 ? ' ×∞' : ` ×${state.MaxConcurrency}`;
      }
      if (state.Type === 'Parallel' && state.Branches?.length) {
        label += ` ‖${state.Branches.length}`;
      }
      if ((state.Retry?.length ?? 0) > 0) label += ' ↺';
      nodes.push({ id: name, label, type: state.Type ?? 'Task', hasRetry: (state.Retry?.length ?? 0) > 0 });
    }

    const hasEnd = Object.values(def.States).some(s => s.End);
    if (hasEnd) nodes.push({ id: '__END__', label: 'End', type: 'END' });

    // Start edge
    edges.push({ id: eid(), source: '__START__', target: def.StartAt, label: '', edgeType: 'normal' });

    for (const [name, state] of Object.entries(def.States)) {
      if (state.Next) {
        edges.push({ id: eid(), source: name, target: state.Next, label: '', edgeType: 'normal' });
      }
      if (state.End) {
        edges.push({ id: eid(), source: name, target: '__END__', label: '', edgeType: 'normal' });
      }
      state.Catch?.forEach(c => {
        const lbl = c.ErrorEquals.join(', ');
        edges.push({ id: eid(), source: name, target: c.Next, label: lbl, edgeType: 'catch' });
      });
      state.Choices?.forEach((c, i) => {
        if (c.Next) {
          let lbl: string;
          if (c.Condition) {
            // JSONata: "{% $foo = 1 %}" → "$foo = 1"
            lbl = String(c.Condition).replace(/\{%\s*|\s*%\}/g, '').trim();
          } else if (c.Variable) {
            // Classic ASL: use last segment of $.path.to.var
            lbl = String(c.Variable).split('.').pop() ?? `b${i + 1}`;
          } else {
            lbl = `b${i + 1}`;
          }
          edges.push({ id: eid(), source: name, target: c.Next, label: lbl, edgeType: 'branch' });
        }
      });
      if (state.Default) {
        edges.push({ id: eid(), source: name, target: state.Default, label: 'default', edgeType: 'default' });
      }
    }

    return { nodes, edges };
  }

  /**
   * Extract sub-graphs for Parallel branches and Map iterators.
   * Returns one entry per branch/iterator, ready for tab rendering.
   */
  /**
   * Collect every state name at every nesting level (top-level + all
   * Parallel branches and Map iterators), deduplicated.
   */
  static allStateNames(def: AslDefinition): string[] {
    const names = new Set<string>();
    const walk = (states: Record<string, AslState>) => {
      for (const [name, state] of Object.entries(states)) {
        names.add(name);
        state.Branches?.forEach(b => walk(b.States ?? {}));
        const iter = state.Iterator ?? state.ItemProcessor;
        if (iter) walk(iter.States ?? {});
      }
    };
    walk(def.States);
    return [...names];
  }

  static extractSubGraphs(def: AslDefinition): SubGraph[] {
    const result: SubGraph[] = [];
    const safe = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '_');

    for (const [name, state] of Object.entries(def.States)) {
      if (state.Type === 'Parallel' && state.Branches?.length) {
        state.Branches.forEach((branch, i) => {
          result.push({
            id: `${safe(name)}_b${i}`,
            label: `${name} — Branch ${i + 1}`,
            type: 'Parallel',
            parentStateName: name,
            data: AslParser.toGraphData(branch),
          });
        });
      } else if (state.Type === 'Map') {
        const iterator = state.Iterator ?? state.ItemProcessor;
        if (iterator) {
          result.push({
            id: `${safe(name)}_iter`,
            label: `${name} — Iterator`,
            type: 'Map',
            parentStateName: name,
            data: AslParser.toGraphData(iterator),
          });
        }
      }
    }
    return result;
  }

  static toMermaid(def: AslDefinition): string {
    // safe: node IDs must be alphanumeric+underscore only
    const safe = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '_');
    // edgeLbl: strip every character that breaks Mermaid's |label| lexer
    const edgeLbl = (s: string) =>
      s.replace(/[|"<>{}[\]()]/g, '').replace(/\s+/g, ' ').trim().substring(0, 20);

    const nodeLines: string[] = [];
    const edgeLines: string[] = [];

    // Synthetic start node — declared as standalone statement, NOT inline in an edge
    nodeLines.push('  SFN_START(Start)');
    edgeLines.push(`  SFN_START --> ${safe(def.StartAt)}`);

    const hasEndState = Object.values(def.States).some(s => s.End);
    if (hasEndState) nodeLines.push('  SFN_END(End)');

    for (const [name, state] of Object.entries(def.States)) {
      const id = safe(name);

      // Node declaration — all labels are the raw state name (no quotes needed,
      // no spaces, pure alphanumeric camelCase). Shapes use graph TD syntax only.
      switch (state.Type) {
        case 'Choice':
          nodeLines.push(`  ${id}{${id}}`);
          break;
        case 'Wait':
          nodeLines.push(`  ${id}(${id})`);
          break;
        case 'Succeed':
        case 'Fail':
          // Double-circle terminal node
          nodeLines.push(`  ${id}((${id}))`);
          break;
        case 'Parallel':
        case 'Map':
          nodeLines.push(`  ${id}[[${id}]]`);
          break;
        default:
          // Task, Pass, unknown → plain rectangle
          nodeLines.push(`  ${id}[${id}]`);
          break;
      }

      // Edges — all in a separate pass so node declarations come first
      if (state.Next) {
        edgeLines.push(`  ${id} --> ${safe(state.Next)}`);
      }
      if (state.End) {
        edgeLines.push(`  ${id} --> SFN_END`);
      }
      state.Catch?.forEach(c => {
        const lbl = edgeLbl(c.ErrorEquals.join(' '));
        edgeLines.push(`  ${id} -->|catch ${lbl}| ${safe(c.Next)}`);
      });
      state.Choices?.forEach((c, i) => {
        if (c.Next) edgeLines.push(`  ${id} -->|b${i + 1}| ${safe(c.Next)}`);
      });
      if (state.Default) {
        edgeLines.push(`  ${id} -->|default| ${safe(state.Default)}`);
      }
    }

    return ['graph TD', ...nodeLines, ...edgeLines].join('\n');
  }
}
