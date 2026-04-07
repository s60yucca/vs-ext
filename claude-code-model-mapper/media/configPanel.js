(function () {
  const vscode = acquireVsCodeApi();
  let configs = [];
  const providerPresets = {
    openrouter: 'https://openrouter.ai/api/v1',
    openadapter: 'https://api.openadapter.in',
    fireworks: 'https://api.fireworks.ai/inference/v1'
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value || '').replace(/"/g, '&quot;');
  }

  function showMsg(id, msg, isError) {
    const el = byId(id);
    el.className = isError ? 'error' : 'success';
    el.textContent = msg;
    setTimeout(function () {
      if (el.textContent === msg) {
        el.textContent = '';
      }
    }, 4000);
  }

  function detectPreset(baseUrl) {
    const normalized = String(baseUrl || '').trim().replace(/\/$/, '');
    if (normalized === providerPresets.openrouter) return 'openrouter';
    if (normalized === providerPresets.openadapter) return 'openadapter';
    if (normalized === providerPresets.fireworks || normalized === 'https://api.fireworks.ai/inference') return 'fireworks';
    return 'custom';
  }

  function renderMappings() {
    const el = byId('mappings');
    if (configs.length === 0) {
      el.innerHTML = '<div style="opacity:0.4;font-size:11px">Chua co mapping nao.</div>';
      return;
    }

    el.innerHTML = configs.map(function (c, i) {
      return '<div class="row">' +
        '<input value="' + esc(c.sourceModel) + '" data-i="' + i + '" data-f="sourceModel">' +
        '<input value="' + esc(c.targetModel) + '" data-i="' + i + '" data-f="targetModel">' +
        '<input type="checkbox" class="toggle" ' + (c.enabled ? 'checked' : '') + ' title="Bat/tat" data-i="' + i + '" data-f="enabled">' +
        '<button class="secondary" data-action="remove" data-i="' + i + '">x</button>' +
      '</div>';
    }).join('');
  }

  document.addEventListener('input', function (event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    if (target.id === 'baseUrl') {
      byId('providerPreset').value = detectPreset(target.value);
      return;
    }

    const index = Number(target.dataset.i);
    const field = target.dataset.f;
    if (!Number.isInteger(index) || !field || !configs[index]) return;
    if (field === 'enabled') return;
    configs[index][field] = target.value;
  });

  document.addEventListener('change', function (event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const index = Number(target.dataset.i);
    const field = target.dataset.f;
    if (!Number.isInteger(index) || !field || !configs[index]) return;
    if (field === 'enabled') {
      configs[index].enabled = target.checked;
    }
  });

  document.addEventListener('click', function (event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.id === 'addBtn') {
      const src = byId('newSource').value.trim();
      const tgt = byId('newTarget').value.trim();
      if (!src || !tgt) {
        showMsg('mapMsg', 'Vui long nhap du source va target.', true);
        return;
      }
      configs.push({ sourceModel: src, targetModel: tgt, enabled: true });
      byId('newSource').value = '';
      byId('newTarget').value = '';
      renderMappings();
      return;
    }

    if (target.id === 'saveMapBtn') {
      vscode.postMessage({ type: 'saveConfigs', configs: configs });
      return;
    }

    if (target.id === 'saveProvBtn') {
      const baseUrl = byId('baseUrl').value.trim();
      const apiKey = byId('apiKey').value;
      const nativeAnthropic = byId('nativeAnthropic') ? byId('nativeAnthropic').checked : false;
      vscode.postMessage({ type: 'saveLMProvider', config: { baseUrl: baseUrl, nativeAnthropic: nativeAnthropic }, apiKey: apiKey });
      return;
    }

    if (target.dataset.action === 'remove') {
      const index = Number(target.dataset.i);
      if (Number.isInteger(index)) {
        configs.splice(index, 1);
        renderMappings();
      }
    }
  });

  byId('providerPreset').addEventListener('change', function (event) {
    const target = event.target;
    const preset = target.value;
    if (preset === 'custom') return;
    byId('baseUrl').value = providerPresets[preset] || '';
  });

  window.addEventListener('message', function (event) {
    const msg = event.data;
    if (msg.type === 'init') {
      configs = msg.configs || [];
      renderMappings();
      if (msg.lmProvider) {
        const baseUrl = msg.lmProvider.baseUrl || '';
        byId('baseUrl').value = baseUrl;
        byId('providerPreset').value = detectPreset(baseUrl);
        if (byId('nativeAnthropic')) {
          byId('nativeAnthropic').checked = !!msg.lmProvider.nativeAnthropic;
        }
        const v = msg.version ? 'v' + msg.version : 'DEV BUILD';
        byId('devBanner').textContent = v + ' · mappings=' + configs.length + ' · baseUrl=' + (baseUrl || '(empty)');
      }
      if (msg.hasApiKey) {
        byId('apiKey').placeholder = '********  (saved - leave blank to keep)';
      }
      return;
    }

    if (msg.type === 'saved') {
      if (msg.scope === 'configs') {
        showMsg('mapMsg', 'Da luu mappings.', false);
      } else {
        showMsg('provMsg', 'Da luu provider.', false);
      }
      return;
    }

    if (msg.type === 'error') {
      showMsg('mapMsg', msg.message, true);
      showMsg('provMsg', msg.message, true);
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
