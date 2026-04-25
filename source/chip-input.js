function initChipInput(hiddenInput, opts = {}) {
  if (!hiddenInput || hiddenInput._chipInputInit) return;
  hiddenInput._chipInputInit = true;

  // opts.displayOf(value) → display label for a stored value (default: identity)
  // opts.resolveInput(typedText, textInput, hiddenInput) → stored value to commit (default: identity; returns null to skip)
  // opts.beforeRemove(value, editMode, hiddenInput) → return false to cancel built-in removal
  // opts.noAutocomplete → suppress tag autocomplete (e.g. in tag manager group inputs)
  const displayOf    = opts.displayOf    || (v => v);
  const resolveInput = opts.resolveInput || (v => v);
  const beforeRemove = opts.beforeRemove || (() => true);

  const container = document.createElement('div');
  container.className = 'chip-input-wrapper';
  container.addEventListener('click', () => textInput.focus());

  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.className = 'chip-text-input';
  textInput.setAttribute('autocomplete', 'off');
  textInput.setAttribute('spellcheck', 'false');

  // Store the original placeholder on the wrapper so we can restore it
  const placeholder = hiddenInput.placeholder || '';
  hiddenInput.placeholder = '';
  hiddenInput.type = 'hidden';

  hiddenInput.parentNode.insertBefore(container, hiddenInput);
  container.appendChild(hiddenInput);
  container.appendChild(textInput);

  let chips = [];

  function syncBacking() {
    hiddenInput._syncing = true;
    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    desc.set.call(hiddenInput, chips.join(' '));
    hiddenInput._syncing = false;
    hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function renderChips() {
    container.querySelectorAll('.chip-live').forEach(el => el.remove());
    chips.forEach(value => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip chip-live';
      chip.dataset.value = value;
      if (typeof applyTagColor === 'function') applyTagColor(chip, value);
      if (typeof applyChipTooltip === 'function') applyChipTooltip(chip, value);

      const label = document.createElement('span');
      label.textContent = displayOf(value);
      chip.appendChild(label);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip-remove-btn';
      btn.textContent = '×';
      btn.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        removeChip(value, false);
      });
      btn.addEventListener('click', e => e.stopPropagation());
      chip.appendChild(btn);

      chip.addEventListener('click', e => { e.stopPropagation(); if (e.target !== btn) removeChip(value, true); });
      container.insertBefore(chip, textInput);
    });
    textInput.placeholder = chips.length ? '' : placeholder;
  }

  function addChip(typed) {
    typed = typed.trim();
    if (!typed) return false;
    const value = resolveInput(typed, textInput, hiddenInput);
    if (value == null || chips.includes(value)) return false;
    chips.push(value);
    renderChips();
    syncBacking();
    return true;
  }

  hiddenInput._addValueDirect = value => {
    if (value == null || chips.includes(value)) return;
    chips.push(value);
    renderChips();
    syncBacking();
    textInput.value = '';
    textInput.focus();
  };

  function removeChip(value, editMode) {
    if (beforeRemove(value, editMode, hiddenInput) === false) return;
    chips = chips.filter(v => v !== value);
    renderChips();
    syncBacking();
    if (editMode) {
      // Put the display name back in the text input so the user can re-type
      const display = displayOf(value);
      const cur = textInput.value.trim();
      textInput.value = cur ? cur + ' ' + display : display;
      textInput.focus();
      textInput.setSelectionRange(textInput.value.length, textInput.value.length);
    }
  }

  function chipifyWord() {
    const word = textInput.value.trim();
    if (word && addChip(word)) textInput.value = '';
  }

  hiddenInput._commit = chipifyWord;

  function setValue(raw) {
    chips = [];
    textInput.value = '';
    (raw || '').trim().split(/\s+/).filter(Boolean).forEach(t => {
      if (!chips.includes(t)) chips.push(t);
    });
    renderChips();
  }

  // Intercept external .value = '...' assignments so showFolderModal/showBoardSettingsPanel
  // can set the value and chips re-render automatically.
  const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(hiddenInput, 'value', {
    get() { return proto.get.call(this); },
    set(val) {
      proto.set.call(this, val);
      if (!this._syncing) setValue(val);
    },
    configurable: true
  });

  textInput.addEventListener('keydown', e => {
    if (e.key === ' ' || e.key === 'Tab') {
      if (textInput.value.trim()) {
        e.preventDefault();
        // If Tab fires while autocomplete suggestion is selected, let autocomplete accept it first
        if (e.key === 'Tab' && textInput.selectionStart !== textInput.selectionEnd) return;
        chipifyWord();
      }
    } else if (e.key === 'Enter') {
      if (textInput.value.trim()) { e.preventDefault(); chipifyWord(); }
      // else let Enter propagate for form submit
    } else if (e.key === 'Backspace' && !textInput.value && chips.length) {
      removeChip(chips[chips.length - 1], true);
    }
  });

  textInput.addEventListener('blur', chipifyWord);

  if (!opts.noAutocomplete && typeof attachTagAutocomplete === 'function') attachTagAutocomplete(textInput, hiddenInput);
  if (hiddenInput.value) setValue(hiddenInput.value);
}
