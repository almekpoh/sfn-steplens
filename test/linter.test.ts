import * as assert from 'assert';
import { AslParser } from '../src/aslParser';
import { AslLinter } from '../src/linter';

// ── Helpers ───────────────────────────────────────────────────────────────────

function lint(yaml: string) {
  const parsed = AslParser.parse(yaml.trim(), 'yaml');
  if (!parsed) throw new Error('Failed to parse YAML fixture');
  return AslLinter.lint(parsed.definition);
}

function hasError(errors: ReturnType<typeof AslLinter.lint>, pattern: string | RegExp) {
  return errors.some(e => typeof pattern === 'string'
    ? e.message.includes(pattern)
    : pattern.test(e.message));
}

// ── R-1: StartAt must exist ───────────────────────────────────────────────────

describe('R-1: StartAt must exist', () => {
  it('reports missing StartAt state', () => {
    const errs = lint(`
StartAt: Missing
States:
  A: { Type: Task, Resource: arn, End: true }
`);
    assert.ok(hasError(errs, 'StartAt "Missing"'));
  });

  it('passes when StartAt exists', () => {
    const errs = lint(`
StartAt: A
States:
  A: { Type: Task, Resource: arn, End: true }
`);
    assert.ok(!hasError(errs, 'StartAt'));
  });
});

// ── R-2: Next must exist ──────────────────────────────────────────────────────

describe('R-2: Next must exist', () => {
  it('reports invalid Next reference', () => {
    const errs = lint(`
StartAt: A
States:
  A: { Type: Task, Resource: arn, Next: Nowhere }
`);
    assert.ok(hasError(errs, 'Next "Nowhere" introuvable'));
  });
});

// ── R-3: Non-terminal state must have Next or End ────────────────────────────

describe('R-3: Non-terminal state must have Next or End', () => {
  it('reports state with no Next/End', () => {
    const errs = lint(`
StartAt: A
States:
  A: { Type: Task, Resource: arn }
`);
    assert.ok(hasError(errs, 'ni "Next" ni "End"'));
  });

  it('does not flag Succeed or Fail', () => {
    const errs = lint(`
StartAt: A
States:
  A: { Type: Task, Resource: arn, Next: B }
  B: { Type: Succeed }
`);
    assert.ok(!hasError(errs, 'ni "Next" ni "End"'));
  });
});

// ── R-4: Catch.Next must exist ────────────────────────────────────────────────

describe('R-4: Catch.Next must exist', () => {
  it('reports invalid Catch.Next', () => {
    const errs = lint(`
StartAt: A
States:
  A:
    Type: Task
    Resource: arn
    Catch:
      - ErrorEquals: [States.ALL]
        Next: Nowhere
    End: true
`);
    assert.ok(hasError(errs, 'Catch[0].Next "Nowhere" introuvable'));
  });
});

// ── R-5: Choice branches ──────────────────────────────────────────────────────

describe('R-5: Choice branches', () => {
  it('reports empty Choices array', () => {
    const errs = lint(`
StartAt: A
States:
  A: { Type: Choice, Choices: [] }
`);
    assert.ok(hasError(errs, 'aucune branche'));
  });

  it('reports missing Next in branch', () => {
    const errs = lint(`
StartAt: A
States:
  A:
    Type: Choice
    Choices:
      - Variable: $.x
        StringEquals: y
`);
    assert.ok(hasError(errs, 'sans "Next"'));
  });
});

// ── R-8: waitForTaskToken ─────────────────────────────────────────────────────

describe('R-8: waitForTaskToken', () => {
  it('warns when no HeartbeatSeconds', () => {
    const errs = lint(`
StartAt: A
States:
  A:
    Type: Task
    Resource: arn:aws:states:::lambda:invoke.waitForTaskToken
    Catch:
      - ErrorEquals: [States.HeartbeatTimeout]
        Next: B
    End: true
  B: { Type: Fail }
`);
    assert.ok(hasError(errs, 'HeartbeatSeconds'));
  });

  it('warns when no HeartbeatTimeout catch', () => {
    const errs = lint(`
StartAt: A
States:
  A:
    Type: Task
    Resource: arn:aws:states:::lambda:invoke.waitForTaskToken
    HeartbeatSeconds: 300
    End: true
`);
    assert.ok(hasError(errs, 'Catch pour States.HeartbeatTimeout'));
  });
});

// ── R-10: MaxConcurrency: 0 ───────────────────────────────────────────────────

describe('R-10: MaxConcurrency 0 warning', () => {
  it('warns when MaxConcurrency is 0', () => {
    const errs = lint(`
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
`);
    assert.ok(hasError(errs, 'illimitée'));
  });
});

// ── R-11: Timeout mutual exclusion ───────────────────────────────────────────

describe('R-11: TimeoutSeconds / TimeoutSecondsPath mutual exclusion', () => {
  it('reports when both are set', () => {
    const errs = lint(`
StartAt: A
States:
  A:
    Type: Task
    Resource: arn
    TimeoutSeconds: 30
    TimeoutSecondsPath: $.timeout
    End: true
`);
    assert.ok(hasError(errs, 'TimeoutSeconds et TimeoutSecondsPath sont mutuellement exclusifs'));
  });
});

// ── R-12: HeartbeatSeconds < TimeoutSeconds ───────────────────────────────────

describe('R-12: HeartbeatSeconds must be < TimeoutSeconds', () => {
  it('reports when heartbeat >= timeout', () => {
    const errs = lint(`
StartAt: A
States:
  A:
    Type: Task
    Resource: arn
    TimeoutSeconds: 30
    HeartbeatSeconds: 30
    End: true
`);
    assert.ok(hasError(errs, 'inférieur à TimeoutSeconds'));
  });
});

// ── R-13: Fail state mutual exclusion ────────────────────────────────────────

describe('R-13: Fail state Error/ErrorPath mutual exclusion', () => {
  it('reports Error + ErrorPath', () => {
    const errs = lint(`
StartAt: A
States:
  A: { Type: Task, Resource: arn, Next: F }
  F:
    Type: Fail
    Error: MyError
    ErrorPath: $.errorField
`);
    assert.ok(hasError(errs, 'Error et ErrorPath sont mutuellement exclusifs'));
  });
});

// ── R-14: Wait state timing ───────────────────────────────────────────────────

describe('R-14: Wait state must have exactly one timing field', () => {
  it('reports no timing field', () => {
    const errs = lint(`
StartAt: W
States:
  W: { Type: Wait, End: true }
`);
    assert.ok(hasError(errs, 'aucun champ de timing'));
  });

  it('reports multiple timing fields', () => {
    const errs = lint(`
StartAt: W
States:
  W:
    Type: Wait
    Seconds: 10
    Timestamp: "2030-01-01T00:00:00Z"
    End: true
`);
    assert.ok(hasError(errs, 'plusieurs champs de timing'));
  });

  it('passes with a single timing field', () => {
    const errs = lint(`
StartAt: W
States:
  W: { Type: Wait, Seconds: 10, End: true }
`);
    assert.ok(!hasError(errs, 'timing'));
  });
});

// ── R-15: States.ALL must be alone and last ───────────────────────────────────

describe('R-15: States.ALL must be alone and last', () => {
  it('reports States.ALL mixed with other errors', () => {
    const errs = lint(`
StartAt: A
States:
  A:
    Type: Task
    Resource: arn
    Catch:
      - ErrorEquals: [States.ALL, States.Timeout]
        Next: A
    End: true
`);
    assert.ok(hasError(errs, 'States.ALL" avec d\'autres erreurs'));
  });

  it('reports States.ALL not last', () => {
    const errs = lint(`
StartAt: A
States:
  A:
    Type: Task
    Resource: arn
    Catch:
      - ErrorEquals: [States.ALL]
        Next: A
      - ErrorEquals: [States.Timeout]
        Next: A
    End: true
`);
    assert.ok(hasError(errs, 'doit être le dernier catcheur'));
  });
});

// ── R-17: ErrorEquals empty ───────────────────────────────────────────────────

describe('R-17: ErrorEquals must not be empty', () => {
  it('reports empty ErrorEquals in Catch', () => {
    const errs = lint(`
StartAt: A
States:
  A:
    Type: Task
    Resource: arn
    Catch:
      - ErrorEquals: []
        Next: A
    End: true
`);
    assert.ok(hasError(errs, 'ErrorEquals est vide'));
  });
});

// ── R-19: ToleratedFailurePercentage range ────────────────────────────────────

describe('R-19: ToleratedFailurePercentage must be 0-100', () => {
  it('reports value > 100', () => {
    const errs = lint(`
StartAt: M
States:
  M:
    Type: Map
    ToleratedFailurePercentage: 150
    ItemProcessor:
      StartAt: C
      States:
        C: { Type: Task, Resource: arn, End: true }
    End: true
`);
    assert.ok(hasError(errs, 'entre 0 et 100'));
  });
});

// ── W-1: Unreachable states ───────────────────────────────────────────────────

describe('W-1: Unreachable states', () => {
  it('warns on orphan state', () => {
    const errs = lint(`
StartAt: A
States:
  A: { Type: Task, Resource: arn, End: true }
  Orphan: { Type: Task, Resource: arn, End: true }
`);
    assert.ok(hasError(errs, '"Orphan" est inaccessible'));
  });
});

// ── W-2: Choice without Default ──────────────────────────────────────────────

describe('W-2: Choice without Default', () => {
  it('warns when no Default', () => {
    const errs = lint(`
StartAt: A
States:
  A:
    Type: Choice
    Choices:
      - Variable: $.x
        StringEquals: y
        Next: B
  B: { Type: Succeed }
`);
    assert.ok(hasError(errs, 'NoChoiceMatched'));
  });

  it('does not warn when Default is set', () => {
    const errs = lint(`
StartAt: A
States:
  A:
    Type: Choice
    Choices:
      - Variable: $.x
        StringEquals: y
        Next: B
    Default: B
  B: { Type: Succeed }
`);
    assert.ok(!hasError(errs, 'NoChoiceMatched'));
  });
});

// ── J-1: Wrong fields per query language ─────────────────────────────────────

describe('J-1: Wrong fields per query language', () => {
  it('reports Parameters in JSONata mode', () => {
    const errs = lint(`
QueryLanguage: JSONata
StartAt: A
States:
  A:
    Type: Task
    Resource: arn
    Parameters:
      foo: bar
    End: true
`);
    assert.ok(hasError(errs, '"Parameters" est un champ JSONPath'));
  });

  it('reports Arguments in JSONPath mode', () => {
    const errs = lint(`
StartAt: A
States:
  A:
    Type: Task
    Resource: arn
    Arguments:
      foo: bar
    End: true
`);
    assert.ok(hasError(errs, '"Arguments" est un champ JSONata'));
  });
});

// ── J-3: Invalid JSONata expression ──────────────────────────────────────────

describe('J-3: JSONata expression validation', () => {
  it('reports empty expression', () => {
    const errs = lint(`
QueryLanguage: JSONata
StartAt: A
States:
  A:
    Type: Task
    Resource: arn
    Arguments:
      x: "{%  %}"
    End: true
`);
    assert.ok(hasError(errs, 'vide'));
  });

  it('reports $eval() usage', () => {
    const errs = lint(`
QueryLanguage: JSONata
StartAt: A
States:
  A:
    Type: Task
    Resource: arn
    Arguments:
      x: "{% $eval('foo') %}"
    End: true
`);
    assert.ok(hasError(errs, '$eval()'));
  });

  it('reports JSONPath $. syntax inside JSONata', () => {
    const errs = lint(`
QueryLanguage: JSONata
StartAt: A
States:
  A:
    Type: Task
    Resource: arn
    Arguments:
      x: "{% $.field %}"
    End: true
`);
    assert.ok(hasError(errs, '"$."'));
  });

  it('reports unbalanced parenthesis', () => {
    const errs = lint(`
QueryLanguage: JSONata
StartAt: A
States:
  A:
    Type: Task
    Resource: arn
    Arguments:
      x: "{% foo( %}"
    End: true
`);
    assert.ok(hasError(errs, 'parenthèse'));
  });
});

// ── J-4: $states.result scope ────────────────────────────────────────────────

describe('J-4: $states.result scope', () => {
  it('reports $states.result in Choice state', () => {
    const errs = lint(`
QueryLanguage: JSONata
StartAt: A
States:
  A:
    Type: Choice
    Choices:
      - Condition: "{% $states.result.x = 1 %}"
        Next: B
    Default: B
  B: { Type: Succeed }
`);
    assert.ok(hasError(errs, '$states.result'));
  });
});

// ── ProcessorConfig validation ────────────────────────────────────────────────

describe('ProcessorConfig: DISTRIBUTED mode', () => {
  it('reports missing ExecutionType in DISTRIBUTED mode', () => {
    const errs = lint(`
StartAt: M
States:
  M:
    Type: Map
    ItemProcessor:
      ProcessorConfig:
        Mode: DISTRIBUTED
      StartAt: C
      States:
        C: { Type: Task, Resource: arn, End: true }
    End: true
`);
    assert.ok(hasError(errs, 'ExecutionType est requis en mode DISTRIBUTED'));
  });

  it('warns when ExecutionType set in INLINE mode', () => {
    const errs = lint(`
StartAt: M
States:
  M:
    Type: Map
    ItemProcessor:
      ProcessorConfig:
        Mode: INLINE
        ExecutionType: EXPRESS
      StartAt: C
      States:
        C: { Type: Task, Resource: arn, End: true }
    End: true
`);
    assert.ok(hasError(errs, 'ignoré en mode INLINE'));
  });

  it('warns when INLINE MaxConcurrency > 40', () => {
    const errs = lint(`
StartAt: M
States:
  M:
    Type: Map
    MaxConcurrency: 50
    ItemProcessor:
      ProcessorConfig:
        Mode: INLINE
      StartAt: C
      States:
        C: { Type: Task, Resource: arn, End: true }
    End: true
`);
    assert.ok(hasError(errs, 'limité à 40'));
  });

  it('reports waitForTaskToken in EXPRESS children', () => {
    const errs = lint(`
StartAt: M
States:
  M:
    Type: Map
    ItemProcessor:
      ProcessorConfig:
        Mode: DISTRIBUTED
        ExecutionType: EXPRESS
      StartAt: C
      States:
        C:
          Type: Task
          Resource: arn:aws:states:::lambda:invoke.waitForTaskToken
          End: true
    End: true
`);
    assert.ok(hasError(errs, 'EXPRESS ne supportent pas .waitForTaskToken'));
  });
});

// ── BackoffRate minimum ───────────────────────────────────────────────────────

describe('BackoffRate minimum 1.0', () => {
  it('reports BackoffRate < 1', () => {
    const errs = lint(`
StartAt: A
States:
  A:
    Type: Task
    Resource: arn
    Retry:
      - ErrorEquals: [States.ALL]
        BackoffRate: 0.5
    End: true
`);
    assert.ok(hasError(errs, 'BackoffRate doit être ≥ 1.0'));
  });
});

// ── Deprecated Iterator ───────────────────────────────────────────────────────

describe('Deprecated Iterator warning', () => {
  it('warns when Iterator used instead of ItemProcessor', () => {
    const errs = lint(`
StartAt: M
States:
  M:
    Type: Map
    Iterator:
      StartAt: C
      States:
        C: { Type: Task, Resource: arn, End: true }
    End: true
`);
    assert.ok(hasError(errs, '"Iterator" est déprécié'));
  });
});
