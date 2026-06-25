// =========================================================
// dr0p_station — MÓDULO: market-quotes-feed.js
// MERCADO (cotações/ledger), notificações, alertas, paginação, feed global + realtime
//
// Parte 3 de 14 do script.js original (split automático,
// ORDEM DE CARREGAMENTO PRESERVADA — não mudar a ordem dos <script> no HTML).
// =========================================================


    // =========================================================
    // PERSISTÊNCIA DO MERCADO — Ponto 1
    // ⚠️ loadMarket/saveMarket (localStorage) foram REMOVIDOS.
    // O mercado agora é persistido na tabela `cards` (for_sale + is_listed)
    // via loadMarketFromSupabase / listCardOnMarket / unlistCardFromMarket /
    // buyCardFromMarket (ver Parte 5/4, mais abaixo no arquivo).
    // =========================================================
    const NOTIF_KEY   = 'dr0p_notifications';
    // LEDGER_KEY removido: o ledger global agora vive na tabela pública
    // `eventos_globais` (ver ledgerCache / pushLedger / fetchAndSeedGlobalEvents),
    // não mais em localStorage.

    // =========================================================
    // SISTEMA DE COTAÇÃO EM TEMPO REAL (MARKET QUOTES ENGINE)
    // =========================================================
    const QUOTES_KEY = 'dr0p_market_quotes';

    // Cotação base de cada raridade (preço de referência em B$)
    const BASE_QUOTES = {
        common:    { base: 10,   label: 'COMUM',     labelEN: 'COMMON'    },
        epic:      { base: 80,   label: 'ÉPICO',     labelEN: 'EPIC'      },
        legendary: { base: 300,  label: 'LENDÁRIO',  labelEN: 'LEGENDARY' },
        ancestral: { base: 2000, label: 'ANCESTRAL', labelEN: 'ANCESTRAL' }
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
            legendary: { price: BASE_QUOTES.legendary.base, change: 0, trend: 'up' },
            ancestral: { price: BASE_QUOTES.ancestral.base, change: 0, trend: 'up' }
        };
    }

    function saveMarketQuotes(quotes) {
        try { localStorage.setItem(QUOTES_KEY, JSON.stringify(quotes)); } catch(e) {}
    }

    let currentLang = (localStorage.getItem('dr0p_lang') || 'PT');
    let audioCtx = null;
    let isBgmPlaying = false;
    let bgmInterval = null;

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

        const rollPct = () => 0.02 + Math.random() * 0.07;

        function applyMove(key, direction) {
            if (!q[key]) return;
            const base = BASE_QUOTES[key].base;
            const pct = rollPct() * direction;
            let newPrice = q[key].price * (1 + pct);
            const floor = base * QUOTE_FLOOR_MULT;
            const ceil  = base * QUOTE_CEIL_MULT;
            newPrice = Math.max(floor, Math.min(ceil, newPrice));
            const changePct = ((newPrice - q[key].price) / q[key].price) * 100;
            q[key].change = changePct;
            q[key].trend  = newPrice >= q[key].price ? 'up' : 'down';
            q[key].price  = Math.round(newPrice * 100) / 100;
        }

        if (droppedRarity === 'ancestral') {
            applyMove('ancestral', -1);
            applyMove('legendary', 1);
            applyMove('epic', 1);
        } else if (droppedRarity === 'epic') {
            applyMove('epic', -1);
        } else if (droppedRarity === 'legendary') {
            applyMove('legendary', -1);
        } else {
            applyMove('epic', 1);
            applyMove('legendary', 1);
            applyMove('common', -1);
        }

        saveMarketQuotes(q);
        renderQuotesTicker();
        return q;
    }

    function renderQuotesTicker() {
        const tracks = [
            document.getElementById('tickerGlobalTrack')
        ].filter(Boolean);
        if (tracks.length === 0) return;

        const order = ['common', 'epic', 'legendary', 'ancestral'];
        const isPT = currentLang === 'PT';

        const itemsHtml = order.map(key => {
            if (!marketQuotes[key]) return '';
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

        const fullHtml = itemsHtml + itemsHtml;
        tracks.forEach(track => track.innerHTML = fullHtml);
    }

    // =========================================================
    // LEDGER DE TRANSAÇÕES GLOBAIS (Ponto 4)
    // BUGFIX (site "zerado" em aba anônima/outra conta): isto ANTES lia/
    // escrevia em localStorage (LEDGER_KEY), que é local a cada navegador —
    // nenhuma outra aba/sessão via essas entradas. Agora `ledgerCache` é só
    // um espelho em memória da tabela pública `eventos_globais`, populado
    // no boot por fetchAndSeedGlobalEvents() e mantido vivo por Realtime
    // (ver initGlobalRealtime(), mais abaixo) — qualquer aba, logada ou
    // anônima, vê a MESMA lista, atualizada instantaneamente.
    // =========================================================
    let ledgerCache = [];
    function loadLedger() {
        return ledgerCache;
    }
    async function pushLedger(entry) {
        // Só usuários autenticados geram atividade real e atribuível —
        // mesmo padrão de RLS usado em cards/inventario (auth.uid() = id_usuario).
        if (!currentUser.loggedIn) return;
        try {
            const { error } = await sb.from('eventos_globais').insert({
                id_usuario: currentUser.id,
                username: currentUser.username,
                tipo: 'ledger',
                mensagem: entry
            });
            if (error) console.error('pushLedger:', error.message);
        } catch (e) { console.error('pushLedger:', e); }
        // Não precisa atualizar ledgerCache/renderMarketLedger aqui na mão —
        // o INSERT acima dispara o evento Realtime em initGlobalRealtime(),
        // que já cuida de inserir no cache e re-renderizar pra TODO mundo
        // (inclusive esta própria aba), de forma consistente.
    }

    function renderMarketLedger() {
        const box  = document.getElementById('marketLedgerBox');
        const list = document.getElementById('marketLedgerList');
        if (!box || !list) return;
        const ledger = loadLedger();
        if (ledger.length === 0) { box.style.display = 'none'; stopLedgerAutoScroll(); return; }
        box.style.display = 'block';
        const last10 = ledger.slice(0, 10);
        list.innerHTML = last10.map((e, i) =>
            `<div class="ledger-entry ledger-entry-expanded" style="animation-delay:${i * 0.08}s;">
                <span class="ledger-ts">[${e.ts}]</span>
                <span class="ledger-text">${e.text}</span>
             </div>`
        ).join('');
        startLedgerAutoScroll(list);
    }

    // Faz o feed "respirar": rola suavemente para o próximo item a cada
    // poucos segundos, dando sensação de movimento contínuo e dinâmico.
    //
    // BUGFIX (scroll vazando pra página inteira): `entries[idx].scrollIntoView()`
    // sobe por TODOS os ancestrais roláveis até a window, pra garantir a
    // visibilidade total do elemento — então, a cada 2.6s, o "respiro" do
    // ledger também arrastava a PÁGINA INTEIRA junto (mesmo #marketLedgerBox
    // já tendo seu próprio overflow-y:auto). Trocado por scroll manual via
    // scrollTop/scrollTo, isolado SÓ no container interno do ledger — nunca
    // mais toca no scroll da janela. State também isolado: o timer agora é
    // explicitamente encerrado (stopLedgerAutoScroll) sempre que o ledger
    // fica vazio/escondido ou quando o usuário sai da tela de Mercado
    // (ver navigateTo), evitando rodar em segundo plano sem necessidade.
    let ledgerAutoScrollTimer = null;
    function startLedgerAutoScroll(list) {
        if (ledgerAutoScrollTimer) clearInterval(ledgerAutoScrollTimer);
        const entries = list.querySelectorAll('.ledger-entry');
        if (entries.length <= 1) return;

        const scrollBox = list.closest('#marketLedgerBox') || list.parentElement;
        let idx = 0;
        ledgerAutoScrollTimer = setInterval(() => {
            idx = (idx + 1) % entries.length;
            if (!scrollBox) return;
            const target = entries[idx].offsetTop - scrollBox.offsetTop;
            if (typeof scrollBox.scrollTo === 'function') {
                scrollBox.scrollTo({ top: target, behavior: 'smooth' });
            } else {
                scrollBox.scrollTop = target;
            }
        }, 2600);
    }
    function stopLedgerAutoScroll() {
        if (ledgerAutoScrollTimer) { clearInterval(ledgerAutoScrollTimer); ledgerAutoScrollTimer = null; }
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

    // Política de Privacidade — modal próprio (rolável), reaproveita o
    // visual do cyber-alert mas com sua própria overlay/box para não
    // conflitar com showCyberAlert() caso algo dispare um alerta por trás.
    function openPrivacyPolicy() {
        const overlay = document.getElementById('privacyPolicyOverlay');
        if (overlay) overlay.classList.add('visible');
    }
    function closePrivacyPolicy() {
        const overlay = document.getElementById('privacyPolicyOverlay');
        if (overlay) overlay.classList.remove('visible');
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
            const isActive = b.dataset.filter === f;
            b.className = 'filter-btn' + (isActive
                ? (f==='epic'?' active-epic': f==='legendary'?' active-legendary': f==='ancestral'?' active-ancestral':' active')
                : '');
        });
        renderVaultGrid();
    }
    function setMarketFilter(f) {
        marketFilter = f; marketPage = 0;
        document.querySelectorAll('#marketFilterBar .filter-btn').forEach(b => {
            const isActive = b.dataset.filter === f;
            b.className = 'filter-btn' + (isActive
                ? (f==='epic'?' active-epic': f==='legendary'?' active-legendary': f==='ancestral'?' active-ancestral':' active')
                : '');
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

    // =========================================================
    // FEED GLOBAL DE MUTAÇÕES/FUSÕES (Ponto 1) — AGORA REAL E PÚBLICO
    // BUGFIX (site "zerado" em aba anônima/outra conta): isto ANTES persistia
    // em localStorage (GLOBAL_FEED_KEY) — cada navegador/aba só via os
    // próprios drops/fusões, nunca os de mais ninguém. `globalFeed` segue
    // existindo como array em memória (buildStoriesMarquee() e o resto do
    // app continuam lendo daqui sem mudança), mas quem alimenta esse array
    // agora é a tabela pública `eventos_globais` (tipo='feed'), carregada no
    // boot por fetchAndSeedGlobalEvents() e atualizada ao vivo por
    // initGlobalRealtime() — qualquer aba, logada ou anônima, vê os MESMOS
    // drops/fusões em tempo real.
    //
    // BUGFIX (perfis fantasmas @cyber_k1ng / @neon_samurai): removido o
    // antigo SEED_FEED estático que era usado como "fallback cosmético"
    // antes do banco responder. Isso fazia QUALQUER aba mostrar dois cards
    // falsos por uma fração de segundo (ou indefinidamente, se o fetch
    // falhasse) — perfis que não existem no Supabase. Agora o estado
    // inicial é sempre um array vazio, e a UI mostra um aviso de
    // "carregando" explícito (ver globalFeedLoading + buildStoriesMarquee())
    // em vez de inventar dados, até a primeira resposta real da rede
    // chegar — mesmo que essa resposta seja "ainda não há nenhum evento".
    // =========================================================
    let globalFeed = [];
    let globalFeedLoading = true;

    // [BUGFIX MUTAÇÕES_REDE] Rede de segurança: se por qualquer motivo
    // (latência alta, aba aberta antes do Supabase client terminar de
    // inicializar, erro silencioso engolido por algum catch) a primeira
    // resposta de fetchAndSeedGlobalEvents() demorar mais que isto, força
    // globalFeedLoading=false e repinta — assim o usuário NUNCA vê o feed
    // travado pra sempre no "carregando", nem (pior) um "nenhum drop
    // aconteceu" que seria mentira por causa de uma resposta que ainda nem
    // chegou. Cancelado automaticamente assim que a resposta real chega
    // (ver fetchAndSeedGlobalEvents).
    let _globalFeedSafetyTimer = null;
    function _armGlobalFeedSafetyTimeout() {
        clearTimeout(_globalFeedSafetyTimer);
        _globalFeedSafetyTimer = setTimeout(() => {
            if (globalFeedLoading) {
                console.warn('[MUTAÇÕES_REDE] fetchAndSeedGlobalEvents demorou demais — tentando novamente.');
                fetchAndSeedGlobalEvents();
            }
        }, 6000);
    }

    // Mercado: array em memória que renderMarketGrid() lê/filtra/pagina.
    // Fonte de verdade real é a tabela `cards` no Supabase — este array é
    // só um CACHE preenchido por loadMarketFromSupabase() sempre que a
    // tela de mercado é aberta ou uma ação (listar/comprar/remover) muda
    // o estado, OU quando o Realtime de `cards` detecta uma mudança feita
    // por QUALQUER usuário (ver initGlobalRealtime()) — assim o mercado se
    // atualiza ao vivo pra todo mundo, sem precisar de F5.
    let marketAssets = [];

    // =========================================================
    // REALTIME GLOBAL (Supabase) — fonte real e pública de:
    //   • eventos_globais → ledger de mercado + feed de drops/fusões
    //   • cards            → listagens/vendas/vitrine, refletidas ao vivo
    // Substitui de raiz qualquer dependência de dados mockados/locais
    // (localStorage) pra esses dois feeds. Roda incondicionalmente no boot
    // do script (ver chamada de initGlobalRealtime() perto do
    // onAuthStateChange, Parte 1), ANTES de qualquer login — inclusive em
    // aba anônima, já que a leitura de ambas as tabelas é pública via RLS.
    // =========================================================
    function rowToLedgerEntry(row) {
        return { text: row.mensagem, ts: new Date(row.created_at).toLocaleTimeString('pt-PT') };
    }
    function rowToFeedCard(row) {
        return row.card_payload ? { ...row.card_payload, _eventId: row.id } : null;
    }

    // Publica um card consolidado (drop resgatado ou fusão bem-sucedida) no
    // feed público. Substitui os antigos `globalFeed.unshift(...) +
    // saveGlobalFeed(...)` — a re-renderização do marquee acontece via
    // Realtime (initGlobalRealtime), de forma consistente pra TODO mundo,
    // inclusive quem disparou a ação.
    async function pushFeedCard(cardLike) {
        if (!currentUser.loggedIn) return;
        try {
            const { error } = await sb.from('eventos_globais').insert({
                id_usuario: currentUser.id,
                username: currentUser.username,
                tipo: 'feed',
                mensagem: `${currentUser.username} consolidou ${cardLike.id} [${cardLike.rarityNameEN}]`,
                card_payload: cardLike
            });
            if (error) console.error('pushFeedCard:', error.message);
        } catch (e) { console.error('pushFeedCard:', e); }
    }

    // Busca os últimos eventos reais da rede e usa pra popular ledgerCache
    // (ledger do mercado) e globalFeed (marquee de stories) — chamado uma
    // única vez no boot, antes de qualquer subscrição Realtime.
    async function fetchAndSeedGlobalEvents() {
        _armGlobalFeedSafetyTimeout();
        const { data, error } = await sb.from('eventos_globais')
            // ANTI-EGRESS: select(*) trazia TODAS as colunas (inclusive
            // colunas grandes não usadas aqui) para os 50 últimos eventos,
            // multiplicado por toda visita à página (até de visitantes
            // deslogados). rowToLedgerEntry/rowToFeedCard só leem estas 4.
            .select('id, mensagem, created_at, card_payload')
            .order('created_at', { ascending: false })
            .limit(50);
        clearTimeout(_globalFeedSafetyTimer);
        if (error) {
            console.error('fetchAndSeedGlobalEvents:', error.message);
            globalFeedLoading = false; // não deixa o aviso de "carregando" travado pra sempre em caso de falha de rede
            buildStoriesMarquee();
            return;
        }

        ledgerCache = data.map(rowToLedgerEntry);

        const feedCards = data.map(rowToFeedCard).filter(Boolean);
        // Sempre usa o que veio do banco — mesmo que seja um array vazio
        // (rede nova, sem eventos ainda). Não há mais fallback pra dados
        // estáticos/fantasma: array vazio é um estado real e válido.
        globalFeed = feedCards;
        globalFeedLoading = false;

        renderMarketLedger();
        buildStoriesMarquee();
    }

    // Assina os canais Realtime públicos. Roda incondicionalmente (logado
    // ou não) — é o que faz o ecossistema parecer "vivo" em QUALQUER aba,
    // inclusive anônima, sem precisar dar F5.
    let _globalRealtimeStarted = false;
    function initGlobalRealtime() {
        if (_globalRealtimeStarted) return; // evita assinar 2x (ex: hot reload / re-chamada acidental)
        _globalRealtimeStarted = true;

        fetchAndSeedGlobalEvents();

        // Ledger + marquee: qualquer INSERT em eventos_globais (de QUALQUER
        // usuário, em QUALQUER aba) chega aqui instantaneamente.
        sb.channel('eventos_globais_live')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'eventos_globais' }, (payload) => {
                const row = payload.new;
                ledgerCache.unshift(rowToLedgerEntry(row));
                if (ledgerCache.length > 50) ledgerCache.length = 50;

                const card = rowToFeedCard(row);
                if (card) {
                    globalFeed.unshift(card);
                    if (globalFeed.length > 50) globalFeed.length = 50;
                    buildStoriesMarquee();
                }
                // Só repinta o ledger se a tela de mercado estiver mesmo
                // aberta — evita trabalho de DOM desnecessário em outras telas.
                const marketScreen = document.getElementById('screen-market');
                if (marketScreen && marketScreen.classList.contains('active')) renderMarketLedger();
            })
            .subscribe();

        // Mercado/vitrine: qualquer INSERT/UPDATE/DELETE em `cards` (nova
        // listagem, venda, remoção, exposição na vitrine) de QUALQUER
        // usuário atualiza a tela de mercado de todo mundo ao vivo.
        sb.channel('cards_live')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'cards' }, () => {
                const marketScreen = document.getElementById('screen-market');
                if (marketScreen && marketScreen.classList.contains('active')) renderMarketGrid();
            })
            .subscribe();
    }


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

    // ── POOL DE IMAGENS DOS DROPS ─────────────────────────────────────
    // Removido o pool fixo de imgbb (eram só imagens de teste). Agora as
    // imagens dos drops vêm 100% do bucket privado `high-res-assets`
    // (Supabase Storage) — qualquer imagem que você subir lá passa a
    // poder sair num drop aleatório. preloadedCanvasPaths[i] guarda o
    // NOME DO ARQUIVO no bucket que corresponde a preloadedCanvases[i],
    // pra sabermos depois, no card já mintado, qual arquivo original
    // pedir ao clicar em "Obter Item" (ver loadDropImagePoolFromBucket
    // mais abaixo e executeDoubleAssetDownload).
    const preloadedCanvases = [];
    const preloadedCanvasPaths = [];
    let lastMintedBuffer = null; let activeAssetData = null; let decayInterval = null; let isRolling = false;
    let isProcessingClaim = false; // Mutex global: impede duplicação e debito duplo de Bumps

    const dictionary = {
        PT: {
            'nav-market': 'MERCADO P2P', 'nav-inbox': 'INBOX SECRETO', 'nav-vault': 'MEU COFRE', 'nav-access': 'ACESSAR TERMINAL',
            'feed-title': 'MUTAÇÕES_REDE', 'lbl-rarity': 'RARIDADE', 'lbl-style': 'ESTILO VISUAL', 'lbl-creator': 'AUTOR DA MINTAGEM',
            'vault-title': 'MEU COFRE', 'market-title': 'MERCADO P2P DIRECT', 'messages-title': 'INBOX // DIALOGOS_CRIPTOGRAFADOS', 'profile-showcase': 'VITRINE EXPOSTA',
            'lbl-id': 'CÓDIGO ID CARD', 'free-sub': 'RISCO DE QUEBRA // FLUXO INESTÁVEL', 'premium-sub': '100% SEGURO // GARANTIA DE COMPILAÇÃO',
            'faq-title': '> TERMINAL_INFO // PERGUNTAS_FREQUENTES',
            'faq-q1': '[+] O que é o dr0p_station?',
            'faq-a1': '▸ Plataforma P2P de cards digitais gerados por IA. Cada card é único, rastreado no registry e negociável em B$ (Bumps).',
            'faq-q2': '[+] O que são Bumps (B$)?',
            'faq-a2': '▸ Moeda interna da rede. Usada para resgatar cards épicos/lendários, comprar no mercado P2P e propor trocas. Carregue via PIX ou cripto.',
            'faq-q3': '[+] O que acontece se não resgatar a tempo?',
            'faq-a3': '▸ A mutação se autodestrói em 10 segundos por instabilidade de rede. O card é removido do feed global permanentemente.',
            'faq-q4': '[+] Como funciona a Alquimia?',
            'faq-a4': '▸ Funde 2 cards do seu cofre para criar um novo. Os originais são destruídos. Raridade resultante depende dos cards usados + roll de probabilidade.',
            'faq-q5': '[+] Quem pode ver meu perfil e cards?',
            'faq-a5': '▸ Perfis públicos são visíveis a todos. Cards expostos na vitrine aparecem no feed. O mercado é público mas compras exigem login.',
            'faq-q6': '[+] Existe risco de perder cards na Fornalha ou em Contratos?',
            'faq-a6': '▸ Sim. Tanto a Fornalha de Sobrecarga quanto os Contratos envolvem risco real de destruição permanente da carta submetida — uma vez confirmada a operação, instabilidades de rede podem corromper o ativo sem aviso prévio, sem direito a estorno. Cards destruídos rendem Fragmentos de Sucata como compensação parcial, nunca o card em si.',
            'faq-q7': '[+] De onde vêm as artes dos cards?',
            'faq-a7': '▸ O terminal intercepta sinais soltos pela rede mundial — referências de cultura pop, memes e ruído visual coletivo — e os processa através de algoritmos de mutação visual próprios. O resultado é uma paródia artística reinterpretada e única, gerada pela própria rede dr0p_station.',
            'log-prefix': 'LOG // ', 'download-btn': 'RESGATAR ATIVO',
            'stability-label': 'TEMPO DE RESGATE: 10s',
            'market-landing-sub': 'VISUALIZAÇÃO PÚBLICA — LOGIN NECESSÁRIO PARA COMPRAR',
            'premium-instant-badge': '✓ RESGATE GARANTIDO // COMPILAÇÃO IMEDIATA'
        },
        EN: {
            'nav-market': 'P2P MARKET', 'nav-inbox': 'SECRET INBOX', 'nav-vault': 'MY VAULT', 'nav-access': 'ACCESS TERMINAL',
            'feed-title': 'NETWORK_MUTATIONS', 'lbl-rarity': 'RARITY', 'lbl-style': 'VISUAL STYLE', 'lbl-creator': 'MINT AUTHOR',
            'vault-title': 'MY SECURE VAULT', 'market-title': 'P2P MARKET DIRECT', 'messages-title': 'INBOX // ENCRYPTED_CHATS', 'profile-showcase': 'EXPOSED SHOWCASE',
            'lbl-id': 'CARD ID CODE', 'free-sub': 'RISK OF SHATTER // UNSTABLE FLOW', 'premium-sub': '100% SECURE // COMPILATION WARRANTY',
            'faq-title': '> TERMINAL_INFO // FREQUENTLY ASKED',
            'faq-q1': '[+] What is dr0p_station?',
            'faq-a1': '▸ P2P platform for AI-generated digital cards. Each card is unique, tracked in the registry and tradeable in B$ (Bumps).',
            'faq-q2': '[+] What are Bumps (B$)?',
            'faq-a2': '▸ Internal network currency. Used to claim epic/legendary cards, buy on P2P market and propose trades. Load via PIX or crypto.',
            'faq-q3': '[+] What happens if I don\'t claim in time?',
            'faq-a3': '▸ The mutation self-destructs in 10 seconds due to network instability. The card is permanently removed from the global feed.',
            'faq-q4': '[+] How does Alchemy work?',
            'faq-a4': '▸ Fuse 2 cards from your vault to create a new one. Originals are destroyed. Resulting rarity depends on input cards + probability roll.',
            'faq-q5': '[+] Who can see my profile and cards?',
            'faq-a5': '▸ Public profiles visible to all. Cards exposed in showcase appear in feed. Market is public but purchases require login.',
            'faq-q6': '[+] Is there a risk of losing cards in the Furnace or Contracts?',
            'faq-a6': '▸ Yes. Both the Overload Furnace and Contracts carry a real risk of permanent destruction of the submitted card — once the operation is confirmed, network instabilities can corrupt the asset without prior warning, with no refund. Destroyed cards yield Scrap Fragments as partial compensation, never the card itself.',
            'faq-q7': '[+] Where do the card arts come from?',
            'faq-a7': '▸ The terminal intercepts stray signals from the global network — pop culture references, memes and collective visual noise — and processes them through proprietary visual mutation algorithms. The result is a unique, reinterpreted artistic parody generated by the dr0p_station network itself.',
            'log-prefix': 'LOG // ', 'download-btn': 'CLAIM ASSET',
            'stability-label': 'CLAIM TIME LEFT: 10s',
            'market-landing-sub': 'PUBLIC VIEW — LOGIN REQUIRED TO PURCHASE',
            'premium-instant-badge': '✓ GUARANTEED CLAIM // IMMEDIATE COMPILATION'
        }
    };

    const CYBER_VOICES = {
        PT: [
            "Acesso concedido.", "Brecha de dados detectada.", "dr0p_station online.", "Mutação instável.",
            "Ativo integrado ao cofre.", "Protocolo de fusão iniciado.", "Rede segura estabelecida.",
            "Identidade verificada.", "Transmissão criptografada.", "Alerta de rede ativado.",
            "Compra confirmada.", "Card lendário detectado.", "Terminal ativado. Bem-vindo, operador."
        ],
        EN: [
            "Access granted.", "Data breach detected.", "dr0p_station online.", "Mutation unstable.",
            "Asset secured in vault.", "Fusion protocol initiated.", "Secure channel established.",
            "Identity verified.", "Encrypted transmission.", "Network alert activated.",
            "Purchase confirmed.", "Legendary card detected.", "Terminal activated. Welcome, operator."
        ]
    };

