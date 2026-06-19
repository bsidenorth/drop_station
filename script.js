    let audioCtx = null;
    const fixedSessionCode = "#" + Math.floor(1000 + Math.random() * 9000);
    
    let currentLang = 'PT';
    let authMode = 'login';
    let isBgmPlaying = false;
    let bgmInterval = null;

    let currentUser = { 
        loggedIn: false, username: "ANON_PLAYER", bumps: 100, code: fixedSessionCode,
        bio: "Explorador da rede Drop Station.", avatar: "https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg", banner: "",
        followers: 12, following: 4, followedByMe: false
    };

    // =========================================================
    // REGISTRY CENTRALIZADO DE UTILIZADORES (persistência GitHub)
    // =========================================================
    const REGISTRY_KEY = 'drop_station_users';
    const SEED_USERS = [
        { username:"@cyber_k1ng",    password:"123", bumps:150, code:"#9901", bio:"Lenda antiga da rede.",  avatar:"https://i.ibb.co/m56c5F2Z/ced5acf2-417d-4669-b964-96437ab91fda.jpg", banner:"", savedAssets:[] },
        { username:"@neon_samurai",  password:"123", bumps:300, code:"#4421", bio:"Luzes e glitch.",        avatar:"https://i.ibb.co/S7JbrXX2/fa809178-22dc-4ec1-8d84-2dcea9ab44b7.jpg", banner:"", savedAssets:[] }
    ];

    function loadRegistry() {
        try { return JSON.parse(localStorage.getItem(REGISTRY_KEY)) || {}; } catch(e) { return {}; }
    }
    function saveRegistry(reg) {
        try { localStorage.setItem(REGISTRY_KEY, JSON.stringify(reg)); } catch(e) {}
    }
    function registryGet(username) {
        // Lê do registry centralizado (fonte de verdade)
        const reg = loadRegistry();
        return reg[username] || null;
    }
    function registrySet(username, data) {
        const reg = loadRegistry();
        reg[username] = data;
        saveRegistry(reg);
        // Mantém compatibilidade com código legado que usa `user_${username}`
        try { localStorage.setItem(`user_${username}`, JSON.stringify(data)); } catch(e) {}
    }

    // Inicialização: semeia utilizadores padrão se o registry ainda não existir
    (function initRegistry() {
        const reg = loadRegistry();
        let changed = false;
        SEED_USERS.forEach(u => {
            if (!reg[u.username]) {
                reg[u.username] = u;
                // Retrocompatibilidade com chave individual
                try { localStorage.setItem(`user_${u.username}`, JSON.stringify(u)); } catch(e) {}
                changed = true;
            }
        });
        if (changed) saveRegistry(reg);
    })();


    // =========================================================
    // PERSISTÊNCIA DO MERCADO (dr0p_market) — Ponto 1
    // =========================================================
    const MARKET_KEY  = 'dr0p_market';
    const NOTIF_KEY   = 'dr0p_notifications';
    const LEDGER_KEY  = 'dr0p_ledger';

    function loadMarket() {
        try { return JSON.parse(localStorage.getItem(MARKET_KEY)) || []; } catch(e) { return []; }
    }
    function saveMarket(arr) {
        try { localStorage.setItem(MARKET_KEY, JSON.stringify(arr)); } catch(e) {}
    }

    // =========================================================
    // SISTEMA DE COTAÇÃO EM TEMPO REAL (MARKET QUOTES ENGINE)
    // =========================================================
    const QUOTES_KEY = 'dr0p_market_quotes';

    // Cotação base de cada raridade (preço de referência em B$)
    const BASE_QUOTES = {
        common:    { base: 10,  label: 'COMUM',    labelEN: 'COMMON'    },
        epic:      { base: 80,  label: 'ÉPICO',    labelEN: 'EPIC'      },
        legendary: { base: 300, label: 'LENDÁRIO', labelEN: 'LEGENDARY' }
    };

    // Limites de variação pra cotação não explodir nem zerar
    const QUOTE_FLOOR_MULT = 0.35; // nunca cai abaixo de 35% do valor base
    const QUOTE_CEIL_MULT  = 3.0;  // nunca sobe acima de 300% do valor base

    function loadMarketQuotes() {
        try {
            const saved = JSON.parse(localStorage.getItem(QUOTES_KEY));
            if (saved && saved.common && saved.epic && saved.legendary) return saved;
        } catch(e) {}
        // Estado inicial: todas no preço base, sem variação
        return {
            common:    { price: BASE_QUOTES.common.base,    change: 0, trend: 'up' },
            epic:      { price: BASE_QUOTES.epic.base,      change: 0, trend: 'up' },
            legendary: { price: BASE_QUOTES.legendary.base, change: 0, trend: 'up' }
        };
    }

    function saveMarketQuotes(quotes) {
        try { localStorage.setItem(QUOTES_KEY, JSON.stringify(quotes)); } catch(e) {}
    }

    let marketQuotes = loadMarketQuotes();

    /**
     * updateMarketQuotes(droppedRarity)
     * Disparada toda vez que um drop acontece na máquina.
     * Regra econômica:
     *  - Drop ÉPICO ou LENDÁRIO  -> cotação DAQUELA categoria CAI (inflação por excesso de oferta).
     *  - Drop COMUM              -> cotação das categorias mais altas (ÉPICO e LENDÁRIO) SOBE (escassez relativa).
     */
    function updateMarketQuotes(droppedRarity) {
        const q = marketQuotes;

        // Variação aleatória entre 2% e 9% por evento, pra ficar orgânico
        const rollPct = () => 0.02 + Math.random() * 0.07;

        function applyMove(key, direction) {
            const base = BASE_QUOTES[key].base;
            const pct = rollPct() * direction; // direction: +1 sobe, -1 cai
            let newPrice = q[key].price * (1 + pct);

            // Trava dentro do piso/teto relativos ao valor base
            const floor = base * QUOTE_FLOOR_MULT;
            const ceil  = base * QUOTE_CEIL_MULT;
            newPrice = Math.max(floor, Math.min(ceil, newPrice));

            const changePct = ((newPrice - q[key].price) / q[key].price) * 100;
            q[key].change = changePct;
            q[key].trend  = newPrice >= q[key].price ? 'up' : 'down';
            q[key].price  = Math.round(newPrice * 100) / 100;
        }

        if (droppedRarity === 'epic') {
            // Excesso de épicos no mercado -> ÉPICO desvaloriza
            applyMove('epic', -1);
        } else if (droppedRarity === 'legendary') {
            // Excesso de lendários no mercado -> LENDÁRIO desvaloriza
            applyMove('legendary', -1);
        } else {
            // Drop comum -> escassez relativa de raros -> ÉPICO e LENDÁRIO valorizam
            applyMove('epic', 1);
            applyMove('legendary', 1);
            // Comum tem leve queda por excesso de oferta da própria categoria
            applyMove('common', -1);
        }

        saveMarketQuotes(q);
        renderQuotesTicker();
        return q;
    }

    /**
     * Renderiza o ticker (HTML) APENAS no ponto Global fixo (header).
     * Os tickers da Landing e do Mercado foram removidos por pedido do usuário.
     */
    function renderQuotesTicker() {
        const tracks = [
            document.getElementById('tickerGlobalTrack')
        ].filter(Boolean);
        if (tracks.length === 0) return;

        const order = ['common', 'epic', 'legendary'];
        const isPT = currentLang === 'PT';

        const itemsHtml = order.map(key => {
            const data  = marketQuotes[key];
            const meta  = BASE_QUOTES[key];
            const label = isPT ? meta.label : meta.labelEN;
            const cls   = `tk-${key}`;
            const dirCls = data.trend === 'up' ? 'up' : 'down';
            const arrow  = data.trend === 'up' ? '▲' : '▼';
            const changeAbs = Math.abs(data.change).toFixed(2);
            return `
                <div class="ticker-item">
                    <span class="ticker-label ${cls}">${label}</span>
                    <span class="ticker-price">${data.price.toFixed(2)} B$</span>
                    <span class="ticker-change ${dirCls}"><span class="ticker-arrow">${arrow}</span>${changeAbs}%</span>
                </div>`;
        }).join('');

        // Duplica a sequência para o loop ficar contínuo (CSS anima até -50%)
        const fullHtml = itemsHtml + itemsHtml;
        tracks.forEach(track => track.innerHTML = fullHtml);
    }

    // =========================================================
    // LEDGER DE TRANSAÇÕES GLOBAIS (Ponto 4)
    // =========================================================
    function loadLedger() {
        try { return JSON.parse(localStorage.getItem(LEDGER_KEY)) || []; } catch(e) { return []; }
    }
    function pushLedger(entry) {
        try {
            const ledger = loadLedger();
            ledger.unshift({ text: entry, ts: new Date().toLocaleTimeString('pt-PT') });
            if (ledger.length > 50) ledger.length = 50;
            localStorage.setItem(LEDGER_KEY, JSON.stringify(ledger));
        } catch(e) {}
    }
    function renderMarketLedger() {
        const box  = document.getElementById('marketLedgerBox');
        const list = document.getElementById('marketLedgerList');
        if (!box || !list) return;
        const ledger = loadLedger();
        if (ledger.length === 0) { box.style.display = 'none'; return; }
        box.style.display = 'block';
        const last5 = ledger.slice(0, 5);
        list.innerHTML = last5.map((e, i) =>
            `<div class="ledger-entry" style="animation-delay:${i * 0.12}s; padding:3px 0; border-bottom:1px solid #111; color:#aaa;">
                <span style="color:#ffaa00;">[${e.ts}]</span> ${e.text}
             </div>`
        ).join('');
        startLedgerAutoScroll(list);
    }

    // Faz o feed "respirar": rola suavemente para o próximo item a cada
    // poucos segundos, dando sensação de movimento contínuo e dinâmico.
    let ledgerAutoScrollTimer = null;
    function startLedgerAutoScroll(list) {
        if (ledgerAutoScrollTimer) clearInterval(ledgerAutoScrollTimer);
        const entries = list.querySelectorAll('.ledger-entry');
        if (entries.length <= 1) return;
        let idx = 0;
        ledgerAutoScrollTimer = setInterval(() => {
            idx = (idx + 1) % entries.length;
            entries[idx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 2600);
    }

    // Notificações / histórico de transações — Ponto 2
    function loadNotifications(username) {
        try {
            const all = JSON.parse(localStorage.getItem(NOTIF_KEY)) || {};
            return all[username] || [];
        } catch(e) { return []; }
    }
    function pushNotification(username, text) {
        try {
            const all = JSON.parse(localStorage.getItem(NOTIF_KEY)) || {};
            if (!all[username]) all[username] = [];
            all[username].unshift({ text, date: new Date().toLocaleString('pt-PT') });
            if (all[username].length > 50) all[username].length = 50; // limite
            localStorage.setItem(NOTIF_KEY, JSON.stringify(all));
        } catch(e) {}
    }

    // Alerta cyberpunk — Ponto 2
    function showCyberAlert(title, msg, type) {
        // type: 'success' | 'error' | 'warn'
        const overlay = document.getElementById('cyberAlertOverlay');
        const box     = document.getElementById('cyberAlertBox');
        const tEl     = document.getElementById('cyberAlertTitle');
        const mEl     = document.getElementById('cyberAlertMsg');
        box.className = 'cyber-alert-box' + (type === 'error' ? ' alert-error' : type === 'warn' ? ' alert-warn' : '');
        tEl.innerText = title;
        mEl.innerHTML = msg;
        overlay.classList.add('visible');
    }
    function closeCyberAlert() {
        document.getElementById('cyberAlertOverlay').classList.remove('visible');
    }

    // =========================================================
    // ESTADO DE FILTROS E PAGINAÇÃO — Ponto 3
    // =========================================================
    const PAGE_SIZE = 9;
    let vaultFilter  = 'all'; let vaultPage  = 0;
    let marketFilter = 'all'; let marketPage = 0;

    function setVaultFilter(f) {
        vaultFilter = f; vaultPage = 0;
        document.querySelectorAll('#vaultFilterBar .filter-btn').forEach(b => {
            b.className = 'filter-btn' + (b.dataset.filter === f ? (f==='epic'?' active-epic':f==='legendary'?' active-legendary':' active') : '');
        });
        renderVaultGrid();
    }
    function setMarketFilter(f) {
        marketFilter = f; marketPage = 0;
        document.querySelectorAll('#marketFilterBar .filter-btn').forEach(b => {
            b.className = 'filter-btn' + (b.dataset.filter === f ? (f==='epic'?' active-epic':f==='legendary'?' active-legendary':' active') : '');
        });
        renderMarketGrid();
    }

    function renderPagination(containerId, totalItems, currentPage, onPageFn) {
        const bar = document.getElementById(containerId); if(!bar) return;
        bar.innerHTML = '';
        const totalPages = Math.ceil(totalItems / PAGE_SIZE);
        if (totalPages <= 1) return;
        for (let i = 0; i < totalPages; i++) {
            const btn = document.createElement('button');
            btn.className = 'page-btn' + (i === currentPage ? ' active-page' : '');
            btn.innerText = i + 1;
            btn.onclick = () => onPageFn(i);
            bar.appendChild(btn);
        }
        const info = document.createElement('span');
        info.className = 'page-info';
        info.innerText = `${currentPage+1} / ${totalPages}`;
        bar.appendChild(info);
    }

    // =========================================================
    // DADOS INICIAIS
    // =========================================================
    let selectedProfileUser = null;
    let savedAssets = [];
    let messageThreads = {};
    let activeThreadUser = null;

    const SEED_FEED = [
        { id: "#449201", rarityType: "legendary", rarityName: "LENDÁRIO", rarityNameEN: "LEGENDARY", styleName: "MATRIX GLITCH", styleNameEN: "MATRIX GLITCH", creator: "@cyber_k1ng", registered: true, exposed: true, forSale: true, price: 150, imgSrc: "https://i.ibb.co/m56c5F2Z/ced5acf2-417d-4669-b964-96437ab91fda.jpg" },
        { id: "#110293", rarityType: "epic",      rarityName: "ÉPICO",    rarityNameEN: "EPIC",      styleName: "ACID NEON",    styleNameEN: "ACID NEON",    creator: "@neon_samurai", registered: true, exposed: true, forSale: false, price: 0, imgSrc: "https://i.ibb.co/S7JbrXX2/fa809178-22dc-4ec1-8d84-2dcea9ab44b7.jpg" }
    ];

    let globalFeed = [...SEED_FEED];

    // Carrega mercado persistido; se vazio, semeia com o item do feed de exemplo
    let marketAssets = loadMarket();
    if (marketAssets.length === 0) {
        marketAssets = [SEED_FEED[0]];
        saveMarket(marketAssets);
    }

    // Garante que items do mercado também aparecem no globalFeed (sem duplicar por ID)
    marketAssets.forEach(m => {
        if (!globalFeed.find(f => f.id === m.id)) globalFeed.unshift(m);
    });

    const canvas = document.getElementById('pfp-canvas'); 
    const ctx = canvas ? canvas.getContext('2d') : null;
    const targetContainer = document.getElementById('target-container');
    const downloadBtn = document.getElementById('download-btn');
    const stabilityWrapper = document.getElementById('stability-wrapper');
    const stabilityLabel = document.getElementById('stability-label');
    const stabilityBar = document.getElementById('stability-bar');
    const metaId = document.getElementById('meta-id'); 
    const metaRarity = document.getElementById('meta-rarity');
    const metaStyle = document.getElementById('meta-style'); 
    const metaOwner = document.getElementById('meta-owner');

    const animePool = [
        "https://i.ibb.co/m56c5F2Z/ced5acf2-417d-4669-b964-96437ab91fda.jpg",
        "https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg",
        "https://i.ibb.co/S7JbrXX2/fa809178-22dc-4ec1-8d84-2dcea9ab44b7.jpg",
        "https://i.ibb.co/pBy1Rmyq/sylvanian-pfp.jpg",
        "https://i.ibb.co/9m50LNJT/db05209d-fd04-4353-a033-d21349f7d98c.jpg",
        "https://i.ibb.co/LdxbZdpR/91e7283f-2f12-4701-8de0-0798caa5e42e.jpg",
        "https://i.ibb.co/HfrS8TJh/Screenshot-20260616-213009-Chrome.jpg",
        "https://i.ibb.co/C3Hp4Cvs/image.jpg",
        "https://i.ibb.co/ycRhQk8v/image.jpg",
        "https://i.ibb.co/N28DPq35/Scearm.jpg",
        "https://i.ibb.co/rGr2fJnT/Pinterest.jpg"
    ];
    const preloadedCanvases = [];
    let lastMintedBuffer = null; let activeAssetData = null; let decayInterval = null; let isRolling = false;
    let isProcessingClaim = false; // Mutex global: impede duplicação e debito duplo de Bumps

    const dictionary = {
        PT: {
            'nav-market': 'MERCADO P2P', 'nav-inbox': 'INBOX SECRETO', 'nav-vault': 'MEU COFRE', 'nav-access': 'ACESSAR TERMINAL',
            'feed-title': 'MUTAÇÕES_REDE', 'lbl-rarity': 'RARIDADE', 'lbl-style': 'ESTILO VISUAL', 'lbl-creator': 'AUTOR DA MINTAGEM',
            'vault-title': 'MEU COFRE', 'market-title': 'MERCADO P2P DIRECT', 'messages-title': 'INBOX // DIALOGOS_CRIPTOGRAFADOS', 'profile-showcase': 'VITRINE EXPOSTA',
            'lbl-id': 'CÓDIGO ID CARD', 'free-sub': 'RISCO DE QUEBRA // FLUXO INESTÁVEL', 'premium-sub': '100% SEGURO // GARANTIA DE COMPILAÇÃO',
            'faq-title': '> TERMINAL_INFO // PERGUNTAS_FREQUENTES',
            'faq-q1': '[+] O que é o Drop Station?',
            'faq-a1': '▸ Plataforma P2P de cards digitais gerados por IA. Cada card é único, rastreado no registry e negociável em B$ (Bumps).',
            'faq-q2': '[+] O que são Bumps (B$)?',
            'faq-a2': '▸ Moeda interna da rede. Usada para resgatar cards épicos/lendários, comprar no mercado P2P e propor trocas. Carregue via PIX ou cripto.',
            'faq-q3': '[+] O que acontece se não resgatar a tempo?',
            'faq-a3': '▸ A mutação se autodestrói em 10 segundos por instabilidade de rede. O card é removido do feed global permanentemente.',
            'faq-q4': '[+] Como funciona a Alquimia?',
            'faq-a4': '▸ Funde 2 cards do seu cofre para criar um novo. Os originais são destruídos. Raridade resultante depende dos cards usados + roll de probabilidade.',
            'faq-q5': '[+] Quem pode ver meu perfil e cards?',
            'faq-a5': '▸ Perfis públicos são visíveis a todos. Cards expostos na vitrine aparecem no feed. O mercado é público mas compras exigem login.',
            'log-prefix': 'LOG // ', 'download-btn': 'RESGATAR ATIVO',
            'stability-label': 'TEMPO DE RESGATE: 10s',
            'market-landing-sub': 'VISUALIZAÇÃO PÚBLICA — LOGIN NECESSÁRIO PARA COMPRAR'
        },
        EN: {
            'nav-market': 'P2P MARKET', 'nav-inbox': 'SECRET INBOX', 'nav-vault': 'MY VAULT', 'nav-access': 'ACCESS TERMINAL',
            'feed-title': 'NETWORK_MUTATIONS', 'lbl-rarity': 'RARITY', 'lbl-style': 'VISUAL STYLE', 'lbl-creator': 'MINT AUTHOR',
            'vault-title': 'MY SECURE VAULT', 'market-title': 'P2P MARKET DIRECT', 'messages-title': 'INBOX // ENCRYPTED_CHATS', 'profile-showcase': 'EXPOSED SHOWCASE',
            'lbl-id': 'CARD ID CODE', 'free-sub': 'RISK OF SHATTER // UNSTABLE FLOW', 'premium-sub': '100% SECURE // COMPILATION WARRANTY',
            'faq-title': '> TERMINAL_INFO // FREQUENTLY ASKED',
            'faq-q1': '[+] What is Drop Station?',
            'faq-a1': '▸ P2P platform for AI-generated digital cards. Each card is unique, tracked in the registry and tradeable in B$ (Bumps).',
            'faq-q2': '[+] What are Bumps (B$)?',
            'faq-a2': '▸ Internal network currency. Used to claim epic/legendary cards, buy on P2P market and propose trades. Load via PIX or crypto.',
            'faq-q3': '[+] What happens if I don\'t claim in time?',
            'faq-a3': '▸ The mutation self-destructs in 10 seconds due to network instability. The card is permanently removed from the global feed.',
            'faq-q4': '[+] How does Alchemy work?',
            'faq-a4': '▸ Fuse 2 cards from your vault to create a new one. Originals are destroyed. Resulting rarity depends on input cards + probability roll.',
            'faq-q5': '[+] Who can see my profile and cards?',
            'faq-a5': '▸ Public profiles visible to all. Cards exposed in showcase appear in feed. Market is public but purchases require login.',
            'log-prefix': 'LOG // ', 'download-btn': 'CLAIM ASSET',
            'stability-label': 'CLAIM TIME LEFT: 10s',
            'market-landing-sub': 'PUBLIC VIEW — LOGIN REQUIRED TO PURCHASE'
        }
    };

    const CYBER_VOICES = {
        PT: [
            "Acesso concedido.", "Brecha de dados detectada.", "Drop Station online.", "Mutação instável.",
            "Ativo integrado ao cofre.", "Protocolo de fusão iniciado.", "Rede segura estabelecida.",
            "Identidade verificada.", "Transmissão criptografada.", "Alerta de rede ativado.",
            "Compra confirmada.", "Card lendário detectado.", "Terminal ativado. Bem-vindo, operador."
        ],
        EN: [
            "Access granted.", "Data breach detected.", "Drop Station online.", "Mutation unstable.",
            "Asset secured in vault.", "Fusion protocol initiated.", "Secure channel established.",
            "Identity verified.", "Encrypted transmission.", "Network alert activated.",
            "Purchase confirmed.", "Legendary card detected.", "Terminal activated. Welcome, operator."
        ]
    };

    function speakPhrase(phrasePT, phraseEN) {
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const text = currentLang === 'PT' ? phrasePT : phraseEN;
        const u = new SpeechSynthesisUtterance(text);
        u.lang = currentLang === 'PT' ? 'pt-BR' : 'en-US';
        u.rate = 1.1; u.pitch = 0.8; u.volume = 0.9;
        window.speechSynthesis.speak(u);
    }

    function speakRandom() {
        if (!('speechSynthesis' in window)) return;
        window.speechSynthesis.cancel();
        const pool = CYBER_VOICES[currentLang];
        const text = pool[Math.floor(Math.random() * pool.length)];
        const u = new SpeechSynthesisUtterance(text);
        u.lang = currentLang === 'PT' ? 'pt-BR' : 'en-US';
        u.rate = 1.0; u.pitch = 0.75; u.volume = 0.9;
        window.speechSynthesis.speak(u);
    }

    // =========================================================
    // SISTEMA CENTRAL DE ÁUDIO E VOZ SINTETIZADA (Ponto 3)
    // =========================================================
    function playTerminalSound(type) {
        // type: 'login' | 'error' | 'claim' | 'alchemy'
        try { initAudio(); } catch(e) {}

        const beep = (freq, oscType, dur, gain) => {
            try {
                initAudio();
                const osc = audioCtx.createOscillator();
                const g   = audioCtx.createGain();
                osc.type = oscType || 'square';
                osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
                g.gain.setValueAtTime(gain || 0.12, audioCtx.currentTime);
                g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
                osc.connect(g); g.connect(audioCtx.destination);
                osc.start(); osc.stop(audioCtx.currentTime + dur);
            } catch(e) {}
        };

        if (type === 'login') {
            beep(440, 'sine', 0.1, 0.12);
            setTimeout(() => beep(880, 'sine', 0.18, 0.1), 120);
            setTimeout(() => speakPhrase("Terminal ativado. Bem-vindo, operador.", "Terminal activated. Welcome, operator."), 300);

        } else if (type === 'error') {
            beep(300, 'sawtooth', 0.3, 0.2);
            setTimeout(() => beep(180, 'sawtooth', 0.3, 0.18), 180);
            setTimeout(() => speakPhrase("Acesso negado. Bumps insuficientes.", "Access denied. Insufficient Bumps."), 300);

        } else if (type === 'claim') {
            beep(523, 'triangle', 0.25, 0.15);
            setTimeout(() => beep(659, 'triangle', 0.25, 0.12), 100);
            setTimeout(() => beep(784, 'triangle', 0.35, 0.1), 200);
            setTimeout(() => speakPhrase("Ativo integrado ao cofre.", "Asset secured in vault."), 400);

        } else if (type === 'alchemy') {
            beep(200, 'sawtooth', 0.15, 0.15);
            setTimeout(() => beep(400, 'square', 0.15, 0.12), 150);
            setTimeout(() => beep(800, 'sine', 0.15, 0.1), 300);
            setTimeout(() => beep(1200, 'sine', 0.3, 0.12), 450);
            setTimeout(() => speakPhrase("Protocolo de fusão concluído. Nova entidade gerada.", "Fusion protocol complete. New entity generated."), 700);
        }
    }

    function toggleLanguage() {
        currentLang = currentLang === 'PT' ? 'EN' : 'PT';
        document.getElementById('langLabel').innerText = currentLang;
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (dictionary[currentLang][key]) el.innerText = dictionary[currentLang][key];
        });
        if (!activeAssetData && !isRolling) {
            document.getElementById('status-text').innerText = currentLang === 'PT' ? 'AGUARDANDO_MUTACAO...' : 'AWAITING_MUTATION...';
        } else if (activeAssetData) {
            metaRarity.innerText = currentLang === 'PT' ? activeAssetData.rarityName : activeAssetData.rarityNameEN;
            metaStyle.innerText  = currentLang === 'PT' ? activeAssetData.styleName  : activeAssetData.styleNameEN;
            if (downloadBtn.style.display === "block") {
                downloadBtn.innerText = activeAssetData.costToClaim > 0 ?
                    (currentLang === 'PT' ? `RESGATAR (CUSTO: 50 B$)` : `CLAIM (COST: 50 B$)`) :
                    (currentLang === 'PT' ? "ENVIAR AO COFRE VIRTUAL" : "SEND TO SECURE VAULT");
            }
        }
        speakRandom();
        renderQuotesTicker();
    }

    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    function playSynthSound(type) {
        try {
            initAudio();
            const osc = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            osc.connect(gainNode); gainNode.connect(audioCtx.destination);

            if (type === 'click') {
                osc.type = 'sine'; osc.frequency.setValueAtTime(800, audioCtx.currentTime);
                gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
                osc.start(); osc.stop(audioCtx.currentTime + 0.05);
            } else if (type === 'success') {
                let now = audioCtx.currentTime;
                osc.type = 'triangle'; osc.frequency.setValueAtTime(523.25, now);
                osc.frequency.exponentialRampToValueAtTime(1046.50, now + 0.15);
                gainNode.gain.setValueAtTime(0.15, now);
                gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
                osc.start(); osc.stop(now + 0.3);

                setTimeout(() => {
                    let osc2 = audioCtx.createOscillator(); let gain2 = audioCtx.createGain();
                    osc2.type = 'sine'; osc2.frequency.setValueAtTime(1318.51, audioCtx.currentTime);
                    osc2.connect(gain2); gain2.connect(audioCtx.destination);
                    gain2.gain.setValueAtTime(0.1, audioCtx.currentTime);
                    gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
                    osc2.start(); osc2.stop(audioCtx.currentTime + 0.2);
                }, 80);
            } else if (type === 'tick') {
                osc.type = 'square'; osc.frequency.setValueAtTime(1400, audioCtx.currentTime);
                gainNode.gain.setValueAtTime(0.04, audioCtx.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.02);
                osc.start(); osc.stop(audioCtx.currentTime + 0.02);
            } else if (type === 'shatter') {
                let now = audioCtx.currentTime;
                osc.type = 'sawtooth'; osc.frequency.setValueAtTime(280, now);
                osc.frequency.linearRampToValueAtTime(40, now + 0.4);
                gainNode.gain.setValueAtTime(0.25, now);
                gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
                osc.start(); osc.stop(now + 0.45);
            } else if (type === 'roll') {
                osc.type = 'sine'; osc.frequency.setValueAtTime(440, audioCtx.currentTime);
                osc.frequency.linearRampToValueAtTime(880, audioCtx.currentTime + 0.12);
                gainNode.gain.setValueAtTime(0.06, audioCtx.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
                osc.start(); osc.stop(audioCtx.currentTime + 0.12);
            }
        } catch(e) {}
    }

    function toggleBackgroundAudio() {
        initAudio();
        const btn = document.getElementById('audioToggleBtn');
        if (isBgmPlaying) {
            clearInterval(bgmInterval); isBgmPlaying = false;
            btn.classList.remove('on');
        } else {
            isBgmPlaying = true;
            btn.classList.add('on');
            let beatIndex = 0;
            const bass = [55.00, 55.00, 48.99, 48.99, 65.41, 65.41, 58.27, 58.27];
            bgmInterval = setInterval(() => {
                try {
                    let osc = audioCtx.createOscillator(); let gain = audioCtx.createGain();
                    let filter = audioCtx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.setValueAtTime(300, audioCtx.currentTime);
                    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(bass[beatIndex % bass.length], audioCtx.currentTime);
                    osc.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination);
                    gain.gain.setValueAtTime(0.15, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.22);
                    osc.start(); osc.stop(audioCtx.currentTime + 0.25); beatIndex++;
                } catch(e) {}
            }, 250);
        }
    }

    animePool.forEach(url => {
        const img = new Image(); img.crossOrigin = "anonymous"; img.src = url;
        img.onload = () => {
            const off = document.createElement('canvas'); off.width = 600; off.height = 600;
            off.getContext('2d').drawImage(img, 0, 0, 600, 600); preloadedCanvases.push(off);
        };
    });

    function resizeCanvases() {
        if(!canvas) return;
        const size = targetContainer.getBoundingClientRect().width || 400;
        canvas.width = size; canvas.height = size;
    }
    window.addEventListener('resize', resizeCanvases); setTimeout(resizeCanvases, 150);

    function toggleFaq(el) {
        const ans = el.nextElementSibling;
        ans.style.display = (ans.style.display === 'block') ? 'none' : 'block';
    }

    function navigateTo(screenId) {
        playSynthSound('click');

        // Limpa estado anterior do drop ao sair do engine, evitando botão travado/duplicação
        if (screenId !== 'engine') {
            downloadBtn.disabled = false;
            // Não destruímos activeAssetData aqui para não perder o card no free roll
            // mas garantimos que o botão não fica disabled ao regressar
        } else {
            // Ao regressar ao engine, re-habilita o botão se houver card ativo
            downloadBtn.disabled = false;
        }

        document.querySelectorAll('.spa-screen').forEach(s => s.classList.remove('active'));
        const t = document.getElementById(`screen-${screenId}`);
        if(t) t.classList.add('active');
        if (screenId === 'engine') { setTimeout(resizeCanvases, 50); }
        if (screenId === 'vault') renderVaultGrid();
        if (screenId === 'market') { renderMarketGrid(); renderMarketLedger(); }
        if (screenId === 'messages') renderChatThreads();
        if (screenId === 'profile') viewTargetUserCollection(currentUser.username, currentUser.code, currentUser.bio, currentUser.avatar, currentUser.banner, true);
    }

    function handleProfileNavClick() {
        if(currentUser.loggedIn) navigateTo('profile'); else navigateTo('auth');
    }

    function logoutSession() {
        currentUser.loggedIn = false; currentUser.username = "ANON_PLAYER";
        // Limpa o estado de chat/propostas em memória — sem isso, a próxima
        // conta logada no mesmo navegador herdava as threads da conta anterior.
        messageThreads = {};
        activeThreadUser = null;
        // BUGFIX CRÍTICO: savedAssets não era resetado no logout. Isso fazia
        // checkIncomingGifts() comparar o cofre do usuário anterior com o do
        // novo, interpretando os cards já existentes do novo usuário como
        // "presentes recebidos" e disparando alertas/TTS sem nenhuma doação real.
        savedAssets = [];
        document.getElementById('nav-btn-text').innerText = "ACESSAR TERMINAL";
        document.getElementById('navVaultBtn').style.display = 'none';
        document.getElementById('navMessagesBtn').style.display = 'none';
        document.getElementById('navLogoutBtn').style.display = 'none';
        // navMarketBtn NÃO é escondido: visitantes deslogados podem navegar
        // e visualizar o mercado/perfis, só não podem comprar/interagir.
        navigateTo('engine');
    }

    function switchAuthMode(mode) {
        authMode = mode;
        document.getElementById('authErrorMsg').style.display = 'none';
        if(mode === 'login') {
            document.getElementById('tab-login').classList.add('active'); document.getElementById('tab-register').classList.remove('active');
            document.getElementById('authTitle').innerText = "SINCRO_CONTA"; document.getElementById('authSubmitBtn').innerText = "Acessar Sistema";
        } else {
            document.getElementById('tab-login').classList.remove('active'); document.getElementById('tab-register').classList.add('active');
            document.getElementById('authTitle').innerText = "REGISTRAR_NÓ"; document.getElementById('authSubmitBtn').innerText = "Consolidar Identidade";
        }
    }

    // =========================================================
    // SEGURANÇA: SANITIZAÇÃO E VALIDAÇÃO DE INPUTS
    // =========================================================
    const RESERVED_USERNAMES = ['admin', 'administrator', 'root', 'system', 'bot', 'null', 'undefined', 'moderator', 'support'];

    function sanitizeInput(str) {
        if (typeof str !== 'string') return '';
        return str
            .replace(/[<>"'`&;{}()\[\]\\\/]/g, '') // remove tags HTML e chars perigosos
            .replace(/javascript:/gi, '')
            .replace(/on\w+=/gi, '')
            .trim()
            .slice(0, 64); // limite máximo
    }

    function validateUsername(raw) {
        const clean = sanitizeInput(raw);
        if (!clean || clean.length < 2) return { ok: false, msg: 'Username deve ter pelo menos 2 caracteres.' };
        const lower = clean.toLowerCase().replace(/^@/, '');
        if (RESERVED_USERNAMES.includes(lower)) return { ok: false, msg: 'Username reservado. Escolhe outro alias.' };
        if (!/^@?[a-zA-Z0-9_\-\.]{2,30}$/.test(clean)) return { ok: false, msg: 'Username inválido. Use apenas letras, números, _ ou -' };
        return { ok: true, value: clean.startsWith('@') ? clean : '@' + clean };
    }

    function validatePassword(raw) {
        if (!raw || raw.length < 6) return { ok: false, msg: 'Chave deve ter no mínimo 6 caracteres.' };
        if (raw.length > 128) return { ok: false, msg: 'Chave demasiado longa (máx. 128 chars).' };
        return { ok: true };
    }

    function handleAuthSubmit(event) {
        event.preventDefault();
        const rawUser = document.getElementById('authUsername').value;
        const rawPass = document.getElementById('authPassword').value;
        const errorEl = document.getElementById('authErrorMsg');
        errorEl.style.display = 'none';

        // Validar username
        const userCheck = validateUsername(rawUser);
        if (!userCheck.ok) { errorEl.innerText = userCheck.msg; errorEl.style.display = 'block'; return; }
        const formattedUser = userCheck.value;

        // Validar password
        const passCheck = validatePassword(rawPass);
        if (!passCheck.ok) { errorEl.innerText = passCheck.msg; errorEl.style.display = 'block'; return; }

        if (authMode === 'register') {
            if (registryGet(formattedUser)) {
                errorEl.innerText = "Este terminal alias já está registrado na rede."; errorEl.style.display = 'block'; return;
            }
            const newUserObj = {
                username: formattedUser, password: rawPass, bumps: 100, code: fixedSessionCode,
                bio: "Membro verificado.", avatar: "https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg", banner: "", savedAssets: []
            };
            registrySet(formattedUser, newUserObj);
            showCyberAlert('// NÓ CONSOLIDADO //', 'Registo concluído. Realiza a conexão agora.', 'success');
            switchAuthMode('login'); return;
        }

        const storedUser = registryGet(formattedUser);
        if (!storedUser) { errorEl.innerText = "Nó de rede inexistente."; errorEl.style.display = 'block'; return; }
        if (storedUser.password !== rawPass) { errorEl.innerText = "Assinatura incorreta."; errorEl.style.display = 'block'; return; }

        const reg = loadRegistry();
        const realFollowers = Object.values(reg).filter(u => u.following && u.following.includes && u.following.includes(formattedUser)).length;
        const realFollowing = Array.isArray(storedUser.following) ? storedUser.following.length : 0;

        currentUser = { ...storedUser, loggedIn: true, followers: realFollowers, following: realFollowing, followingList: storedUser.following || [], status: storedUser.status || 'online' };
        // Garante que nenhuma thread/proposta de uma sessão anterior (de outra
        // conta) sobreviva no estado em memória ao entrar com a conta nova.
        messageThreads = {};
        activeThreadUser = null;
        const prevAssets = [...(savedAssets || [])];
        savedAssets = storedUser.savedAssets || [];
        checkIncomingGifts(prevAssets, savedAssets);

        document.getElementById('nav-btn-text').innerText = currentUser.username.toUpperCase();
        document.getElementById('navVaultBtn').style.display = 'flex'; document.getElementById('navMarketBtn').style.display = 'flex';
        document.getElementById('navMessagesBtn').style.display = 'flex'; document.getElementById('navLogoutBtn').style.display = 'flex';

        playTerminalSound('login');
        navigateTo('engine');
    }

    function pauseMarquee() { document.getElementById('storiesContainer').classList.remove('animated'); }
    function resumeMarquee() { document.getElementById('storiesContainer').classList.add('animated'); }

    function masterRenderLoop() {
        if (ctx && canvas) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (isRolling && preloadedCanvases.length > 0) {
                ctx.drawImage(preloadedCanvases[Math.floor(Math.random() * preloadedCanvases.length)], 0, 0, canvas.width, canvas.height);
            } else if (lastMintedBuffer) {
                ctx.drawImage(lastMintedBuffer, 0, 0, canvas.width, canvas.height);
            } else {
                ctx.fillStyle = "#06060c"; ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = "#00ff66"; ctx.font = "bold 14px 'Space Mono'"; ctx.textAlign = "center";
                ctx.fillText("[SISTEMA_PRONTO_PARA_MINTAR]", canvas.width/2, canvas.height/2);
            }
        }
        requestAnimationFrame(masterRenderLoop);
    }
    requestAnimationFrame(masterRenderLoop);

    function executeHardwareRoll(isPremium) {
        if (isRolling) return;
        // PREMIUM_DROP_PASS: bloqueia imediatamente se deslogado
        if (isPremium && !currentUser.loggedIn) {
            alert(currentLang === 'PT' 
                ? "⛔ ACESSO NEGADO: O PREMIUM_DROP_PASS requer autenticação de rede. Faça login para continuar." 
                : "⛔ ACCESS DENIED: PREMIUM_DROP_PASS requires network authentication. Login to proceed.");
            return;
        }
        if (isPremium && currentUser.bumps < 50) { openDepositModal(); return; }
        if (isPremium) currentUser.bumps -= 50;

        isRolling = true; 
        activeAssetData = null;
        downloadBtn.style.display = "none"; 
        clearInterval(decayInterval);
        
        document.getElementById('status-text').innerText = currentLang === 'PT' ? "MINTANDO_DADOS..." : "MINTING_DATA...";
        targetContainer.className = "target-box rolling"; 
        stabilityWrapper.style.display = "block";

        document.getElementById('btnFree').classList.add('disabled');
        document.getElementById('btnPremium').classList.add('disabled');

        const generatedId = "#" + Math.floor(100000 + Math.random() * 900000);
        metaId.innerText = generatedId;

        let tickTimes = 0;
        let tickInterval = setInterval(() => { 
            if(tickTimes < 10) { 
                playSynthSound('roll'); 
                tickTimes++; 
            } 
        }, 100);

        setTimeout(() => {
            clearInterval(tickInterval);
            targetContainer.classList.remove("rolling");
            document.getElementById('btnFree').classList.remove('disabled');
            document.getElementById('btnPremium').classList.remove('disabled');

            if (preloadedCanvases.length === 0) { isRolling = false; return; }
            const sourceBuffer = preloadedCanvases[Math.floor(Math.random() * preloadedCanvases.length)];
            const bakedBuffer = document.createElement('canvas'); bakedBuffer.width = 600; bakedBuffer.height = 600;
            const bCtx = bakedBuffer.getContext('2d');

            let watermarkColor = "#ffffff"; 
            let rarityKey = "common"; 
            let rarityName = "COMUM"; 
            let rarityNameEN = "COMMON";
            let claimCost = 0;
            let filterStyle = "none"; 
            let styleName = "CYBER PUNK";
            let styleNameEN = "CYBER PUNK";

            let randRarity = Math.random();
            if (!isPremium && randRarity < 0.15) { shatterAsset(); isRolling = false; return; }

            const visualStylesPT = ["CHROME DECAY", "GOTHIC APOCALYPSE", "VIRTUAL OVERDRIVE", "ROSE PHANTOM", "RETRO GLITCH", "BINARY DEEP"];
            const visualStylesEN = ["CHROME DECAY", "GOTHIC APOCALYPSE", "VIRTUAL OVERDRIVE", "ROSE PHANTOM", "RETRO GLITCH", "BINARY DEEP"];
            const visualFilters = [
                "contrast(180%) saturate(30%) invert(10%)",
                "grayscale(100%) brightness(120%) contrast(200%)",
                "sepia(80%) hue-rotate(320deg) saturate(300%)",
                "hue-rotate(60deg) saturate(180%) invert(5%)",
                "invert(100%) hue-rotate(180deg)",
                "saturate(400%) contrast(150%)"
            ];
            let styleIndex = Math.floor(Math.random() * visualStylesPT.length);

            // TAXAS EXACTAS: 1% LEGENDARY, 14% EPIC, 85% COMMON
            // randRarity já foi usado para shatter check (free < 0.15 → shatter)
            // Para o free roll que sobreviveu: randRarity >= 0.15
            // Para premium: qualquer randRarity
            // Usamos um roll dedicado para raridade, independente do shatter roll
            let rarityRoll = Math.random(); // 0..1
            if (rarityRoll < 0.01) {
                rarityKey = "legendary";
            } else if (rarityRoll < 0.15) {
                rarityKey = "epic";
            } else {
                rarityKey = "common";
            }

            rarityName = rarityKey === "legendary" ? "LENDÁRIO" : rarityKey === "epic" ? "ÉPICO" : "COMUM";
            rarityNameEN = rarityKey === "legendary" ? "LEGENDARY" : rarityKey === "epic" ? "EPIC" : "COMMON";
            watermarkColor = rarityKey === "legendary" ? "#00ffff" : rarityKey === "epic" ? "#ffaa00" : "#ffffff";

            // Atualiza a cotação global do mercado em tempo real a cada drop
            updateMarketQuotes(rarityKey);

            if (rarityKey !== "common") {
                filterStyle = rarityKey === "legendary" ? "hue-rotate(210deg) saturate(250%) contrast(120%)" : "hue-rotate(140deg) saturate(200%) brightness(90%)";
                styleName = rarityKey === "legendary" ? "NEON GHOST" : "ACID GLITCH";
                styleNameEN = rarityKey === "legendary" ? "NEON GHOST" : "ACID GLITCH";
                if(!isPremium) claimCost = 50;
            } else {
                filterStyle = visualFilters[styleIndex];
                styleName = visualStylesPT[styleIndex];
                styleNameEN = visualStylesEN[styleIndex];
            }

            targetContainer.className = "target-box";
            targetContainer.classList.add(`card-${rarityKey}`);

            metaRarity.innerText = currentLang === 'PT' ? rarityName : rarityNameEN; 
            metaRarity.style.color = watermarkColor;
            metaStyle.innerText = currentLang === 'PT' ? styleName : styleNameEN; 
            metaOwner.innerText = currentUser.loggedIn ? currentUser.username : "RECRUTA";

            bCtx.filter = filterStyle; bCtx.drawImage(sourceBuffer, 0, 0, 600, 600); bCtx.filter = "none";
            bCtx.fillStyle = "rgba(0, 0, 0, 0.75)"; bCtx.fillRect(20, bakedBuffer.height - 52, 160, 36);
            bCtx.fillStyle = watermarkColor; bCtx.font = "bold 24px 'Space Mono'"; bCtx.fillText(generatedId, 30, bakedBuffer.height - 26);

            lastMintedBuffer = bakedBuffer;
            activeAssetData = { 
                id: generatedId, rarityType: rarityKey, rarityName: rarityName, rarityNameEN: rarityNameEN,
                styleName: styleName, styleNameEN: styleNameEN, creator: currentUser.loggedIn ? currentUser.username : "OG DROP", 
                registered: currentUser.loggedIn, exposed: false, forSale: false, price: 0, imgSrc: bakedBuffer.toDataURL(), costToClaim: claimCost 
            };

            globalFeed.unshift({...activeAssetData});
            buildStoriesMarquee();

            downloadBtn.style.display = "block";
            downloadBtn.innerText = claimCost > 0 ? 
                (currentLang === 'PT' ? `RESGATAR (CUSTO: 50 B$)` : `CLAIM (COST: 50 B$)`) : 
                (currentLang === 'PT' ? "ENVIAR AO COFRE VIRTUAL" : "SEND TO SECURE VAULT");
            
            document.getElementById('status-text').innerText = currentLang === 'PT' ? "MUTAÇÃO_ESTÁVEL" : "MUTATION_STABLE";
            
            playSynthSound('success'); 
            speakPhrase("Mutação bem sucedida! Resgate o ativo.", "Mutation successful! Claim the asset.");
            startStabilityDecay(); 
            isRolling = false;
        }, 1200);
    }

    function startStabilityDecay() {
        let timeLeft = 10.0; clearInterval(decayInterval);
        decayInterval = setInterval(() => {
            timeLeft -= 0.1;
            if (timeLeft <= 0) { 
                clearInterval(decayInterval); 
                shatterAsset(); 
                return;
            }
            stabilityBar.style.width = `${(timeLeft / 10) * 100}%`;
            stabilityLabel.innerText = currentLang === 'PT' ? 
                `EXPIRA EM: ${timeLeft.toFixed(1)}s [CONSOLIDE ANTES DO COLLAPSE]` : 
                `EXPIRES IN: ${timeLeft.toFixed(1)}s [CONSOLIDATE BEFORE COLLAPSE]`;
        }, 100);
    }

    function shatterAsset() {
        playSynthSound('shatter');
        speakPhrase("Mutação destruída.", "Mutation destroyed.");
        if(activeAssetData) { globalFeed = globalFeed.filter(a => a.id !== activeAssetData.id); buildStoriesMarquee(); }
        
        downloadBtn.style.display = "none";
        targetContainer.className = "target-box shattering";
        
        stabilityLabel.innerText = currentLang === 'PT' ? "MUTAÇÃO CORROMPIDA // COLLAPSE" : "MUTATION CORRUPTED // COLLAPSE"; 
        document.getElementById('status-text').innerText = currentLang === 'PT' ? "SISTEMA_AUTODESTRUIDO" : "SYSTEM_SELF_DESTRUCTED";
        
        lastMintedBuffer = null; 
        activeAssetData = null;
        setTimeout(() => { targetContainer.classList.remove("shattering"); }, 800);
    }

    function claimAssetLogic() {
        // MUTEX GLOBAL: bloqueia qualquer clique duplicado antes de qualquer operação
        if (isProcessingClaim) return;
        if (!activeAssetData) return;

        isProcessingClaim = true;
        downloadBtn.disabled = true;
        const originalBtnText = downloadBtn.innerText;
        downloadBtn.innerText = currentLang === 'PT' ? "SALVANDO..." : "SAVING...";

        // FREE ROLL sem login: bloqueia envio ao cofre, liberta mutex imediatamente
        if (!currentUser.loggedIn) {
            alert(currentLang === 'PT'
                ? "🔒 COFRE BLOQUEADO: Faça login para salvar este ativo no seu cofre seguro. O card será perdido se não consolidar."
                : "🔒 VAULT LOCKED: Login required to save this asset to your secure vault. Card will be lost if not consolidated.");
            downloadBtn.disabled = false;
            downloadBtn.innerText = originalBtnText;
            isProcessingClaim = false;
            navigateTo('auth');
            return;
        }

        // Saldo insuficiente: aborta sem debitar nada
        if (activeAssetData.costToClaim > 0 && currentUser.bumps < activeAssetData.costToClaim) {
            downloadBtn.disabled = false;
            downloadBtn.innerText = originalBtnText;
            isProcessingClaim = false;
            playTerminalSound('error');
            openDepositModal();
            return;
        }

        // === ZONA CRÍTICA: executa UMA única vez por mutex ===
        if (activeAssetData.costToClaim > 0) {
            currentUser.bumps -= activeAssetData.costToClaim;
            const profBumpsEl = document.getElementById('profBumps');
            if (profBumpsEl) profBumpsEl.innerText = `${currentUser.bumps} B$`;
        }
        clearInterval(decayInterval);

        // Clona dados antes de qualquer limpeza de estado
        const assetSnapshot = { ...activeAssetData, creator: currentUser.username, registered: true };

        // Salvaguarda extra: impede duplicado se ID já existir no cofre
        const alreadyOwned = savedAssets.some(a => a.id === assetSnapshot.id);
        if (!alreadyOwned) {
            savedAssets.push(assetSnapshot);
        }

        // Persiste no localStorage via registry centralizado
        try {
            const userData = registryGet(currentUser.username);
            if (userData) {
                userData.savedAssets = savedAssets;
                userData.bumps = currentUser.bumps;
                registrySet(currentUser.username, userData);
            }
        } catch(e) { console.error("Erro ao salvar no localStorage:", e); }

        // Limpa estado do drop ANTES do alert
        activeAssetData = null;
        lastMintedBuffer = null;
        downloadBtn.style.display = "none";
        downloadBtn.disabled = false;
        downloadBtn.innerText = originalBtnText;
        stabilityWrapper.style.display = "none";
        document.getElementById('status-text').innerText = currentLang === 'PT' ? "ATIVO_SALVO_NO_COFRE" : "ASSET_SAVED_TO_VAULT";

        playTerminalSound('claim');
        speakPhrase("Ativo integrado ao seu cofre.", "Asset integrated into your vault.");

        // Ledger entry
        pushLedger(`${currentUser.username} resgatou o card ${assetSnapshot.id} [${assetSnapshot.rarityNameEN}]`);

        // Liberta mutex após o alert (alert é síncrono, bloqueia a thread até dismiss)
        alert(currentLang === 'PT' ? "Consolidado no seu cofre seguro!" : "Consolidated into your secure vault!");
        isProcessingClaim = false;
    }

    function buildStoriesMarquee() {
        const container = document.getElementById('storiesContainer'); 
        if(!container) return;
        container.innerHTML = '';
        if(globalFeed.length === 0) return;
        
        const displayItems = globalFeed.length > 4 ? [...globalFeed, ...globalFeed] : globalFeed;

        displayItems.forEach((a) => {
            const node = document.createElement('div');
            node.className = 'story-node';
            node.addEventListener('click', () => openInspectModal(a));
            node.innerHTML = `
                <div class="story-avatar-wrapper rare-${a.rarityType}"><img src="${a.imgSrc}"></div>
                <div class="story-meta">${a.creator}<br><b>${a.id}</b></div>
            `;
            container.appendChild(node);
        });
    }

    function renderVaultGrid() {
        const grid = document.getElementById('albumGrid'); if(!grid) return;
        const freshGrid = grid.cloneNode(false);
        grid.parentNode.replaceChild(freshGrid, grid);
        const g = document.getElementById('albumGrid');

        document.getElementById('vault-count-badge').innerText = `${savedAssets.length} ATIVOS`;

        const filtered = vaultFilter === 'all' ? savedAssets : savedAssets.filter(a => a.rarityType === vaultFilter);
        const pageItems = filtered.slice(vaultPage * PAGE_SIZE, (vaultPage + 1) * PAGE_SIZE);

        if(filtered.length === 0) { g.innerHTML = '<div class="empty-vault-notice">NENHUM ATIVO NESTA CATEGORIA.</div>'; renderPagination('vaultPagination',0,0,()=>{}); return; }

        pageItems.forEach((a) => {
            const index = savedAssets.indexOf(a);
            const card = document.createElement('div');
            card.className = `album-card rare-${a.rarityType}`;
            card.dataset.vaultIndex = index;
            const custodyBadge = a.isListed ? `<div style="position:absolute;top:-5px;left:-5px;background:#ff0044;color:#fff;font-size:0.5rem;padding:2px 6px;font-weight:bold;z-index:5;box-shadow:0 0 8px #ff0044;">🔒 EM CUSTÓDIA</div>` : '';
            card.innerHTML = `
                ${custodyBadge}
                <div class="album-preview-wrapper"><img src="${a.imgSrc}" draggable="false"></div>
                ${a.forSale ? `<div class="market-badge">${a.price} B$</div>` : ''}
                <div class="album-meta">
                    <div class="album-id">${a.id}</div>
                    <div class="album-rarity" style="color:${a.rarityType==='legendary'?'#00ffff':a.rarityType==='epic'?'#ffaa00':'#aaaaaa'}">${currentLang === 'PT' ? a.rarityName : a.rarityNameEN}</div>
                </div>
                <div class="card-actions">
                    <button class="btn-action btn-expose" data-action="expose" data-idx="${index}">${a.exposed ? '⭐ Sair da Vitrine' : '📁 Expor na Vitrine'}</button>
                    <button class="btn-action btn-sell"   data-action="sell"   data-idx="${index}" style="border-color:#ffaa00;">${a.forSale ? '⚡ Alterar Preço P2P' : '💵 Vender / Anunciar'}</button>
                    <button class="btn-action btn-gift"   data-action="gift"   data-idx="${index}" style="border-color:#ff00ff;">🎁 Presentear Card</button>
                    <button class="btn-action btn-dl"     data-action="download" data-idx="${index}" style="border-color:#00ffff; color:#00ffff;">⬇ DOWNLOAD ASSET</button>
                </div>
            `;
            card.querySelector('.album-preview-wrapper').addEventListener('click', () => {
                openInspectModal(savedAssets[parseInt(card.dataset.vaultIndex, 10)]);
            });
            card.querySelector('.card-actions').addEventListener('click', (e) => {
                const btn = e.target.closest('[data-action]');
                if (!btn) return;
                const idx = parseInt(btn.dataset.idx, 10);
                const action = btn.dataset.action;
                if (action === 'expose')    toggleExposeAsset(idx);
                else if (action === 'sell') marketListPrompt(idx);
                else if (action === 'gift') giftAssetPrompt(idx);
                else if (action === 'download') downloadVaultAsset(idx);
            });
            g.appendChild(card);
        });

        renderPagination('vaultPagination', filtered.length, vaultPage, (p) => { vaultPage = p; renderVaultGrid(); });
    }

    function toggleExposeAsset(index) {
        const asset = savedAssets[index];
        if (asset.isListed) {
            playSynthSound('shatter');
            showCyberAlert('🔒 ATIVO BLOQUEADO EM CUSTÓDIA NO MERCADO', 'Este card está listado no mercado e está em custódia. Remove o anúncio primeiro para alterar o seu estado.', 'error');
            return;
        }
        savedAssets[index].exposed = !savedAssets[index].exposed;
        // Ponto 1: persiste usuário no registry
        const userData = registryGet(currentUser.username);
        if(userData) { userData.savedAssets = savedAssets; registrySet(currentUser.username, userData); }

        // Ponto 1: sincroniza com dr0p_market se o item for para venda e exposto
        if (asset.forSale) {
            marketAssets = marketAssets.filter(m => m.id !== asset.id);
            if (asset.exposed) marketAssets.push(asset);
            saveMarket(marketAssets);
        }
        renderVaultGrid();
    }

    function marketListPrompt(index) {
        if (savedAssets[index].isListed) {
            playSynthSound('shatter');
            showCyberAlert('🔒 ATIVO BLOQUEADO EM CUSTÓDIA NO MERCADO', 'Este card já está em custódia no mercado. Remove o anúncio primeiro.', 'error');
            return;
        }
        const price = prompt("Insira o valor de venda em Bumps (B$):", savedAssets[index].price || 100);
        if (price === null) return; const parsed = parseInt(price);
        if (isNaN(parsed) || parsed <= 0) { showCyberAlert('ERRO DE INPUT', 'Valor de venda inválido. Insere um número positivo.', 'error'); return; }

        savedAssets[index].forSale  = true;
        savedAssets[index].price    = parsed;
        savedAssets[index].isListed = true; // CUSTÓDIA (Ponto 2)

        // Ponto 1: remove entry antiga e insere actualizada no mercado
        marketAssets = marketAssets.filter(m => m.id !== savedAssets[index].id);
        marketAssets.push({...savedAssets[index]});
        saveMarket(marketAssets);

        // Ledger (Ponto 4)
        pushLedger(`${currentUser.username} listou o card ${savedAssets[index].id} [${savedAssets[index].rarityNameEN}] por ${parsed} B$`);

        // Persiste utilizador
        const userData = registryGet(currentUser.username);
        if(userData) { userData.savedAssets = savedAssets; registrySet(currentUser.username, userData); }

        renderVaultGrid();
    }

    function giftAssetPrompt(index) {
        const targetUser = prompt("Digite o @username exato do destinatário da rede (Ex: @cyber_k1ng):");
        if (!targetUser) return;
        if (!targetUser.startsWith('@')) { showCyberAlert('FORMATO INVÁLIDO', 'O username deve iniciar com @', 'error'); return; }

        const targetData = registryGet(targetUser);
        if (!targetData) {
            showCyberAlert('ERRO_REDE', 'Esse nó de usuário não existe ou está desconectado.', 'error'); return;
        }

        let targetObject = { ...savedAssets[index] };
        const giftedCard = savedAssets[index];
        targetObject.creator = targetUser;
        targetObject.exposed = false;
        targetObject.forSale = false;

        if (!targetData.savedAssets) targetData.savedAssets = [];
        targetData.savedAssets.push(targetObject);
        registrySet(targetUser, targetData);

        savedAssets.splice(index, 1);
        const myData = registryGet(currentUser.username);
        if (myData) { myData.savedAssets = savedAssets; registrySet(currentUser.username, myData); }

        // Efeito sonoro de presente
        playSynthSound('success');
        setTimeout(() => playSynthSound('success'), 200);

        // TTS — aviso de presente enviado
        speakPhrase("Presente enviado com sucesso. Lootbox entregue.", "New Lootbox Detected. Gift delivered successfully.");

        // Alerta cyber customizado
        showCyberAlert(
            '🎁 LOOTBOX ENTREGUE',
            `Card <b>${giftedCard.id}</b> [${giftedCard.rarityNameEN}] foi transferido para <b>${targetUser}</b>.<br><small style="color:#666;">O destinatário receberá o alerta ao abrir o cofre.</small>`,
            'success'
        );

        pushLedger(`${currentUser.username} presenteou ${targetUser} com o card ${giftedCard.id} [${giftedCard.rarityNameEN}]`);
        renderVaultGrid();
    }

    // Dispara alerta + TTS quando um presente é detectado no cofre ao login
    function checkIncomingGifts(prevAssets, newAssets) {
        if (!prevAssets || !newAssets) return;
        // Segunda camada de proteção: se não havia estado anterior nesta
        // sessão (cofre vazio antes do login), não há base de comparação
        // confiável — evita interpretar o cofre inicial do usuário como "presente".
        if (prevAssets.length === 0) return;
        const prevIds = new Set(prevAssets.map(a => a.id));
        const incoming = newAssets.filter(a => !prevIds.has(a.id));
        if (incoming.length === 0) return;
        incoming.forEach(gift => {
            setTimeout(() => {
                playSynthSound('success');
                speakPhrase("Presente Recebido. Novo Lootbox detectado.", "New Lootbox Detected. Gift received.");
                showCyberAlert(
                    '🎁 NEW LOOTBOX DETECTED',
                    `Um presente chegou ao teu cofre!<br>Card <b>${gift.id}</b> — <span style="color:${gift.rarityType==='legendary'?'#00ffff':gift.rarityType==='epic'?'#ffaa00':'#aaa'}">${gift.rarityNameEN}</span>`,
                    'success'
                );
            }, 800);
        });
    }

    function renderMarketGrid() {
        const grid = document.getElementById('marketGrid'); if(!grid) return;
        grid.innerHTML = '';
        document.getElementById('market-count-badge').innerText = `${marketAssets.length} CARDS`;

        const filtered = marketFilter === 'all' ? marketAssets : marketAssets.filter(a => a.rarityType === marketFilter);
        const pageItems = filtered.slice(marketPage * PAGE_SIZE, (marketPage + 1) * PAGE_SIZE);

        if(filtered.length === 0) { grid.innerHTML = '<div class="empty-vault-notice">NENHUM ATIVO NESTA CATEGORIA.</div>'; renderPagination('marketPagination',0,0,()=>{}); return; }

        pageItems.forEach((a) => {
            const card = document.createElement('div');
            card.className = `album-card rare-${a.rarityType}`;
            card.innerHTML = `
                <div class="album-preview-wrapper"><img src="${a.imgSrc}"></div>
                <div class="album-meta">
                    <div class="album-id">${a.id} <span style="font-size:0.6rem; color:#00ff66; cursor:pointer;" class="ext-profile">by ${a.creator}</span></div>
                    <div class="album-price">${a.price} B$</div>
                </div>
                <div class="card-actions"></div>
            `;
            card.querySelector('.album-preview-wrapper').addEventListener('click', () => {
                openInspectModal(marketAssets.find(m => m.id === a.id));
            });
            card.querySelector('.ext-profile').addEventListener('click', () => viewExternalProfile(a.creator));

            const actionsZone = card.querySelector('.card-actions');
            if (!currentUser.loggedIn) {
                const loginBtn = document.createElement('button');
                loginBtn.className = 'btn-action'; loginBtn.style.cssText = "border-color:#00ff66;";
                loginBtn.innerText = "LOGIN PARA INTERAGIR";
                loginBtn.addEventListener('click', () => navigateTo('auth'));
                actionsZone.appendChild(loginBtn);
            } else if (a.creator !== currentUser.username) {
                const buyBtn = document.createElement('button');
                buyBtn.className = 'btn-action'; buyBtn.style.cssText = "background:#ffaa00; color:#000;";
                buyBtn.innerText = "COMPRAR DIRETO";
                buyBtn.addEventListener('click', () => buyMarketAsset(a.id));

                const tradeBtn = document.createElement('button');
                tradeBtn.className = 'btn-action'; tradeBtn.style.borderColor = '#ff00ff';
                tradeBtn.innerText = "PROPOR TROCA / CHAT";
                tradeBtn.addEventListener('click', () => initiateTradeContact(a.creator, a.id));

                actionsZone.appendChild(buyBtn);
                actionsZone.appendChild(tradeBtn);
            } else {
                const removeBtn = document.createElement('button');
                removeBtn.className = 'btn-action'; removeBtn.style.borderColor = '#ff0044';
                removeBtn.innerText = "REMOVER ANÚNCIO";
                removeBtn.addEventListener('click', () => removeAssetFromMarket(a.id));
                actionsZone.appendChild(removeBtn);
            }
            grid.appendChild(card);
        });

        renderPagination('marketPagination', filtered.length, marketPage, (p) => { marketPage = p; renderMarketGrid(); });
    }

    function buyMarketAsset(id) {
        const asset = marketAssets.find(m => m.id === id); if (!asset) return;
        if (!currentUser.loggedIn) { navigateTo('auth'); return; }

        // Valida saldo do comprador
        if (currentUser.bumps < asset.price) {
            playTerminalSound('error');
            showCyberAlert('FUNDOS INSUFICIENTES', `Saldo actual: <b>${currentUser.bumps} B$</b><br>Custo do ativo: <b>${asset.price} B$</b><br><br>Carregue o saldo no teu perfil.`, 'warn');
            return;
        }

        const sellerName = asset.creator;

        // Debita comprador
        currentUser.bumps -= asset.price;

        // Credita vendedor no registry e REMOVE o card do cofre do vendedor
        if (sellerName !== currentUser.username) {
            const sellerData = registryGet(sellerName);
            if (sellerData) {
                sellerData.bumps = (sellerData.bumps || 0) + asset.price;
                // Remove card do cofre do vendedor (Ponto 1)
                if (sellerData.savedAssets) {
                    sellerData.savedAssets = sellerData.savedAssets.filter(a => a.id !== id);
                }
                registrySet(sellerName, sellerData);
            }
        }

        // Move card para o cofre do comprador (actualiza creator + limpa custódia)
        const acquiredAsset = { ...asset, forSale: false, exposed: false, isListed: false, creator: currentUser.username };
        const alreadyOwned = savedAssets.some(a => a.id === acquiredAsset.id);
        if (!alreadyOwned) savedAssets.push(acquiredAsset);

        // Remove do mercado e persiste
        marketAssets = marketAssets.filter(m => m.id !== id);
        saveMarket(marketAssets);

        // Persiste comprador no registry
        const myData = registryGet(currentUser.username);
        if (myData) {
            myData.savedAssets = savedAssets;
            myData.bumps = currentUser.bumps;
            registrySet(currentUser.username, myData);
        }

        // Ledger (Ponto 4)
        pushLedger(`${currentUser.username} comprou o card ${asset.id} de ${sellerName} por ${asset.price} B$`);

        // Regista notificação para comprador e vendedor
        const dateStr = new Date().toLocaleString('pt-PT');
        pushNotification(currentUser.username, `Comprou ${asset.id} por ${asset.price} B$ de ${sellerName} — ${dateStr}`);
        pushNotification(sellerName, `Vendeu ${asset.id} por ${asset.price} B$ para ${currentUser.username} — ${dateStr}`);

        // Alerta cyberpunk de sucesso
        playSynthSound('success');
        showCyberAlert(
            '// TRANSFERÊNCIA DE ATIVOS CONCLUÍDA //',
            `Card <b>${asset.id}</b> adicionado ao teu cofre.<br>
             Débito: <b>-${asset.price} B$</b> &nbsp;|&nbsp; Saldo actual: <b>${currentUser.bumps} B$</b><br>
             Vendedor <b>${sellerName}</b> recebeu <b>+${asset.price} B$</b>.`,
            'success'
        );

        // Actualiza UI
        const profBumpsEl = document.getElementById('profBumps');
        if (profBumpsEl) profBumpsEl.innerText = `${currentUser.bumps} B$`;
        renderMarketGrid();
    }

    function removeAssetFromMarket(id) {
        marketAssets = marketAssets.filter(m => m.id !== id);
        saveMarket(marketAssets);
        const vaultItem = savedAssets.find(m => m.id === id);
        if (vaultItem) { vaultItem.forSale = false; vaultItem.exposed = false; vaultItem.isListed = false; } // liberta custódia
        // Persiste utilizador
        const userData = registryGet(currentUser.username);
        if(userData) { userData.savedAssets = savedAssets; registrySet(currentUser.username, userData); }
        renderMarketGrid();
    }

    function openInspectModal(asset) {
        if(!asset) return;
        document.getElementById('inspectImg').src = asset.imgSrc;
        document.getElementById('inspectTitle').innerText = `INSPECT // ${asset.id}`;

        const glow = document.getElementById('holoGlow');
        if (asset.rarityType === 'legendary') {
            glow.style.display = 'block'; glow.style.background = "radial-gradient(circle, rgba(0,255,255,0.4) 0%, transparent 70%)";
        } else if (asset.rarityType === 'epic') {
            glow.style.display = 'block'; glow.style.background = "radial-gradient(circle, rgba(255,170,0,0.3) 0%, transparent 70%)";
        } else { glow.style.display = 'none'; }
        
        let ownerItems = globalFeed.filter(f => f.creator === asset.creator);
        let score = ownerItems.length * 5; 

        const metaBox = document.getElementById('inspectMetaBox');
        metaBox.innerHTML = `
            <b>CÓDIGO IDENTIFICADOR:</b> ${asset.id}<br>
            <b>ESTILO VISUAL:</b> ${currentLang === 'PT' ? asset.styleName : (asset.styleNameEN || asset.styleName)}<br>
            <b>RARIDADE DO ATIVO:</b> <span style="color:${asset.rarityType==='legendary'?'#00ffff':'#ffaa00'}">${(currentLang === 'PT' ? asset.rarityName : asset.rarityNameEN).toUpperCase()}</span><br>
            <b>NÍVEL DE COLECIONADOR DO PROPRIETÁRIO:</b> LVL ${score || 1}<br>
            <b>DONO DA ASSINATURA:</b> <span style="color:#00ff66; text-decoration:underline; cursor:pointer;" class="inspect-author">${asset.creator}</span> (CLIQUE PARA VER PERFIL)<br>
            <b>ESTADO NA REDE:</b> ${asset.registered ? 'CRIPTOGRAFADO EM WALLET' : 'FLUXO VOLÁTIL'}
        `;

        metaBox.querySelector('.inspect-author').addEventListener('click', () => viewExternalProfile(asset.creator));

        const zone = document.getElementById('inspectActionZone'); zone.innerHTML = '';
        if (asset.registered && asset.creator !== currentUser.username) {
            const btn = document.createElement('button'); btn.className = 'btn-action'; btn.style.borderColor = '#ff00ff';
            btn.innerText = `💬 ABRIR NEGOCIAÇÃO COM ${asset.creator}`;
            btn.onclick = () => { closeInspectModal(); initiateTradeContact(asset.creator, asset.id); };
            zone.appendChild(btn);
        }

        document.getElementById('inspectModal').style.display = 'flex';
    }

    function closeInspectModal() { document.getElementById('inspectModal').style.display = 'none'; }

    function rotateCard(e) {
        const card = document.getElementById('card3D'); const box = card.getBoundingClientRect();
        const x = e.clientX - box.left - (box.width/2); const y = e.clientY - box.top - (box.height/2);
        card.style.transform = `rotateY(${x / 5}deg) rotateX(${-y / 5}deg) scale(1.08)`;
    }
    function resetCardRotation() { document.getElementById('card3D').style.transform = `rotateY(0deg) rotateX(0deg) scale(1)`; }

    /* LÓGICA DE NEGOCIAÇÃO INTEGRADA, SISTEMA DE PROPOSTAS E EXIBIÇÃO DE AVATARES */
    function getTradeKey(partnerUsername) {
        // Chave única por par: garante isolamento entre conversas diferentes
        return `trade_${currentUser.username}_${partnerUsername}`;
    }

    function saveThreadToStorage(partnerUsername) {
        try {
            const key = getTradeKey(partnerUsername);
            localStorage.setItem(key, JSON.stringify(messageThreads[partnerUsername]));
        } catch(e) {}
    }

    function loadThreadFromStorage(partnerUsername) {
        try {
            const key = getTradeKey(partnerUsername);
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : null;
        } catch(e) { return null; }
    }

    function initiateTradeContact(seller, assetId) {
        if (!currentUser.loggedIn) { navigateTo('auth'); return; }
        
        let assetData = marketAssets.find(m => m.id === assetId) || globalFeed.find(g => g.id === assetId);

        if (!messageThreads[seller]) {
            // Tenta restaurar thread guardada anteriormente para este par
            const savedThread = loadThreadFromStorage(seller);
            if (savedThread) {
                messageThreads[seller] = savedThread;
            } else {
                messageThreads[seller] = {
                    targetAsset: assetData || null,
                    activeProposal: {
                        offeredBumps: 0,
                        offeredAsset: null,
                        proposer: currentUser.username,
                        status: "PENDING"
                    },
                    messages: []
                };
                messageThreads[seller].messages.push({ 
                    sender: 'system', 
                    text: `🔒 Linha segura estabelecida com ${seller} a respeito do Ativo ${assetId}. Use o terminal abaixo para estruturar sua proposta.` 
                });
                saveThreadToStorage(seller);
            }
        }
        
        activeThreadUser = seller; 
        navigateTo('messages');
    }

    function renderChatThreads() {
        const sidebar = document.getElementById('chatSidebarThreads'); if(!sidebar) return;
        sidebar.innerHTML = '';
        const keys = Object.keys(messageThreads);
        document.getElementById('msg-count-badge').innerText = `${keys.length} CONVERSAS`;

        if(keys.length === 0) { sidebar.innerHTML = '<div style="color:#445; font-size:0.6rem; padding:10px;">INBOX VAZIO</div>'; return; }
        
        keys.forEach(k => {
            let thread = messageThreads[k];
            let partnerAvatar = "https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg";
            let storedUser = localStorage.getItem(`user_${k}`);
            if(storedUser) partnerAvatar = JSON.parse(storedUser).avatar;

            const div = document.createElement('div'); 
            div.className = `chat-thread-node ${activeThreadUser === k ? 'active' : ''}`;
            div.onclick = () => { 
                // Limpa a proposal box antes de trocar de chat para evitar estado cruzado
                const proposalBox = document.getElementById('dealProposalBox');
                if(proposalBox) { proposalBox.style.display = "none"; }
                const assetBanner = document.getElementById('dealAssetBanner');
                if(assetBanner) { assetBanner.style.display = "none"; }
                
                activeThreadUser = k; 
                renderChatThreads(); 
            }; 
            
            div.innerHTML = `
                <img src="${partnerAvatar}" class="chat-thread-avatar">
                <div class="chat-thread-info">
                    <span class="chat-thread-name">${k}</span>
                    <span style="color:#667; font-size:0.5rem; text-transform:uppercase;">Ativo: ${thread.targetAsset ? thread.targetAsset.id : 'Nenhum'}</span>
                </div>
            `;
            sidebar.appendChild(div);
        });
        
        renderChatWindow();
    }

    function renderChatWindow() {
        const box = document.getElementById('chatMessagesBox'); if(!box) return;
        // Limpa tudo antes de renderizar para evitar qualquer vazamento entre chats
        box.innerHTML = '';

        const assetBanner = document.getElementById('dealAssetBanner');
        const proposalBox = document.getElementById('dealProposalBox');
        const counterPanel = document.getElementById('counterPanelZone');

        // Reset completo dos painéis (isolamento ao trocar de chat)
        if (proposalBox) { proposalBox.style.display = "none"; proposalBox.querySelector && (document.getElementById('dealProposalDetails').innerHTML = ''); }
        if (assetBanner) assetBanner.style.display = "none";
        if (counterPanel) counterPanel.style.display = "none";

        if (!activeThreadUser) {
            box.innerHTML = '<div style="color:#445; font-size:0.7rem; text-align:center; margin-top:50px;">SELECIONE UM CANAL DO TERMINAL CRIPTOGRÁFICO</div>';
            return;
        }

        // Lê sempre do localStorage com chave composta (fonte de verdade isolada por par)
        const freshThread = loadThreadFromStorage(activeThreadUser);
        if (freshThread) {
            messageThreads[activeThreadUser] = freshThread;
        }

        if (!messageThreads[activeThreadUser]) {
            box.innerHTML = '<div style="color:#445; font-size:0.7rem; text-align:center; margin-top:50px;">SELECIONE UM CANAL DO TERMINAL CRIPTOGRÁFICO</div>';
            return;
        }

        let thread = messageThreads[activeThreadUser];

        // 1. Renderiza Informações do Item Sendo Negociado (Topo)
        if(thread.targetAsset) {
            assetBanner.style.display = "flex";
            document.getElementById('dealAssetImg').src = thread.targetAsset.imgSrc;
            document.getElementById('dealAssetTitle').innerText = `${thread.targetAsset.id} (${thread.targetAsset.styleName})`;
            document.getElementById('dealAssetOwner').innerText = `Proprietário: ${thread.targetAsset.creator}`;
            document.getElementById('dealAssetPrice').innerText = `Preço de tabela: ${thread.targetAsset.price} B$`;
        } else {
            assetBanner.style.display = "none";
        }

        // 2. Renderiza o Estado da Proposta Ativa (lido exclusivamente do thread deste par)
        let prop = thread.activeProposal;
        if(prop && prop.status === "PENDING" && (prop.offeredBumps > 0 || prop.offeredAsset)) {
            proposalBox.style.display = "flex";
            let desc = `Ofertado por ${prop.proposer}: **${prop.offeredBumps} B$**`;
            if(prop.offeredAsset) {
                desc += ` + Figurinha [${prop.offeredAsset.id} - ${prop.offeredAsset.rarityName}]`;
            }
            document.getElementById('dealProposalDetails').innerText = desc;

            const buttonsZone = document.getElementById('proposalActionButtonsZone');
            if(prop.proposer === currentUser.username) {
                buttonsZone.innerHTML = `<span style="color:#ffaa00; font-style:italic;">Sua oferta foi enviada. Aguardando decisão do operador oposto...</span>`;
            } else {
                buttonsZone.innerHTML = `
                    <button class="btn-action" style="border-color:#00ff66; background:#04140a;" onclick="acceptCurrentProposal()">ACEITAR OFERTA</button>
                    <button class="btn-action" style="border-color:#ff0044; background:#14040a;" onclick="rejectCurrentProposal()">RECUSAR OFERTA</button>
                `;
            }
        } else if(prop && prop.status === "ACCEPTED") {
            proposalBox.style.display = "flex";
            document.getElementById('dealProposalDetails').innerHTML = `<span style="color:#00ff66; font-weight:bold;">✓ OPERAÇÃO CONCLUÍDA: A PROPOSTA FOI ACEITA E O ATIVO ENVIADO AO RESPECTIVO COFRE!</span>`;
            document.getElementById('proposalActionButtonsZone').innerHTML = '';
        } else if(prop && prop.status === "REJECTED") {
            proposalBox.style.display = "flex";
            document.getElementById('dealProposalDetails').innerHTML = `<span style="color:#ff0044; font-weight:bold;">✕ PROPOSTA RECUSADA. Monte uma contraproposta utilizando o painel inferior.</span>`;
            document.getElementById('proposalActionButtonsZone').innerHTML = '';
        } else {
            proposalBox.style.display = "none";
        }

        // 3. Painel de Contrapropostas
        if(prop && prop.status !== "ACCEPTED") {
            counterPanel.style.display = "flex";
            const selectElement = document.getElementById('counterAssetSelect');
            selectElement.innerHTML = '<option value="">-- NENHUMA FIGURINHA SELECIONADA --</option>';
            savedAssets.forEach((a) => {
                if(thread.targetAsset && a.id === thread.targetAsset.id) return;
                const opt = document.createElement('option');
                opt.value = a.id;
                opt.innerText = `${a.id} - Rarity: ${a.rarityName} (${a.styleName})`;
                selectElement.appendChild(opt);
            });
        } else {
            counterPanel.style.display = "none";
        }

        // 4. Histórico de Mensagens
        thread.messages.forEach(m => {
            const div = document.createElement('div');
            div.className = `msg-bubble ${m.sender === currentUser.username ? 'sent' : 'received'}`;
            div.innerText = m.text;
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    }

    function sendChatMessage() {
        const input = document.getElementById('inputChatMsg'); const text = input.value.trim();
        if(!text || !activeThreadUser) return;
        messageThreads[activeThreadUser].messages.push({ sender: currentUser.username, text: text });
        input.value = '';
        saveThreadToStorage(activeThreadUser);
        renderChatWindow();
    }

    /* SISTEMA COMPLETO DE CONTRA-PROPOSTAS E MERCADO P2P DIRECT */
    function submitCounterProposal() {
        if(!activeThreadUser || !messageThreads[activeThreadUser]) return;
        let thread = messageThreads[activeThreadUser];

        if(thread.activeProposal && thread.activeProposal.status === "ACCEPTED") {
            alert("Este canal de negociação já foi finalizado com sucesso."); return;
        }

        const bumpsOffered = parseInt(document.getElementById('counterBumpsInput').value) || 0;
        const selectedAssetId = document.getElementById('counterAssetSelect').value;

        if(bumpsOffered < 0) { alert("Valor inválido de Bumps."); return; }
        if(bumpsOffered > currentUser.bumps) { alert("Você não possui saldo de Bumps suficiente em conta para cobrir esta proposta."); return; }

        let assetObject = null;
        if(selectedAssetId) {
            assetObject = savedAssets.find(a => a.id === selectedAssetId);
        }

        // Sobrescreve proposta ativa com a contraproposta
        thread.activeProposal = {
            offeredBumps: bumpsOffered,
            offeredAsset: assetObject ? {...assetObject} : null,
            proposer: currentUser.username,
            status: "PENDING"
        };

        // Adiciona registro estruturado na caixa de mensagens
        let logMsg = `⚙️ CONTRAPROPOSTA ENVIADA POR ${currentUser.username}: Ofertou ${bumpsOffered} B$`;
        if(assetObject) logMsg += ` + Figurinha [${assetObject.id}]`;
        thread.messages.push({ sender: currentUser.username, text: logMsg });

        // Ledger global (Ponto 4)
        pushLedger(`${currentUser.username} enviou proposta a ${activeThreadUser}: ${bumpsOffered} B$${assetObject ? ' + ' + assetObject.id : ''}`);

        document.getElementById('counterBumpsInput').value = '';
        playSynthSound('success');
        saveThreadToStorage(activeThreadUser);
        renderChatWindow();
    }

    function acceptCurrentProposal() {
        if(!activeThreadUser || !messageThreads[activeThreadUser]) return;
        let thread = messageThreads[activeThreadUser];
        let prop = thread.activeProposal;

        if(!thread.targetAsset) return;

        let buyerName = prop.proposer;
        let sellerName = thread.targetAsset.creator;

        // Se o atual usuário logado é quem vai receber os Bumps e figurinhas (Dono do Card Alvo)
        if(currentUser.username === sellerName) {
            // Verifica se o comprador fictício tem fundos no ambiente simulado
            let storedBuyer = localStorage.getItem(`user_${buyerName}`);
            let buyerData = storedBuyer ? JSON.parse(storedBuyer) : null;

            if(buyerData && buyerData.bumps < prop.offeredBumps) {
                alert(`ERRO_REDE: O comprador ${buyerName} não possui fundos suficientes no momento.`); return;
            }

            // Transfere o Card Alvo para o Comprador
            let assetToTransfer = savedAssets.find(s => s.id === thread.targetAsset.id);
            if(!assetToTransfer) { alert("Você já não possui mais este ativo no cofre."); return; }

            // Executa Trocas Financeiras
            currentUser.bumps += prop.offeredBumps;
            if(buyerData) buyerData.bumps -= prop.offeredBumps;

            // Remove o Card Alvo do vendedor
            savedAssets = savedAssets.filter(s => s.id !== assetToTransfer.id);
            marketAssets = marketAssets.filter(m => m.id !== assetToTransfer.id);

            // Adiciona o Card Alvo ao comprador
            assetToTransfer.creator = buyerName;
            assetToTransfer.forSale = false;
            assetToTransfer.exposed = false;
            if(buyerData) {
                if(!buyerData.savedAssets) buyerData.savedAssets = [];
                buyerData.savedAssets.push(assetToTransfer);
            }

            // Se houve Figurinha envolvida na troca, remove do comprador e passa para o vendedor atual
            if(prop.offeredAsset) {
                if(buyerData && buyerData.savedAssets) {
                    buyerData.savedAssets = buyerData.savedAssets.filter(b => b.id !== prop.offeredAsset.id);
                }
                let extraAsset = prop.offeredAsset;
                extraAsset.creator = currentUser.username;
                extraAsset.forSale = false;
                extraAsset.exposed = false;
                savedAssets.push(extraAsset);
            }

            // Atualiza bases de dados do LocalStorage
            const myKey = `user_${currentUser.username}`;
            const myData = JSON.parse(localStorage.getItem(myKey));
            if(myData) { myData.savedAssets = savedAssets; myData.bumps = currentUser.bumps; localStorage.setItem(myKey, JSON.stringify(myData)); }
            if(buyerData) localStorage.setItem(`user_${buyerName}`, JSON.stringify(buyerData));

        } else {
            // Caso o Usuário Atual seja o COMPRADOR aceitando uma oferta/contraproposta vinda do Dono do Card
            if(currentUser.bumps < prop.offeredBumps) { alert("Seu saldo de Bumps é insuficiente."); return; }
            
            let storedSeller = localStorage.getItem(`user_${sellerName}`);
            let sellerData = storedSeller ? JSON.parse(storedSeller) : null;

            if(sellerData) {
                let sellerAsset = sellerData.savedAssets.find(s => s.id === thread.targetAsset.id);
                if(!sellerAsset) { alert("O vendedor não possui mais este ativo no cofre."); return; }

                // Deduz recursos do comprador atual
                currentUser.bumps -= prop.offeredBumps;
                sellerData.bumps += prop.offeredBumps;

                // Transfere Card Alvo para o Comprador atual
                sellerData.savedAssets = sellerData.savedAssets.filter(s => s.id !== thread.targetAsset.id);
                marketAssets = marketAssets.filter(m => m.id !== thread.targetAsset.id);
                
                let assetToGet = {...sellerAsset};
                assetToGet.creator = currentUser.username;
                assetToGet.forSale = false;
                assetToGet.exposed = false;
                savedAssets.push(assetToGet);

                // Se houver figurinha de troca do comprador atual saindo
                if(prop.offeredAsset) {
                    savedAssets = savedAssets.filter(s => s.id !== prop.offeredAsset.id);
                    let giftAsset = prop.offeredAsset;
                    giftAsset.creator = sellerName;
                    giftAsset.forSale = false;
                    giftAsset.exposed = false;
                    sellerData.savedAssets.push(giftAsset);
                }

                // Salva estados permanentes
                const myKey = `user_${currentUser.username}`;
                const myData = JSON.parse(localStorage.getItem(myKey));
                if(myData) { myData.savedAssets = savedAssets; myData.bumps = currentUser.bumps; localStorage.setItem(myKey, JSON.stringify(myData)); }
                localStorage.setItem(`user_${sellerName}`, JSON.stringify(sellerData));
            }
        }

        prop.status = "ACCEPTED";
        thread.messages.push({ sender: 'system', text: `✓ ACORDO COMINADO. Transações de rede liquidadas e registradas.` });
        playSynthSound('success');
        saveThreadToStorage(activeThreadUser);
        renderChatWindow();
    }

    function rejectCurrentProposal() {
        if(!activeThreadUser || !messageThreads[activeThreadUser]) return;
        let thread = messageThreads[activeThreadUser];
        thread.activeProposal.status = "REJECTED";
        thread.messages.push({ sender: currentUser.username, text: `✕ A proposta ativa na mesa de negociação foi rejeitada.` });
        playSynthSound('shatter');
        saveThreadToStorage(activeThreadUser);
        renderChatWindow();
    }

    // =========================================================
    // DOWNLOAD DO ASSET (Ponto 6)
    // =========================================================
    function downloadVaultAsset(index) {
        const asset = savedAssets[index];
        if (!asset) return;
        // Só o dono real pode fazer download
        if (asset.creator !== currentUser.username) {
            showCyberAlert('ACESSO NEGADO', 'Apenas o dono original pode descarregar este ativo.', 'error');
            return;
        }
        // Abre a imagem numa nova aba (dispara download se for data URI ou link)
        const a = document.createElement('a');
        a.href = asset.imgSrc;
        // Se for data URI (card gerado), dispara download direto
        if (asset.imgSrc.startsWith('data:')) {
            a.download = `dr0p_${asset.id.replace('#','')}_${asset.rarityType}.png`;
            a.click();
        } else {
            // URL externa: abre em nova aba
            window.open(asset.imgSrc, '_blank');
        }
    }

    // =========================================================
    // ALQUIMIA — FUSÃO DE 2 CARDS COM PROBABILIDADE (VAULT ONLY)
    // =========================================================
    function toggleAlchemyPanel() {
        const panel = document.getElementById('alchemyPanel'); if (!panel) return;
        if (panel.style.display === 'none' || !panel.style.display) {
            if (!currentUser.loggedIn) { showCyberAlert('ACESSO NEGADO', currentLang === 'PT' ? 'Precisas de estar logado para aceder ao laboratório de Alquimia.' : 'Login required to access the Alchemy Lab.', 'error'); return; }
            panel.style.display = 'block';
            openAlchemyPanel();
        } else {
            panel.style.display = 'none';
        }
    }

    function openAlchemyPanel() {
        ['fuseCard1','fuseCard2'].forEach((sid, si) => {
            const sel = document.getElementById(sid); if (!sel) return;
            const prev = sel.value;
            sel.innerHTML = `<option value="">-- CARD ${si+1} --</option>`;
            savedAssets.forEach(a => {
                if (a.isListed) return;
                const opt = document.createElement('option');
                opt.value = a.id;
                opt.innerText = `${a.id} [${a.rarityNameEN}] ${a.styleName}`;
                if (a.id === prev) opt.selected = true;
                sel.appendChild(opt);
            });
        });
        previewAlchemy();
    }

    function previewAlchemy() {
        const id1 = document.getElementById('fuseCard1').value;
        const id2 = document.getElementById('fuseCard2').value;
        const probBox = document.getElementById('alchProbBox');

        const p1 = document.getElementById('previewSlot1');
        const p2 = document.getElementById('previewSlot2');

        const c1 = savedAssets.find(a => a.id === id1);
        const c2 = savedAssets.find(a => a.id === id2);

        p1.innerHTML = c1 ? `<img src="${c1.imgSrc}">` : '<span style="color:#ff00ff44;font-size:2rem;">⚗</span>';
        p2.innerHTML = c2 ? `<img src="${c2.imgSrc}">` : '<span style="color:#ff00ff44;font-size:2rem;">⚗</span>';

        if (!c1 || !c2 || id1 === id2) { probBox.style.display = 'none'; return; }

        const score = (c) => c.rarityType === 'legendary' ? 3 : c.rarityType === 'epic' ? 2 : 1;
        const total = score(c1) + score(c2);
        let ps, pb, pc; // successEpicPlus, break, common
        if (total >= 6)      { ps = 70; pb = 10; pc = 20; }
        else if (total >= 4) { ps = 45; pb = 15; pc = 40; }
        else if (total >= 3) { ps = 25; pb = 20; pc = 55; }
        else                 { ps = 10; pb = 25; pc = 65; }

        probBox.style.display = 'block';
        document.getElementById('probSuccess').innerText = `${ps}%`;
        document.getElementById('probBreak').innerText   = `${pb}%`;
        document.getElementById('probCommon').innerText  = `${pc}%`;
    }

    // =========================================================
    // EFEITO VISUAL DINÂMICO DE FUSÃO (ALQUIMIA) — Ponto 4
    // Gera um filtro CSS aleatório + distorção/pixelado/ruído únicos
    // a cada fusão, sempre a partir da imagem-base do card resultante.
    // =========================================================
    function buildRandomFusionFilter() {
        const hue = Math.floor(Math.random() * 360);
        const sat = 120 + Math.floor(Math.random() * 220);     // 120% - 340%
        const con = 100 + Math.floor(Math.random() * 140);     // 100% - 240%
        const bri = 70 + Math.floor(Math.random() * 60);       // 70%  - 130%
        const doInvert = Math.random() < 0.35;
        const invertPct = doInvert ? Math.floor(Math.random() * 100) : 0;
        const doGray = Math.random() < 0.2;

        let parts = [
            `hue-rotate(${hue}deg)`,
            `saturate(${sat}%)`,
            `contrast(${con}%)`,
            `brightness(${bri}%)`
        ];
        if (doInvert) parts.push(`invert(${invertPct}%)`);
        if (doGray) parts.push(`grayscale(${20 + Math.floor(Math.random() * 50)}%)`);

        return parts.join(' ');
    }

    /**
     * Renderiza a imagem-base do card fundido com filtro CSS aleatório
     * e, por cima, aplica uma das distorções de pixel (pixelado, ruído
     * estático, "derretido"/stretch) escolhida aleatoriamente, de modo
     * que o resultado visual nunca se repita entre fusões.
     * Retorna uma Promise<string> com o dataURL final (PNG).
     */
    function renderFusedCardVisual(baseImgSrc) {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                const SIZE = 600;
                const canvas = document.createElement('canvas');
                canvas.width = SIZE; canvas.height = SIZE;
                const ctx = canvas.getContext('2d');

                // 1) Desenha a imagem-base já com o filtro CSS aleatório aplicado
                const filterStr = buildRandomFusionFilter();
                ctx.filter = filterStr;
                ctx.drawImage(img, 0, 0, SIZE, SIZE);
                ctx.filter = "none";

                // 2) Escolhe aleatoriamente UMA distorção adicional pra aplicar
                const distortion = ["pixelado", "ruido", "derretido", "nenhuma"][Math.floor(Math.random() * 4)];

                if (distortion === "pixelado") {
                    const blockSize = 6 + Math.floor(Math.random() * 14); // 6-20px
                    const tiny = document.createElement('canvas');
                    const tinyW = Math.max(1, Math.floor(SIZE / blockSize));
                    tiny.width = tinyW; tiny.height = tinyW;
                    const tCtx = tiny.getContext('2d');
                    tCtx.drawImage(canvas, 0, 0, tinyW, tinyW);
                    ctx.imageSmoothingEnabled = false;
                    ctx.clearRect(0, 0, SIZE, SIZE);
                    ctx.drawImage(tiny, 0, 0, tinyW, tinyW, 0, 0, SIZE, SIZE);
                    ctx.imageSmoothingEnabled = true;

                } else if (distortion === "ruido") {
                    // Sobrepõe ruído estático em pequenos blocos translúcidos
                    const noiseCount = 800 + Math.floor(Math.random() * 1200);
                    for (let i = 0; i < noiseCount; i++) {
                        const nx = Math.random() * SIZE;
                        const ny = Math.random() * SIZE;
                        const ns = 1 + Math.random() * 2.5;
                        const shade = Math.floor(Math.random() * 255);
                        ctx.fillStyle = `rgba(${shade},${shade},${shade},${(Math.random() * 0.35).toFixed(2)})`;
                        ctx.fillRect(nx, ny, ns, ns);
                    }
                    // Linhas de scanline aleatórias, estilo TV com defeito
                    const scanlines = 4 + Math.floor(Math.random() * 8);
                    for (let i = 0; i < scanlines; i++) {
                        const ly = Math.random() * SIZE;
                        ctx.fillStyle = `rgba(0,0,0,${(0.1 + Math.random() * 0.25).toFixed(2)})`;
                        ctx.fillRect(0, ly, SIZE, 1 + Math.random() * 3);
                    }

                } else if (distortion === "derretido") {
                    // Efeito "derretido": redesenha em faixas horizontais com
                    // deslocamento horizontal e estiramento vertical aleatório,
                    // crescente em direção à base da imagem.
                    const snapshot = ctx.getImageData(0, 0, SIZE, SIZE);
                    const tmp = document.createElement('canvas');
                    tmp.width = SIZE; tmp.height = SIZE;
                    tmp.getContext('2d').putImageData(snapshot, 0, 0);

                    ctx.clearRect(0, 0, SIZE, SIZE);
                    const strips = 30 + Math.floor(Math.random() * 30);
                    const stripH = SIZE / strips;
                    const maxDrip = 18 + Math.random() * 40;
                    for (let i = 0; i < strips; i++) {
                        const progress = i / strips; // 0 no topo, 1 na base
                        const xOffset = (Math.random() - 0.5) * (8 + progress * 26);
                        const dripStretch = 1 + (progress * progress) * (maxDrip / stripH) * 0.15 * Math.random();
                        const sy = i * stripH;
                        ctx.drawImage(
                            tmp,
                            0, sy, SIZE, stripH,
                            xOffset, sy, SIZE, stripH * dripStretch
                        );
                    }
                }
                // "nenhuma" → mantém só o filtro de cor, sem distorção extra

                // 3) Marca d'água sutil indicando que é resultado de fusão
                ctx.fillStyle = "rgba(0,0,0,0.55)";
                ctx.fillRect(16, SIZE - 40, 150, 28);
                ctx.fillStyle = "#ff00ff";
                ctx.font = "bold 13px 'Space Mono'";
                ctx.fillText("FUSION_OUTPUT", 24, SIZE - 21);

                resolve(canvas.toDataURL());
            };
            img.onerror = () => resolve(baseImgSrc); // fallback: usa imagem original sem efeito
            img.src = baseImgSrc;
        });
    }

    function fuseCards(id1, id2) {
        if (!id1 || !id2) { showCyberAlert('ERRO DE ALQUIMIA', currentLang === 'PT' ? 'Seleciona 2 cards diferentes.' : 'Select 2 different cards.', 'error'); return; }
        if (id1 === id2) { showCyberAlert('ERRO DE ALQUIMIA', currentLang === 'PT' ? 'Os 2 cards devem ser diferentes.' : 'Both cards must be different.', 'error'); return; }

        const c1 = savedAssets.find(a => a.id === id1);
        const c2 = savedAssets.find(a => a.id === id2);
        if (!c1 || !c2) { showCyberAlert('ERRO DE ALQUIMIA', currentLang === 'PT' ? 'Card não encontrado no cofre.' : 'Card not found in vault.', 'error'); return; }
        if (c1.isListed || c2.isListed) { showCyberAlert('🔒 CUSTÓDIA ATIVA', currentLang === 'PT' ? 'Cards em custódia no mercado não podem ser fundidos.' : 'Cards listed on market cannot be fused.', 'error'); return; }

        // Snapshot antes de qualquer alteração
        const snap1 = {...c1}; const snap2 = {...c2};

        const score = (c) => c.rarityType === 'legendary' ? 3 : c.rarityType === 'epic' ? 2 : 1;
        const total = score(c1) + score(c2);

        let ps, pb;
        if (total >= 6)      { ps = 0.70; pb = 0.10; }
        else if (total >= 4) { ps = 0.45; pb = 0.15; }
        else if (total >= 3) { ps = 0.25; pb = 0.20; }
        else                 { ps = 0.10; pb = 0.25; }

        const roll = Math.random();

        // ── FASE 1: animação visual do painel de alquimia ──────────────
        const alchPanel = document.getElementById('alchemyPanel');
        alchPanel.classList.add('alchemy-fusing');
        playSynthSound('click');
        speakPhrase("Iniciando fusão. Aguarde a estabilização.", "Initiating fusion sequence. Stand by.");

        setTimeout(() => {
            alchPanel.classList.remove('alchemy-fusing');

            // ── FASE 2: overlay de glitch por 1500ms ───────────────────────
            const glitchOverlay = document.createElement('div');
            glitchOverlay.id = 'fusionGlitchOverlay';
            glitchOverlay.className = 'fusion-glitch-active';
            Object.assign(glitchOverlay.style, {
                position:       'fixed',
                inset:          '0',
                zIndex:         '9999',
                background:     'rgba(5, 5, 7, 0.92)',
                display:        'flex',
                flexDirection:  'column',
                alignItems:     'center',
                justifyContent: 'center',
                gap:            '18px',
                pointerEvents:  'all',
            });

            // Camada de flash de luz, dispara em pulsos aleatórios durante o overlay
            const flashLayer = document.createElement('div');
            flashLayer.className = 'fusion-flash-layer';
            glitchOverlay.appendChild(flashLayer);

            // Trepidação de tela (shake) no body inteiro durante a fusão
            document.body.classList.add('fusion-screen-shake');

            // Som de "máquina" em loop curto enquanto o overlay está ativo
            playTerminalSound('alchemy');
            const glitchSoundTimer = setInterval(() => playSynthSound('click'), 350);
            // Flashes de luz em instantes aleatórios dentro da janela de 1500ms
            const flashTimers = [300, 650, 1000, 1250].map(delay =>
                setTimeout(() => {
                    flashLayer.classList.add('flash-pulse');
                    setTimeout(() => flashLayer.classList.remove('flash-pulse'), 90);
                    playSynthSound('click');
                }, delay)
            );

            // Texto principal com efeito glitch
            const glitchLabel = document.createElement('div');
            glitchLabel.className = 'loading-glitch loading-glitch-cursor';
            glitchLabel.setAttribute('data-text', currentLang === 'PT' ? 'EXECUTANDO_FUSÃO...' : 'EXECUTING_FUSION...');
            glitchLabel.textContent = currentLang === 'PT' ? 'EXECUTANDO_FUSÃO...' : 'EXECUTING_FUSION...';
            Object.assign(glitchLabel.style, { fontSize: '1.4rem', letterSpacing: '4px' });

            // Linha de status secundária
            const glitchSub = document.createElement('div');
            glitchSub.style.cssText = 'font-family:"Space Mono",monospace; font-size:0.6rem; color:#444466; letter-spacing:2px;';
            const subMessages = [
                'QUEBRANDO VÍNCULOS MOLECULARES...',
                'RECOMBINANDO SEQUÊNCIA DE DNA DIGITAL...',
                'INSTABILIDADE DE REDE DETECTADA...',
                'SINCRONIZANDO MATRIZ DE RARIDADE...',
            ];
            glitchSub.textContent = subMessages[Math.floor(Math.random() * subMessages.length)];

            // Barra de progresso de terminal
            const glitchBar = document.createElement('span');
            glitchBar.className = 'loading-glitch-bar';
            Object.assign(glitchBar.style, { width: '260px', display: 'block' });

            // Scanline sobreposta
            const scanline = document.createElement('div');
            scanline.className = 'loading-glitch-scanline';

            glitchOverlay.appendChild(scanline);
            glitchOverlay.appendChild(glitchLabel);
            glitchOverlay.appendChild(glitchSub);
            glitchOverlay.appendChild(glitchBar);
            document.body.appendChild(glitchOverlay);

            // ── FASE 3: após 1500ms, remove glitch e processa resultado ───
            setTimeout(async () => {
                clearInterval(glitchSoundTimer);
                document.body.classList.remove('fusion-screen-shake');
                glitchOverlay.remove();

                // Remove cartas originais ANTES de qualquer resultado
                savedAssets = savedAssets.filter(a => a.id !== id1 && a.id !== id2);
                marketAssets = marketAssets.filter(m => m.id !== id1 && m.id !== id2);
                saveMarket(marketAssets);

                let result, fusedCard, alertTitle, alertMsg, alertType;

                if (roll < pb) {
                    // FALHA: cartas quebram — sem novo card
                    result = 'break';
                    alertTitle = currentLang === 'PT' ? '💀 FUSÃO DESTRUÍDA' : '💀 FUSION DESTROYED';
                    alertMsg   = currentLang === 'PT'
                        ? `Cards <b>${id1}</b> e <b>${id2}</b> foram destruídos na fusão instável. Nenhum ativo gerado.`
                        : `Cards <b>${id1}</b> and <b>${id2}</b> were destroyed in the unstable fusion. No asset generated.`;
                    alertType = 'error';
                    playSynthSound('shatter');
                    speakPhrase("Fusão destruída. Perda total.", "Fusion destroyed. Total loss.");

                } else if (roll < pb + (1 - ps - pb)) {
                    // ITEM COMUM
                    result = 'common';
                    const newId = "#" + Math.floor(100000 + Math.random() * 900000);
                    const fusedVisual = await renderFusedCardVisual(snap1.imgSrc);
                    fusedCard = {
                        id: newId, rarityType: 'common', rarityName: 'COMUM', rarityNameEN: 'COMMON',
                        styleName: 'RESÍDUO [FUSED]', styleNameEN: 'RESIDUE [FUSED]',
                        creator: currentUser.username, registered: true, exposed: false,
                        forSale: false, isListed: false, price: 0,
                        imgSrc: fusedVisual, isFused: true, tags: ['fused']
                    };
                    savedAssets.push(fusedCard);
                    alertTitle = currentLang === 'PT' ? '◆ FUSÃO PARCIAL' : '◆ PARTIAL FUSION';
                    alertMsg   = currentLang === 'PT'
                        ? `Fusão instável resultou num card comum.<br><b>${newId}</b> — <span style="color:#aaa">COMUM</span>`
                        : `Unstable fusion resulted in a common card.<br><b>${newId}</b> — <span style="color:#aaa">COMMON</span>`;
                    alertType = 'warn';
                    playSynthSound('success');
                    speakPhrase("Fusão parcial. Item comum gerado.", "Partial fusion. Common item generated.");

                } else {
                    // SUCESSO — rarity baseada nos inputs
                    result = 'success';
                    const rarityRoll = Math.random();
                    let newRarity;
                    if (total >= 6)      newRarity = rarityRoll < 0.75 ? 'legendary' : 'epic';
                    else if (total >= 4) newRarity = rarityRoll < 0.35 ? 'legendary' : 'epic';
                    else if (total >= 3) newRarity = rarityRoll < 0.08 ? 'legendary' : 'epic';
                    else                 newRarity = rarityRoll < 0.03 ? 'legendary' : 'epic';

                    const rN   = newRarity === 'legendary' ? 'LENDÁRIO' : 'ÉPICO';
                    const rNEN = newRarity === 'legendary' ? 'LEGENDARY' : 'EPIC';
                    const wc   = newRarity === 'legendary' ? '#00ffff' : '#ffaa00';
                    const nameParts = [snap1.styleName.split(' ')[0], snap2.styleName.split(' ')[0]];
                    const fusedStyle = nameParts.join('×') + ' [FUSED]';
                    const newId = "#" + Math.floor(100000 + Math.random() * 900000);
                    const baseVisualSrc = Math.random() > 0.5 ? snap1.imgSrc : snap2.imgSrc;
                    const fusedVisual = await renderFusedCardVisual(baseVisualSrc);

                    fusedCard = {
                        id: newId, rarityType: newRarity, rarityName: rN, rarityNameEN: rNEN,
                        styleName: fusedStyle, styleNameEN: fusedStyle,
                        creator: currentUser.username, registered: true, exposed: false,
                        forSale: false, isListed: false, price: 0,
                        imgSrc: fusedVisual,
                        isFused: true, tags: ['fused', 'evento']
                    };
                    savedAssets.push(fusedCard);
                    alertTitle = currentLang === 'PT' ? '⚗️ FUSÃO CONCLUÍDA' : '⚗️ FUSION COMPLETE';
                    alertMsg   = currentLang === 'PT'
                        ? `Novo ativo gerado com sucesso!<br><b>${newId}</b> — <span style="color:${wc}">${rNEN}</span><br>Estilo: <b>${fusedStyle}</b><br><small style="color:#666">Este card tem tag [EVENTO] e pode ser usado como banner.</small>`
                        : `New asset successfully generated!<br><b>${newId}</b> — <span style="color:${wc}">${rNEN}</span><br>Style: <b>${fusedStyle}</b><br><small style="color:#666">This card has [EVENT] tag and can be used as banner.</small>`;
                    alertType = 'success';
                    playTerminalSound('alchemy');
                }

                // Persiste
                const userData = registryGet(currentUser.username);
                if (userData) { userData.savedAssets = savedAssets; registrySet(currentUser.username, userData); }
                if (result !== 'break') pushLedger(`${currentUser.username} fundiu ${id1}+${id2} → ${fusedCard.id} [${fusedCard.rarityNameEN}]`);
                else pushLedger(`${currentUser.username} tentou fundir ${id1}+${id2} — FALHA TOTAL`);

                document.getElementById('alchemyPanel').style.display = 'none';
                renderVaultGrid();
                showCyberAlert(alertTitle, alertMsg, alertType);

            }, 1500); // ← 1500ms de glitch antes do pop-up
        }, 1200);
    }

    function viewTargetUserCollection(username, code, bio, avatar, banner, isOwner) {
        selectedProfileUser = username;

        // Identidade
        document.getElementById('profUsername').innerText = username;
        document.getElementById('profCode').innerText = code || '#0000';
        document.getElementById('profBioView').innerText = bio || '';

        // Avatar do usuário logado/visitado (BUGFIX: avatar sumido da tela de perfil)
        const avatarImg = document.getElementById('profAvatarImg');
        if (avatarImg) avatarImg.src = avatar || 'https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg';

        // Banner
        const bannerEl = document.getElementById('profBannerView');
        if (bannerEl) {
            bannerEl.style.backgroundImage = banner ? `url(${banner})` : '';
        }

        // Saldo (somente para o próprio usuário)
        const profBumpsEl = document.getElementById('profBumps');
        if (profBumpsEl) profBumpsEl.innerText = isOwner ? `${currentUser.bumps} B$` : '--- B$';

        // Zona de edição só aparece para o próprio perfil
        const editZone = document.getElementById('profileEditZone');
        if (editZone) editZone.style.display = isOwner ? 'block' : 'none';
        const inputBio = document.getElementById('inputBio');
        if (inputBio) inputBio.value = isOwner ? (bio || '') : '';

        // Vitrine: assets expostos do usuário-alvo
        const sourceAssets = isOwner ? savedAssets : ((registryGet(username) || {}).savedAssets || []);
        const exposedAssets = sourceAssets.filter(a => a.exposed);
        const showcaseGrid = document.getElementById('showcaseGrid');
        if (showcaseGrid) {
            showcaseGrid.innerHTML = '';
            if (exposedAssets.length === 0) {
                showcaseGrid.innerHTML = '<div class="empty-vault-notice" style="grid-column:1/-1;">Nenhum ativo exposto na vitrine.</div>';
            } else {
                exposedAssets.forEach((a) => {
                    const card = document.createElement('div');
                    card.className = `album-card rare-${a.rarityType}`;
                    card.innerHTML = `
                        <div class="album-preview-wrapper"><img src="${a.imgSrc}" draggable="false"></div>
                        <div class="album-meta">
                            <div class="album-id">${a.id}</div>
                            <div class="album-rarity" style="color:${a.rarityType==='legendary'?'#00ffff':a.rarityType==='epic'?'#ffaa00':'#aaaaaa'}">${currentLang === 'PT' ? a.rarityName : a.rarityNameEN}</div>
                        </div>
                    `;
                    card.querySelector('.album-preview-wrapper').addEventListener('click', () => openInspectModal(a));
                    showcaseGrid.appendChild(card);
                });
            }
        }

        const showcaseRankArea = document.getElementById('showcaseRankArea');
        if (showcaseRankArea) computeCollectionLevel(sourceAssets, showcaseRankArea);
    }

    function computeCollectionLevel(items, areaElement) {
        if(!areaElement) return;
        let score = 0;
        items.forEach(i => {
            if (i.rarityType === 'legendary') score += 12;
            else if (i.rarityType === 'epic') score += 6;
            else score += 2;
        });

        if (score >= 24) {
            areaElement.innerHTML = `<div class="showcase-rank-badge rank-godlike">⚡ STATUS: MUTANTE ANCESTRAL // COLECIONADOR SUPERIOR (LVL ${score}) ⚡</div>`;
        } else if (score >= 10) {
            areaElement.innerHTML = `<div class="showcase-rank-badge rank-hype">🔥 STATUS: HYPE HUSTLER // ENGRAZADO DA REDE (LVL ${score})</div>`;
        } else {
            areaElement.innerHTML = `<div class="showcase-rank-badge rank-basic">⚙️ STATUS: RECRUTA DA RECEPTAÇÃO (LVL ${score || 1})</div>`;
        }
    }

    function openAvatarSelector() {
        if(selectedProfileUser !== currentUser.username) return;
        document.getElementById('avatarSelectorModal').style.display = 'flex';
        const grid = document.getElementById('avatarSelectorGrid'); grid.innerHTML = '';

        // Apenas avatares no cofre que NÃO estão em custódia/listados no mercado
        const availableAssets = savedAssets.filter(a => a.isListed === false && a.forSale === false);

        if(availableAssets.length === 0) {
            grid.innerHTML = '<div class="empty-vault-notice" style="grid-column:1/-1;">Cofre sem dados sincronizados.</div>'; return;
        }
        availableAssets.forEach((a) => {
            const div = document.createElement('div'); div.className = 'album-card'; div.style.padding = '5px';
            div.onclick = () => {
                currentUser.avatar = a.imgSrc;
                document.getElementById('profAvatarImg').src = a.imgSrc;
                const userData = registryGet(currentUser.username);
                if(userData) { userData.avatar = a.imgSrc; registrySet(currentUser.username, userData); }
                closeAvatarSelector();
            };
            div.innerHTML = `<div class="album-preview-wrapper"><img src="${a.imgSrc}"></div>`;
            grid.appendChild(div);
        });
    }
    function closeAvatarSelector() { document.getElementById('avatarSelectorModal').style.display = 'none'; }

    const DEFAULT_BANNERS = [
        { id: 'default-neon',   label: 'NEON GRID',     css: 'linear-gradient(135deg, #000510 0%, #001a33 40%, #003366 60%, #000510 100%)' },
        { id: 'default-cyber',  label: 'CYBER CRIMSON', css: 'linear-gradient(135deg, #0d0005 0%, #330011 40%, #660022 60%, #0d0005 100%)' },
        { id: 'default-matrix', label: 'MATRIX PULSE',  css: 'linear-gradient(135deg, #000d00 0%, #001a00 40%, #003300 60%, #000d00 100%)' }
    ];

    function openBannerSelector() {
        document.getElementById('bannerSelectorModal').style.display = 'flex';
        const grid = document.getElementById('bannerSelectorGrid'); grid.innerHTML = '';

        // Default banners (always available)
        const defaultSection = document.createElement('div');
        defaultSection.innerHTML = '<div style="font-size:0.55rem; color:#888899; letter-spacing:2px; margin-bottom:8px;">BANNERS PADRÃO CYBERPUNK</div>';
        const defaultGrid = document.createElement('div');
        defaultGrid.className = 'default-banner-grid';
        DEFAULT_BANNERS.forEach(b => {
            const card = document.createElement('div');
            card.className = 'default-banner-card';
            card.style.background = b.css;
            card.innerHTML = `<span>${b.label}</span>`;
            card.onclick = () => {
                currentUser.banner = b.css;
                const bv = document.getElementById('profBannerView');
                bv.style.backgroundImage = 'none';
                bv.style.background = b.css;
                document.getElementById('bannerLockStatus').innerText = b.label;
                document.getElementById('bannerLockStatus').style.color = '#00ffff';
                const ud = registryGet(currentUser.username);
                if (ud) { ud.banner = b.css; registrySet(currentUser.username, ud); }
                closeBannerSelector();
            };
            defaultGrid.appendChild(card);
        });
        defaultSection.appendChild(defaultGrid);
        grid.appendChild(defaultSection);

        // Event-tagged cards only
        const eventItems = savedAssets.filter(i => i.tags && i.tags.includes('evento') || i.isFused);
        const legacyLegendary = savedAssets.filter(i => i.rarityType === 'legendary' && !(i.tags && i.tags.includes('evento')) && !i.isFused);

        const eventSection = document.createElement('div');
        eventSection.innerHTML = '<div style="font-size:0.55rem; color:#ff00ff; letter-spacing:2px; margin:12px 0 8px;">BANNERS DE EVENTO (CARDS TAG: EVENTO)</div>';

        const allEventCards = [...eventItems, ...legacyLegendary];
        if (allEventCards.length === 0) {
            eventSection.innerHTML += '<div style="color:#666; font-size:0.6rem; padding:8px;">Nenhum card de evento no cofre. Cards [LENDÁRIO] ou com tag Evento desbloqueiam banners personalizados.</div>';
        } else {
            allEventCards.forEach(item => {
                const row = document.createElement('div');
                if (item.isListed) {
                    row.style.cssText = "background:#111; border:1px solid #ff0044; padding:10px; display:flex; justify-content:space-between; align-items:center; opacity:0.5; cursor:not-allowed; margin-bottom:6px;";
                    row.innerHTML = `<span style="font-size:0.65rem; color:#ff0044;">🔒 CUSTÓDIA: ${item.id}</span>`;
                } else {
                    row.style.cssText = "background:#111; border:1px solid #ff00ff; padding:10px; display:flex; justify-content:space-between; align-items:center; cursor:pointer; margin-bottom:6px;";
                    row.innerHTML = `<img src="${item.imgSrc}" style="width:40px;height:40px;object-fit:cover;border:1px solid #ff00ff;margin-right:10px;"><span style="font-size:0.65rem; color:#fff; flex:1;">${item.id} [${item.rarityNameEN}]</span>`;
                    row.onclick = () => {
                        currentUser.banner = item.imgSrc;
                        document.getElementById('profBannerView').style.backgroundImage = `url(${item.imgSrc})`;
                        document.getElementById('bannerLockStatus').innerText = `BANNER: ${item.id}`;
                        document.getElementById('bannerLockStatus').style.color = '#00ffff';
                        const ud = registryGet(currentUser.username);
                        if(ud) { ud.banner = item.imgSrc; registrySet(currentUser.username, ud); }
                        closeBannerSelector();
                    };
                }
                eventSection.appendChild(row);
            });
        }
        grid.appendChild(eventSection);
    }
    function closeBannerSelector() { document.getElementById('bannerSelectorModal').style.display = 'none'; }

    function viewExternalProfile(username) {
        closeInspectModal();
        // Lê sempre do registry centralizado
        const p = registryGet(username);
        if(p) {
            viewTargetUserCollection(p.username, p.code, p.bio, p.avatar, p.banner, p.username === currentUser.username);
        } else {
            viewTargetUserCollection(username, "#9999", "Membro estável.", "https://i.ibb.co/8Dkmrttv/Homer-Simpson-swag-pfp.jpg", "", false);
        }
        navigateTo('profile');
    }

    function saveProfileCustoms() {
        const bioVal = document.getElementById('inputBio').value;
        currentUser.bio = bioVal;
        const bioView = document.getElementById('profBioView');
        if (bioView) bioView.innerText = bioVal;
        const userData = registryGet(currentUser.username);
        if(userData) { userData.bio = bioVal; registrySet(currentUser.username, userData); }
    }

    function openDepositModal() { document.getElementById('depositModal').style.display = 'flex'; }
    function closeDepositModal() { document.getElementById('depositModal').style.display = 'none'; }

    function simularDeposito(amount) {
        currentUser.bumps += amount;
        const profBumpsEl = document.getElementById('profBumps');
        if (profBumpsEl) profBumpsEl.innerText = `${currentUser.bumps} B$`;
        // Ponto 1: persiste saldo actualizado
        const userData = registryGet(currentUser.username);
        if(userData) { userData.bumps = currentUser.bumps; registrySet(currentUser.username, userData); }
        playSynthSound('success');
        closeDepositModal();
        // Ponto 2: alerta cyberpunk em vez de browser alert
        showCyberAlert('// INJEÇÃO DE CARGA CONCLUÍDA //', `+<b>${amount} B$</b> adicionados ao teu terminal.<br>Saldo actual: <b>${currentUser.bumps} B$</b>`, 'success');
    }

    function setUserStatus(status) {
        currentUser.status = status;
        const dot = document.getElementById('userStatusDot');
        const sc = status === 'away' ? 'status-away' : status === 'busy' ? 'status-busy' : 'status-online';
        if (dot) dot.className = `user-status-dot ${sc}`;
        document.querySelectorAll('#statusSelectorZone .status-btn').forEach(b => {
            b.className = 'status-btn' + (b.dataset.s === status ? ` active-${status === 'online' ? 'online' : status === 'away' ? 'away' : 'busy'}` : '');
        });
        const ud = registryGet(currentUser.username);
        if (ud) { ud.status = status; registrySet(currentUser.username, ud); }
    }

    buildStoriesMarquee();
    renderQuotesTicker();

