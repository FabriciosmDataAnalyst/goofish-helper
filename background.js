// Goofish Helper - Service Worker (MV3)
// Responsável por buscar e cachear taxas CNY -> USD/EUR/BRL

const CACHE_KEY = 'gh_rates';
const FALLBACK_RATES = { USD: 0.138, EUR: 0.127, BRL: 0.78, MXN: 2.45, ARS: 138, COP: 580, CLP: 131, PEN: 0.51, CAD: 0.188, AUD: 0.207 }; // aprox 2026, atualizado via API

async function fetchRates() {
  const symbols = 'USD,EUR,BRL,MXN,ARS,COP,CLP,PEN,CAD,AUD';
  const urls = [
    `https://api.exchangerate.host/latest?base=CNY&symbols=${symbols}`,
    'https://open.er-api.com/v6/latest/CNY',
    'https://api.frankfurter.app/latest?from=CNY&to=USD,EUR'
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      let rates = null;
      if (data.rates) {
        // exchangerate.host: { rates: {USD, EUR, BRL} }
        // open.er-api: { rates: {...}, result: 'success' }
        // frankfurter: { rates: {USD, EUR} }
        rates = data.rates;
      }
      if (rates && rates.USD) {
        for (const k of Object.keys(FALLBACK_RATES)) if (!rates[k] || !isFinite(rates[k])) rates[k] = FALLBACK_RATES[k];
        const payload = {
          rates: { USD: rates.USD, EUR: rates.EUR, BRL: rates.BRL, MXN: rates.MXN, ARS: rates.ARS, COP: rates.COP, CLP: rates.CLP, PEN: rates.PEN, CAD: rates.CAD, AUD: rates.AUD },
          timestamp: Date.now(),
          source: url
        };
        await chrome.storage.local.set({ [CACHE_KEY]: payload });
        console.log('[Goofish Helper] Taxas atualizadas', payload);
        return payload;
      }
    } catch (e) {
      console.warn('[Goofish Helper] Falha fetch', url, e);
    }
  }
  // se tudo falhar, mantém cache antigo ou fallback
  const stored = await chrome.storage.local.get(CACHE_KEY);
  if (stored[CACHE_KEY]) return stored[CACHE_KEY];
  const fallback = { rates: FALLBACK_RATES, timestamp: Date.now(), source: 'fallback' };
  await chrome.storage.local.set({ [CACHE_KEY]: fallback });
  return fallback;
}

chrome.runtime.onInstalled.addListener(async () => {
  await fetchRates();
  chrome.alarms.create('gh_refresh_rates', { periodInMinutes: 720 }); // 12h
  // defaults
  const sync = await chrome.storage.sync.get(['hideLogin', 'autoConvert', 'floatingMenu', 'displayCurrency', 'translateFilters', 'language']);
  if (sync.hideLogin === undefined) await chrome.storage.sync.set({ hideLogin: true });
  if (sync.autoConvert === undefined) await chrome.storage.sync.set({ autoConvert: true });
  if (sync.floatingMenu === undefined) await chrome.storage.sync.set({ floatingMenu: true });
  if (sync.displayCurrency === undefined) await chrome.storage.sync.set({ displayCurrency: 'ALL' });
  if (sync.translateFilters === undefined) await chrome.storage.sync.set({ translateFilters: true });
  if (sync.language === undefined) await chrome.storage.sync.set({ language: 'pt' });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'gh_refresh_rates') fetchRates();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GH_GET_RATES') {
    chrome.storage.local.get(CACHE_KEY).then((data) => {
      if (data[CACHE_KEY]) {
        // se cache >12h, atualiza em background
        const age = Date.now() - data[CACHE_KEY].timestamp;
        if (age > 12 * 60 * 60 * 1000) fetchRates();
        sendResponse(data[CACHE_KEY]);
      } else {
        fetchRates().then(sendResponse);
        return true;
      }
    });
    return true;
  }
  if (msg.type === 'GH_FORCE_REFRESH') {
    fetchRates().then((r) => sendResponse(r));
    return true;
  }
  if (msg.type === 'GH_SEARCH') {
    // navega na mesma guia (não abre nova) — spm é obrigatório
    const q = encodeURIComponent(msg.query);
    const url = `https://www.goofish.com/search?q=${q}&spm=a21ybx.search.searchInput.0`;
    if (sender && sender.tab && sender.tab.id) {
      chrome.tabs.update(sender.tab.id, { url });
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0] && tabs[0].id) chrome.tabs.update(tabs[0].id, { url });
        else chrome.tabs.create({ url });
      });
    }
  }
});
