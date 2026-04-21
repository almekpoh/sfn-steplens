# Internal notes — not published

---

## TODO graph

### Node hover tooltip

Show a tooltip on hover over **all nodes**. Content by type:

| Type | Fields shown |
|------|-------------|
| Task | `Resource` (full ARN), `TimeoutSeconds`, `HeartbeatSeconds`, pattern (`.sync` / `.waitForTaskToken`) |
| Map | `MaxConcurrency`, INLINE/DISTRIBUTED mode, `ExecutionType` |
| Parallel | branch count |
| Wait | `Seconds` or `Timestamp` |
| Fail | `Error` + `Cause` (both — the label only shows `Error`) |
| Choice | branch count, whether `Default` is defined |
| Pass / Succeed | type only when no notable fields |

**Mockup**

```
  ┌─────────────────────────────────────────┐
  │  ProcessOrder                     Task  │  ← hovered node
  └─────────────────────────────────────────┘
       │
       ▼
  ╔═════════════════════════════════════════╗
  ║  Resource                               ║
  ║  arn:aws:states:::lambda:invoke         ║
  ║  .waitForTaskToken                      ║
  ╟─────────────────────────────────────────╢
  ║  TimeoutSeconds    300                  ║
  ║  HeartbeatSeconds   60                  ║
  ╚═════════════════════════════════════════╝

  ┌────────────────────┐
  │  ProcessBatch  Map │
  └────────────────────┘
       │
       ▼
  ╔══════════════════════════╗
  ║  Mode          INLINE    ║
  ║  MaxConcurrency    5     ║
  ╚══════════════════════════╝

  ┌──────────────────────┐
  │  RouteOrder  Fail    │
  └──────────────────────┘
       │
       ▼
  ╔══════════════════════════════╗
  ║  Error    OrderNotFound      ║
  ║  Cause    No order with ID   ║
  ╚══════════════════════════════╝
```

**Suggested approach**: [cytoscape-popper](https://github.com/cytoscape/cytoscape.js-popper) library (Popper.js) or native CSS tooltip via `qtip2`. Add the bundle to `webview/vendor-entry.js`. Trigger on the Cytoscape `mouseover` event, hide on `mouseout`.

Alternative with no extra dependency: overlay div positioned via `evt.renderedPosition` + offset, shown/hidden in plain JS inside `preview.html`.

**Data to inject**: extend `GraphNode` in `aslParser.ts` with the relevant fields (`resource?`, `timeoutSeconds?`, etc.) and pass them in `buildElements()` in `preview.html`.

---
