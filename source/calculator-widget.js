// Calculator and Converter widget. All calculations stay local and use the
// parser below; expressions are never handed to the JavaScript runtime.

const CALCULATOR_HISTORY_LIMIT = 12;
const CALCULATOR_RUNTIME_CACHE_KEY = 'runtime';
const _calculatorRuntimeMemory = new Map();

const CALCULATOR_FUNCTIONS = Object.freeze({
  abs: Math.abs,
  ceil: Math.ceil,
  cos: Math.cos,
  floor: Math.floor,
  ln: Math.log,
  log: Math.log10,
  round: Math.round,
  sin: Math.sin,
  sqrt: Math.sqrt,
  tan: Math.tan
});

const CALCULATOR_CONSTANTS = Object.freeze({ pi: Math.PI, e: Math.E });

const CALCULATOR_CONVERTERS = Object.freeze({
  length: {
    label: 'Length',
    units: {
      mm: ['Millimetres', 0.001], cm: ['Centimetres', 0.01], m: ['Metres', 1], km: ['Kilometres', 1000],
      in: ['Inches', 0.0254], ft: ['Feet', 0.3048], yd: ['Yards', 0.9144], mi: ['Miles', 1609.344],
      au: ['Astronomical units (AU)', 149597870700], ly: ['Light-years', 9460730472580800],
      pc: ['Parsecs', 3.085677581491367e16]
    }
  },
  mass: {
    label: 'Mass',
    units: {
      mg: ['Milligrams', 0.000001], g: ['Grams', 0.001], kg: ['Kilograms', 1],
      oz: ['Ounces', 0.028349523125], lb: ['Pounds', 0.45359237]
    }
  },
  temperature: {
    label: 'Temperature',
    units: { c: ['Celsius', 1], f: ['Fahrenheit', 1], k: ['Kelvin', 1] }
  },
  duration: {
    label: 'Duration',
    units: {
      ms: ['Milliseconds', 0.001], s: ['Seconds', 1], min: ['Minutes', 60], h: ['Hours', 3600],
      day: ['Days', 86400], week: ['Weeks', 604800]
    }
  },
  storage: {
    label: 'Storage',
    units: {
      bit: ['Bits', 0.125], b: ['Bytes', 1], kb: ['Kilobytes (KB)', 1000], mb: ['Megabytes (MB)', 1000 ** 2],
      gb: ['Gigabytes (GB)', 1000 ** 3], tb: ['Terabytes (TB)', 1000 ** 4],
      kib: ['Kibibytes (KiB)', 1024], mib: ['Mebibytes (MiB)', 1024 ** 2],
      gib: ['Gibibytes (GiB)', 1024 ** 3], tib: ['Tebibytes (TiB)', 1024 ** 4]
    }
  },
  angle: {
    label: 'Angle',
    units: { deg: ['Degrees', Math.PI / 180], rad: ['Radians', 1], grad: ['Gradians', Math.PI / 200], turn: ['Turns', Math.PI * 2] }
  },
  date: {
    label: 'Date & timestamp',
    units: { iso: ['ISO 8601', 1], unix: ['Unix seconds', 1], unixms: ['Unix milliseconds', 1] }
  },
  timezone: { label: 'Time zone', units: {} }
});

const CALCULATOR_TIME_ZONES = Object.freeze([
  ['local', 'Local time'], ['UTC', 'UTC'], ['Europe/London', 'London'], ['Europe/Berlin', 'Berlin'],
  ['America/New_York', 'New York'], ['America/Los_Angeles', 'Los Angeles'], ['Asia/Tokyo', 'Tokyo'],
  ['Asia/Kolkata', 'Kolkata'], ['Australia/Sydney', 'Sydney']
]);

function _calculatorNormalizeExpression(value) {
  return String(value ?? '')
    .trim()
    .replace(/[−–]/g, '-')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/\*\*/g, '^')
    .replace(/(\d),(?=\d)/g, '$1.');
}

function _calculatorTokenize(expression) {
  const input = _calculatorNormalizeExpression(expression);
  if (!input) throw new Error('Enter an expression.');
  if (input.length > 512) throw new Error('Expression is too long.');
  const tokens = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (/\s/.test(char)) { index += 1; continue; }
    const number = input.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (number) {
      const value = Number(number[0]);
      if (!Number.isFinite(value)) throw new Error('Number is outside the supported range.');
      tokens.push({ type: 'number', value });
      index += number[0].length;
      continue;
    }
    const identifier = input.slice(index).match(/^[a-z]+/i);
    if (identifier) {
      tokens.push({ type: 'identifier', value: identifier[0].toLowerCase() });
      index += identifier[0].length;
      continue;
    }
    if ('+-*/^()%'.includes(char)) {
      tokens.push({ type: char, value: char });
      index += 1;
      continue;
    }
    throw new Error(`Unexpected character “${char}”.`);
  }
  if (tokens.length > 256) throw new Error('Expression has too many parts.');
  tokens.push({ type: 'end', value: '' });
  return tokens;
}

function _calculatorParseExpression(expression) {
  const tokens = _calculatorTokenize(expression);
  let position = 0;
  const current = () => tokens[position];
  const take = type => current().type === type ? tokens[position++] : null;
  const expect = type => {
    const token = take(type);
    if (!token) throw new Error(type === ')' ? 'Missing closing parenthesis.' : 'Incomplete expression.');
    return token;
  };

  function primary() {
    const number = take('number');
    if (number) return { type: 'number', value: number.value };
    const identifier = take('identifier');
    if (identifier) {
      if (take('(')) {
        if (!Object.hasOwn(CALCULATOR_FUNCTIONS, identifier.value)) throw new Error(`Unknown function “${identifier.value}”.`);
        const argument = addition();
        expect(')');
        return { type: 'function', name: identifier.value, argument };
      }
      if (!Object.hasOwn(CALCULATOR_CONSTANTS, identifier.value)) throw new Error(`Unknown value “${identifier.value}”.`);
      return { type: 'number', value: CALCULATOR_CONSTANTS[identifier.value] };
    }
    if (take('(')) {
      const node = addition();
      expect(')');
      return node;
    }
    throw new Error('Expected a number or parenthesis.');
  }

  function postfix() {
    let node = primary();
    while (take('%')) node = { type: 'percent', value: node };
    return node;
  }

  function power() {
    const left = postfix();
    return take('^') ? { type: 'binary', operator: '^', left, right: unary() } : left;
  }

  function unary() {
    if (take('+')) return { type: 'unary', operator: '+', value: unary() };
    if (take('-')) return { type: 'unary', operator: '-', value: unary() };
    return power();
  }

  function multiplication() {
    let node = unary();
    while (current().type === '*' || current().type === '/') {
      const operator = tokens[position++].type;
      node = { type: 'binary', operator, left: node, right: unary() };
    }
    return node;
  }

  function addition() {
    let node = multiplication();
    while (current().type === '+' || current().type === '-') {
      const operator = tokens[position++].type;
      node = { type: 'binary', operator, left: node, right: multiplication() };
    }
    return node;
  }

  const tree = addition();
  if (current().type !== 'end') throw new Error(`Unexpected “${current().value}”.`);
  return tree;
}

function _calculatorEvaluateNode(node) {
  if (node.type === 'number') return node.value;
  if (node.type === 'percent') return _calculatorEvaluateNode(node.value) / 100;
  if (node.type === 'unary') {
    const value = _calculatorEvaluateNode(node.value);
    return node.operator === '-' ? -value : value;
  }
  if (node.type === 'function') return CALCULATOR_FUNCTIONS[node.name](_calculatorEvaluateNode(node.argument));
  const left = _calculatorEvaluateNode(node.left);
  let right = _calculatorEvaluateNode(node.right);
  if ((node.operator === '+' || node.operator === '-') && node.right.type === 'percent') right = left * right;
  if (node.operator === '+') return left + right;
  if (node.operator === '-') return left - right;
  if (node.operator === '*') return left * right;
  if (node.operator === '/') {
    if (right === 0) throw new Error('Cannot divide by zero.');
    return left / right;
  }
  return left ** right;
}

function _calculatorEvaluateExpression(expression) {
  const result = _calculatorEvaluateNode(_calculatorParseExpression(expression));
  if (!Number.isFinite(result)) throw new Error('Result is outside the supported range.');
  return Object.is(result, -0) ? 0 : result;
}

function _calculatorFormatNumber(value, precision = 10) {
  if (!Number.isFinite(Number(value))) return '—';
  const digits = Math.max(2, Math.min(14, Math.round(Number(precision) || 10)));
  const number = Object.is(Number(value), -0) ? 0 : Number(value);
  const absolute = Math.abs(number);
  if (absolute !== 0 && (absolute >= 1e12 || absolute < 1e-9)) {
    return number.toExponential(digits - 1).replace(/(\.\d*?[1-9])0+(?=e)|\.0+(?=e)/, '$1').replace('e+', 'e');
  }
  return Number(number.toPrecision(digits)).toString();
}

function _calculatorConvertValue(category, value, from, to) {
  const numeric = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(numeric)) throw new Error('Enter a valid number.');
  if (category === 'temperature') {
    let celsius = numeric;
    if (from === 'f') celsius = (numeric - 32) * 5 / 9;
    if (from === 'k') celsius = numeric - 273.15;
    if (to === 'f') return celsius * 9 / 5 + 32;
    if (to === 'k') return celsius + 273.15;
    return celsius;
  }
  const converter = CALCULATOR_CONVERTERS[category];
  const fromFactor = converter?.units?.[from]?.[1];
  const toFactor = converter?.units?.[to]?.[1];
  if (!Number.isFinite(fromFactor) || !Number.isFinite(toFactor)) throw new Error('Choose valid source and target units.');
  const result = numeric * fromFactor / toFactor;
  if (!Number.isFinite(result)) throw new Error('Result is outside the supported range.');
  return result;
}

function _calculatorConvertDateValue(value, from, to) {
  let instant;
  if (from === 'iso') instant = new Date(String(value).trim());
  else if (from === 'unix') instant = new Date(Number(String(value).replace(',', '.')) * 1000);
  else instant = new Date(Number(String(value).replace(',', '.')));
  if (Number.isNaN(instant.getTime())) throw new Error('Enter a valid date or timestamp.');
  if (to === 'iso') return instant.toISOString();
  if (to === 'unix') return String(instant.getTime() / 1000);
  return String(instant.getTime());
}

function _calculatorDatePartsInZone(date, timeZone) {
  if (timeZone === 'local') {
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes() };
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

function _calculatorParseLocalDateTime(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) throw new Error('Choose a date and time.');
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]) };
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute));
  if (check.getUTCFullYear() !== parts.year || check.getUTCMonth() + 1 !== parts.month || check.getUTCDate() !== parts.day) throw new Error('Choose a valid date and time.');
  return parts;
}

function _calculatorZonedLocalToDate(value, timeZone) {
  const parts = _calculatorParseLocalDateTime(value);
  if (timeZone === 'local') {
    const local = new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    if (local.getFullYear() !== parts.year || local.getMonth() + 1 !== parts.month || local.getDate() !== parts.day || local.getHours() !== parts.hour || local.getMinutes() !== parts.minute) {
      throw new Error('That local time does not exist because of a daylight-saving change.');
    }
    return local;
  }
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  let timestamp = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rendered = _calculatorDatePartsInZone(new Date(timestamp), timeZone);
    const difference = Date.UTC(rendered.year, rendered.month - 1, rendered.day, rendered.hour, rendered.minute) - desired;
    if (!difference) break;
    timestamp -= difference;
  }
  const instant = new Date(timestamp);
  const roundTrip = _calculatorDatePartsInZone(instant, timeZone);
  if (Object.keys(parts).some(key => roundTrip[key] !== parts[key])) {
    throw new Error('That time does not exist in the source zone because of a daylight-saving change.');
  }
  return instant;
}

function _calculatorFormatInZone(date, timeZone) {
  const parts = _calculatorDatePartsInZone(date, timeZone);
  const pad = value => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

function _calculatorConvertTimeZone(value, from, to) {
  return _calculatorFormatInZone(_calculatorZonedLocalToDate(value, from), to);
}

async function _calculatorCopyText(value) {
  const text = String(value ?? '');
  if (!text) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  if (typeof document === 'undefined') return false;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch {}
  field.remove();
  return copied;
}

function _calculatorDefaultRuntime(widget) {
  const category = CALCULATOR_CONVERTERS[widget?.config?.converterCategory] ? widget.config.converterCategory : 'length';
  const units = Object.keys(CALCULATOR_CONVERTERS[category].units || {});
  const now = new Date();
  const localNow = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return {
    mode: widget?.config?.defaultMode === 'converter' ? 'converter' : 'calculator',
    expression: '', result: '', error: '', memory: 0, history: [], historyOpen: true,
    category, converterInput: category === 'timezone' ? localNow : category === 'date' ? now.toISOString() : '1',
    from: units[0] || 'local', to: units[1] || 'UTC'
  };
}

function _calculatorReadRuntime(widget) {
  if (_calculatorRuntimeMemory.has(widget.id)) return _calculatorRuntimeMemory.get(widget.id);
  const fallback = _calculatorDefaultRuntime(widget);
  let stored = null;
  try { stored = typeof WidgetSDK !== 'undefined' ? WidgetSDK.cache.get('calculatorConverter', widget.id, CALCULATOR_RUNTIME_CACHE_KEY) : null; } catch {}
  const runtime = stored && typeof stored === 'object' ? { ...fallback, ...stored } : fallback;
  runtime.history = Array.isArray(runtime.history) ? runtime.history.slice(0, CALCULATOR_HISTORY_LIMIT) : [];
  runtime.historyOpen = runtime.historyOpen !== false;
  runtime.memory = Number.isFinite(Number(runtime.memory)) ? Number(runtime.memory) : 0;
  _calculatorRuntimeMemory.set(widget.id, runtime);
  return runtime;
}

function _calculatorPersistRuntime(widget, runtime) {
  _calculatorRuntimeMemory.set(widget.id, runtime);
  try { if (typeof WidgetSDK !== 'undefined') WidgetSDK.cache.set('calculatorConverter', widget.id, CALCULATOR_RUNTIME_CACHE_KEY, runtime); } catch {}
}

function _calculatorElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function _calculatorMakeSelect(options, value, ariaLabel) {
  const select = _calculatorElement('select', 'calculator-select');
  select.setAttribute('aria-label', ariaLabel);
  options.forEach(([key, label]) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = label;
    option.selected = key === value;
    select.appendChild(option);
  });
  return select;
}

function _calculatorShowCopyFeedback(button, copied) {
  const original = button.textContent;
  button.textContent = copied ? 'Copied' : 'Copy failed';
  setTimeout(() => { if (button.isConnected) button.textContent = original; }, 1200);
}

function _calculatorRenderCalculator(widget, runtime, body, rerender) {
  const precision = Math.max(2, Math.min(14, Number(widget.config?.precision) || 10));
  const display = _calculatorElement('div', 'calculator-display');
  const input = _calculatorElement('input', 'calculator-expression');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.placeholder = '2 + 3 × 4';
  input.value = runtime.expression;
  input.setAttribute('aria-label', 'Calculator expression');
  const resultRow = _calculatorElement('div', `calculator-result${runtime.error ? ' is-error' : ''}`);
  const result = _calculatorElement('output', '', runtime.error || runtime.result || '0');
  const copy = _calculatorElement('button', 'calculator-copy', 'Copy');
  copy.type = 'button';
  copy.disabled = !runtime.result || !!runtime.error;
  copy.addEventListener('click', async () => _calculatorShowCopyFeedback(copy, await _calculatorCopyText(runtime.result)));
  resultRow.append(result, copy);
  display.append(input, resultRow);
  body.appendChild(display);

  const calculate = () => {
    runtime.expression = input.value.trim();
    try {
      const value = _calculatorEvaluateExpression(runtime.expression);
      runtime.result = _calculatorFormatNumber(value, precision);
      runtime.error = '';
      runtime.history = [{ expression: runtime.expression, result: runtime.result }, ...runtime.history.filter(item => item.expression !== runtime.expression)].slice(0, CALCULATOR_HISTORY_LIMIT);
    } catch (error) {
      runtime.result = '';
      runtime.error = error.message;
    }
    _calculatorPersistRuntime(widget, runtime);
    rerender(true);
  };
  input.addEventListener('input', () => { runtime.expression = input.value; _calculatorPersistRuntime(widget, runtime); });
  input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); calculate(); } });

  const memory = _calculatorElement('div', 'calculator-memory');
  ['MC', 'MR', 'M+', 'M-'].forEach(action => {
    const button = _calculatorElement('button', '', action);
    button.type = 'button';
    button.addEventListener('click', () => {
      if (action === 'MC') runtime.memory = 0;
      if (action === 'MR') runtime.expression = _calculatorFormatNumber(runtime.memory, precision);
      if (action === 'M+' || action === 'M-') {
        try {
          const value = runtime.result ? Number(runtime.result) : _calculatorEvaluateExpression(runtime.expression);
          runtime.memory += action === 'M+' ? value : -value;
          runtime.error = '';
        } catch (error) { runtime.error = error.message; }
      }
      _calculatorPersistRuntime(widget, runtime);
      rerender(action === 'MR');
    });
    memory.appendChild(button);
  });
  body.appendChild(memory);

  const keypad = _calculatorElement('div', 'calculator-keypad');
  const keys = ['(', ')', '%', '⌫', '7', '8', '9', '÷', '4', '5', '6', '×', '1', '2', '3', '−', '0', '.', 'C', '+'];
  keys.forEach(key => {
    const button = _calculatorElement('button', /[÷×−+]/.test(key) ? 'is-operator' : '', key);
    button.type = 'button';
    button.addEventListener('click', () => {
      if (key === 'C') { runtime.expression = ''; runtime.result = ''; runtime.error = ''; }
      else if (key === '⌫') runtime.expression = runtime.expression.slice(0, -1);
      else runtime.expression += ({ '÷': '/', '×': '*', '−': '-' }[key] || key);
      _calculatorPersistRuntime(widget, runtime);
      rerender(true);
    });
    keypad.appendChild(button);
  });
  const equals = _calculatorElement('button', 'calculator-equals', '=');
  equals.type = 'button';
  equals.addEventListener('click', calculate);
  keypad.appendChild(equals);
  body.appendChild(keypad);

  if (widget.config?.showHistory !== false && runtime.history.length) {
    const history = _calculatorElement('details', 'calculator-history');
    history.open = runtime.historyOpen;
    history.addEventListener('toggle', () => {
      runtime.historyOpen = history.open;
      _calculatorPersistRuntime(widget, runtime);
    });
    const summary = _calculatorElement('summary', '', `History (${runtime.history.length})`);
    history.appendChild(summary);
    runtime.history.forEach(item => {
      const button = _calculatorElement('button', 'calculator-history-item');
      button.type = 'button';
      button.append(_calculatorElement('span', '', item.expression), _calculatorElement('strong', '', item.result));
      button.addEventListener('click', () => { runtime.expression = item.expression; runtime.result = item.result; runtime.error = ''; _calculatorPersistRuntime(widget, runtime); rerender(true); });
      history.appendChild(button);
    });
    body.appendChild(history);
  }
}

function _calculatorRenderConverter(widget, runtime, body, rerender) {
  const precision = Math.max(2, Math.min(14, Number(widget.config?.precision) || 10));
  const categoryOptions = Object.entries(CALCULATOR_CONVERTERS).map(([key, item]) => [key, item.label]);
  const category = _calculatorMakeSelect(categoryOptions, runtime.category, 'Conversion type');
  body.appendChild(category);
  const form = _calculatorElement('div', 'calculator-converter-form');
  const input = _calculatorElement('input', 'calculator-converter-input');
  input.value = runtime.converterInput;
  input.setAttribute('aria-label', 'Value to convert');
  input.inputMode = 'decimal';
  if (runtime.category === 'timezone') { input.type = 'datetime-local'; input.inputMode = ''; }
  else input.type = 'text';

  const isTimeZone = runtime.category === 'timezone';
  const unitOptions = isTimeZone
    ? CALCULATOR_TIME_ZONES
    : Object.entries(CALCULATOR_CONVERTERS[runtime.category]?.units || {}).map(([key, item]) => [key, item[0]]);
  if (!unitOptions.some(([key]) => key === runtime.from)) runtime.from = unitOptions[0]?.[0] || '';
  if (!unitOptions.some(([key]) => key === runtime.to)) runtime.to = unitOptions[1]?.[0] || unitOptions[0]?.[0] || '';
  const from = _calculatorMakeSelect(unitOptions, runtime.from, 'Source unit');
  const to = _calculatorMakeSelect(unitOptions, runtime.to, 'Target unit');
  const swap = _calculatorElement('button', 'calculator-swap', '⇅ Swap');
  swap.type = 'button';
  form.append(input, from, swap, to);

  const outputRow = _calculatorElement('div', 'calculator-converter-output');
  const output = _calculatorElement('output', '', '—');
  const copy = _calculatorElement('button', 'calculator-copy', 'Copy');
  copy.type = 'button';
  copy.disabled = true;
  outputRow.append(output, copy);
  form.appendChild(outputRow);
  body.appendChild(form);

  const convert = () => {
    runtime.converterInput = input.value;
    runtime.from = from.value;
    runtime.to = to.value;
    try {
      let value;
      if (runtime.category === 'timezone') value = _calculatorConvertTimeZone(input.value, from.value, to.value);
      else if (runtime.category === 'date') value = _calculatorConvertDateValue(input.value, from.value, to.value);
      else value = _calculatorFormatNumber(_calculatorConvertValue(runtime.category, input.value, from.value, to.value), precision);
      output.textContent = value;
      output.classList.remove('is-error');
      copy.disabled = false;
      copy.onclick = async () => _calculatorShowCopyFeedback(copy, await _calculatorCopyText(value));
    } catch (error) {
      output.textContent = error.message;
      output.classList.add('is-error');
      copy.disabled = true;
    }
    _calculatorPersistRuntime(widget, runtime);
  };
  input.addEventListener('input', convert);
  from.addEventListener('change', convert);
  to.addEventListener('change', convert);
  swap.addEventListener('click', () => { const previous = runtime.from; runtime.from = runtime.to; runtime.to = previous; _calculatorPersistRuntime(widget, runtime); rerender(false); });
  category.addEventListener('change', () => {
    runtime.category = category.value;
    const options = runtime.category === 'timezone' ? CALCULATOR_TIME_ZONES.map(item => item[0]) : Object.keys(CALCULATOR_CONVERTERS[runtime.category].units);
    runtime.from = options[0];
    runtime.to = options[1] || options[0];
    if (runtime.category === 'timezone') {
      const now = new Date();
      runtime.converterInput = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    } else runtime.converterInput = runtime.category === 'date' ? new Date().toISOString() : '1';
    _calculatorPersistRuntime(widget, runtime);
    rerender(false);
  });
  convert();
}

function _calculatorRenderWidget(widget, element, context = 'column', focusExpression = false) {
  const runtime = _calculatorReadRuntime(widget);
  element.innerHTML = '';
  element.classList.remove('calculator-widget--column', 'calculator-widget--navpane');
  element.classList.add('calculator-widget', `calculator-widget--${context}`);
  const tabs = _calculatorElement('div', 'calculator-tabs');
  tabs.setAttribute('role', 'tablist');
  [['calculator', 'Calculator'], ['converter', 'Converter']].forEach(([mode, label]) => {
    const button = _calculatorElement('button', runtime.mode === mode ? 'active' : '', label);
    button.type = 'button';
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', runtime.mode === mode ? 'true' : 'false');
    button.addEventListener('click', () => { runtime.mode = mode; _calculatorPersistRuntime(widget, runtime); _calculatorRenderWidget(widget, element, context, mode === 'calculator'); });
    tabs.appendChild(button);
  });
  element.appendChild(tabs);
  const body = _calculatorElement('div', 'calculator-body');
  const rerender = focus => _calculatorRenderWidget(widget, element, context, focus);
  if (runtime.mode === 'converter') _calculatorRenderConverter(widget, runtime, body, rerender);
  else _calculatorRenderCalculator(widget, runtime, body, rerender);
  element.appendChild(body);
  if (focusExpression) {
    const field = element.querySelector('.calculator-expression');
    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
  }
}

WIDGET_REGISTRY['calculatorConverter'] = {
  id: 'calculatorConverter',
  name: 'Calculator & Converter',
  category: 'Utilities',
  description: 'Calculate expressions and convert common units, dates, storage, and time zones locally.',
  allowedIn: ['column', 'navpane'],
  defaultConfig: { defaultMode: 'calculator', converterCategory: 'length', precision: 10, showHistory: true },
  defaultData: {},
  settingsSchema: {
    type: 'object',
    properties: {
      defaultMode: { type: 'string', enum: ['calculator', 'converter'] },
      converterCategory: { type: 'string', enum: Object.keys(CALCULATOR_CONVERTERS) },
      precision: { type: 'number', minimum: 2, maximum: 14 },
      showHistory: { type: 'boolean' }
    },
    additionalProperties: false
  },
  capabilities: { localCache: { quotaBytes: 128 * 1024 } },
  responsive: { minWidth: 180, preferredWidth: 420, compactBelow: 260 },
  liveSettingsPreview: false,
  migrate(state) {
    state.config = { ...this.defaultConfig, ...(state.config || {}) };
    state.data = {};
    return state;
  },
  cleanup(widget) {
    _calculatorRuntimeMemory.delete(widget.id);
    try { if (typeof WidgetSDK !== 'undefined') WidgetSDK.cache.remove('calculatorConverter', widget.id, CALCULATOR_RUNTIME_CACHE_KEY); } catch {}
  },
  onSettingsCommit(widget, previousConfig) {
    const runtime = _calculatorReadRuntime(widget);
    if (widget.config.defaultMode !== previousConfig?.defaultMode) runtime.mode = widget.config.defaultMode === 'converter' ? 'converter' : 'calculator';
    if (widget.config.converterCategory !== previousConfig?.converterCategory && CALCULATOR_CONVERTERS[widget.config.converterCategory]) {
      const replacement = _calculatorDefaultRuntime(widget);
      runtime.category = replacement.category;
      runtime.converterInput = replacement.converterInput;
      runtime.from = replacement.from;
      runtime.to = replacement.to;
    }
    _calculatorPersistRuntime(widget, runtime);
  },
  render(widget, element, context) { _calculatorRenderWidget(widget, element, context); },
  renderSettings(widget, container) {
    container.innerHTML = `
      <label class="settings-row"><span>Open on</span><select class="settings-select" data-cfg="defaultMode">
        <option value="calculator" ${widget.config.defaultMode !== 'converter' ? 'selected' : ''}>Calculator</option>
        <option value="converter" ${widget.config.defaultMode === 'converter' ? 'selected' : ''}>Converter</option>
      </select></label>
      <label class="settings-row"><span>Default conversion</span><select class="settings-select" data-cfg="converterCategory">
        ${Object.entries(CALCULATOR_CONVERTERS).map(([key, item]) => `<option value="${key}" ${widget.config.converterCategory === key ? 'selected' : ''}>${item.label}</option>`).join('')}
      </select></label>
      <label class="settings-row"><span>Significant digits</span><input class="settings-text-input" type="number" min="2" max="14" step="1" value="${Math.max(2, Math.min(14, Number(widget.config.precision) || 10))}" data-cfg="precision" /></label>
      <div class="settings-row"><span>Show calculation history</span><label class="settings-toggle"><input type="checkbox" data-cfg="showHistory" ${widget.config.showHistory !== false ? 'checked' : ''} /><span class="toggle-track"></span></label></div>`;
  }
};
