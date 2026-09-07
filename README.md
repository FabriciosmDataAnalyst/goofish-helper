# 🐟 Goofish Helper

> **Navegue no Goofish (Xianyu) sem barreiras.** Bloqueio de login, conversão CNY → 10 moedas, tradução PT/EN/ES, menu flutuante e integração direta com **CSSBUY** com seu código de afiliado.

![Version](https://img.shields.io/badge/version-1.2.1-orange)
![Manifest](https://img.shields.io/badge/manifest-v3-blue)
![License](https://img.shields.io/badge/license-CC%20BY--NC--SA%204.0-lightgrey)
![Chrome](https://img.shields.io/badge/Chrome-88%2B-green)

---

## ✨ Funcionalidades

| Área | O que faz |
|------|-----------|
| **🔒 Bloqueio de login** | Detecta e remove modais `登录` (inclui modais vazios com iframe lazy), máscara escura e trava de scroll. Polling agressivo 800ms/3s + `ESC` para matar manualmente. |
| **💱 Conversor inline** | Detecta `¥ 288` / `¥ 3.80万` e injeta `≈ R$ 218,56 BRL` (ou `ALL` com USD/EUR/BRL). 1 badge por card, sem duplicar. Cache 12h via `exchangerate.host` / `open.er-api` / `frankfurter`. Home topo (`/`) sem badges para não poluir banners. |
| **🌐 Tradução** | `综合→Geral`, `包邮→Frete grátis`, `卖家信用优秀→Vendedor excelente` (âmbar), `极好→Vendedor ótimo` (azul), `良好→Vendedor bom` (verde), `百分百好评→Avaliação 100%` (roxo), `回复超快→Resposta rápida` (rosa), `累计降价`, `小时前发布` (`10小时前发布` → `10 horas atrás` mantendo número), `天内降价`, `未拆封`, `少许/少量/严重磕碰划痕`, etc. Fallback para pills + re-tradução PT↔EN↔ES sem reload. |
| **🏪 Selos em imagem** | `鱼小铺 L5-L7` (`tps-201-48`) e `Vendedor Certificado` (`tps-162-48` `O1CN01LYPs6n`) e `7天无理由退货` (`tps-216-42` / `228-42` `O1CN01k7P6QR`/`O1CN01IdADAH`) viram texto acima da imagem: `Loja Nível L5`, `Vendedor Certificado`, `Devolução em 7 dias` (traduzido por idioma). |
| **🧭 Menu flutuante** | `Shadow DOM` em `left:16px top:72px`, arrastável (salvo em `chrome.storage.sync:ghTop`), sem scroll (gap 2px, 12 botões). Sem ícones genéricos — só texto. Botão `🛒 CSSBUY` (verde) só em página de produto. |
| **🛒 CSSBUY** | Em produto (`/item?id=...`) injeta barra fixa `🛒 Abrir no CSSBUY` (top:72px) e botão no menu. Abre `https://www.cssbuy.com/shop/goodsDetail?type=xianyu&id={id}&t={ts}&promotionCode=821ce7fb53ba04e7` (seu código sempre) + `clipboard` do link Goofish. Fallback `search?keyword=`. |
| **⚙️ Popup** | Toggles `Ocultar login / Conversão / Menu / Traduzir`, seletores `Idioma (PT/EN/ES)` e `Moeda (ALL/BRL/USD...)`, conversor manual `¥ CNY → 10 moedas`, `↻ Atualizar taxas` e `⛔ Desativar extensão` (kill-switch via `storage` + `management` ou reload). |
| **🚫 Kill-switch** | Botão `⛔ Desativar` remove `gh-floating-root`, `gh-cssbuy-bar`, badges e desconecta observers; `↻ Reativar` limpa flag e recarrega abas. |

---

## 📦 Instalação (desenvolvedor)

1. Baixe ou clone este repositório:
   ```bash
   git clone https://github.com/seu-usuario/goofish-helper.git
   ```
2. Abra `chrome://extensions` → ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** → selecione a pasta `goofish-helper/`.
4. Acesse `https://www.goofish.com` — o helper injeta automaticamente.

> **Atualizar:** após `git pull`, clique em `↻` no card da extensão em `chrome://extensions` e `F5` na aba Goofish.

---

## 🎮 Como usar

* **Login nunca mais:** navegue e o modal some sozinho. Se aparecer, pressione `ESC` ou use `window.ghKill()` no console.
* **Preço:** passe o mouse no badge `≈ R$...` para ver cotação completa `1 CNY = ...` com data.
* **Idioma/moeda:** popup → `Idioma` troca todo o menu e filtros instantaneamente; `Moeda` troca `BRL`/`ALL` nos badges.
* **CSSBUY:** dentro de um produto clique em `🛒 Abrir no CSSBUY` (barra verde no topo direito ou no menu). Seu código `821ce7fb53ba04e7` já vai na URL.
* **Desativar:** popup → `⛔ Desativar extensão`. Para reativar, mesmo botão vira `↻ Reativar` ou ative em `chrome://extensions`.

---

## ⚙️ Configuração

Tudo salvo em `chrome.storage.sync` (sincroniza entre dispositivos):

| Chave | Padrão | Descrição |
|-------|--------|-----------|
| `hideLogin` | `true` | Bloqueia popups |
| `autoConvert` | `true` | Conversão automática |
| `floatingMenu` | `true` | Menu flutuante |
| `displayCurrency` | `ALL` | `ALL` ou `BRL/USD/EUR...` |
| `translateFilters` | `true` | Traduz filtros/selos |
| `language` | `pt` | `pt/en/es` |
| `ghTop` | `72px` | Posição vertical arrastada |
| `extensionDisabled` | `false` | Kill-switch |

Taxas em `chrome.storage.local[gh_rates]` com `timestamp` e `source`, refresh `alarms` a cada 12h.

---

## 🗂️ Estrutura

```
goofish-helper/
├── manifest.json      # MV3, permissions storage/alarms/management, host_permissions goofish/taobao + exchangerate APIs
├── background.js      # Service Worker: fetchRates() 3 URLs, fallback, GH_GET_RATES / GH_FORCE_REFRESH / GH_SEARCH
├── content.js         # IIFE principal: bloqueio login, scanPrices, translateFilters, addShopLevelLabel, floating menu, CSSBUY, kill-switch
├── content.css        # #gh-floating-root (fixed 72px) + .gh-convert-badge
├── popup.html         # Header com logo 闲鱼 (icons/icon48.png), controles, conversor, desativar
├── popup.js           # I18N, toggles, GH_SET_LANGUAGE / GH_SET_CURRENCY, disable
├── popup.css          # Cards, toggles, converter
└── icons/
    ├── icon16.png     # 16×16  (logo 闲鱼 96×96 redimensionado)
    ├── icon48.png     # 48×48
    ├── icon128.png    # 128×128
    └── logo-goofish.png
```

---

## 🛠️ Desenvolvimento

```bash
# validar sintaxe
node --check content.js
node --check popup.js
node --check background.js

# recarregar
# chrome://extensions → ↻
```

* **Content script:** `run_at: document_start`, `all_frames: true`, `Shadow DOM` para isolamento, `MutationObserver` + polling para SPA do Goofish.
* **Tradução:** `FILTER_MAPS[pt/en/es]` + `reverseMap` para re-traduzir sem reload + fallback em `span/div` folhas para pills.
* **Conversão:** `extractCny()` suporta `¥ 48.50`, `¥ 3.80万`, `49元`; `convertedSet:WeakSet` + `productCard` dedup.

---

## 🔗 CSSBUY Afiliado

Seu código `821ce7fb53ba04e7` é injetado em toda abertura:

```
https://www.cssbuy.com/shop/goodsDetail?type=xianyu&id={GOOFISH_ID}&t={Date.now()}&promotionCode=821ce7fb53ba04e7
```

Cashback cai automaticamente quando o item é comprado via seu link.

---

## 📄 Licença

**CC BY-NC-SA 4.0** — Uso não comercial, compartilhe igual com atribuição. Proibida venda.

Fork original por **Slet**, mantido por **Daudas** / **SantannaCarlos** — este helper expande com tradução, conversão 10 moedas, CSSBUY e kill-switch.

---

## 🙏 Créditos

* Logo `闲鱼` © Alibaba / Goofish
* Taxas via `exchangerate.host`, `open.er-api.com`, `frankfurter.app`
* Ícones removidos genéricos (📱 repetidos) — agora só texto limpo

> Dúvidas? Abra uma issue. PRs bem-vindos!
