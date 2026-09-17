// Unit tests for the CSP-safe action dispatcher (public/js/actions.js).
// The script is evaluated in a vm sandbox with a minimal `window`/`document`
// so the pure grammar functions (parse/coerce/arg/splitCall/resolve) can be
// exercised without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = readFileSync(new URL('../VELTRUVIA Server/resources/app/public/js/actions.js', import.meta.url), 'utf8');

function boot() {
  const listeners = [];
  const sandbox = {
    console,
    setTimeout,
    window: null,
    document: {
      addEventListener: (ev, fn, cap) => listeners.push([ev, fn]),
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      body: { classList: { toggle() {}, remove() {}, add() {} } },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'actions.js' });
  const V = sandbox.window.VeltruviaActions;
  assert.ok(V, 'VeltruviaActions not exported');
  assert.ok(V.__test, 'test hook missing');
  return { V, listeners };
}

test('exports version and test hook', () => {
  const { V } = boot();
  assert.match(V.version, /^\d+\.\d+\.\d+$/);
  for (const k of ['parse', 'coerce', 'arg', 'splitCall', 'resolve']) {
    assert.equal(typeof V.__test[k], 'function', k);
  }
});

test('register listeners for all supported events', () => {
  const { listeners } = boot();
  const evs = listeners.map(l => l[0]);
  for (const ev of ['click', 'input', 'change', 'keydown', 'focusin', 'focusout', 'mousedown']) {
    assert.ok(evs.includes(ev), `missing ${ev}`);
  }
  // hover pair
  assert.ok(evs.includes('mouseover') && evs.includes('mouseout'), 'hover listeners');
});

test('coerce: numbers, booleans, null, strings pass through', () => {
  const { V } = boot();
  const c = V.__test.coerce;
  assert.equal(c('42'), 42);
  assert.equal(c('-3.5'), -3.5);
  assert.equal(c('true'), true);
  assert.equal(c('false'), false);
  assert.equal(c('null'), null);
  assert.equal(c('abc'), 'abc');
  assert.equal(c('007'), '007'); // leading zeros stay strings (IDs)
  assert.equal(c(''), '');
});

test('parse: splits steps on ;; and explicit ops are flagged', () => {
  const { V } = boot();
  const p = V.__test.parse;
  const steps = p('doLogin;;stop;;showPanel:patients');
  assert.deepEqual([...steps.map(s => s.op)], ['doLogin', 'stop', 'showPanel']); // spread: local realm array
  assert.equal(steps[0].explicit, false);
  assert.equal(steps[1].explicit, true);
  assert.equal(steps[2].explicit, true);
  assert.equal(steps[2].rest, 'patients');
});

test('parse: whitespace-only steps are dropped', () => {
  const { V } = boot();
  assert.deepEqual(V.__test.parse('  doLogin ;;  ').length, 1);
});

test('splitCall: top-level commas only (parens/brackets/braces protect)', () => {
  const { V } = boot();
  const sc = V.__test.splitCall;
  assert.deepEqual([...sc('a,b')], ['a', 'b']);
  assert.deepEqual([...sc('f(1,2),x')], ['f(1,2)', 'x']);
  assert.deepEqual([...sc('[1,2],{a:1}')], ['[1,2]', '{a:1}']);
  assert.deepEqual([...sc('')], ['']);
});

test('resolve: dotted paths resolve through objects', () => {
  const { V } = boot();
  const r = V.__test.resolve;
  assert.equal(typeof r('Math.floor'), 'function');
  assert.equal(r('nope.nada'), undefined);
});

test('arg: @value/@checked/@this tokens read from element', () => {
  const { V } = boot();
  const arg = V.__test.arg;
  const el = { value: '  hello  ', checked: true };
  assert.equal(arg('@value', el), '  hello  ');
  assert.equal(arg('@checked', el), true);
  assert.equal(arg('@this', el), el);
  assert.equal(arg('@num', { value: '7' }), 7);
  assert.equal(arg('plain', el), 'plain');
  assert.equal(arg('42', el), 42);
});

test('explicit ops table contains all documented micro-ops', () => {
  const { V } = boot();
  const p = V.__test.parse;
  const ops = ['stop','prevent','hide','show','mirror','labelclick','blurhide','selectval',
    'upper','setval','clickid','classList','numeric6','borderColor','color','bg','bgt',
    'availRow','availSplice','elRemove','toggleDisplay','showFormDate','showPanel','showRTab','showRTabQ'];
  for (const op of ops) {
    const s = p(op + ':x')[0];
    assert.equal(s.explicit, true, op + ' should be an explicit op');
  }
});
