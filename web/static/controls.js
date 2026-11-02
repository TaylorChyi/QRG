(() => {
  'use strict';

  const enhanced = [];
  let openPanel = null;
  const t = (source, values) => window.QRGI18n?.t(source, values) || source;

  function closePanel() {
    if (!openPanel) return;
    openPanel.panel.remove();
    openPanel.trigger.setAttribute('aria-expanded', 'false');
    openPanel.trigger.removeAttribute('aria-activedescendant');
    openPanel.trigger.removeAttribute('aria-controls');
    openPanel = null;
  }

  function dismissPanel() {
    const trigger = openPanel?.trigger;
    closePanel();
    trigger?.focus();
  }

  function placePanel() {
    if (!openPanel) return;
    const { trigger, panel } = openPanel;
    const rect = trigger.getBoundingClientRect();
    const gap = 6;
    const below = window.innerHeight - rect.bottom - gap - 8;
    const above = rect.top - gap - 8;
    const useAbove = below < 210 && above > below;
    const available = Math.max(80, useAbove ? above : below);
    panel.style.maxHeight = `${available}px`;
    const width = Math.max(rect.width, Math.min(260, window.innerWidth - 16));
    panel.style.width = `${Math.min(width, window.innerWidth - 16)}px`;
    panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = useAbove ? `${Math.max(8, rect.top - panel.offsetHeight - gap)}px` : `${rect.bottom + gap}px`;
  }

  function showPanel(trigger, panel) {
    closePanel();
    document.body.append(panel);
    openPanel = { trigger, panel };
    trigger.setAttribute('aria-expanded', 'true');
    placePanel();
  }

  function labelText(input) {
    return input.getAttribute('aria-label') || document.querySelector(`label[for="${input.id}"]`)?.textContent.trim() || input.id;
  }

  function handleLabel(input, trigger) {
    const label = document.querySelector(`label[for="${input.id}"]`);
    label?.addEventListener('click', (event) => {
      if (event.target === trigger || trigger.contains(event.target)) return;
      event.preventDefault();
      trigger.focus();
      trigger.click();
    });
  }

  function shapePreview(select, value) {
    if (!['module-shape', 'eye-shape', 'image-shape'].includes(select.id)) return null;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('qrg-shape-preview');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    if (select.id === 'image-shape') {
      svg.setAttribute('viewBox', '0 0 24 24');
      const outline = document.createElementNS(svg.namespaceURI, 'rect');
      for (const [name, attribute] of Object.entries({ x: 2, y: 2, width: 20, height: 20, rx: value === 'rounded' ? 4 : 0,
        fill: 'none', stroke: 'currentColor', 'stroke-width': 2 })) {
        outline.setAttribute(name, attribute);
      }
      svg.append(outline);
    } else if (select.id === 'module-shape') {
      svg.setAttribute('viewBox', '0 0 2.4 2.4');
      const inset = value === 'tile' ? 0.12 : 0;
      const radius = { square: 0, tile: 0.16, circle: 0.5 }[value];
      for (const y of [0, 1.4]) {
        for (const x of [0, 1.4]) {
          const dot = document.createElementNS(svg.namespaceURI, 'rect');
          for (const [name, number] of Object.entries({ x: x + inset, y: y + inset, width: 1 - 2 * inset, height: 1 - 2 * inset, rx: radius })) {
            dot.setAttribute(name, number);
          }
          svg.append(dot);
        }
      }
    } else {
      svg.setAttribute('viewBox', '0 0 7 7');
      const ring = document.createElementNS(svg.namespaceURI, 'path');
      ring.setAttribute('fill-rule', 'evenodd');
      ring.setAttribute('d', value === 'rounded'
        ? 'M1.5 0H5.5A1.5 1.5 0 0 1 7 1.5V5.5A1.5 1.5 0 0 1 5.5 7H1.5A1.5 1.5 0 0 1 0 5.5V1.5A1.5 1.5 0 0 1 1.5 0Z M1.8 1H5.2A.8 .8 0 0 1 6 1.8V5.2A.8 .8 0 0 1 5.2 6H1.8A.8 .8 0 0 1 1 5.2V1.8A.8 .8 0 0 1 1.8 1Z'
        : 'M0 0H7V7H0Z M1 1H6V6H1Z');
      const centre = document.createElementNS(svg.namespaceURI, 'rect');
      for (const [name, number] of Object.entries({ x: 2, y: 2, width: 3, height: 3, rx: value === 'rounded' ? 0.6 : 0 })) {
        centre.setAttribute(name, number);
      }
      svg.append(ring, centre);
    }
    return svg;
  }

  function selectContent(container, select, option) {
    const text = document.createElement('span');
    text.className = 'qrg-select-text';
    text.textContent = option?.textContent || '';
    const preview = shapePreview(select, option?.value);
    container.replaceChildren(...(preview ? [preview, text] : [text]));
  }

  function enhanceSelect(select) {
    const wrapper = document.createElement('span');
    wrapper.className = 'qrg-select';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'qrg-select-trigger';
    trigger.setAttribute('aria-label', labelText(select));
    trigger.setAttribute('role', 'combobox');
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    const caption = document.createElement('span');
    caption.className = 'qrg-select-caption';
    const arrow = document.createElement('span');
    arrow.className = 'qrg-chevron';
    arrow.setAttribute('aria-hidden', 'true');
    trigger.append(caption, arrow);
    select.after(wrapper);
    wrapper.append(select, trigger);
    select.classList.add('qrg-native-control');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    const sync = () => {
      selectContent(caption, select, select.selectedOptions[0]);
      trigger.setAttribute('aria-label', t('{label}：{value}', { label: labelText(select), value: caption.textContent }));
      trigger.disabled = select.disabled;
    };
    let activeIndex = Math.max(0, select.selectedIndex);
    let typeBuffer = '';
    let typeTimer = null;

    function choose(index) {
      const option = select.options[index];
      if (!option || option.disabled) return;
      if (select.value !== option.value) {
        select.value = option.value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      sync();
      closePanel();
      trigger.focus();
    }

    function open() {
      if (trigger.disabled) return;
      const panel = document.createElement('div');
      panel.className = 'qrg-popup qrg-listbox';
      panel.id = `qrg-options-${select.id}`;
      panel.setAttribute('role', 'listbox');
      panel.setAttribute('aria-label', labelText(select));
      activeIndex = Math.max(0, select.selectedIndex);
      [...select.options].forEach((option, index) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'qrg-option';
        item.id = `${panel.id}-${index}`;
        item.setAttribute('role', 'option');
        item.tabIndex = -1;
        item.setAttribute('aria-selected', String(index === select.selectedIndex));
        selectContent(item, select, option);
        item.disabled = option.disabled;
        item.addEventListener('pointerenter', () => { activeIndex = index; updateActive(panel); });
        item.addEventListener('click', () => choose(index));
        panel.append(item);
      });
      showPanel(trigger, panel);
      trigger.setAttribute('aria-controls', panel.id);
      updateActive(panel);
      panel.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
    }

    function updateActive(panel) {
      [...panel.children].forEach((item, index) => item.classList.toggle('is-active', index === activeIndex));
      trigger.setAttribute('aria-activedescendant', `${panel.id}-${activeIndex}`);
      panel.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
    }

    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      if (openPanel?.trigger === trigger) closePanel(); else open();
    });
    trigger.addEventListener('keydown', (event) => {
      if (event.key === 'Tab' && openPanel?.trigger === trigger) {
        closePanel();
        return;
      }
      if (event.key === 'Escape' && openPanel?.trigger === trigger) {
        event.preventDefault(); dismissPanel(); return;
      }
      const navigation = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '];
      if (navigation.includes(event.key)) {
        event.preventDefault();
        const wasOpen = openPanel?.trigger === trigger;
        if (!wasOpen) open();
        const panel = openPanel?.panel;
        if (!panel) return;
        if (!wasOpen && (event.key === 'Enter' || event.key === ' ')) return;
        if (event.key === 'Enter' || event.key === ' ') { choose(activeIndex); return; }
        if (event.key === 'Home') activeIndex = 0;
        else if (event.key === 'End') activeIndex = select.options.length - 1;
        else activeIndex = Math.max(0, Math.min(select.options.length - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1)));
        updateActive(panel);
      } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
        clearTimeout(typeTimer);
        typeBuffer += event.key.toLocaleLowerCase();
        typeTimer = setTimeout(() => { typeBuffer = ''; }, 650);
        const options = [...select.options];
        const query = typeBuffer.split('').every(character => character === typeBuffer[0]) ? typeBuffer[0] : typeBuffer;
        const start = query.length === 1 ? (activeIndex + 1) % options.length : 0;
        const found = Array.from({ length: options.length }, (_, offset) => (start + offset) % options.length)
          .find(index => options[index].textContent.toLocaleLowerCase().startsWith(query));
        if (found >= 0) {
          if (openPanel?.trigger !== trigger) open();
          activeIndex = found;
          updateActive(openPanel.panel);
        }
      }
    });
    select.addEventListener('change', sync);
    handleLabel(select, trigger);
    enhanced.push(sync);
    sync();
  }

  const palette = ['#202330', '#5145CD', '#4338CA', '#146C53', '#9A482F', '#F0A140', '#FFFFFF', '#F7F8FA', '#FFF8F0', '#E7D8F5'];
  function enhanceColour(input) {
    const wrapper = input.parentElement;
    const transparent = input.id === 'background' ? document.getElementById('transparent') : null;
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'qrg-colour-trigger';
    trigger.setAttribute('aria-label', labelText(input));
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    const swatch = document.createElement('span');
    swatch.className = 'qrg-colour-swatch';
    swatch.setAttribute('aria-hidden', 'true');
    const value = document.createElement('span');
    value.className = 'qrg-colour-value';
    trigger.append(swatch, value);
    wrapper.append(trigger);
    wrapper.classList.add('qrg-colour-field');
    input.classList.add('qrg-native-control');
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    const output = wrapper.querySelector('output');
    if (output) output.classList.add('qrg-native-control');
    const sync = () => {
      swatch.classList.toggle('qrg-transparent-swatch', Boolean(transparent?.checked));
      swatch.style.backgroundColor = transparent?.checked ? '' : input.value;
      value.textContent = transparent?.checked ? t('透明') : input.value.toUpperCase();
      trigger.setAttribute('aria-label', t('{label}：{value}', { label: labelText(input), value: value.textContent }));
      trigger.disabled = input.disabled;
      if (input.disabled && openPanel?.trigger === trigger) closePanel();
    };

    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      if (openPanel?.trigger === trigger) { closePanel(); return; }
      if (input.disabled) return;
      const panel = document.createElement('div');
      panel.className = 'qrg-popup qrg-colour-popup';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-label', t('{label}选择器', { label: labelText(input) }));
      if (transparent) {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'qrg-option qrg-transparent-option';
        option.setAttribute('aria-pressed', String(transparent.checked));
        option.innerHTML = '<span class="qrg-colour-swatch qrg-transparent-swatch" aria-hidden="true"></span><span></span>';
        option.lastElementChild.textContent = t('透明背景');
        option.addEventListener('click', () => {
          transparent.checked = true;
          transparent.dispatchEvent(new Event('change', { bubbles: true }));
          sync();
          closePanel();
          trigger.focus();
        });
        panel.append(option);
      }
      let pendingColour = input.value.toUpperCase();
      const preview = document.createElement('div');
      preview.className = 'qrg-colour-preview';
      preview.innerHTML = '<span aria-hidden="true"></span><strong></strong>';
      preview.lastElementChild.textContent = t('自定义颜色');
      preview.firstElementChild.style.background = pendingColour;
      const grid = document.createElement('div');
      grid.className = 'qrg-palette';
      palette.forEach(colour => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'qrg-palette-swatch';
        button.style.background = colour;
        button.setAttribute('aria-label', colour);
        button.addEventListener('click', () => {
          input.value = colour;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          sync();
          closePanel();
          trigger.focus();
        });
        grid.append(button);
      });
      const channels = document.createElement('div');
      channels.className = 'qrg-rgb-channels';
      const sliders = [];
      for (const [index, name] of ['红色', '绿色', '蓝色'].entries()) {
        const row = document.createElement('label');
        row.className = 'qrg-rgb-row';
        const title = document.createElement('span');
        title.textContent = t(name);
        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '255';
        slider.step = '1';
        slider.setAttribute('aria-label', t('{label}{channel}通道', { label: labelText(input), channel: t(name) }));
        const amount = document.createElement('output');
        amount.setAttribute('aria-live', 'off');
        row.append(title, slider, amount);
        channels.append(row);
        sliders.push({ slider, amount, index });
      }
      const label = document.createElement('label');
      label.className = 'qrg-hex-label';
      label.textContent = t('十六进制颜色');
      const hex = document.createElement('input');
      hex.type = 'text';
      hex.className = 'qrg-hex-input';
      hex.inputMode = 'text';
      hex.maxLength = 7;
      hex.value = input.value.toUpperCase();
      hex.setAttribute('aria-label', t('{label}十六进制颜色', { label: labelText(input) }));
      const error = document.createElement('span');
      error.className = 'qrg-hex-error';
      error.id = `qrg-${input.id}-hex-error`;
      error.textContent = t('请输入 6 位十六进制颜色，例如 #5145CD。');
      error.hidden = true;
      hex.setAttribute('aria-describedby', error.id);
      label.append(hex);
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'qrg-hex-apply';
      apply.textContent = t('应用颜色');
      function setError(invalid) {
        hex.setAttribute('aria-invalid', String(invalid));
        error.hidden = !invalid;
      }
      function setPending(colour, updateHex = true) {
        pendingColour = colour.toUpperCase();
        preview.firstElementChild.style.background = pendingColour;
        for (const { slider, amount, index } of sliders) {
          const channel = parseInt(pendingColour.slice(1 + index * 2, 3 + index * 2), 16);
          slider.value = String(channel);
          amount.value = String(channel);
          amount.textContent = String(channel);
        }
        if (updateHex) hex.value = pendingColour;
        setError(false);
      }
      sliders.forEach(({ slider }) => slider.addEventListener('input', () => {
        const colour = `#${sliders.map(({ slider: channel }) => Number(channel.value).toString(16).padStart(2, '0')).join('')}`;
        setPending(colour);
      }));
      hex.addEventListener('input', () => {
        const raw = hex.value.trim();
        if (/^#?[0-9a-f]{6}$/i.test(raw)) setPending(`#${raw.replace(/^#/, '')}`, false);
        else setError(false);
      });
      function applyHex() {
        const raw = hex.value.trim();
        if (!/^#?[0-9a-f]{6}$/i.test(raw)) { setError(true); hex.focus(); return; }
        setPending(`#${raw.replace(/^#/, '')}`);
        input.value = pendingColour;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        sync();
        closePanel();
        trigger.focus();
      }
      apply.addEventListener('click', applyHex);
      hex.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); applyHex(); } });
      setPending(pendingColour);
      panel.append(preview, grid, channels, label, error, apply);
      panel.addEventListener('keydown', event => {
        if (event.key !== 'Tab') return;
        const focusables = [...panel.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      });
      showPanel(trigger, panel);
      hex.focus();
    });
    input.addEventListener('input', sync);
    handleLabel(input, trigger);
    enhanced.push(sync);
    sync();
  }

  function enhanceNumber(input) {
    const wrapper = document.createElement('span');
    wrapper.className = 'qrg-number';
    const actions = document.createElement('span');
    actions.className = 'qrg-number-actions';
    for (const [direction, symbol, label] of [[1, '+', '增加'], [-1, '−', '减少']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'qrg-stepper';
      button.textContent = symbol;
      const updateLabel = () => button.setAttribute('aria-label', t('{label}：{action}', { label: labelText(input), action: t(label) }));
      updateLabel();
      enhanced.push(updateLabel);
      button.addEventListener('click', () => {
        if (input.disabled) return;
        const current = Number(input.value);
        const step = Number(input.step) || 1;
        const baseline = Number.isFinite(current) && input.value !== '' ? current : Number(input.min) || 0;
        const next = baseline + direction * step;
        if (next < Number(input.min) || next > Number(input.max)) return;
        input.value = String(next);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      });
      actions.append(button);
    }
    input.after(wrapper);
    wrapper.append(input, actions);
    const sync = () => {
      const value = Number(input.value);
      const valid = input.value !== '' && Number.isFinite(value);
      actions.children[0].disabled = input.disabled || valid && value >= Number(input.max);
      actions.children[1].disabled = input.disabled || valid && value <= Number(input.min);
    };
    input.addEventListener('input', sync);
    input.addEventListener('change', sync);
    enhanced.push(sync);
    sync();
  }

  function init() {
    document.querySelectorAll('select').forEach(enhanceSelect);
    document.querySelectorAll('input[type="color"]').forEach(enhanceColour);
    document.querySelectorAll('input[type="number"]').forEach(enhanceNumber);
    document.addEventListener('pointerdown', event => {
      if (openPanel && !openPanel.panel.contains(event.target) && !openPanel.trigger.contains(event.target)) closePanel();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && openPanel) { dismissPanel(); event.preventDefault(); }
    });
    document.addEventListener('focusin', event => {
      if (openPanel && !openPanel.panel.contains(event.target) && !openPanel.trigger.contains(event.target)) closePanel();
    });
    window.addEventListener('resize', placePanel);
    document.addEventListener('scroll', placePanel, true);
    document.addEventListener('qrg:languagechange', () => {
      closePanel();
      enhanced.forEach(update => update());
    });
  }

  window.QRGControls = { init, sync: () => enhanced.forEach(update => update()), close: closePanel };
})();
