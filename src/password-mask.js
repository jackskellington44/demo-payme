const PASSWORD_MASK_SEQUENCE = '#**^%**+!@*!+^%**+!*%';
const passwordState = new WeakMap();

function getMaskDisplay(length) {
  const targetLength = Math.max(0, Number(length) || 0);
  if (targetLength === 0) return '';

  let output = '';
  while (output.length < targetLength) {
    output += PASSWORD_MASK_SEQUENCE;
  }
  return output.slice(0, targetLength);
}

function ensureState(input) {
  if (!input) return { value: '' };
  let state = passwordState.get(input);
  if (!state) {
    state = { value: '' };
    passwordState.set(input, state);
  }
  return state;
}

function syncDisplay(input) {
  if (!input) return;
  const state = ensureState(input);
  input.value = getMaskDisplay(state.value.length);
}

function setCaret(input, position) {
  if (!input || typeof input.setSelectionRange !== 'function') return;
  const nextPos = Math.max(0, Number(position) || 0);
  input.setSelectionRange(nextPos, nextPos);
}

function emitSyntheticInput(input) {
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function replaceSelection(input, insertedText = '') {
  const state = ensureState(input);
  const start = input.selectionStart ?? state.value.length;
  const end = input.selectionEnd ?? start;
  const nextText = String(insertedText || '');
  state.value = state.value.slice(0, start) + nextText + state.value.slice(end);
  syncDisplay(input);
  setCaret(input, start + nextText.length);
  emitSyntheticInput(input);
}

function deleteBackward(input) {
  const state = ensureState(input);
  const start = input.selectionStart ?? state.value.length;
  const end = input.selectionEnd ?? start;

  if (start !== end) {
    state.value = state.value.slice(0, start) + state.value.slice(end);
    syncDisplay(input);
    setCaret(input, start);
    emitSyntheticInput(input);
    return;
  }

  if (start <= 0) return;
  state.value = state.value.slice(0, start - 1) + state.value.slice(end);
  syncDisplay(input);
  setCaret(input, start - 1);
  emitSyntheticInput(input);
}

function deleteForward(input) {
  const state = ensureState(input);
  const start = input.selectionStart ?? state.value.length;
  const end = input.selectionEnd ?? start;

  if (start !== end) {
    state.value = state.value.slice(0, start) + state.value.slice(end);
    syncDisplay(input);
    setCaret(input, start);
    emitSyntheticInput(input);
    return;
  }

  if (start >= state.value.length) return;
  state.value = state.value.slice(0, start) + state.value.slice(start + 1);
  syncDisplay(input);
  setCaret(input, start);
  emitSyntheticInput(input);
}

export function attachFakePasswordInput(input) {
  if (!input || input.dataset.fakePasswordAttached === 'true') return input;

  input.dataset.fakePasswordAttached = 'true';
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('data-fake-password-sequence', PASSWORD_MASK_SEQUENCE);
  syncDisplay(input);

  input.addEventListener('beforeinput', (event) => {
    if (input.readOnly || input.disabled) return;

    switch (event.inputType) {
      case 'insertText':
      case 'insertCompositionText':
      case 'insertReplacementText':
        event.preventDefault();
        replaceSelection(input, event.data || '');
        return;
      case 'insertFromPaste':
        event.preventDefault();
        replaceSelection(input, event.data || '');
        return;
      case 'deleteContentBackward':
        event.preventDefault();
        deleteBackward(input);
        return;
      case 'deleteContentForward':
        event.preventDefault();
        deleteForward(input);
        return;
      case 'deleteByCut':
      case 'deleteContent':
        event.preventDefault();
        replaceSelection(input, '');
        return;
      default:
        return;
    }
  });

  input.addEventListener('paste', (event) => {
    if (input.readOnly || input.disabled) return;
    const pastedText = event.clipboardData?.getData('text');
    if (typeof pastedText !== 'string') return;
    event.preventDefault();
    replaceSelection(input, pastedText);
  });

  input.addEventListener('drop', (event) => {
    event.preventDefault();
  });

  input.addEventListener('focus', () => {
    const state = ensureState(input);
    setCaret(input, state.value.length);
  });

  return input;
}

export function getFakePasswordValue(input) {
  return ensureState(input).value;
}

export function setFakePasswordValue(input, value = '') {
  if (!input) return;
  const state = ensureState(input);
  state.value = String(value || '');
  syncDisplay(input);
}
