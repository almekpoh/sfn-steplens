// Mock the vscode module so unit tests can run without a VS Code instance
const Module = require('module');
const _load = Module._load.bind(Module);
Module._load = function (request: string, ...args: any[]) {
  if (request === 'vscode') {
    return {
      DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    };
  }
  return _load(request, ...args);
};
