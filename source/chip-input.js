function initChipInput(hiddenInput) {
  if (!hiddenInput || hiddenInput._chipInputInit) return;
  hiddenInput._chipInputInit = true;

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
    chips.forEach(tag => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip chip-live';
      if (typeof applyTagColor === 'function') applyTagColor(chip, tag);

      const label = document.createElement('span');
      label.textContent = tag;
      chip.appendChild(label);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip-remove-btn';
      btn.textContent = '×';
      btn.addEventListener('mousedown', e => { e.preventDefault(); removeChip(tag, false); });
      chip.appendChild(btn);

      chip.addEventListener('click', e => { if (e.target !== btn) removeChip(tag, true); });
      container.insertBefore(chip, textInput);
    });
    textInput.placeholder = chips.length ? '' : placeholder;
  }

  function addChip(tag) {
    tag = tag.trim();
    if (!tag || chips.includes(tag)) return;
    chips.push(tag);
    renderChips();
    syncBacking();
  }

  function removeChip(tag, editMode) {
    chips = chips.filter(t => t !== tag);
    renderChips();
    syncBacking();
    if (editMode) {
      const cur = textInput.value.trim();
      textInput.value = cur ? cur + ' ' + tag : tag;
      textInput.focus();
      textInput.setSelectionRange(textInput.value.length, textInput.value.length);
    }
  }

  function chipifyWord() {
    const word = textInput.value.trim();
    if (word) { addChip(word); textInput.value = ''; }
  }

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
      if (textInput.value.trim()) { e.preventDefault(); chipifyWord(); }
    } else if (e.key === 'Enter') {
      if (textInput.value.trim()) { e.preventDefault(); chipifyWord(); }
      // else let Enter propagate for form submit
    } else if (e.key === 'Backspace' && !textInput.value && chips.length) {
      removeChip(chips[chips.length - 1], true);
    }
  });

  textInput.addEventListener('blur', chipifyWord);

  if (typeof attachTagAutocomplete === 'function') attachTagAutocomplete(textInput);
  if (hiddenInput.value) setValue(hiddenInput.value);
}
