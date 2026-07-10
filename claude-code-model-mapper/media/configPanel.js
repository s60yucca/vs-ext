(function () {
  const vscode = acquireVsCodeApi();
  let configs = [];
  const providerPresets = {
    openrouter: { baseUrl: 'https://openrouter.ai/api/v1' },
    openadapter: { baseUrl: 'https://api.openadapter.in' },
    fireworks: { baseUrl: 'https://api.fireworks.ai/inference/v1' },
    azure: { baseUrl: '', placeholder: 'https://YOUR.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-08-01-preview', authHeader: 'api-key', authValuePrefix: '', isFullEndpoint: true }
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
    var normalized = String(baseUrl || '').trim().replace(/\/$/, '');
    for (var key in providerPresets) {
      if (providerPresets[key].baseUrl && normalized === providerPresets[key].baseUrl.replace(/\/$/, '')) {
        return key;
      }
    }
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
      var baseUrl = byId('baseUrl').value.trim();
      var apiKey = byId('apiKey').value;
      var nativeAnthropic = byId('nativeAnthropic') ? byId('nativeAnthropic').checked : false;
      var authHeader = byId('authHeader').value.trim() || void 0;
      var authValuePrefix = byId('authValuePrefix').value;
      var isFullEndpoint = byId('isFullEndpoint').checked;
      vscode.postMessage({ type: 'saveLMProvider', config: { baseUrl: baseUrl, nativeAnthropic: nativeAnthropic, authHeader: authHeader, authValuePrefix: authValuePrefix, isFullEndpoint: isFullEndpoint }, apiKey: apiKey });
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
    var target = event.target;
    var preset = target.value;
    if (preset === 'custom') return;
    var p = providerPresets[preset];
    if (!p) return;
    if (p.baseUrl) {
      byId('baseUrl').value = p.baseUrl;
    }
    byId('baseUrl').placeholder = p.placeholder || '';
    if (p.authHeader !== undefined) {
      byId('authHeader').value = p.authHeader || '';
    }
    if (p.authValuePrefix !== undefined) {
      byId('authValuePrefix').value = p.authValuePrefix || '';
    }
    if (p.isFullEndpoint !== undefined) {
      byId('isFullEndpoint').checked = !!p.isFullEndpoint;
    }
    // Auto-expand advanced section for providers with custom auth
    if (p.authHeader || p.isFullEndpoint) {
      byId('advancedSection').open = true;
    }
  });

  window.addEventListener('message', function (event) {
    const msg = event.data;
    if (msg.type === 'init') {
      configs = msg.configs || [];
      renderMappings();
      if (msg.lmProvider) {
        var baseUrl = msg.lmProvider.baseUrl || '';
        byId('baseUrl').value = baseUrl;
        byId('providerPreset').value = detectPreset(baseUrl);
        if (byId('nativeAnthropic')) {
          byId('nativeAnthropic').checked = !!msg.lmProvider.nativeAnthropic;
        }
        if (byId('authHeader')) {
          byId('authHeader').value = msg.lmProvider.authHeader || '';
        }
        if (byId('authValuePrefix')) {
          byId('authValuePrefix').value = msg.lmProvider.authValuePrefix || '';
        }
        if (byId('isFullEndpoint')) {
          byId('isFullEndpoint').checked = !!msg.lmProvider.isFullEndpoint;
        }
        var v = msg.version ? 'v' + msg.version : 'DEV BUILD';
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
