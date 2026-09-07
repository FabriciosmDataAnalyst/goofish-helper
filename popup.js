// Goofish Helper - popup.js
let rates = { USD: 0.138, EUR: 0.127, BRL: 0.78, MXN: 2.45, ARS: 138, COP: 580, CLP: 131, PEN: 0.51, CAD: 0.188, AUD: 0.207 };
let timestamp = 0;
let currentLang = 'pt';

async function loadRates() {
  try {
    const data = await chrome.runtime.sendMessage({ type: 'GH_GET_RATES' });
    if (data && data.rates) {
      rates = data.rates;
      timestamp = data.timestamp;
    }
  } catch (e) {
    const local = await chrome.storage.local.get('gh_rates');
    if (local.gh_rates) {
      rates = local.gh_rates.rates;
      timestamp = local.gh_rates.timestamp;
    }
  }
  updateRateInfo();
  convert();
}

const I18N_POPUP = {
  pt: { ratesDefault:'Taxas padrão (sem conexão)', rates:'1 CNY = ', ago:'há', convertAuto:'Conversão automática na página', hideLogin:'Ocultar popup de login', floatMenu:'Menu flutuante na página', translateFilters:'Traduzir filtros', language:'Idioma', currencyOnPage:'Moeda nos produtos', currencyHint:'Escolha qual moeda aparece ao lado do preço em ¥' },
  en: { ratesDefault:'Default rates (offline)', rates:'1 CNY = ', ago:'ago', convertAuto:'Auto-convert on page', hideLogin:'Hide login popup', floatMenu:'Floating menu', translateFilters:'Translate filters', language:'Language', currencyOnPage:'Currency on page', currencyHint:'Choose currency next to ¥ price' },
  es: { ratesDefault:'Tasas por defecto (sin conexión)', rates:'1 CNY = ', ago:'hace', convertAuto:'Conversión automática', hideLogin:'Ocultar popup de login', floatMenu:'Menú flotante', translateFilters:'Traducir filtros', language:'Idioma', currencyOnPage:'Moneda en productos', currencyHint:'Elige moneda junto al precio ¥' }
};

function applyPopupI18n(lang) {
  const t = I18N_POPUP[lang] || I18N_POPUP.pt;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n;
    if (t[k]) el.textContent = t[k];
  });
}

function updateRateInfo() {
  const el = document.getElementById('rateInfo');
  const t = I18N_POPUP[currentLang] || I18N_POPUP.pt;
  if (!timestamp) { el.textContent = t.ratesDefault; return; }
  const d = new Date(timestamp);
  const ageH = ((Date.now() - timestamp) / 3600000).toFixed(1);
  const locale = currentLang==='en'?'en-US': currentLang==='es'?'es-ES':'pt-BR';
  el.textContent = `${t.rates}$${rates.USD} USD · €${rates.EUR} EUR · R$${rates.BRL} BRL • ${t.ago} ${ageH}h (${d.toLocaleString(locale)})`;
}

function convert() {
  const v = parseFloat(document.getElementById('cnyInput').value);
  const ids = ['usd','eur','brl','mxn','ars','cop','clp','pen','cad','aud'];
  const sym = { usd:'$', eur:'€', brl:'R$', mxn:'$', ars:'$', cop:'$', clp:'$', pen:'S/', cad:'C$', aud:'A$' };
  const keys = { usd:'USD', eur:'EUR', brl:'BRL', mxn:'MXN', ars:'ARS', cop:'COP', clp:'CLP', pen:'PEN', cad:'CAD', aud:'AUD' };
  if (!isFinite(v) || v <= 0) {
    ids.forEach(id => { const el=document.getElementById(id+'Val'); if(el) el.textContent='—'; });
    return;
  }
  ids.forEach(id => {
    const el=document.getElementById(id+'Val');
    if (!el) return;
    const k=keys[id];
    const rate=rates[k];
    if (rate==null) { el.textContent='—'; return; }
    const val=v*rate;
    const dec=(k==='COP'||k==='CLP')?0:2;
    el.textContent=`${sym[id]} ${val.toFixed(dec)}`;
  });
}

async function init() {
  try {
  // toggles + language
  const sync = await chrome.storage.sync.get(['hideLogin', 'autoConvert', 'floatingMenu', 'displayCurrency', 'translateFilters', 'language', 'extensionDisabled']);
  currentLang = sync.language || 'pt';
  try { applyPopupI18n(currentLang); } catch {}
  const setChecked = (id, val) => { const el=document.getElementById(id); if(el) el.checked = val; };
  setChecked('toggleLogin', sync.hideLogin !== false);
  setChecked('toggleConvert', sync.autoConvert !== false);
  setChecked('toggleMenu', sync.floatingMenu !== false);
  setChecked('toggleTranslate', sync.translateFilters !== false);
  const langSel = document.getElementById('languageSelect');
  if (langSel) {
    langSel.value = currentLang;
    langSel.addEventListener('change', async (e) => {
      const v = e.target.value;
      currentLang = v;
      await chrome.storage.sync.set({ language: v });
      try { applyPopupI18n(v); } catch {}
      updateRateInfo(); convert();
      try { chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'GH_SET_LANGUAGE', value: v });
      }); } catch {}
    });
  }
  const curSel = document.getElementById('currencySelect');
  if (curSel) {
    curSel.value = sync.displayCurrency || 'ALL';
    curSel.addEventListener('change', async (e) => {
      const v = e.target.value;
      await chrome.storage.sync.set({ displayCurrency: v });
      try { chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'GH_SET_CURRENCY', value: v });
      }); } catch {}
    });
  }

  const on = (id, ev, fn) => { const el=document.getElementById(id); if(el) el.addEventListener(ev, fn); };
  on('toggleLogin','change', async (e) => {
    await chrome.storage.sync.set({ hideLogin: e.target.checked });
    try { chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'GH_TOGGLE_LOGIN', value: e.target.checked });
    }); } catch {}
  });
  on('toggleConvert','change', async (e) => {
    await chrome.storage.sync.set({ autoConvert: e.target.checked });
    try { chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'GH_TOGGLE_CONVERT', value: e.target.checked });
    }); } catch {}
  });
  on('toggleMenu','change', async (e) => {
    await chrome.storage.sync.set({ floatingMenu: e.target.checked });
    try { chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'GH_TOGGLE_MENU', value: e.target.checked });
    }); } catch {}
  });
  on('toggleTranslate','change', async (e) => {
    await chrome.storage.sync.set({ translateFilters: e.target.checked });
    try { chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: 'GH_TOGGLE_TRANSLATE', value: e.target.checked });
    }); } catch {}
  });
  const disBtn = document.getElementById('disableExtension');
  if (disBtn) {
    if (sync.extensionDisabled) {
      disBtn.textContent = '↻ Reativar extensão'; disBtn.style.background = '#16a34a'; disBtn.style.borderColor = '#15803d';
    }
    on('disableExtension','click', async () => {
      const isDisabled = (await chrome.storage.sync.get(['extensionDisabled'])).extensionDisabled;
      if (isDisabled) {
        await chrome.storage.sync.set({ extensionDisabled: false });
        disBtn.textContent = 'Reativando...'; disBtn.disabled = true;
        chrome.tabs.query({}, (tabs) => tabs.forEach(t => { try { chrome.tabs.reload(t.id); } catch {} }));
        setTimeout(()=>window.close(), 300);
        return;
      }
      if (!confirm('Desativar Goofish Helper? Você poderá reativar por aqui ou em chrome://extensions.')) return;
      disBtn.textContent = 'Desativando...'; disBtn.disabled = true;
      try {
        if (chrome.management && chrome.management.setEnabled) {
          await new Promise((res, rej) => chrome.management.setEnabled(chrome.runtime.id, false, () => chrome.runtime.lastError ? rej(chrome.runtime.lastError) : res()));
          window.close(); return;
        }
      } catch {}
      try {
        await chrome.storage.sync.set({ extensionDisabled: true });
        chrome.tabs.query({}, (tabs) => tabs.forEach(t => { try { chrome.tabs.sendMessage(t.id, { type: 'GH_DISABLE_ALL' }); } catch {} }));
        alert('Extensão desativada. Recarregue as abas do Goofish.');
        window.close();
      } catch (e) { alert('Erro ao desativar: ' + e.message); disBtn.disabled = false; disBtn.textContent = '⛔ Desativar extensão'; }
    });
  }

  await loadRates();

  const cnyEl = document.getElementById('cnyInput');
  if (cnyEl) cnyEl.addEventListener('input', convert);
  const refBtn = document.getElementById('refreshRates');
  if (refBtn) refBtn.addEventListener('click', async () => {
    const btn = refBtn;
    btn.textContent = 'Atualizando...';
    btn.disabled = true;
    try {
      const data = await chrome.runtime.sendMessage({ type: 'GH_FORCE_REFRESH' });
      if (data && data.rates) { rates = data.rates; timestamp = data.timestamp; }
    } catch {}
    updateRateInfo(); convert();
    btn.textContent = '↻ Atualizar taxas';
    btn.disabled = false;
  });
  } catch(e){ console.error('[popup] init failed', e); }
}

init();
