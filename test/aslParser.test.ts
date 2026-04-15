import * as assert from 'assert';
import { AslParser } from '../src/aslParser';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const RAW_JSON = JSON.stringify({
  StartAt: 'Hello',
  States: {
    Hello: { Type: 'Task', Resource: 'arn:aws:lambda:::fn', End: true },
  },
});

const RAW_YAML = `
StartAt: Hello
States:
  Hello:
    Type: Task
    Resource: arn:aws:lambda:::fn
    End: true
`;

const SF_FLAT_YAML = `
definition:
  StartAt: Hello
  States:
    Hello:
      Type: Task
      Resource: arn:aws:lambda:::fn
      End: true
`;

const SF_NAMED_YAML = `
myMachine:
  name: my-machine
  definition:
    StartAt: Hello
    States:
      Hello:
        Type: Task
        Resource: arn:aws:lambda:::fn
        End: true
`;

const PARALLEL_YAML = `
StartAt: Par
States:
  Par:
    Type: Parallel
    Branches:
      - StartAt: A
        States:
          A: { Type: Task, Resource: arn, End: true }
      - StartAt: B
        States:
          B: { Type: Task, Resource: arn, End: true }
    End: true
`;

const MAP_YAML = `
StartAt: M
States:
  M:
    Type: Map
    MaxConcurrency: 5
    ItemProcessor:
      StartAt: Child
      States:
        Child: { Type: Task, Resource: arn, End: true }
    Next: Done
  Done:
    Type: Succeed
`;

// ── parse() ──────────────────────────────────────────────────────────────────

describe('AslParser.parse()', () => {
  it('parses raw JSON', () => {
    const r = AslParser.parse(RAW_JSON, 'json');
    assert.ok(r);
    assert.strictEqual(r.definition.StartAt, 'Hello');
    assert.strictEqual(r.isWrapped, false);
  });

  it('parses raw YAML', () => {
    const r = AslParser.parse(RAW_YAML, 'yaml');
    assert.ok(r);
    assert.strictEqual(r.definition.StartAt, 'Hello');
    assert.strictEqual(r.isWrapped, false);
  });

  it('parses Serverless Framework flat wrapper', () => {
    const r = AslParser.parse(SF_FLAT_YAML, 'yaml');
    assert.ok(r);
    assert.strictEqual(r.isWrapped, true);
    assert.strictEqual(r.definition.StartAt, 'Hello');
  });

  it('parses Serverless Framework named wrapper', () => {
    const r = AslParser.parse(SF_NAMED_YAML, 'yaml');
    assert.ok(r);
    assert.strictEqual(r.isWrapped, true);
    assert.strictEqual(r.definition.StartAt, 'Hello');
  });

  it('returns null for non-SFN file', () => {
    assert.strictEqual(AslParser.parse('name: foo\nversion: 1', 'yaml'), null);
  });

  it('returns null for invalid JSON', () => {
    assert.strictEqual(AslParser.parse('{broken', 'json'), null);
  });
});

// ── reachableStates() ────────────────────────────────────────────────────────

describe('AslParser.reachableStates()', () => {
  it('marks all reachable states', () => {
    const def = AslParser.parse(MAP_YAML, 'yaml')!.definition;
    const r = AslParser.reachableStates(def);
    assert.ok(r.has('M'));
    assert.ok(r.has('Done'));
  });

  it('does not include states from unreachable branches in top-level set', () => {
    const yaml = `
StartAt: A
States:
  A: { Type: Task, Resource: arn, End: true }
  Orphan: { Type: Task, Resource: arn, End: true }
`;
    const def = AslParser.parse(yaml, 'yaml')!.definition;
    const r = AslParser.reachableStates(def);
    assert.ok(r.has('A'));
    assert.ok(!r.has('Orphan'));
  });
});

// ── toGraphData() ─────────────────────────────────────────────────────────────

describe('AslParser.toGraphData()', () => {
  it('creates START and END nodes', () => {
    const def = AslParser.parse(RAW_JSON, 'json')!.definition;
    const g = AslParser.toGraphData(def);
    assert.ok(g.nodes.find(n => n.id === '__START__'));
    assert.ok(g.nodes.find(n => n.id === '__END__'));
  });

  it('annotates Map node with ×N', () => {
    const def = AslParser.parse(MAP_YAML, 'yaml')!.definition;
    const g = AslParser.toGraphData(def);
    const m = g.nodes.find(n => n.id === 'M')!;
    assert.ok(m.label.includes('×5'), `label was: ${m.label}`);
  });

  it('annotates Map node with ×∞ when MaxConcurrency is 0', () => {
    const yaml = `
StartAt: M
States:
  M:
    Type: Map
    MaxConcurrency: 0
    ItemProcessor:
      StartAt: C
      States:
        C: { Type: Task, Resource: arn, End: true }
    End: true
`;
    const def = AslParser.parse(yaml, 'yaml')!.definition;
    const g = AslParser.toGraphData(def);
    assert.ok(g.nodes.find(n => n.id === 'M')!.label.includes('×∞'));
  });

  it('annotates Parallel node with ‖N', () => {
    const def = AslParser.parse(PARALLEL_YAML, 'yaml')!.definition;
    const g = AslParser.toGraphData(def);
    const p = g.nodes.find(n => n.id === 'Par')!;
    assert.ok(p.label.includes('‖2'), `label was: ${p.label}`);
  });

  it('annotates Task with ↺ when Retry is set', () => {
    const yaml = `
StartAt: T
States:
  T:
    Type: Task
    Resource: arn
    Retry:
      - ErrorEquals: [States.ALL]
    End: true
`;
    const def = AslParser.parse(yaml, 'yaml')!.definition;
    const g = AslParser.toGraphData(def);
    assert.ok(g.nodes.find(n => n.id === 'T')!.label.includes('↺'));
  });

  it('annotates waitForTaskToken with ⏸', () => {
    const yaml = `
StartAt: T
States:
  T:
    Type: Task
    Resource: arn:aws:states:::lambda:invoke.waitForTaskToken
    End: true
`;
    const def = AslParser.parse(yaml, 'yaml')!.definition;
    const g = AslParser.toGraphData(def);
    assert.ok(g.nodes.find(n => n.id === 'T')!.label.includes('⏸'));
  });

  it('annotates HTTP Task with 🌐', () => {
    const yaml = `
StartAt: T
States:
  T:
    Type: Task
    Resource: arn:aws:states:::http:invoke
    End: true
`;
    const def = AslParser.parse(yaml, 'yaml')!.definition;
    const g = AslParser.toGraphData(def);
    assert.ok(g.nodes.find(n => n.id === 'T')!.label.includes('🌐'));
  });

  it('annotates distributed Map with ⊕', () => {
    const yaml = `
StartAt: M
States:
  M:
    Type: Map
    ItemProcessor:
      ProcessorConfig:
        Mode: DISTRIBUTED
        ExecutionType: STANDARD
      StartAt: C
      States:
        C: { Type: Task, Resource: arn, End: true }
    End: true
`;
    const def = AslParser.parse(yaml, 'yaml')!.definition;
    const g = AslParser.toGraphData(def);
    assert.ok(g.nodes.find(n => n.id === 'M')!.label.includes('⊕'));
  });
});

// ── extractSubGraphs() ───────────────────────────────────────────────────────

describe('AslParser.extractSubGraphs()', () => {
  it('extracts Parallel branches', () => {
    const def = AslParser.parse(PARALLEL_YAML, 'yaml')!.definition;
    const subs = AslParser.extractSubGraphs(def);
    assert.strictEqual(subs.length, 2);
    assert.ok(subs.every(s => s.type === 'Parallel'));
  });

  it('extracts Map iterator (ItemProcessor)', () => {
    const def = AslParser.parse(MAP_YAML, 'yaml')!.definition;
    const subs = AslParser.extractSubGraphs(def);
    assert.strictEqual(subs.length, 1);
    assert.strictEqual(subs[0].type, 'Map');
  });
});
