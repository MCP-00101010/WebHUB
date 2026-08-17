const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'source/calculator-widget.js'), 'utf8');

function createContext(extra = {}) {
  const context = vm.createContext({
    WIDGET_REGISTRY: {},
    Date,
    Intl,
    Math,
    Number,
    Object,
    String,
    Map,
    setTimeout: callback => callback(),
    ...extra
  });
  vm.runInContext(source, context);
  return context;
}

function calculate(context, expression) {
  return vm.runInContext(`_calculatorEvaluateExpression(${JSON.stringify(expression)})`, context);
}

test('calculator parser handles precedence, powers, unary values, functions, and contextual percentages', () => {
  const context = createContext();
  assert.equal(calculate(context, '2 + 3 * 4'), 14);
  assert.equal(calculate(context, '(2 + 3) * 4'), 20);
  assert.equal(calculate(context, '2^3^2'), 512);
  assert.equal(calculate(context, '-2^2'), -4);
  assert.equal(calculate(context, 'sqrt(81) + abs(-2)'), 11);
  assert.equal(calculate(context, '200 + 10%'), 220);
  assert.equal(calculate(context, '200 - 10%'), 180);
  assert.equal(calculate(context, '200 * 10%'), 20);
  assert.equal(calculate(context, '100 + 10% + 10%'), 121);
});

test('calculator accepts decimal commas and rejects invalid or unsafe input', () => {
  const context = createContext();
  assert.equal(calculate(context, '1,5 + 2,25'), 3.75);
  assert.throws(() => calculate(context, '2 +'), /Expected|Incomplete/);
  assert.throws(() => calculate(context, '1 / 0'), /divide by zero/);
  assert.throws(() => calculate(context, 'unknown(2)'), /Unknown function/);
  assert.throws(() => calculate(context, 'globalThis'), /Unknown value/);
  assert.doesNotMatch(source, /\beval\s*\(/);
  assert.doesNotMatch(source, /new\s+Function\s*\(/);
});

test('number formatting honours precision and preserves extreme finite values', () => {
  const context = createContext();
  assert.equal(vm.runInContext('_calculatorFormatNumber(1 / 3, 6)', context), '0.333333');
  assert.equal(vm.runInContext('_calculatorFormatNumber(-0, 10)', context), '0');
  assert.match(vm.runInContext('_calculatorFormatNumber(1.23456789e20, 6)', context), /^1\.23457e20$/);
  assert.match(vm.runInContext('_calculatorFormatNumber(1.2e-12, 6)', context), /^1\.2e-12$/);
});

test('converter covers common units, temperature, duration, storage, angle, and dates', () => {
  const context = createContext();
  assert.ok(Math.abs(vm.runInContext("_calculatorConvertValue('length', 1, 'mi', 'km')", context) - 1.609344) < 1e-12);
  assert.equal(vm.runInContext("_calculatorConvertValue('temperature', 32, 'f', 'c')", context), 0);
  assert.equal(vm.runInContext("_calculatorConvertValue('duration', 2, 'h', 'min')", context), 120);
  assert.equal(vm.runInContext("_calculatorConvertValue('storage', 1, 'gib', 'mib')", context), 1024);
  assert.equal(vm.runInContext("_calculatorConvertValue('storage', 8, 'bit', 'b')", context), 1);
  assert.ok(Math.abs(vm.runInContext("_calculatorConvertValue('angle', 180, 'deg', 'rad')", context) - Math.PI) < 1e-12);
  assert.equal(vm.runInContext("_calculatorConvertDateValue('1970-01-01T00:00:01.000Z', 'iso', 'unix')", context), '1');
  assert.equal(vm.runInContext("_calculatorConvertDateValue('1000', 'unixms', 'iso')", context), '1970-01-01T00:00:01.000Z');
});

test('length conversion includes astronomical units, light-years, and parsecs', () => {
  const context = createContext();
  assert.equal(vm.runInContext("_calculatorConvertValue('length', 1, 'au', 'm')", context), 149597870700);
  assert.equal(vm.runInContext("_calculatorConvertValue('length', 1, 'ly', 'm')", context), 9460730472580800);
  assert.ok(Math.abs(vm.runInContext("_calculatorConvertValue('length', 1, 'pc', 'ly')", context) - 3.261563777) < 1e-8);
});

test('time-zone conversion respects offsets and rejects daylight-saving gaps', () => {
  const context = createContext();
  assert.equal(
    vm.runInContext("_calculatorConvertTimeZone('2026-01-15T12:00', 'Europe/London', 'America/New_York')", context),
    '2026-01-15 07:00'
  );
  assert.throws(
    () => vm.runInContext("_calculatorConvertTimeZone('2026-03-08T02:30', 'America/New_York', 'UTC')", context),
    /does not exist/
  );
});

test('copy uses the browser clipboard and widget runtime remains outside synced data', async () => {
  const writes = [];
  const cacheWrites = [];
  const context = createContext({
    navigator: { clipboard: { writeText: async value => writes.push(value) } },
    WidgetSDK: { cache: { get: () => null, set: (...args) => cacheWrites.push(args), remove: () => {} } }
  });
  assert.equal(await vm.runInContext("_calculatorCopyText('42')", context), true);
  assert.deepEqual(writes, ['42']);
  const widget = { id: 'calc-1', config: { converterCategory: 'length' }, data: { shouldDisappear: true } };
  context.widget = widget;
  vm.runInContext("const runtime = _calculatorReadRuntime(widget); runtime.memory = 12; _calculatorPersistRuntime(widget, runtime);", context);
  assert.deepEqual(widget.data, { shouldDisappear: true });
  assert.equal(cacheWrites[0][0], 'calculatorConverter');
  assert.deepEqual(JSON.parse(JSON.stringify(context.WIDGET_REGISTRY.calculatorConverter.defaultData)), {});
});

test('widget descriptor supports board/sidebar layouts and complete SDK metadata', () => {
  const context = createContext();
  const descriptor = context.WIDGET_REGISTRY.calculatorConverter;
  assert.deepEqual(JSON.parse(JSON.stringify(descriptor.allowedIn)), ['column', 'navpane']);
  assert.equal(descriptor.category, 'Personal & Productivity');
  assert.equal(descriptor.capabilities.localCache.quotaBytes, 128 * 1024);
  assert.equal(typeof descriptor.render, 'function');
  assert.equal(typeof descriptor.renderSettings, 'function');
  assert.equal(typeof descriptor.migrate, 'function');
  assert.equal(typeof descriptor.cleanup, 'function');
});

test('calculator assets load in SDK order and include compact responsive styling', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'source/calculator-widget.css'), 'utf8');
  assert.ok(html.indexOf('source/widget-sdk.js') < html.indexOf('source/calculator-widget.js'));
  assert.ok(html.indexOf('source/calculator-widget.js') < html.indexOf('source/command-palette.js'));
  assert.match(html, /source\/calculator-widget\.css/);
  assert.match(css, /calculator-widget--navpane/);
  assert.match(css, /@container \(max-width: 260px\)/);
  assert.match(css, /var\(--accent\)/);
});

test('command palette exposes calculator results and invalid-expression feedback', () => {
  const context = createContext();
  const paletteSource = fs.readFileSync(path.join(root, 'source/command-palette.js'), 'utf8');
  const start = paletteSource.indexOf('function _commandPaletteCalculatorEntry');
  const end = paletteSource.indexOf('\nfunction _commandPaletteFilteredEntries', start);
  context.showNotice = () => {};
  context.openCommandPalette = () => {};
  vm.runInContext(paletteSource.slice(start, end), context);
  const result = vm.runInContext("_commandPaletteCalculatorEntry('= 2 + 3 * 4')", context);
  assert.equal(result.group, 'Calculator');
  assert.equal(result.label, '14');
  assert.match(result.shortcut, /Copy/);
  const invalid = vm.runInContext("_commandPaletteCalculatorEntry('= 2 +')", context);
  assert.equal(invalid.label, 'Invalid expression');
});
