/* Goofish Helper - content.js */
(() => {
  // Silencia "Extension context invalidated" quando a extensão é recarregada com a aba aberta
  // (erro inevitável do Chrome - content script antigo perde conexão com background)
  try {
    const _ghIgn = m => String(m || '').includes('Extension context invalidated');
    window.addEventListener('error', e => { if (_ghIgn(e.message) || _ghIgn(e.error && e.error.message)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
    window.addEventListener('unhandledrejection', e => { const r = e.reason; if (_ghIgn(r && r.message) || _ghIgn(r)) e.preventDefault(); }, true);
  } catch {}
  const LOGIN_TEXT_RE = /(登录|请登录|去登录|立即登录|登录后|登录查看|一键登录|Sign in|Log in|login)/i;
  const RATE_CACHE_KEY = 'gh_rates';

  let settings = { hideLogin: true, autoConvert: true, floatingMenu: true, displayCurrency: 'ALL', translateFilters: true, language: 'pt' };
  let rates = null;
  let ratesTimestamp = 0;
  let ghDisabled = false;
  const CSSBUY_PROMO = '821ce7fb53ba04e7';

  // ---------- Helpers: evita "Extension context invalidated" após reload/update ----------
  function isCtxValid() { try { return !!chrome.runtime?.id; } catch { return false; } }
  function safeSyncGet(keys) { if (!isCtxValid()) return Promise.resolve({}); try { const p = chrome.storage.sync.get(keys); return p && p.catch ? p.catch(() => ({})) : Promise.resolve({}); } catch { return Promise.resolve({}); } }
  function safeSyncSet(obj) { if (!isCtxValid()) return; try { const p = chrome.storage.sync.set(obj); if (p && p.catch) p.catch(() => {}); } catch {} }

  // Kill switch global
  safeSyncGet(['extensionDisabled']).then(v => {
    if (v && v.extensionDisabled) {
      ghDisabled = true; disableAll();
      return;
    }
  }).catch(()=>{});
  function disableAll() {
    ghDisabled = true;
    try { if (loginObserver) loginObserver.disconnect(); } catch {}
    try { if (priceObserver) priceObserver.disconnect(); } catch {}
    try { if (translateObserver) translateObserver.disconnect(); } catch {}
    try { if (loginPoll) clearInterval(loginPoll); } catch {}
    try { document.getElementById('gh-floating-root')?.remove(); floatingRoot = null; } catch {}
    try { document.getElementById('gh-cssbuy-bar')?.remove(); } catch {}
    try { document.querySelectorAll('.gh-convert-badge').forEach(el=>el.remove()); } catch {}
    try { document.getElementById('gh-early-style')?.remove(); } catch {}
  }

  // ---------- Config ----------
  safeSyncGet(['hideLogin', 'autoConvert', 'floatingMenu', 'displayCurrency', 'translateFilters', 'language']).then(s => {
    if (s.hideLogin !== undefined) settings.hideLogin = s.hideLogin;
    if (s.autoConvert !== undefined) settings.autoConvert = s.autoConvert;
    if (s.floatingMenu !== undefined) settings.floatingMenu = s.floatingMenu;
    if (s.displayCurrency !== undefined) settings.displayCurrency = s.displayCurrency;
    if (s.translateFilters !== undefined) settings.translateFilters = s.translateFilters;
    if (s.language !== undefined) settings.language = s.language;
    if (settings.translateFilters) setTimeout(() => { translateFilters(); startTranslateObserver(); }, 800);
    // se usuário desativou, reverte agressivo
    if (!settings.hideLogin && loginObserver) {
      // não reconecta se desativado - mas já bloqueou, mantém?
      // respeita toggle: se false, desconecta mas não reexibe o que já escondeu
      loginObserver.disconnect();
    }
    if (!settings.floatingMenu && floatingRoot) floatingRoot.style.display = 'none';
    if (!settings.autoConvert && priceObserver) priceObserver.disconnect();
  }).catch(() => {});
  loadRatesBg();

  async function loadRatesBg() {
    try {
      if (!isCtxValid()) throw new Error('ctx invalid');
      const res = await chrome.runtime.sendMessage({ type: 'GH_GET_RATES' });
      if (res && res.rates) { rates = res.rates; ratesTimestamp = res.timestamp; if (settings.autoConvert) scanPrices(); }
    } catch (e) {
      try {
        if (!isCtxValid()) throw new Error('ctx invalid');
        const local = await chrome.storage.local.get(RATE_CACHE_KEY);
        if (local[RATE_CACHE_KEY]) { rates = local[RATE_CACHE_KEY].rates; ratesTimestamp = local[RATE_CACHE_KEY].timestamp; }
      } catch {}
    }
    if (!rates) rates = { USD: 0.138, EUR: 0.127, BRL: 0.78, MXN: 2.45, ARS: 138, COP: 580, CLP: 131, PEN: 0.51, CAD: 0.188, AUD: 0.207 };
  }

  try { chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      if (changes.hideLogin) {
        settings.hideLogin = changes.hideLogin.newValue;
        if (settings.hideLogin) startLoginObserver(); else if (loginObserver) loginObserver.disconnect();
      }
      if (changes.autoConvert) {
        settings.autoConvert = changes.autoConvert.newValue;
        if (settings.autoConvert) scanPrices(); else document.querySelectorAll('.gh-convert-badge').forEach(el => el.remove());
      }
      if (changes.floatingMenu) {
        settings.floatingMenu = changes.floatingMenu.newValue;
        toggleFloatingMenu(settings.floatingMenu);
      }
      if (changes.displayCurrency) {
        settings.displayCurrency = changes.displayCurrency.newValue;
        document.querySelectorAll('.gh-convert-badge').forEach(el => el.remove());
        convertedSet.clear();
        if (settings.autoConvert) scanPrices();
      }
      if (changes.translateFilters) {
        settings.translateFilters = changes.translateFilters.newValue;
        if (settings.translateFilters) { translateFilters(); startTranslateObserver(); }
        else { stopTranslateObserver(); location.reload(); }
      }
      if (changes.language) {
        settings.language = changes.language.newValue;
        document.querySelectorAll('.gh-convert-badge').forEach(el => el.remove());
        convertedSet.clear();
        if (settings.autoConvert) scanPrices();
        if (settings.translateFilters) { translateFilters(); addShopLevelLabel(); }
        if (floatingRoot) buildFloatingMenu();
        const oldBar = document.getElementById('gh-cssbuy-bar'); if (oldBar) oldBar.remove();
        setTimeout(injectCssBuyBar, 100);
      }
    }
    if (area === 'local' && changes[RATE_CACHE_KEY]) {
      rates = changes[RATE_CACHE_KEY].newValue.rates;
      ratesTimestamp = changes[RATE_CACHE_KEY].newValue.timestamp;
      document.querySelectorAll('.gh-convert-badge').forEach(el => el.remove());
      convertedSet.clear();
      if (settings.autoConvert) scanPrices();
    }
  }); } catch {}

  // ---------- 0. CSS agressivo injetado imediatamente ----------
  (function injectEarlyCss() {
    const style = document.createElement('style');
    style.id = 'gh-early-style';
    style.textContent = `
      /* fallback: esconde imediatamente qualquer overlay que contenha texto de login será feito via JS; aqui apenas garante que body não trava */
      html.gh-no-scroll, body.gh-no-scroll { overflow: auto !important; }
    `;
    (document.head || document.documentElement).appendChild(style);
  })();

  // ---------- 1. Bloqueio de Login (AGRESSIVO, inicia SINCRONAMENTE) ----------
  // Marca se usuário interagiu (clique) — evita esconder modais que usuário abriu de propósito (ex: ver foto)
  let userClickedRecently = false;
  document.addEventListener('click', () => { userClickedRecently = true; setTimeout(() => userClickedRecently = false, 2000); }, true);

  function isLoginModal(node) {
    if (!(node instanceof HTMLElement)) return false;
    // ignora nosso próprio UI
    if (node.id === 'gh-floating-root' || node.closest('#gh-floating-root')) return false;
    if (node.closest('.gh-convert-badge')) return false;
    const text = (node.innerText || node.textContent || '').slice(0, 1200);
    const hasLoginText = LOGIN_TEXT_RE.test(text);
    // se tem texto de login, aplica regras; se não tem, cai no fallback de modal vazio suspeito
    if (!hasLoginText && !isSuspiciousEmptyModal(node)) return false;
    if (!hasLoginText) return true; // modal vazio suspeito já é considerado login nag
    // Só considera se parece modal/popup, não card de produto
    // Critérios LOOSOS: qualquer um basta
    const cls = (node.className && typeof node.className === 'string') ? node.className : '';
    // whitelist: header/nav principal contém "登录" mas não é modal — nunca esconder
    if (/header-main|search-fix|nav-main/i.test(cls)) return false;
    if (node.closest && node.closest('header, nav, [class*="header-main"]')) {
      // se é header ou está dentro, só considera se for claramente modal (fixed+overlay)
      // header real não é fixed modal
      try {
        const csH = window.getComputedStyle(node);
        if (csH.position !== 'fixed' && csH.position !== 'absolute') return false;
      } catch { return false; }
    }
    const hasLoginClass = /login|sign.?in/i.test(cls);
    let isFixed = false, highZ = false, isOverlaySize = false;
    try {
      const cs = window.getComputedStyle(node);
      isFixed = cs.position === 'fixed' || cs.position === 'absolute';
      const z = parseInt(cs.zIndex, 10);
      highZ = !isNaN(z) && z >= 900;
      isOverlaySize = node.offsetWidth > 180 && node.offsetHeight > 100;
    } catch {}
    const hasMaskClass = /mask|overlay|dialog|modal|popup|drawer|baxia|ant-modal|adm-/.test(cls);
    const roleDialog = node.getAttribute('role') === 'dialog' || node.getAttribute('aria-modal') === 'true';
    let hasButton = false;
    try { hasButton = !!node.querySelector('button, a[role="button"], [class*="btn" i]'); } catch {}
    const isBodyChild = !!(node.parentElement && (node.parentElement === document.body || node.parentElement === document.documentElement));
    const depthOk = (() => { try { let d = 0, p = node; while (p && p !== document.body && d < 6) { p = p.parentElement; if (!p) break; d++; } return d <= 4; } catch { return false; } })();
    const isOverlayLike = roleDialog || hasMaskClass || (isFixed && isOverlaySize) || highZ;

    // Regra 1: tem texto login + (role dialog OU mask class OU fixed+size)
    if (isOverlayLike) return true;
    // Regra 2: filho direto do body com texto login e botão (modal típico) - exige overlay-like
    if (isBodyChild && hasButton && text.length < 800 && isOverlayLike) return true;
    // Regra 3: elemento com classe login + tamanho overlay
    if (hasLoginClass && (isOverlaySize || isFixed)) return true;
    // Regra 4: texto login + botão + overlay-like + perto do body (captura modais aninhados)
    if (hasButton && text.length < 600 && (isFixed || highZ) && isOverlaySize) return true;
    // Regra 4b: variação com depthOk mas também exige overlay-like estrito
    if (hasButton && text.length < 600 && depthOk && isOverlaySize && isOverlayLike) return true;
    // Regra 5: fallback - exige overlay-like, não só tamanho
    if (text.length < 500 && isOverlaySize && depthOk && isOverlayLike) return true;
    return false;
  }

  // Detecta modal vazio/branco centralizado (como o da screenshot: peixe amarelo + painel branco + X)
  // Esse modal carrega iframe de login de forma lazy, então inicialmente não tem texto 登录
  function isSuspiciousEmptyModal(node) {
    if (!(node instanceof HTMLElement)) return false;
    if (node.id === 'gh-floating-root' || node.closest('#gh-floating-root')) return false;
    // só considera elementos grandes
    const w = node.offsetWidth, h = node.offsetHeight;
    if (w < 280 || h < 200) return false;
    if (w > window.innerWidth * 0.95 && h > window.innerHeight * 0.9) return false; // não é fullscreen
    let isCentered = false, isFixed = false, hasOverlaySibling = false, isWhite = false;
    try {
      const cs = window.getComputedStyle(node);
      isFixed = cs.position === 'fixed' || cs.position === 'absolute';
      const rect = node.getBoundingClientRect();
      // centralizado horizontalmente (centro do viewport ± 150px)
      const centerX = rect.left + rect.width / 2;
      const viewportCenterX = window.innerWidth / 2;
      const isHorizCentered = Math.abs(centerX - viewportCenterX) < 200;
      const isVertCentered = rect.top > 40 && rect.top < window.innerHeight * 0.45;
      isCentered = isHorizCentered && isVertCentered;
      // fundo branco ou claro
      const bg = cs.backgroundColor || '';
      isWhite = /rgb\(255,\s*255,\s*255\)/.test(bg) || bg === 'white' || cs.background === 'white' || node.style.background === 'white';
      // sem isFixed mas ainda pode ser modal dentro de portal fixed
      if (!isFixed) {
        let p = node.parentElement;
        let depth = 0;
        while (p && depth < 4) {
          try {
            const pcs = window.getComputedStyle(p);
            if (pcs && pcs.position === 'fixed') { isFixed = true; break; }
          } catch {}
          p = p.parentElement; depth++;
        }
      }
    } catch {}
    // verifica se tem botão X de fechar (característico do modal da screenshot)
    const hasCloseBtn = !!node.querySelector('[class*="close" i], [aria-label*="close" i], [aria-label*="Close" i]') ||
      Array.from(node.querySelectorAll('button, span, div')).some(el => (el.textContent||'').trim() === '×' || (el.textContent||'').trim() === '✕' || el.innerHTML.includes('close'));
    // verifica se tem overlay/máscara ao fundo (body tem filho escuro semi-transparente)
    try {
      if (!document.body) hasOverlaySibling = false;
      else hasOverlaySibling = Array.from(document.body.children).some(sib => {
        if (!sib || sib === node || sib.id === 'gh-floating-root') return false;
        try {
          const cs = window.getComputedStyle(sib);
          const isOverlay = cs.position === 'fixed' && parseInt(cs.zIndex||0) > 500;
          const bg = cs.backgroundColor || '';
          const isDarkOverlay = /rgba\(0,\s*0,\s*0,\s*0\.[3-7]\)/.test(bg) || bg === 'rgba(0, 0, 0, 0.5)' || (cs.backgroundColor && cs.backgroundColor.includes('rgba'));
          return isOverlay && (isDarkOverlay || sib.offsetWidth > window.innerWidth * 0.9);
        } catch { return false; }
      });
    } catch { hasOverlaySibling = false; }
    // também verifica iframe com src de login dentro
    const hasLoginIframe = !!node.querySelector('iframe[src*="login" i], iframe[src*="passport" i], iframe[src*="auth" i], iframe[src*="taobao.com" i]');

    // iframe de login é sempre suspeito
    if (hasLoginIframe && isCentered && isFixed) {
      if (userClickedRecently) return false;
      return true;
    }
    // Regra estrita: branco + centralizado + fixed + X + overlay escuro
    if (isCentered && isFixed && isWhite && hasCloseBtn && hasOverlaySibling) {
      if (userClickedRecently) return false;
      return true;
    }
    // fallback: branco grande centralizado com X e fixed (exige X)
    if (isCentered && isWhite && hasCloseBtn && isFixed && w > 300 && h > 250) {
      if (!userClickedRecently) return true;
    }
    return false;
  }

  function forceKillTopModals() {
    // mata o topmost modal + overlay de forma agressiva (chamado via ESC ou botão)
    const all = Array.from(document.querySelectorAll('div, section'));
    let killed = 0;
    for (const el of all) {
      if (el instanceof HTMLElement && !el.dataset.ghHidden && el.offsetWidth > 200 && el.offsetHeight > 150) {
        if (isLoginModal(el) || isSuspiciousEmptyModal(el)) {
          hideNode(el);
          killed++;
        }
      }
    }
    // também mata overlays escuros
    for (const el of document.body.children) {
      if (el instanceof HTMLElement && !el.dataset.ghHidden && el.id !== 'gh-floating-root') {
        try {
          const cs = window.getComputedStyle(el);
          if (cs.position === 'fixed' && parseInt(cs.zIndex||0) > 800) {
            const bg = cs.backgroundColor || '';
            if (/rgba\(0, 0, 0/.test(bg) || cs.backdropFilter) {
              hideNode(el);
              killed++;
            }
          }
        } catch {}
      }
    }
    unlockScroll();
    console.log(`[Goofish Helper] forceKill: ${killed} modais/overlays removidos`);
    return killed;
  }

  function unlockScroll() {
    try {
      // remove overflow/height/position com e sem !important
      document.documentElement.style.removeProperty('overflow');
      document.body.style.removeProperty('overflow');
      document.documentElement.style.removeProperty('height');
      document.body.style.removeProperty('height');
      document.body.style.removeProperty('position');
      document.body.style.removeProperty('top');
      document.body.style.removeProperty('left');
      document.body.style.removeProperty('right');
      // força scroll liberado (com !important para vencer regras inline do site)
      try { document.documentElement.style.setProperty('overflow', 'auto', 'important'); } catch {}
      try { document.body.style.setProperty('overflow', 'auto', 'important'); } catch {}
      // limpa posição fixa que trava scroll
      if (document.body.style.position === 'fixed') document.body.style.position = '';
      // remove classes que travam scroll (inclui padrões Ant Design e Goofish)
      const re = /modal|lock|no-scroll|overflow|hidden|ant-scrolling-effect/i;
      document.documentElement.classList.forEach(c => { if (re.test(c)) document.documentElement.classList.remove(c); });
      document.body.classList.forEach(c => { if (re.test(c)) document.body.classList.remove(c); });
      // Goofish/AntD também injeta overflow em <html> via classe ant-scrolling-effect
      // garante que mesmo após setProperty o scroll volta após próximo frame
      requestAnimationFrame(() => {
        try {
          if (getComputedStyle(document.body).overflow === 'hidden') {
            document.body.style.setProperty('overflow', 'auto', 'important');
          }
          if (getComputedStyle(document.documentElement).overflow === 'hidden') {
            document.documentElement.style.setProperty('overflow', 'auto', 'important');
          }
        } catch {}
      });
    } catch {}
  }

  function hideLoginOverlays() {
    if (!document.body) return 0;
    let killed = 0;
    // 1) busca direta nos filhos do body (caso clássico: máscara full-screen)
    for (const el of Array.from(document.body.children)) {
      if (!(el instanceof HTMLElement) || el.dataset.ghHidden || el.id === 'gh-floating-root') continue;
      try {
        const cs = window.getComputedStyle(el);
        const isFixed = cs.position === 'fixed';
        const z = parseInt(cs.zIndex || '0', 10);
        const bg = cs.backgroundColor || '';
        const isDark = /rgba\(0,\s*0,\s*0,\s*0\.[2-8]\)/.test(bg) || /rgba\(0, 0, 0/.test(bg);
        const coversViewport = el.offsetWidth > window.innerWidth * 0.85 && el.offsetHeight > window.innerHeight * 0.4;
        if (isFixed && z > 500 && isDark && coversViewport) {
          hideNode(el);
          killed++;
        }
      } catch {}
    }
    // 2) busca profunda: overlay pode estar aninhado como /html/body/div[5]/div/div[1]
    // usado quando o wrap ant-modal-wrap está escondido mas o filho escuro permanece
    try {
      const deepCandidates = document.querySelectorAll('div, section');
      for (const el of deepCandidates) {
        if (!(el instanceof HTMLElement) || el.dataset.ghHidden || el.id === 'gh-floating-root') continue;
        // só avalia se já matamos um modal ou se candidato parece overlay grande
        if (el.offsetWidth < window.innerWidth * 0.5 || el.offsetHeight < window.innerHeight * 0.3) continue;
        const cs = window.getComputedStyle(el);
        const isFixed = cs.position === 'fixed' || cs.position === 'absolute';
        const z = parseInt(cs.zIndex || '0', 10);
        const bg = cs.backgroundColor || '';
        const isDark = /rgba\(0,\s*0,\s*0,\s*0\.[2-8]\)/.test(bg) || /rgba\(0, 0, 0/.test(bg);
        // aninhado pode não ter z alto, então aceita se pai é fixed de alto z
        let hasHighZAncestor = z > 400;
        if (!hasHighZAncestor) {
          let p = el.parentElement; let d = 0;
          while (p && d < 3) {
            try {
              const pcs = window.getComputedStyle(p);
              if (pcs.position === 'fixed' && parseInt(pcs.zIndex||'0',10) > 500) { hasHighZAncestor = true; break; }
            } catch {}
            p = p.parentElement; d++;
          }
        }
        const coversViewport = el.offsetWidth >= window.innerWidth * 0.85 || el.offsetHeight >= window.innerHeight * 0.5;
        if (isDark && (isFixed || hasHighZAncestor) && coversViewport) {
          // evita matar página principal: só esconde se não contém conteúdo principal (texto muito longo)
          const textLen = (el.innerText || '').length;
          if (textLen > 1500) continue;
          // se já está hidden ou é wrap conhecido, esconde
          hideNode(el);
          killed++;
        }
      }
    } catch {}
    // 3) fallback específico para estrutura relatada: /html/body/div[5]/div/div[1]
    try {
      const suspect = document.querySelector('body > div:nth-child(5) > div > div:nth-child(1)');
      if (suspect instanceof HTMLElement && !suspect.dataset.ghHidden) {
        const cs = window.getComputedStyle(suspect);
        const bg = cs.backgroundColor || '';
        if (/rgba\(0, 0, 0/.test(bg)) {
          hideNode(suspect);
          // também esconde o wrapper pai se for máscara
          const wrap = suspect.parentElement;
          if (wrap && wrap !== document.body && !wrap.dataset.ghHidden) {
            const wcs = window.getComputedStyle(wrap);
            if (wcs.position === 'fixed' || /rgba\(0, 0, 0/.test(wcs.backgroundColor)) hideNode(wrap);
          }
          killed++;
        }
      }
    } catch {}
    if (killed) unlockScroll();
    return killed;
  }

  function hideNode(node) {
    if (!node || !(node instanceof HTMLElement)) return;
    if (node.dataset.ghHidden) return;
    // não esconde se for nosso UI
    if (node.id === 'gh-floating-root') return;
    node.dataset.ghHidden = '1';
    // guarda display original para debug
    node.style.setProperty('display', 'none', 'important');
    node.style.setProperty('visibility', 'hidden', 'important');
    node.style.setProperty('pointer-events', 'none', 'important');
    // tenta remover do fluxo também via hidden
    node.setAttribute('aria-hidden', 'true');
    console.log('[Goofish Helper] Modal de login bloqueado:', node.className?.slice(0,120), (node.innerText||'').slice(0,80));
    unlockScroll();
  }

  function scanForLoginModals() {
    if (!settings.hideLogin) return;
    if (!document.body) return;
    const candidates = new Set();
    // filhos do body (modais sempre no body)
    try {
      for (const child of document.body.children) {
        if (!child) continue;
        candidates.add(child);
        // varre até 2 níveis (portais React costumam ter wrapper)
        if (child.children) {
          for (const c2 of child.children) {
            if (!c2) continue;
            candidates.add(c2);
            if (c2.children && c2.children.length < 8) {
              for (const c3 of c2.children) if (c3) candidates.add(c3);
            }
          }
        }
      }
    } catch {}

    // também todos dialogs/masks conhecidos
    document.querySelectorAll('[role="dialog"], [aria-modal="true"], [class*="Modal"], [class*="modal"], [class*="Mask"], [class*="mask"], [class*="Overlay"], [class*="overlay"], [class*="Drawer"], [class*="popup"], [class*="Popup"], [class*="baxia"], [class*="ant-"], [id*="modal"], [id*="login" i]').forEach(el => candidates.add(el));

    let anyKilled = false;
    for (const el of candidates) {
      if (el instanceof HTMLElement && isLoginModal(el)) {
        hideNode(el);
        anyKilled = true;
        // esconde overlay irmão (mask) - usa computed style, não só inline
        const siblings = [el.previousElementSibling, el.nextElementSibling, el.parentElement];
        for (const sib of siblings) {
          if (sib instanceof HTMLElement && sib !== el && !sib.dataset.ghHidden) {
            try {
              const cs = window.getComputedStyle(sib);
              const csib = sib.className || '';
              const isMaskClass = /mask|overlay|backdrop|wrapper/i.test(csib);
              const bg = cs.backgroundColor || '';
              const isDarkBg = /rgba\(0,\s*0,\s*0,\s*0\.[2-8]\)/.test(bg) || /rgba\(0, 0, 0/.test(bg);
              const isOverlayPos = cs.position === 'fixed' && parseInt(cs.zIndex || '0', 10) > 500;
              if (isMaskClass || isDarkBg || isOverlayPos || sib.style.backgroundColor) {
                if ((sib.innerText || '').length < 300) hideNode(sib);
              }
            } catch {}
          }
        }
        // se o parent é um portal container vazio, esconde também
        const parent = el.parentElement;
        if (parent && parent !== document.body && parent.children.length === 1 && parent !== document.documentElement) {
          if (!parent.dataset.ghHidden && parent.offsetHeight > 100) {
            const pcls = parent.className || '';
            if (/portal|root|container|wrapper|modal/i.test(pcls)) hideNode(parent);
          }
        }
      }
    }
    if (anyKilled) hideLoginOverlays();
    // fallback: busca por qualquer elemento com texto login que esteja fixed e grande (varredura mais cara mas só quando necessário)
    if (candidates.size < 30) {
      let fallbackKilled = false;
      document.querySelectorAll('div').forEach(el => {
        if (el instanceof HTMLElement && !el.dataset.ghHidden && el.offsetWidth > 250 && el.offsetHeight > 120) {
          if (isLoginModal(el)) { hideNode(el); fallbackKilled = true; }
        }
      });
      if (fallbackKilled) hideLoginOverlays();
    }
    // se nenhum modal mas overlay escuro sozinho ficou (caso empty modal não detectado), varre overlay global
    if (!anyKilled) {
      // só limpa overlay se houver sinal de modal suspeito no body
      const hasSuspect = Array.from(candidates).some(c => c instanceof HTMLElement && isSuspiciousEmptyModal(c));
      if (hasSuspect) hideLoginOverlays();
    }
  }

  let loginObserver = null;
  let loginPoll = null;
  function startLoginObserver() {
    if (loginObserver) loginObserver.disconnect();
    if (loginPoll) clearInterval(loginPoll);
    if (!settings.hideLogin) return;
    // varredura imediata
    if (document.body) scanForLoginModals();

    loginObserver = new MutationObserver((mutations) => {
      let needsScan = false;
      let killedDirect = false;
      for (const m of mutations) {
        if (m.type === 'childList' && m.addedNodes.length) {
          for (const node of m.addedNodes) {
            if (node instanceof HTMLElement) {
              if (isLoginModal(node)) { hideNode(node); killedDirect = true; continue; }
              // checa filhos
              if (node.querySelectorAll) {
                // rápido: só se contém 登录
                if ((node.innerText||'').includes('登录') || (node.textContent||'').includes('登录') || /login/i.test(node.innerHTML||'')) {
                  if (isLoginModal(node)) { hideNode(node); killedDirect = true; }
                  else {
                    const inners = node.querySelectorAll('div, section, [role="dialog"]');
                    for (const el of inners) if (el instanceof HTMLElement && isLoginModal(el)) { hideNode(el); killedDirect = true; }
                  }
                }
              }
              needsScan = true;
            }
          }
        }
        if (m.type === 'attributes' && m.target instanceof HTMLElement) {
          if (isLoginModal(m.target) && m.target.style.display !== 'none' && !m.target.dataset.ghHidden) { hideNode(m.target); killedDirect = true; }
        }
      }
      if (killedDirect) hideLoginOverlays();
      if (needsScan) scanForLoginModals();
    });
    const target = document.body || document.documentElement;
    loginObserver.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'aria-hidden'] });

    // polling agressivo: a cada 800ms por 60s, depois a cada 3s para sempre (Goofish reexibe após scroll)
    let ticks = 0;
    loginPoll = setInterval(() => {
      if (!settings.hideLogin) { clearInterval(loginPoll); return; }
      scanForLoginModals();
      unlockScroll(); // garante que mesmo se escondermos, o scroll volta
      ticks++;
      if (ticks > 75) { // após 60s (75*800ms)
        clearInterval(loginPoll);
        // polling leve permanente
        loginPoll = setInterval(() => { if (settings.hideLogin) { scanForLoginModals(); unlockScroll(); } }, 3000);
      }
    }, 800);
  }

  // ESC para matar modal manualmente
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && settings.hideLogin) {
      const killed = forceKillTopModals();
      if (killed > 0) e.stopPropagation();
    }
  }, true);

  // Expõe para popup e console
  window.ghKill = forceKillTopModals;

  // Inicia BLOQUEIO IMEDIATAMENTE, sem esperar storage (default true)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => startLoginObserver());
    // também tenta observar documentElement já
    try { startLoginObserver(); } catch {}
  } else {
    startLoginObserver();
  }
  // também observa imediatamente documentElement caso body ainda não exista
  if (!document.body) {
    const earlyObs = new MutationObserver(() => {
      if (document.body) { earlyObs.disconnect(); startLoginObserver(); }
    });
    earlyObs.observe(document.documentElement, { childList: true });
  }

  // ---------- 2. Conversor Inline ----------
  const convertedSet = new WeakSet();

  function extractCny(text) {
    if (!text) return null;
    // tenta padrão ¥ 48.50 ou ¥ 3.80万 (split 万)
    let m = /[¥￥]\s*([\d,]+(?:\.\d+)?)\s*(万)?/.exec(text);
    if (m) {
      let n = parseFloat(m[1].replace(/,/g, ''));
      if (m[2]) n *= 10000;
      if (isFinite(n) && n > 0 && n < 1e8) return n;
    }
    m = /([\d,]+(?:\.\d+)?)\s*(万)?\s*元/.exec(text);
    if (m) {
      let n = parseFloat(m[1].replace(/,/g, ''));
      if (m[2]) n *= 10000;
      if (isFinite(n) && n > 0 && n < 1e8) return n;
    }
    return null;
  }

  function formatConverted(cny) {
    if (!rates) return null;
    const get = (k) => (rates[k] != null ? (cny * rates[k]) : null);
    return {
      usd: get('USD') != null ? get('USD').toFixed(2) : null,
      eur: get('EUR') != null ? get('EUR').toFixed(2) : null,
      brl: get('BRL') != null ? get('BRL').toFixed(2) : null,
      mxn: get('MXN') != null ? get('MXN').toFixed(2) : null,
      ars: get('ARS') != null ? get('ARS').toFixed(2) : null,
      cop: get('COP') != null ? get('COP').toFixed(0) : null,
      clp: get('CLP') != null ? get('CLP').toFixed(0) : null,
      pen: get('PEN') != null ? get('PEN').toFixed(2) : null,
      cad: get('CAD') != null ? get('CAD').toFixed(2) : null,
      aud: get('AUD') != null ? get('AUD').toFixed(2) : null,
    };
  }

  function createBadge(cny) {
    const conv = formatConverted(cny);
    if (!conv) return null;
    const span = document.createElement('span');
    span.className = 'gh-convert-badge';
    const cur = settings.displayCurrency || 'ALL';
    const locale = settings.language === 'en' ? 'en-US' : settings.language === 'es' ? 'es-ES' : 'pt-BR';
    let title = `1 CNY = USD ${rates.USD} · EUR ${rates.EUR} · BRL ${rates.BRL} · MXN ${rates.MXN} · ARS ${rates.ARS} · COP ${rates.COP} · CLP ${rates.CLP} · PEN ${rates.PEN} · CAD ${rates.CAD} · AUD ${rates.AUD} • ${new Date(ratesTimestamp).toLocaleDateString(locale)}`;
    if (cur !== 'ALL' && rates[cur] != null) title = `1 CNY = ${rates[cur]} ${cur} • ${new Date(ratesTimestamp).toLocaleDateString(locale)}`;
    span.title = title;
    const map = {
      USD: `≈ <b>$${conv.usd}</b> <span class="gh-flag">USD</span>`,
      EUR: `≈ <b>€${conv.eur}</b> <span class="gh-flag">EUR</span>`,
      BRL: `≈ <b>R$${conv.brl}</b> <span class="gh-flag">BRL</span>`,
      MXN: `≈ <b>$${conv.mxn}</b> <span class="gh-flag">MXN</span>`,
      ARS: `≈ <b>$${conv.ars}</b> <span class="gh-flag">ARS</span>`,
      COP: `≈ <b>$${conv.cop}</b> <span class="gh-flag">COP</span>`,
      CLP: `≈ <b>$${conv.clp}</b> <span class="gh-flag">CLP</span>`,
      PEN: `≈ <b>S/${conv.pen}</b> <span class="gh-flag">PEN</span>`,
      CAD: `≈ <b>C$${conv.cad}</b> <span class="gh-flag">CAD</span>`,
      AUD: `≈ <b>A$${conv.aud}</b> <span class="gh-flag">AUD</span>`,
    };
    if (map[cur]) span.innerHTML = map[cur];
    else span.innerHTML = `≈ <b>$${conv.usd}</b> <span class="gh-flag">USD</span> · <b>€${conv.eur}</b> <span class="gh-flag">EUR</span> · <b>R$${conv.brl}</b> <span class="gh-flag">BRL</span>`;
    return span;
  }

  function scanPrices(root = document.body) {
    if (!settings.autoConvert || !rates || !root) return;
    // Prioriza seletores de preço do Goofish (evita falsos positivos em cards)
    const priceSelectors = '[class*="price" i], [class*="Price"], [class*="amount"], [class*="fee" i], [data-testid*="price" i], [class*="activity" i], [class*="detail" i]';
    let candidates = [];
    try { candidates = Array.from(root.querySelectorAll ? root.querySelectorAll(priceSelectors) : []); } catch {}
    // Fallback: busca por ¥ em containers pequenos
    if (candidates.length === 0) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const t = (node.nodeValue || '').trim();
          if (!t) return NodeFilter.FILTER_REJECT;
          if (/[¥￥]/.test(t) && t.length < 20) return NodeFilter.FILTER_ACCEPT;
          return NodeFilter.FILTER_REJECT;
        }
      });
      const tmp = []; let n; while ((n = walker.nextNode())) tmp.push(n.parentElement);
      candidates = tmp.filter(Boolean);
    }
    const seen = new Set();
    for (const el of candidates) {
      if (!el || !(el instanceof HTMLElement) || el.closest('.gh-convert-badge') || convertedSet.has(el) || seen.has(el)) continue;
      if (/^(SCRIPT|STYLE|NOSCRIPT)$/.test(el.tagName)) continue;
      // apenas um badge por card/produto (evita duplicado e badge solto no container)
      let productCard = el.closest('a.feeds-item-wrap--rGdH_KoF, a[class*="feeds-item-wrap"], a[class*="feeds-item"]');
      if (!productCard) {
        productCard = el.closest('[class*="item" i], [class*="goods" i], li, article, [class*="card" i]');
        if (productCard && productCard.classList.contains('feeds-list-container--UkIMBPNk')) productCard = null;
      }
      if (!productCard) {
        // detail page ou fallback: usa parent mas garante que não é o container da lista
        const cand = el.parentElement;
        if (cand && cand.classList.contains('feeds-list-container--UkIMBPNk')) continue;
        productCard = cand;
      }
      if (!productCard) continue;
      if (productCard.querySelector('.gh-convert-badge')) continue;
      if (!productCard.querySelector('img')) continue;
      if ((productCard.innerText || '').trim().length < 15) continue;
      // limpeza de badges soltos entre cards (filhos diretos do list container)
      try { document.querySelectorAll('.feeds-list-container--UkIMBPNk > .gh-convert-badge, .feeds-list-container > .gh-convert-badge').forEach(b => b.remove()); } catch {}
      // home: remove valores dos 4 banners coloridos do topo (só feed deve ter conversão)
      if ((location.pathname === '/' || location.pathname === '/index') && el.getBoundingClientRect().top < 850) continue;
      if (el.nextElementSibling && el.nextElementSibling.classList && el.nextElementSibling.classList.contains('gh-convert-badge')) continue;
      seen.add(el);
      // container pode ser o próprio el ou seu pai que contém ¥ + número
      const container = el;
      const text = (container.innerText || container.textContent || '').slice(0, 60);
      if (!/[¥￥]/.test(text)) continue;
      if (text.length > 40) continue; // evita card inteiro
      const found = extractCny(text);
      if (found === null) continue;
      // evita preços absurdos de "万" solto (ex: "万" sem ¥ foi capturado via texto vizinho)
      if (text.trim() === '万' || text.trim() === '¥') continue;
      const badge = createBadge(found);
      if (badge) {
        try {
          container.after(badge);
          convertedSet.add(container);
        } catch {
          try { el.after(badge); convertedSet.add(el); } catch {}
        }
      }
    }
    // Detail page: garante conversão em "活动价 ¥345.00" mesmo se seletores falharem
    try {
      if (typeof isProductPage === 'function' && isProductPage() && !document.querySelector('.gh-detail-badge')) {
        const candidatesDetail = Array.from(document.querySelectorAll('*')).filter(el => {
          if (!(el instanceof HTMLElement)) return false;
          if (el.closest && el.closest('.gh-convert-badge, .gh-detail-badge, #gh-floating-root, #gh-cssbuy-bar')) return false;
          const txt = (el.innerText || el.textContent || '');
          return txt.includes('活动价') && txt.includes('¥') && txt.length < 80 && el.children.length < 4;
        });
        for (const cont of candidatesDetail) {
          const txt = (cont.innerText || cont.textContent || '');
          const foundDetail = extractCny(txt);
          if (foundDetail === null) continue;
          if (cont.querySelector('.gh-convert-badge, .gh-detail-badge')) continue;
          if (cont.nextElementSibling && cont.nextElementSibling.classList && (cont.nextElementSibling.classList.contains('gh-convert-badge') || cont.nextElementSibling.classList.contains('gh-detail-badge'))) continue;
          const badgeDetail = createBadge(foundDetail);
          if (badgeDetail) {
            badgeDetail.classList.add('gh-detail-badge');
            badgeDetail.style.fontSize = '13px';
            badgeDetail.style.padding = '4px 8px';
            badgeDetail.style.marginLeft = '8px';
            badgeDetail.style.verticalAlign = 'middle';
            try { cont.appendChild(badgeDetail); convertedSet.add(cont); } catch { try { cont.after(badgeDetail); } catch {} }
          }
          break; // apenas o principal
        }
      }
    } catch {}
  }

  let priceObserver = null;
  function startPriceObserver() {
    if (priceObserver) priceObserver.disconnect();
    if (!settings.autoConvert || !document.body) return;
    scanPrices();
    priceObserver = new MutationObserver((mutations) => {
      for (const m of mutations) for (const node of m.addedNodes) if (node instanceof HTMLElement) scanPrices(node);
    });
    priceObserver.observe(document.body, { childList: true, subtree: true });
  }
  // inicia preços após DOM pronto
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { if (settings.autoConvert) startPriceObserver(); });
  else setTimeout(() => { if (settings.autoConvert) startPriceObserver(); }, 600);

  // ---------- 2b. Tradução de Filtros (PT/EN/ES) ----------
  const FILTER_MAPS = {
    pt: {
      '综合': 'Geral','新降价': 'Preço caiu','累计降价': 'Preço caiu','天内降价': ' dias: preço caiu','小时前降价': ' horas atrás: preço caiu','分钟前降价': ' min atrás: preço caiu','小时前发布': ' horas atrás','分钟前发布': ' minutos atrás','小时内发布': ' horas atrás','小时发货': ' horas para envio','天内发布': ' dias atrás','天前发布': ' dias atrás','新发布': 'Novos','价格': 'Preço','区域': 'Região',
      '个人闲置': 'Particular','验货宝': 'Verificado','验号担保': 'Garantia','包邮': 'Frete grátis','超赞鱼小铺': 'Loja destaque','全新': 'Novo','严选': 'Seleção','转卖': 'Revenda',
      '猜你喜欢': 'Recomendados','小闲鱼没有找到你想要的宝贝~': 'Nenhum resultado','减少筛选内容试试': 'Tente remover filtros','搜索': 'Buscar','发闲置': 'Anunciar',
      '最新': 'Mais recente','1天内': 'Último dia','3天内': 'Últimos 3 dias','7天内': 'Últimos 7 dias','14天内': 'Últimos 14 dias',
      '价格从低到高': 'Menor preço','价格从高到低': 'Maior preço','从低到高': 'Menor preço','从高到低': 'Maior preço',
      '最近活跃': 'Atividade recente','距离最近': 'Mais próximo','信用排序': 'Por reputação',
      '卖家信用优秀': 'Vendedor excelente','卖家信用极好': 'Vendedor ótimo','卖家信用良好': 'Vendedor bom','鱼小铺': 'Loja','7天无理由退货': '7 dias p/ devolver','描述不符包退': 'Devolução garantida','人想要': ' pessoas querem','几乎全新': 'Quase novo','几乎新': 'Quase novo',
      '百分百好评': 'Avaliação 100%','回复超快': 'Resposta rápida','发货快': 'Envio rápido','未拆封': 'Não aberto','轻度磕碰划痕': 'Leve arranhão','细微磕碰划痕': 'Arranhões leves','少许磕碰划痕': 'Alguns arranhões','少量磕碰划痕': 'Poucos arranhões','功能明显异常': 'Função com falha','功能正常': 'Funcionando','屏幕显示完美': 'Tela perfeita','严重磕碰划痕': 'Arranhões graves','屏幕破损或外壳破碎': 'Tela danificada ou carcaça quebrada'
    },
    en: {
      '综合': 'General','新降价': 'Price drop','累计降价': 'Price drop','天内降价': ' days: price drop','小时前降价': ' hours ago: price drop','分钟前降价': ' min ago: price drop','小时前发布': ' hours ago','分钟前发布': ' minutes ago','小时内发布': ' hours ago','小时发货': ' hours to ship','天内发布': ' days ago','天前发布': ' days ago','新发布': 'New arrivals','价格': 'Price','区域': 'Region',
      '个人闲置': 'Personal','验货宝': 'Verified','验号担保': 'Warranty','包邮': 'Free shipping','超赞鱼小铺': 'Top shop','全新': 'New','严选': 'Curated','转卖': 'Resale',
      '猜你喜欢': 'Recommended','小闲鱼没有找到你想要的宝贝~': 'No results','减少筛选内容试试': 'Try fewer filters','搜索': 'Search','发闲置': 'Sell',
      '最新': 'Latest','1天内': 'Last day','3天内': 'Last 3 days','7天内': 'Last 7 days','14天内': 'Last 14 days',
      '价格从低到高': 'Lowest price','价格从高到低': 'Highest price','从低到高': 'Lowest','从高到低': 'Highest',
      '最近活跃': 'Recent activity','距离最近': 'Nearest','信用排序': 'Top rated',
      '卖家信用优秀': 'Excellent seller','卖家信用极好': 'Top seller','卖家信用良好': 'Good seller','鱼小铺': 'Shop','7天无理由退货': '7-day return','描述不符包退': 'Refund if not as described','人想要': ' want it','几乎全新': 'Almost new','几乎新': 'Almost new',
      '百分百好评': '100% positive','回复超快': 'Quick reply','发货快': 'Fast shipping','未拆封': 'Sealed','轻度磕碰划痕': 'Light scratches','细微磕碰划痕': 'Minor scratches','少许磕碰划痕': 'Few scratches','少量磕碰划痕': 'Few scratches','功能明显异常': 'Function abnormal','功能正常': 'Working','屏幕显示完美': 'Perfect screen','严重磕碰划痕': 'Severe scratches','屏幕破损或外壳破碎': 'Damaged screen or broken casing'
    },
    es: {
      '综合': 'General','新降价': 'Bajada precio','累计降价': 'Bajada precio','天内降价': ' días: bajada','小时前降价': ' horas atrás: bajada','分钟前降价': ' min atrás: bajada','小时前发布': ' horas atrás','分钟前发布': ' minutos atrás','小时内发布': ' horas atrás','小时发货': ' horas para envío','天内发布': ' días atrás','小时内发布': ' horas atrás','小时发货': ' horas para envio','天内发布': ' dias atrás','天前发布': ' días atrás','新发布': 'Nuevos','价格': 'Precio','区域': 'Región',
      '个人闲置': 'Particular','验货宝': 'Verificado','验号担保': 'Garantía','包邮': 'Envío gratis','超赞鱼小铺': 'Tienda destacada','全新': 'Nuevo','严选': 'Selección','转卖': 'Reventa',
      '猜你喜欢': 'Recomendados','小闲鱼没有找到你想要的宝贝~': 'Sin resultados','减少筛选内容试试': 'Prueba menos filtros','搜索': 'Buscar','发闲置': 'Publicar',
      '最新': 'Más reciente','1天内': 'Último día','3天内': 'Últimos 3 días','7天内': 'Últimos 7 días','14天内': 'Últimos 14 días',
      '价格从低到高': 'Menor precio','价格从高到低': 'Mayor precio','从低到高': 'Menor','从高到低': 'Mayor',
      '最近活跃': 'Actividad reciente','距离最近': 'Más cercano','信用排序': 'Mejor reputación',
      '卖家信用优秀': 'Vendedor excelente','卖家信用极好': 'Vendedor top','卖家信用良好': 'Buen vendedor','鱼小铺': 'Tienda','7天无理由退货': 'Devolución 7 días','描述不符包退': 'Reembolso garantizado','人想要': ' lo quieren','几乎全新': 'Casi nuevo','几乎新': 'Casi nuevo',
      '百分百好评': '100% positivas','回复超快': 'Respuesta rápida','发货快': 'Envío rápido','未拆封': 'Sin abrir','轻度磕碰划痕': 'Arañazos leves','细微磕碰划痕': 'Arañazos leves','少许磕碰划痕': 'Algunos arañazos','少量磕碰划痕': 'Pocos arañazos','功能明显异常': 'Función anormal','功能正常': 'Funcionando','屏幕显示完美': 'Pantalla perfecta','严重磕碰划痕': 'Arañazos graves','屏幕破损或外壳破碎': 'Pantalla dañada o carcasa rota'
    }
  };
  function getFilterMap() { return FILTER_MAPS[settings.language] || FILTER_MAPS.pt; }
  function getFilterKeys() { return Object.keys(getFilterMap()).sort((a,b) => b.length - a.length); }

  function translateFilters(root = document.body) {
    if (!settings.translateFilters || !root) return;
    const map = getFilterMap();
    const keys = getFilterKeys();
    // reverse map para re-traduzir quando idioma muda (ex: PT -> EN)
    const reverseMap = {};
    for (const lang of Object.keys(FILTER_MAPS)) {
      for (const [cn, tr] of Object.entries(FILTER_MAPS[lang])) {
        if (!reverseMap[tr]) reverseMap[tr] = cn;
      }
    }
    const allKeys = [...keys];
    const revKeys = Object.keys(reverseMap).sort((a,b) => b.length - a.length);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const t = (node.nodeValue || '').trim();
        if (!t) return NodeFilter.FILTER_REJECT;
        if (t.length > 100) return NodeFilter.FILTER_REJECT;
        for (const k of allKeys) if (t === k || t.includes(k)) return NodeFilter.FILTER_ACCEPT;
        for (const rk of revKeys) if (t === rk || t.includes(rk)) return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_REJECT;
      }
    });
    const nodes = [];
    let n; while ((n = walker.nextNode())) nodes.push(n);
    for (const node of nodes) {
      if (node.parentElement && node.parentElement.closest('#gh-floating-root, .gh-convert-badge, #gh-cssbuy-bar, .gh-shop-level-label')) continue;
      const parentText = (node.parentElement && node.parentElement.innerText || '').trim();
      if (parentText.length > 120) continue;
      let txt = node.nodeValue;
      let changed = false;
      // normaliza: se já traduzido, volta ao CN primeiro
      let cnKey = null;
      for (const rk of revKeys) {
        if (txt.trim() === rk) { cnKey = reverseMap[rk]; txt = txt.replace(rk, cnKey); break; }
        if (txt.includes(rk) && txt.trim().length < 80 && txt.includes(rk)) { cnKey = reverseMap[rk]; txt = txt.replace(rk, cnKey); break; }
      }
      let usedKey = null;
      for (const k of keys) {
        if (txt.includes(k)) {
          if (txt.trim() === k) {
            node.nodeValue = txt.replace(k, map[k]);
            changed = true; usedKey = k; break;
          } else if (txt.trim().length < 80 && txt.includes(k)) {
            node.nodeValue = txt.replace(k, map[k]);
            changed = true; usedKey = k; break;
          }
        }
      }
      if (changed && node.parentElement) {
        node.parentElement.setAttribute('title', node.nodeValue.trim());
        node.parentElement.dataset.ghTranslated = '1';
        // cores distintas para níveis de vendedor
        const p = node.parentElement;
        if (usedKey === '卖家信用优秀') { p.style.background='#fef3c7'; p.style.color='#92400e'; p.style.borderColor='#fde68a'; p.style.borderWidth='1px'; p.style.borderStyle='solid'; p.style.borderRadius='999px'; }
        else if (usedKey === '卖家信用极好') { p.style.background='#dbeafe'; p.style.color='#1e40af'; p.style.borderColor='#bfdbfe'; p.style.borderWidth='1px'; p.style.borderStyle='solid'; p.style.borderRadius='999px'; }
        else if (usedKey === '卖家信用良好') { p.style.background='#d1fae5'; p.style.color='#065f46'; p.style.borderColor='#a7f3d0'; p.style.borderWidth='1px'; p.style.borderStyle='solid'; p.style.borderRadius='999px'; }
        else if (usedKey === '百分百好评') { p.style.background='#ede9fe'; p.style.color='#5b21b6'; p.style.borderColor='#c4b5fd'; p.style.borderWidth='1px'; p.style.borderStyle='solid'; p.style.borderRadius='999px'; }
        else if (usedKey === '回复超快') { p.style.background='#fce7f3'; p.style.color='#9d174d'; p.style.borderColor='#fbcfe8'; p.style.borderWidth='1px'; p.style.borderStyle='solid'; p.style.borderRadius='999px'; }
      }
    }
    // Fallback para pills que escapam do walker + cores distintas por nível
    try {
      const shopTr = map['鱼小铺'];
      const seloExcellent = map['卖家信用优秀'];
      const seloGreat = map['卖家信用极好'];
      const seloGood = map['卖家信用良好'];
      const pctTr = map['百分百好评'];
      const replyTr = map['回复超快'];
      const dropTr = map['累计降价'];
      const targets = root.querySelectorAll ? root.querySelectorAll('span,div,a,b,em,strong,i') : [];
      const allMapKeys = Object.keys(map).sort((a,b)=>b.length-a.length);
      for (const el of targets) {
        if (el.closest && el.closest('#gh-floating-root, .gh-convert-badge, #gh-cssbuy-bar, .gh-shop-level-label')) continue;
        if (el.children.length > 2) continue;
        const t = (el.textContent || '').trim();
        if (!t || t.length > 30) continue;
        let newText = null; let bg=null, fg=null, bd=null;
        if (t.includes('鱼小铺') && shopTr && !t.includes(shopTr)) newText = el.textContent.replace(/鱼小铺/g, shopTr);
        else if (t.includes('卖家信用优秀') && seloExcellent && !t.includes(seloExcellent)) { newText = el.textContent.replace(/卖家信用优秀/g, seloExcellent); bg='#fef3c7'; fg='#92400e'; bd='#fde68a'; }
        else if (t.includes('卖家信用极好') && seloGreat && !t.includes(seloGreat)) { newText = el.textContent.replace(/卖家信用极好/g, seloGreat); bg='#dbeafe'; fg='#1e40af'; bd='#bfdbfe'; }
        else if (t.includes('卖家信用良好') && seloGood && !t.includes(seloGood)) { newText = el.textContent.replace(/卖家信用良好/g, seloGood); bg='#d1fae5'; fg='#065f46'; bd='#a7f3d0'; }
        else if (t.includes('百分百好评') && pctTr && !t.includes(pctTr)) { newText = el.textContent.replace(/百分百好评/g, pctTr); bg='#ede9fe'; fg='#5b21b6'; bd='#c4b5fd'; }
        else if (t.includes('回复超快') && replyTr && !t.includes(replyTr)) { newText = el.textContent.replace(/回复超快/g, replyTr); bg='#fce7f3'; fg='#9d174d'; bd='#fbcfe8'; }
        else if (t.includes('累计降价') && dropTr && !t.includes(dropTr)) { newText = el.textContent.replace(/累计降价/g, dropTr); }
        else {
          for (const k of allMapKeys) {
            if (t.includes(k) && !t.includes(map[k])) {
              const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              newText = el.textContent.replace(new RegExp(esc, 'g'), map[k]);
              break;
            }
          }
        }
        if (newText && newText !== el.textContent) {
          el.textContent = newText;
          el.setAttribute('title', newText.trim());
          el.dataset.ghTranslated = '1';
          if (bg) {
            el.style.background = bg; el.style.color = fg; el.style.borderColor = bd;
            el.style.borderWidth = '1px'; el.style.borderStyle = 'solid'; el.style.borderRadius = '999px';
            el.style.padding = '1px 6px';
          }
        }
      }
    } catch {}
  }

  function addShopLevelLabel(root = document.body) {
    if (!settings.translateFilters || !root) return;
    // limpeza: remove labels espalhados incorretamente (bug anterior: tps- genérico pegou todas as imagens)
    try {
      const badLabels = (root === document.body ? document : root).querySelectorAll ? (root === document.body ? document : root).querySelectorAll('.gh-shop-level-label') : [];
      for (const bad of badLabels) {
        const nxt = bad.nextElementSibling;
        const isShopImg = nxt && nxt.tagName === 'IMG' && (String(nxt.src||'').includes('tps-201-48') || String(nxt.src||'').includes('tps-162-48') || String(nxt.src||'').includes('O1CN01LYPs6n'));
        if (!isShopImg) {
          if (root === document.body) bad.remove();
        }
      }
      const flaggedImgs = (root === document.body ? document : root).querySelectorAll ? (root === document.body ? document : root).querySelectorAll('img[data-gh-shop-label]') : [];
      for (const fi of flaggedImgs) {
        const s = String(fi.src||'');
        if (!s.includes('tps-201-48') && !s.includes('tps-162-48') && !s.includes('O1CN01LYPs6n')) delete fi.dataset.ghShopLabel;
      }
    } catch {}
    const urlMap = {
      'O1CN01spKz9q1lv5ioRoUe9': 'L7',
      'O1CN01W9Lywj1oMgow16Evn': 'L6',
      'O1CN01iIXWtQ1eQg6zbhCol': 'L5'
    };
    const i18nShop = { pt: 'Loja Nível', en: 'Shop Level', es: 'Tienda Nivel' };
    const i18nCert = { pt: 'Vendedor Certificado', en: 'Certified seller', es: 'Vendedor Certificado' };
    const labelBase = i18nShop[settings.language] || i18nShop.pt;
    const certLabel = i18nCert[settings.language] || i18nCert.pt;
    // APENAS selos reais dentro de credit-container
    const imgs = root.querySelectorAll ? root.querySelectorAll('img[src*="alicdn.com/imgextra"][src*="tps-"]') : [];
    for (const img of imgs) {
      if (img.dataset.ghShopLabel) continue;
      const src = img.src || '';
      const inCredit = img.closest && img.closest('[class*="credit" i]');
      if (!inCredit) continue;
      if (!src.includes('alicdn.com/imgextra')) continue;
      const isCert = src.includes('162-48') || src.includes('O1CN01LYPs6n');
      const isShop = src.includes('201-48');
      if (!isCert && !isShop) continue;
      let text = null;
      if (isCert) {
        text = certLabel;
      } else {
        let level = null;
        for (const [hash, lvl] of Object.entries(urlMap)) if (src.includes(hash)) { level = lvl; break; }
        text = level ? `${labelBase} ${level}` : labelBase;
      }
      const badge = document.createElement('div');
      badge.textContent = text;
      badge.className = 'gh-shop-level-label';
      // marca tipo para não confundir na atualização de idioma
      badge.dataset.ghShopKind = isCert ? 'cert' : 'shop';
      if (isCert) badge.dataset.ghCert = '1';
      badge.dataset.ghShopLabel = '1';
      badge.title = text;
      // cor diferente para certificado (verde) vs loja (azul)
      badge.style.cssText = isCert
        ? 'font-size:9px;font-weight:700;color:#065f46;background:#d1fae5;border:1px solid #a7f3d0;border-radius:4px;padding:1px 6px;margin-bottom:2px;text-align:center;white-space:nowrap;line-height:1.2;'
        : 'font-size:9px;font-weight:700;color:#1e40af;background:#e6f0ff;border:1px solid #bfdbfe;border-radius:4px;padding:1px 4px;margin-bottom:2px;text-align:center;white-space:nowrap;line-height:1.2;';
      const parent = img.parentElement;
      if (parent) {
        if (getComputedStyle(parent).display !== 'flex' || getComputedStyle(parent).flexDirection !== 'column') {
          parent.style.display = 'flex';
          parent.style.flexDirection = 'column';
          parent.style.alignItems = 'center';
          parent.style.gap = '2px';
        }
        img.before(badge);
        img.dataset.ghShopLabel = '1';
      } else {
        img.before(badge);
      }
    }
    try {
      const existing = root.querySelectorAll ? root.querySelectorAll('.gh-shop-level-label') : [];
      for (const el of existing) {
        const isCert = el.dataset.ghCert === '1' || el.dataset.ghShopKind === 'cert';
        if (isCert) {
          const nt = certLabel;
          if (el.textContent !== nt) { el.textContent = nt; el.title = nt; }
        } else {
          const m = el.textContent.match(/L\s*([1-7])/i);
          const lvl = m ? ` L${m[1]}` : '';
          const nt = `${labelBase}${lvl}`.trim();
          if (el.textContent !== nt) { el.textContent = nt; el.title = nt; }
        }
      }
    } catch {}
    // Imagem 216-42 / 228-42 (7天无理由退货) -> Devolução em 7 dias
    try {
      const retMap = { 'O1CN01k7P6QR1DbfqYrsY5N': true, 'O1CN01IdADAH1ZMwenlz92N': true };
      const i18nRet = { pt: 'Devolução em 7 dias', en: '7-day return', es: 'Devolución 7 días' };
      const retLabel = i18nRet[settings.language] || i18nRet.pt;
      const retImgs = root.querySelectorAll ? root.querySelectorAll('img[src*="alicdn.com/imgextra"][src*="tps-216-42"], img[src*="alicdn.com/imgextra"][src*="tps-228-42"], img[src*="O1CN01k7P6QR"], img[src*="O1CN01IdADAH"]') : [];
      for (const img of retImgs) {
        if (img.dataset.ghRetLabel) continue;
        const src = img.src || '';
        let isRet = src.includes('216-42') || src.includes('228-42');
        for (const h of Object.keys(retMap)) if (src.includes(h)) isRet = true;
        if (!isRet) continue;
        const badge = document.createElement('div');
        badge.textContent = retLabel;
        badge.className = 'gh-ret-label';
        badge.dataset.ghRetLabel = '1';
        badge.title = retLabel;
        badge.style.cssText = 'font-size:9px;font-weight:600;color:#065f46;background:#d1fae5;border:1px solid #a7f3d0;border-radius:999px;padding:1px 6px;margin-bottom:2px;text-align:center;white-space:nowrap;line-height:1.2;';
        const parent = img.parentElement;
        if (parent) {
          if (getComputedStyle(parent).display !== 'flex' || getComputedStyle(parent).flexDirection !== 'column') {
            parent.style.display = 'flex';
            parent.style.flexDirection = 'column';
            parent.style.alignItems = 'flex-start';
            parent.style.gap = '2px';
          }
          img.before(badge);
          img.style.display = 'none';
          img.dataset.ghRetLabel = '1';
        } else {
          img.before(badge);
          img.style.display = 'none';
        }
      }
      const existingRet = root.querySelectorAll ? root.querySelectorAll('.gh-ret-label') : [];
      for (const el of existingRet) {
        const nt = retLabel;
        if (el.textContent !== nt) { el.textContent = nt; el.title = nt; }
      }
    } catch {}
  }

  let translateObserver = null;
  function startTranslateObserver() {
    if (translateObserver) translateObserver.disconnect();
    if (!settings.translateFilters || !document.body) return;
    translateFilters();
    addShopLevelLabel();
    translateObserver = new MutationObserver((muts) => {
      for (const m of muts) for (const node of m.addedNodes) if (node instanceof HTMLElement) { translateFilters(node); addShopLevelLabel(node); }
    });
    translateObserver.observe(document.body, { childList: true, subtree: true });
  }
  function stopTranslateObserver() {
    if (translateObserver) translateObserver.disconnect();
  }

  // ---------- 3. Menu Lateral Flutuante (Shadow DOM) ----------
  const SEARCH_DEFS = [
    { key: 'smartphones', icon: '', query: '手机' },
    { key: 'iphone', icon: '', query: '苹果手机' },
    { key: 'samsung', icon: '', query: '三星手机' },
    { key: 'xiaomi', icon: '', query: '小米手机' },
    { key: 'huawei', icon: '', query: '华为手机' },
    { key: 'honor', icon: '', query: '荣耀手机' },
    { key: 'oneplus', icon: '', query: '一加手机' },
    { key: 'oppo', icon: '', query: 'OPPO手机' },
    { key: 'vivo', icon: '', query: 'vivo手机' },
    { key: 'realme', icon: '', query: 'realme手机' },
    { key: 'meizu', icon: '', query: '魅族手机' },
    { key: 'electronics', icon: '', query: '电子产品' },
  ];
  const SEARCH_LABELS = {
    pt: { smartphones:'Smartphones', iphone:'iPhone', samsung:'Samsung', xiaomi:'Xiaomi', huawei:'Huawei', honor:'Honor', oneplus:'OnePlus', oppo:'OPPO', vivo:'Vivo', realme:'Realme', meizu:'Meizu', electronics:'Eletrônicos' },
    en: { smartphones:'Smartphones', iphone:'iPhone', samsung:'Samsung', xiaomi:'Xiaomi', huawei:'Huawei', honor:'Honor', oneplus:'OnePlus', oppo:'OPPO', vivo:'Vivo', realme:'Realme', meizu:'Meizu', electronics:'Electronics' },
    es: { smartphones:'Smartphones', iphone:'iPhone', samsung:'Samsung', xiaomi:'Xiaomi', huawei:'Huawei', honor:'Honor', oneplus:'OnePlus', oppo:'OPPO', vivo:'Vivo', realme:'Realme', meizu:'Meizu', electronics:'Electrónica' }
  };
  const UI_I18N = {
    pt: { menuTitle:'🐟 Goofish Helper', searchHint:'Buscar... (pt ou 中文)', go:'Ir', footALL:'Conversor CNY→ BRL ativo', footBRL:'Conversor CNY→ BRL ativo', footUSD:'Conversor CNY→ USD ativo', footEUR:'Conversor CNY→ EUR ativo', footMXN:'Conversor CNY→ MXN ativo', footARS:'Conversor CNY→ ARS ativo', footCOP:'Conversor CNY→ COP ativo', footCLP:'Conversor CNY→ CLP ativo', footPEN:'Conversor CNY→ PEN ativo', footCAD:'Conversor CNY→ CAD ativo', footAUD:'Conversor CNY→ AUD ativo', cssBuy:'🛒 Abrir no CSSBUY', cssBuyHint:'Abrir este produto no CSSBUY (link copiado)', cssBuyBar:'🛒 Abrir no CSSBUY', linkCopied:'link copiado', close:'Fechar', toggleOpen:'Abrir menu', toggleClose:'Fechar menu' },
    en: { menuTitle:'🐟 Goofish Helper', searchHint:'Search... (en or 中文)', go:'Go', footALL:'Converter CNY→ USD/EUR/BRL', footBRL:'Converter CNY→ BRL', footUSD:'Converter CNY→ USD', footEUR:'Converter CNY→ EUR', footMXN:'Converter CNY→ MXN', footARS:'Converter CNY→ ARS', footCOP:'Converter CNY→ COP', footCLP:'Converter CNY→ CLP', footPEN:'Converter CNY→ PEN', footCAD:'Converter CNY→ CAD', footAUD:'Converter CNY→ AUD', cssBuy:'🛒 Open in CSSBUY', cssBuyHint:'Open this product in CSSBUY (link copied)', cssBuyBar:'🛒 Open in CSSBUY', linkCopied:'link copied', close:'Close', toggleOpen:'Open menu', toggleClose:'Close menu' },
    es: { menuTitle:'🐟 Goofish Helper', searchHint:'Buscar... (es o 中文)', go:'Ir', footALL:'Conversor CNY→ USD/EUR/BRL', footBRL:'Conversor CNY→ BRL', footUSD:'Conversor CNY→ USD', footEUR:'Conversor CNY→ EUR', footMXN:'Conversor CNY→ MXN', footARS:'Conversor CNY→ ARS', footCOP:'Conversor CNY→ COP', footCLP:'Conversor CNY→ CLP', footPEN:'Conversor CNY→ PEN', footCAD:'Converter CNY→ CAD', footAUD:'Converter CNY→ AUD', cssBuy:'🛒 Abrir en CSSBUY', cssBuyHint:'Abrir este producto en CSSBUY (enlace copiado)', cssBuyBar:'🛒 Abrir en CSSBUY', linkCopied:'enlace copiado', close:'Cerrar', toggleOpen:'Abrir menú', toggleClose:'Cerrar menú' }
  };
  function getSearches() {
    const labels = SEARCH_LABELS[settings.language] || SEARCH_LABELS.pt;
    return SEARCH_DEFS.map(d => ({ label: labels[d.key] || d.key, icon: d.icon, query: d.query }));
  }

  let floatingRoot = null;
  let isExpanded = false;

  function buildFloatingMenu() {
    if (ghDisabled) return;
    const prevExpanded = isExpanded;
    const prevTop = floatingRoot ? floatingRoot.style.top : null;
    const prevTransform = floatingRoot ? floatingRoot.style.transform : null;
    if (floatingRoot) floatingRoot.remove();
    floatingRoot = document.createElement('div');
    floatingRoot.id = 'gh-floating-root';
    const shadow = floatingRoot.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .gh-wrap { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
      .gh-toggle { width: 40px; height: 40px; border-radius: 50%; border: none; background: #ff6a00; color: #fff; font-size: 18px; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,.25); display: grid; place-items: center; transition: transform .15s, background .15s; }
      .gh-toggle:hover { transform: scale(1.07); background: #ff7a1a; }
      .gh-panel { display: flex; flex-direction: column; gap: 2px; background: #fff; border-radius: 12px; padding: 6px; box-shadow: 0 8px 32px rgba(0,0,0,.18); border: 1px solid #ffe4cc; min-width: 150px; max-width: 190px; max-height: none; overflow: visible; animation: ghIn .18s ease; }
      @keyframes ghIn { from { opacity:0; transform: translateX(-8px) scale(.97); } to { opacity:1; transform:none; } }
      .gh-title { font-size: 9px; font-weight: 700; color: #9a3412; letter-spacing: .04em; text-transform: uppercase; padding: 1px 4px 3px; border-bottom: 1px solid #ffedd5; display:flex; justify-content:space-between; align-items:center; }
      .gh-close { background:none; border:none; cursor:pointer; font-size:12px; color:#9a3412; padding:1px 3px; }
      .gh-btn { display:flex; align-items:center; gap:4px; width:100%; padding:4px 6px; border:1px solid #ffedd5; border-radius:7px; background:#fff7ed; color:#7c2d12; font-size:11px; font-weight:600; cursor:pointer; text-align:left; transition: background .12s, transform .12s; line-height:1.1; }
      .gh-btn:hover { background:#ffedd5; transform: translateX(1px); }
      .gh-btn span.icon { font-size:12px; width:16px; text-align:center; }
      .gh-btn span.hint { font-size:8px; font-weight:400; color:#a16207; margin-left:auto; }
      .gh-search-row { display:flex; gap:3px; margin-top:2px; }
      .gh-input { flex:1; padding:4px 6px; border:1px solid #fed7aa; border-radius:6px; font-size:10px; outline:none; }
      .gh-input:focus { border-color:#ff6a00; box-shadow:0 0 0 2px #ffedd5; }
      .gh-go { padding:4px 7px; border:none; border-radius:6px; background:#ff6a00; color:#fff; font-weight:700; font-size:10px; cursor:pointer; }
      .gh-foot { font-size:8px; color:#a16207; text-align:center; padding-top:2px; }
      .gh-hidden { display:none !important; }
    `;
    const wrap = document.createElement('div'); wrap.className = 'gh-wrap';
    const ui = UI_I18N[settings.language] || UI_I18N.pt;
    const logoUrl = (() => { try { return chrome.runtime.getURL('icons/icon48.png'); } catch { return ''; } })();
    const toggle = document.createElement('button'); toggle.className = 'gh-toggle'; toggle.title = ui.toggleOpen; toggle.setAttribute('aria-label', ui.toggleOpen);
    if (logoUrl) toggle.innerHTML = `<img src="${logoUrl}" alt="Goofish" style="width:26px;height:26px;border-radius:6px;object-fit:contain;">`;
    else toggle.textContent = '🐟';
    const panel = document.createElement('div'); panel.className = 'gh-panel gh-hidden';
    const title = document.createElement('div'); title.className = 'gh-title'; title.innerHTML = `<span>${ui.menuTitle}</span>`;
    const closeBtn = document.createElement('button'); closeBtn.className = 'gh-close'; closeBtn.textContent = '✕'; closeBtn.title = ui.close; title.appendChild(closeBtn);
    panel.appendChild(title);

    // Botão CSSBUY - só em página de produto
    if (isProductPage()) {
      const cssBtn = document.createElement('button'); cssBtn.className = 'gh-btn';
      cssBtn.style.background = '#6CBC2A'; cssBtn.style.color = '#fff'; cssBtn.style.borderColor = '#5aa524';
      cssBtn.innerHTML = `${ui.cssBuy} <span class="hint" style="color:#e8ffe0;">›</span>`;
      cssBtn.title = ui.cssBuyHint; cssBtn.addEventListener('click', openCssBuy);
      panel.appendChild(cssBtn);
      const sep = document.createElement('div'); sep.style.height='1px'; sep.style.background='#ffedd5'; sep.style.margin='4px 0'; panel.appendChild(sep);
    }

    getSearches().forEach(s => {
      const b = document.createElement('button'); b.className = 'gh-btn';
      const iconHtml = s.icon ? `<span class="icon">${s.icon}</span>` : '';
      b.innerHTML = `${iconHtml} ${s.label} <span class="hint">${s.query}</span>`;
      b.title = `Buscar "${s.query}" (${s.label})`; b.addEventListener('click', () => doSearch(s.query)); panel.appendChild(b);
    });
    const row = document.createElement('div'); row.className = 'gh-search-row';
    const input = document.createElement('input'); input.className = 'gh-input'; input.placeholder = ui.searchHint;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(input.value.trim()); });
    const go = document.createElement('button'); go.className = 'gh-go'; go.textContent = ui.go; go.addEventListener('click', () => doSearch(input.value.trim()));
    row.appendChild(input); row.appendChild(go); panel.appendChild(row);
    const foot = document.createElement('div'); foot.className = 'gh-foot';
    { const cur = settings.displayCurrency || 'ALL'; const key = 'foot' + cur; foot.textContent = ui[key] || ui.footALL; }
    panel.appendChild(foot);
    function setExpanded(exp) {
      isExpanded = exp; panel.classList.toggle('gh-hidden', !exp);
      if (exp) { toggle.textContent = '✕'; toggle.innerHTML = '✕'; }
      else { if (logoUrl) toggle.innerHTML = `<img src="${logoUrl}" alt="Goofish" style="width:26px;height:26px;border-radius:6px;object-fit:contain;">`; else toggle.textContent = '🐟'; }
      toggle.title = exp ? ui.toggleClose : ui.toggleOpen; toggle.setAttribute('aria-label', exp ? ui.toggleClose : ui.toggleOpen);
    }
    toggle.addEventListener('click', () => setExpanded(!isExpanded));
    closeBtn.addEventListener('click', () => setExpanded(false));
    wrap.appendChild(panel); wrap.appendChild(toggle);
    shadow.appendChild(style); shadow.appendChild(wrap);
    (document.body || document.documentElement).appendChild(floatingRoot);
    // restaura posição e estado expandido anterior (troca de idioma)
    if (prevTop) { floatingRoot.style.top = prevTop; if (prevTransform) floatingRoot.style.transform = prevTransform; }
    let dragging = false, startY = 0, startTop = 0;
    toggle.addEventListener('mousedown', (e) => { dragging = true; startY = e.clientY; startTop = floatingRoot.getBoundingClientRect().top; e.preventDefault(); });
    window.addEventListener('mousemove', (e) => { if (!dragging) return; const dy = e.clientY - startY; floatingRoot.style.top = `${Math.max(12, Math.min(window.innerHeight - 80, startTop + dy))}px`; floatingRoot.style.transform = 'none'; });
    window.addEventListener('mouseup', () => { if (dragging) { dragging = false; safeSyncSet({ ghTop: floatingRoot.style.top }); } });
    if (!prevTop) {
      safeSyncGet(['ghTop']).then(v => {
        if (v && v.ghTop) {
          const n = parseInt(v.ghTop, 10);
          if (!isNaN(n) && n > 140) { try { chrome.storage.sync.remove('ghTop'); } catch {} return; }
          if (String(v.ghTop).includes('%')) { try { chrome.storage.sync.remove('ghTop'); } catch {} return; }
          floatingRoot.style.top = v.ghTop; floatingRoot.style.transform = 'none';
        }
      }).catch(() => {});
    }
    if (prevExpanded) setExpanded(true);
  }

  function openCssBuy() {
    const url = location.href;
    // extrai id do Goofish: ?id=1076053858509
    let id = null;
    try {
      const u = new URL(url);
      id = u.searchParams.get('id');
      if (!id) {
        const m = url.match(/[?&]id=(\d{6,})/);
        if (m) id = m[1];
      }
    } catch { const m = url.match(/[?&]id=(\d{6,})/); if (m) id = m[1]; }
    try { navigator.clipboard.writeText(url).catch(() => {}); } catch {}
    if (id) {
      const cssUrl = `https://www.cssbuy.com/shop/goodsDetail?type=xianyu&id=${id}&t=${Date.now()}&promotionCode=${CSSBUY_PROMO}`;
      window.open(cssUrl, '_blank', 'noopener');
    } else {
      const cssUrl = `https://www.cssbuy.com/search?keyword=${encodeURIComponent(url)}&promotionCode=${CSSBUY_PROMO}`;
      window.open(cssUrl, '_blank', 'noopener');
    }
  }
  function isProductPage() {
    const u = location.href;
    return /goofish\.com\/(item|detail)/i.test(u) || /[?&]id=\d{6,}/.test(u);
  }
  function injectCssBuyBar() {
    if (ghDisabled) return;
    if (!isProductPage()) return;
    if (document.getElementById('gh-cssbuy-bar')) return;
    const ui = UI_I18N[settings.language] || UI_I18N.pt;
    const bar = document.createElement('div');
    bar.id = 'gh-cssbuy-bar';
    bar.innerHTML = `<a id="gh-cssbuy-btn" href="javascript:void(0)" title="${ui.cssBuyHint}">${ui.cssBuyBar}</a><span style="font-size:10px;opacity:.7;margin-left:6px;">${ui.linkCopied}</span>`;
    const style = document.createElement('style');
    style.textContent = `#gh-cssbuy-bar{position:fixed;right:16px;top:72px;z-index:2147483646;display:flex;align-items:center;gap:4px;background:#6CBC2A;color:#fff;padding:8px 14px;border-radius:999px;box-shadow:0 4px 16px rgba(0,0,0,.2);font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-weight:700;font-size:13px;}#gh-cssbuy-bar a{color:#fff;text-decoration:none;}#gh-cssbuy-bar:hover{filter:brightness(1.05);transform:translateY(-1px);} @media(max-width:900px){#gh-cssbuy-bar{top:auto;bottom:16px;right:12px;}}`;
    (document.head || document.documentElement).appendChild(style);
    (document.body || document.documentElement).appendChild(bar);
    bar.querySelector('#gh-cssbuy-btn').addEventListener('click', openCssBuy);
  }

  function doSearch(query) { if (!query) return; window.location.href = `https://www.goofish.com/search?q=${encodeURIComponent(query)}&spm=a21ybx.search.searchInput.0`; }
  function toggleFloatingMenu(show) {
    if (show) { if (!floatingRoot) buildFloatingMenu(); else floatingRoot.style.display = ''; }
    else if (floatingRoot) floatingRoot.style.display = 'none';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { if (settings.floatingMenu) setTimeout(buildFloatingMenu, 800); setTimeout(injectCssBuyBar, 900); });
  else { setTimeout(() => { if (settings.floatingMenu) buildFloatingMenu(); }, 800); setTimeout(injectCssBuyBar, 900); }
  // SPA: Goofish navega sem reload, re-tenta injetar barra CSSBUY quando URL muda
  let _ghLastHref = location.href;
  setInterval(() => {
    if (ghDisabled) return;
    if (location.href !== _ghLastHref) {
      _ghLastHref = location.href;
      const old = document.getElementById('gh-cssbuy-bar'); if (old) old.remove();
      setTimeout(injectCssBuyBar, 600);
      if (floatingRoot && isProductPage()) setTimeout(buildFloatingMenu, 400);
    }
  }, 800);

  // ---------- Mensagens do popup ----------
  try { chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'GH_DISABLE_ALL') { disableAll(); return; }
    if (ghDisabled) return;
    if (msg.type === 'GH_TOGGLE_LOGIN') { settings.hideLogin = msg.value; if (msg.value) startLoginObserver(); else if (loginObserver) loginObserver.disconnect(); }
    if (msg.type === 'GH_TOGGLE_CONVERT') { settings.autoConvert = msg.value; if (msg.value) startPriceObserver(); else { if (priceObserver) priceObserver.disconnect(); document.querySelectorAll('.gh-convert-badge').forEach(el => el.remove()); } }
    if (msg.type === 'GH_TOGGLE_MENU') { settings.floatingMenu = msg.value; toggleFloatingMenu(msg.value); }
    if (msg.type === 'GH_KILL_MODAL') { forceKillTopModals(); }
    if (msg.type === 'GH_SET_CURRENCY') {
      settings.displayCurrency = msg.value;
      document.querySelectorAll('.gh-convert-badge').forEach(el => el.remove());
      convertedSet.clear();
      if (settings.autoConvert) scanPrices();
      try {
        const shadow = floatingRoot && floatingRoot.shadowRoot;
        const foot = shadow && shadow.querySelector('.gh-foot');
        if (foot) {
          const ui = UI_I18N[settings.language] || UI_I18N.pt;
          const key = 'foot' + settings.displayCurrency;
          foot.textContent = ui[key] || ui.footALL;
        }
      } catch {}
    }
    if (msg.type === 'GH_TOGGLE_TRANSLATE') {
      settings.translateFilters = msg.value;
      if (msg.value) { translateFilters(); startTranslateObserver(); }
      else { stopTranslateObserver(); location.reload(); }
    }
    if (msg.type === 'GH_SET_LANGUAGE') {
      settings.language = msg.value;
      // retraduz filtros e reconstrói menu
      document.querySelectorAll('.gh-convert-badge').forEach(el => el.remove());
      convertedSet.clear();
      if (settings.autoConvert) scanPrices();
      if (settings.translateFilters) { translateFilters(); addShopLevelLabel(); }
      if (floatingRoot) buildFloatingMenu();
      const oldBar2 = document.getElementById('gh-cssbuy-bar'); if (oldBar2) oldBar2.remove();
      setTimeout(injectCssBuyBar, 100);
    }
  }); } catch {}

  // Debug helper exposto: window.ghDebug()
  window.ghDebug = () => {
    console.log('[Goofish Helper] settings', settings, 'rates', rates);
    scanForLoginModals();
    console.log('scan executado, verifique se modal sumiu');
  };
})();
