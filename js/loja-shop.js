// =========================================================
// dr0p_station — MÓDULO: loja-shop.js
// LOJA — cosméticos, inventário de relíquias, efeitos de equipamento
//
// Parte 13 de 14 do script.js original (split automático,
// ORDEM DE CARREGAMENTO PRESERVADA — não mudar a ordem dos <script> no HTML).
// =========================================================

// ID da div onde a Loja será injetada. Troque para o id real da sua
// div de conteúdo principal se ela já existir (ex: 'screen-loja').
const LOJA_TARGET_ID = 'lojaScreen';

// Estado local de cosméticos comprados. Fonte de verdade é o Supabase
// (coluna profiles.cosmetics) — currentUser.cosmetics já vem populado dali
// no login/refresh (ver applyProfileToCurrentUser). lojaOwnedItems deixou
// de existir como array mock separado: tudo lê/escreve direto em
// currentUser.cosmetics, pra nunca dessincronizar do banco.

// ── PONTO ET PUNK — comerciante da Loja trocado de robô (🤖 "Spike") pra
// um ET com estética punk ("ZRK", abreviação de "Zarkrin", o nome real é
// impronunciável em qualquer idioma humano). Mantido o nome da constante
// (SPIKE_LINES_LOJA) por compatibilidade com qualquer outro ponto do
// código que ainda referencie esse identificador — só o CONTEÚDO das
// falas e a renderização visual (lojaBuildMarkup) mudaram.
const SPIKE_LINES_LOJA = [
    "Hackeei o firmware da nave só pra abrir essa loja aqui. Valeu a pena.",
    "Root no mainframe, root no seu cartão. Mesma técnica, planetas diferentes.",
    "Atravessei sete firewalls intergalácticos pra te vender essa moldura.",
    "Bumps são só números num banco de dados. Eu já invadi bancos de dados melhores que esse.",
    "Garantia? Aqui não. Mas o exploit que usei pra entrar nessa estação, esse sim era sólido.",
    "Sucateiro raiz desde antes do colapso da Rede Outer. E sysadmin não-certificado desde sempre.",
    "Se a luz neon queimar seu olho, já era — não devolvo B$. Reporta bug, eu rio.",
    "Tenho exploits novos chegando. Ou não. Depende do humor do firewall da Terra.",
    "Não pirateei sua nave-mãe. Ainda. Compra logo essa moldura.",
    "Meu antivírus é desconfiança. O seu devia ser também.",
    "Decodifiquei sua linguagem em 0.3 segundos. Seus preços, em menos ainda.",
    "Punk não morre, só recompila."
];

// Moldura padrão (frame-style-1) não é vendida na Loja — todo usuário já
// nasce com ela equipada (ver currentUser.avatarFrame inicial). Por isso não
// entra em LOJA_FRAME_ITEMS (que só lista o que é comprável), mas precisa
// de uma entrada de raridade própria pro seletor/filtro saber como tratá-la.
const FRAME_DEFAULT_ID = 'frame-style-1';
const EQUIPMENT_INVENTORY_TARGET_ID = 'profEquipmentInventoryZone';
const FRAME_DEFAULT_RARITY = 'raro';

const LOJA_FRAME_ITEMS = [
    { id: 'frame-style-2', category: 'moldura', name: 'Neon Pulse',           price: 1000, accent: '#00ffff', tagline: 'Pulso cíclico de luz fria ao redor do avatar.', rarity: 'raro' },
    { id: 'frame-style-3', category: 'moldura', name: 'Glitch Core',          price: 2200, accent: '#ff00ff', tagline: 'Distorção de sinal instável. Estética de corrompido.', rarity: 'lendario' },
    { id: 'frame-style-4', category: 'moldura', name: 'Apocalypse Override',  price: 3500, accent: '#ff0044', tagline: 'Moldura de emergência de núcleo. Só pra raridade alta.', rarity: 'ancestral' }
];

// ── Categoria "Molduras de Sub-Rede": linha de molduras de entrada,
// vendida separada das molduras principais (LOJA_FRAME_ITEMS). Usa a
// mesma category 'moldura' pra reaproveitar toda a lógica de equip já
// existente (setAvatarFrame / cosmeticSlotForCategory ignora 'moldura'
// de qualquer forma, pois molduras usam slot próprio).
const LOJA_SUBNET_FRAME_ITEMS = [
    { id: 'frame-subnet-static-pulse', category: 'moldura', name: 'Static Pulse', price: 250, accent: '#88aaff', tagline: 'Ruído de sinal fraco da sub-rede. Pulso instável, preço de entrada.', rarity: 'raro' }
];

const LOJA_BACKGROUND_ITEMS = [
    { id: 'bg-neon-glow',   category: 'fundo', name: 'Luz Neon de Fundo',  price: 850, accent: '#ffaa00', tagline: 'Glow ambiente atrás do perfil. Liga sozinho à noite.', colorKey: 'amber' },
    { id: 'bg-neon-toxic',  category: 'fundo', name: 'Luz Neon Tóxica',    price: 850, accent: '#22c55e', tagline: 'Glow verde tóxico ao redor da caixa de perfil.', colorKey: 'green' },
    { id: 'bg-neon-violet', category: 'fundo', name: 'Luz Neon Violeta',   price: 950, accent: '#a855f7', tagline: 'Glow roxo-elétrico, vibe synthwave.', colorKey: 'purple' }
];

// Mapa colorKey → classes Tailwind reais aplicadas no profile-main-box quando
// o acessório de fundo correspondente está equipado (Ponto 4 — efeito real,
// não decorativo).
const NEON_BG_TAILWIND_CLASSES = {
    amber:  ['shadow-[inset_0_0_50px_rgba(255,170,0,0.35)]',  'bg-gradient-to-b', 'from-amber-950/40',  'to-transparent'],
    green:  ['shadow-[inset_0_0_50px_rgba(34,197,94,0.3)]',   'bg-gradient-to-b', 'from-green-950/40',  'to-transparent'],
    purple: ['shadow-[inset_0_0_50px_rgba(168,85,247,0.35)]', 'bg-gradient-to-b', 'from-purple-950/40', 'to-transparent']
};
// Lista achatada de TODAS as classes possíveis, usada só pra limpeza (remover
// tudo antes de aplicar o conjunto novo, evitando acúmulo de classes mortas).
const NEON_BG_TAILWIND_ALL_CLASSES = Object.values(NEON_BG_TAILWIND_CLASSES).flat();

const LOJA_EMOTICON_ITEMS = [
    { id: 'emo-pack-circuito',  category: 'emoticon', name: 'Pack Circuito',  price: 300, accent: '#00ff66', tagline: '12 emoticons de chat com tema de placa-mãe.', glyphs: ['⚡','🛰️','☢','⬡'] },
    { id: 'emo-pack-ancestral', category: 'emoticon', name: 'Pack Ancestral', price: 600, accent: '#ff007f', tagline: '12 emoticons raros, tema runas digitais.', glyphs: ['✦','◈','✧','⟁'] }
];

// ── PONTO 1 — Adereços para os Cards: pequeno elemento absoluto injetado
// acima da PFP do avatar quando equipado (ver applyEquippedPropEffect). ──
const LOJA_PROP_ITEMS = [
    { id: 'prop-chapeu-pixel',  category: 'adereco', name: 'Chapéu Pixel',   price: 450, accent: '#ffaa00', tagline: 'Chapéu 8-bit sobreposto na PFP. Clássico do underground.', glyph: '🎩' },
    { id: 'prop-peruca-cyber',  category: 'adereco', name: 'Peruca Cyber',   price: 600, accent: '#00ffff', tagline: 'Fios de fibra ótica no lugar de cabelo. Carrega de noite.', glyph: '💇' },
    { id: 'prop-oculos-glitch', category: 'adereco', name: 'Óculos Glitch',  price: 520, accent: '#ff00ff', tagline: 'Lente com falha de sinal permanente. Estilo, não defeito.', glyph: '🕶️' }
];

// ── PONTO 1 — Estantes e Expositores: mudam a moldura/fundo do slot
// individual onde cada card fica posicionado na Vitrine (ver applyEquippedShelfEffect). ──
const LOJA_SHELF_ITEMS = [
    { id: 'shelf-suporte-mainframe', category: 'estante', name: 'Suporte Mainframe', price: 700, accent: '#00ffff', tagline: 'Slots com moldura metálica de placa-mãe industrial.' },
    { id: 'shelf-estante-neon',      category: 'estante', name: 'Estante Neon',      price: 780, accent: '#ff00ff', tagline: 'Slots com glow neon individual atrás de cada card.' }
];

const LOJA_ALL_ITEMS = [...LOJA_FRAME_ITEMS, ...LOJA_SUBNET_FRAME_ITEMS, ...LOJA_BACKGROUND_ITEMS, ...LOJA_PROP_ITEMS, ...LOJA_SHELF_ITEMS, ...LOJA_EMOTICON_ITEMS];

// Mapeia a categoria de um item de loja pro slot correspondente dentro de
// currentUser.equippedCosmetics. Molduras NÃO entram aqui — elas usam a
// coluna própria avatar_frame / a function setAvatarFrame.
function cosmeticSlotForCategory(category) {
    if (category === 'fundo') return 'background';
    if (category === 'adereco') return 'prop';
    if (category === 'estante') return 'shelf';
    if (category === 'emoticon') return 'emoticon';
    return null;
}

const LOJA_MOCK_CONTRACTS = [
    { id: 'ctr-001', title: 'EMPRÉSTIMO_DE_CARD // RAID NOTURNA',        status: 'EM_BREVE',  reward: 140, minRarity: 'epic',      description: 'Cede um card épico+ por 6h para operação coletiva. Recompensa em B$ ao final.' },
    { id: 'ctr-002', title: 'EMPRÉSTIMO_DE_CARD // VITRINE_PATROCINADA', status: 'EM_BREVE',  reward: 300, minRarity: 'legendary', description: 'Card lendário exposto na vitrine parceira por 24h. Risco zero de destruição.' },
    { id: 'ctr-003', title: 'EMPRÉSTIMO_DE_CARD // FORNALHA_DE_TERCEIROS', status: 'BLOQUEADO', reward: 620, minRarity: 'ancestral', description: 'Card ancestral usado como garantia em fornalha alheia. Alto risco, alta paga.' }
];

// ── garante o CDN do Tailwind, já que o resto do site não carrega ──
function ensureTailwindLoaded(callback) {
    if (window.tailwind || document.getElementById('loja-tailwind-cdn')) {
        callback();
        return;
    }
    const script = document.createElement('script');
    script.id = 'loja-tailwind-cdn';
    script.src = 'https://cdn.tailwindcss.com';
    script.onload = callback;
    document.head.appendChild(script);
}

function lojaPreviewMarkup(item) {
    if (item.category === 'moldura') {
        return `<div class="w-full h-full flex items-center justify-center bg-black">
                    <div class="w-16 h-16 rounded-full border-2 animate-pulse" style="border-color:${item.accent}; box-shadow:0 0 18px ${item.accent};"></div>
                </div>`;
    }
    if (item.category === 'fundo') {
        return `<div class="w-full h-full flex items-center justify-center bg-black">
                    <div class="w-20 h-20 rounded-full blur-sm" style="background:radial-gradient(circle, ${item.accent}55 0%, transparent 70%);"></div>
                </div>`;
    }
    if (item.category === 'emoticon') {
        return `<div class="w-full h-full flex items-center justify-center gap-2 bg-black text-2xl">
                    ${(item.glyphs || []).slice(0, 4).map(g => `<span style="color:${item.accent}; text-shadow:0 0 8px ${item.accent};">${g}</span>`).join('')}
                </div>`;
    }
    if (item.category === 'adereco') {
        return `<div class="w-full h-full flex items-center justify-center bg-black text-4xl">
                    <span style="filter: drop-shadow(0 0 8px ${item.accent});">${item.glyph || '✨'}</span>
                </div>`;
    }
    if (item.category === 'estante') {
        return `<div class="w-full h-full grid grid-cols-2 gap-1 p-2 bg-black">
                    ${Array.from({ length: 4 }).map(() => `<div class="border" style="border-color:${item.accent}; box-shadow:inset 0 0 8px ${item.accent}66;"></div>`).join('')}
                </div>`;
    }
    return '';
}

function lojaItemCardMarkup(item) {
    const owned = !!(currentUser && Array.isArray(currentUser.cosmetics) && currentUser.cosmetics.includes(item.id));
    const balance = (currentUser && currentUser.bumps) || 0;
    const affordable = balance >= item.price;

    const btnClasses = owned
        ? 'border border-zinc-700 text-zinc-600 cursor-not-allowed'
        : affordable
            ? 'bg-amber-500 text-black border border-amber-500 hover:bg-amber-400 cursor-pointer'
            : 'border border-zinc-800 text-zinc-600 cursor-not-allowed';
    const btnLabel = owned ? 'ATIVO' : affordable ? 'COMPRAR' : 'SEM B$';

    return `
        <div class="relative bg-[#0a0703] border ${owned ? '' : 'border-amber-900/40'} p-3 flex flex-col gap-2.5 transition-all hover:border-amber-500 hover:-translate-y-0.5"
             style="${owned ? `border-color:${item.accent}; box-shadow:0 0 14px ${item.accent}33;` : ''}">
            ${owned ? `<div class="absolute -top-2 -left-2 text-[0.55rem] font-bold px-1.5 py-0.5 text-black" style="background:${item.accent}; box-shadow:0 0 10px ${item.accent};">INSTALADO</div>` : ''}
            <div class="w-full aspect-square border border-zinc-900">
                ${lojaPreviewMarkup(item)}
            </div>
            <div class="flex flex-col gap-0.5">
                <span class="text-[0.5rem] uppercase tracking-wider font-bold text-amber-800">${item.category}</span>
                <span class="text-sm font-extrabold text-amber-200">${item.name}</span>
                <span class="text-[0.62rem] text-amber-700/80 leading-snug">${item.tagline}</span>
            </div>
            <div class="flex items-center justify-between mt-1">
                <span class="text-sm font-extrabold text-amber-500">${item.price} B$</span>
                <button
                    class="text-[0.6rem] font-extrabold uppercase tracking-wide px-3 py-1.5 ${btnClasses}"
                    ${owned || !affordable ? 'disabled' : ''}
                    onclick="lojaHandlePurchase('${item.id}')">
                    ${btnLabel}
                </button>
            </div>
        </div>
    `;
}

function lojaContractCardMarkup(contract) {
    const locked = true; // mock — contratos reais ainda não habilitados
    const statusColor = contract.status === 'EM_BREVE' ? 'text-amber-500 border-amber-500'
        : contract.status === 'BLOQUEADO' ? 'text-red-500 border-red-500'
        : 'text-emerald-500 border-emerald-500';

    return `
        <div class="bg-[#0a0703] border border-amber-900/40 p-4 flex flex-col gap-2.5">
            <div class="flex justify-between items-start gap-2.5">
                <span class="text-[0.75rem] font-extrabold text-amber-200">${contract.title}</span>
                <span class="text-[0.5rem] font-extrabold ${statusColor} border px-1.5 py-0.5 whitespace-nowrap">${contract.status}</span>
            </div>
            <p class="text-[0.65rem] text-amber-700/80 leading-relaxed m-0">${contract.description}</p>
            <div class="flex justify-between items-center mt-1">
                <span class="text-[0.6rem] text-amber-800">RARIDADE MÍN: <b class="text-amber-500">${contract.minRarity.toUpperCase()}</b></span>
                <span class="text-sm font-extrabold text-amber-500">+${contract.reward} B$</span>
            </div>
            <button
                class="mt-1 text-[0.6rem] font-extrabold uppercase tracking-wide py-2 border border-zinc-800 text-zinc-600 cursor-not-allowed"
                disabled
                onclick="lojaHandleAcceptContract('${contract.id}')">
                AGUARDANDO_ABERTURA
            </button>
        </div>
    `;
}

function lojaCategorySection(label, items) {
    if (items.length === 0) return '';
    return `
        <div class="mb-7">
            <h2 class="text-[0.7rem] font-extrabold text-amber-500 tracking-widest mb-3 border-l-2 border-amber-500 pl-2 uppercase">${label}</h2>
            <div class="grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));">
                ${items.map(lojaItemCardMarkup).join('')}
            </div>
        </div>
    `;
}

function lojaBuildMarkup() {
    const balance = (currentUser && currentUser.bumps) || 0;
    const line = SPIKE_LINES_LOJA[Math.floor(Math.random() * SPIKE_LINES_LOJA.length)];

    return `
    <div class="min-h-screen bg-black text-amber-200 font-mono p-5 pb-16 relative overflow-hidden" style="font-family:'Space Mono', monospace;">

        <div class="flex justify-between items-center flex-wrap gap-3.5 mb-6 relative z-10">
            <div>
                <h1 class="text-base font-extrabold tracking-widest text-amber-500 uppercase m-0" style="text-shadow:0 0 14px rgba(255,170,0,0.5);">
                    MERCADO_NEGRO // TERMINAL_DE_SUCATA
                </h1>
                <p class="text-[0.6rem] text-amber-800 mt-1 tracking-wide">ACESSO NÃO REGISTRADO. NEGOCIE POR SUA CONTA E RISCO.</p>
            </div>
            <div class="flex items-center gap-2.5 bg-[#0a0703] border border-amber-500 px-4 py-2.5" style="box-shadow:0 0 14px rgba(255,170,0,0.18);">
                <div class="w-6 h-6 rounded-full border-2 border-amber-500 flex items-center justify-center text-xs font-extrabold text-amber-500" style="box-shadow:0 0 10px #ffaa00;">B</div>
                <div class="flex flex-col leading-tight">
                    <span class="text-[0.5rem] text-amber-800 tracking-wide">SALDO_ATUAL</span>
                    <span id="lojaBalanceDisplay" class="text-sm font-extrabold text-amber-200">${balance.toLocaleString('pt-BR')} B$</span>
                </div>
            </div>
        </div>

        <div class="flex gap-4 items-start bg-[#0a0703] border border-amber-900/40 p-4 mb-6 relative z-10 flex-wrap">
            <div id="lojaEtAvatar" class="w-16 h-16 flex-shrink-0 border-2 border-amber-500 flex items-center justify-center text-3xl relative loja-et-avatar" style="background:repeating-linear-gradient(45deg, #100b03 0px, #100b03 4px, #1a1206 4px, #1a1206 8px); box-shadow:0 0 16px rgba(255,170,0,0.35); cursor:pointer;" onclick="speakZrkLine()" title="Clique pra ouvir o ZRK">
                👽
                <span class="absolute -bottom-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" style="box-shadow:0 0 8px #00ff66;"></span>
            </div>
            <div class="flex-1" style="min-width:220px;">
                <div class="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span class="text-[0.7rem] font-extrabold text-amber-500 tracking-wide">ZRK // ET_PUNK</span>
                    <span class="text-[0.5rem] text-emerald-500 border border-emerald-500 px-1.5 tracking-wide">[ZRK_v0.49_ONLINE]</span>
                </div>
                <div id="lojaSpikeLine" class="bg-black border border-zinc-900 px-3 py-2.5 text-[0.7rem] text-amber-300 leading-relaxed" style="min-height:36px;">
                    ▸ ${line}
                </div>
            </div>
        </div>

        <div class="flex gap-2 mb-5 relative z-10 border-b border-amber-900/40 flex-wrap">
            <button id="lojaTabBtnContratos" onclick="lojaSwitchTab('contratos')"
                class="bg-transparent text-amber-800 border-b-2 border-transparent text-[0.65rem] font-extrabold tracking-wide px-4.5 py-2.5 uppercase cursor-pointer transition-all">
                [ CONTRATOS ]
            </button>
            <button id="lojaTabBtnCosmeticos" onclick="lojaSwitchTab('cosmeticos')"
                class="bg-amber-500 text-black border-b-2 border-amber-500 text-[0.65rem] font-extrabold tracking-wide px-4.5 py-2.5 uppercase cursor-pointer transition-all">
                [ COSMÉTICOS ]
            </button>
            <button id="lojaTabBtnFragmentos" onclick="lojaSwitchTab('fragmentos')"
                class="bg-transparent text-amber-800 border-b-2 border-transparent text-[0.65rem] font-extrabold tracking-wide px-4.5 py-2.5 uppercase cursor-pointer transition-all"
                style="border-color:transparent; color:#aaaaaa;">
                [ FRAGMENTOS 🧩 ]
            </button>
        </div>

        <div id="lojaTabContratos" class="hidden relative z-10">
            <p class="text-[0.65rem] text-amber-800 mb-4">
                Espaço reservado para missões futuras de empréstimo de cards. ZRK libera contratos por conta própria — sem aviso, sem garantia.
            </p>
            <div class="grid gap-4" style="grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));">
                ${LOJA_MOCK_CONTRACTS.map(lojaContractCardMarkup).join('')}
            </div>
        </div>

        <div id="lojaTabCosmeticos" class="relative z-10">
            <div class="loja-filter-bar">
                <button class="loja-filter-btn active" data-loja-cat="todos" onclick="lojaFilterCategory('todos')">TODOS</button>
                <button class="loja-filter-btn" data-loja-cat="molduras" onclick="lojaFilterCategory('molduras')">MOLDURAS</button>
                <button class="loja-filter-btn" data-loja-cat="subnet" onclick="lojaFilterCategory('subnet')">MOLDURAS SUB-REDE</button>
                <button class="loja-filter-btn" data-loja-cat="fundo" onclick="lojaFilterCategory('fundo')">LUZ DE FUNDO</button>
                <button class="loja-filter-btn" data-loja-cat="adereco" onclick="lojaFilterCategory('adereco')">ADEREÇOS</button>
                <button class="loja-filter-btn" data-loja-cat="estante" onclick="lojaFilterCategory('estante')">ESTANTES</button>
                <button class="loja-filter-btn" data-loja-cat="emoticon" onclick="lojaFilterCategory('emoticon')">EMOTICONS</button>
            </div>
            <div id="lojaCatMolduras" data-loja-cat="molduras">${lojaCategorySection('MOLDURAS', LOJA_FRAME_ITEMS)}</div>
            <div id="lojaCatSubnet" data-loja-cat="subnet">${lojaCategorySection('MOLDURAS DE SUB-REDE', LOJA_SUBNET_FRAME_ITEMS)}</div>
            <div id="lojaCatFundo" data-loja-cat="fundo">${lojaCategorySection('LUZ DE FUNDO', LOJA_BACKGROUND_ITEMS)}</div>
            <div id="lojaCatAdereco" data-loja-cat="adereco">${lojaCategorySection('ADEREÇOS DE CARD', LOJA_PROP_ITEMS)}</div>
            <div id="lojaCatEstante" data-loja-cat="estante">${lojaCategorySection('ESTANTES E EXPOSITORES', LOJA_SHELF_ITEMS)}</div>
            <div id="lojaCatEmoticon" data-loja-cat="emoticon">${lojaCategorySection('EMOTICONS', LOJA_EMOTICON_ITEMS)}</div>
        </div>

        <div id="lojaTabFragmentos" class="hidden relative z-10">
            ${lojaFragmentosTabMarkup()}
        </div>

        <div class="pointer-events-none absolute inset-0 z-20" style="background-image:repeating-linear-gradient(to bottom, transparent 0px, transparent 2px, rgba(255,170,0,0.035) 2px, rgba(255,170,0,0.035) 3px); mix-blend-mode:overlay;"></div>
    </div>
    `;
}

// ── ALTERNÂNCIA DE ABAS (classList hidden, nativo) ──
// ── Gera o HTML da aba de Fragmentos de Sucata ──
function lojaFragmentosTabMarkup() {
    const frags = (currentUser && typeof currentUser.fragments === 'number') ? currentUser.fragments : 0;
    const ticketCost  = typeof FRAGMENTS_TO_REDEEM_TICKET !== 'undefined' ? FRAGMENTS_TO_REDEEM_TICKET : 30;
    const itemCost    = typeof FRAGMENTS_TO_REDEEM_ITEM   !== 'undefined' ? FRAGMENTS_TO_REDEEM_ITEM   : 15;
    const canTicket   = frags >= ticketCost;
    const canItem     = frags >= itemCost;

    return `
    <div style="margin-bottom:18px;">
        <div style="color:#aaa; font-size:0.6rem; letter-spacing:2px; margin-bottom:4px;">🧩 SISTEMA DE FRAGMENTOS DE SUCATA</div>
        <p style="font-size:0.6rem; color:#666688; margin-bottom:16px; line-height:1.6;">
            Fragmentos são gerados quando cartas são <b style="color:#ff0044;">destruídas</b> em Contratos ou na Fornalha de Sobrecarga.
            Acumule-os e troque por recompensas aqui — nunca fique completamente bloqueado.
        </p>

        <div style="background:#0a0a14; border:1px solid #333355; padding:16px; margin-bottom:18px; display:flex; align-items:center; gap:16px;">
            <div style="font-size:2rem;">🧩</div>
            <div>
                <div style="font-size:0.55rem; color:#666688; letter-spacing:2px;">SEU SALDO DE FRAGMENTOS</div>
                <div id="lojaFragsDisplay" style="font-size:1.4rem; font-weight:bold; color:#00ffcc; font-family:'Archivo Black', monospace;">${frags}</div>
            </div>
        </div>

        <div style="display:grid; gap:14px; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));">

            <div style="background:#070712; border:1px solid ${canItem ? '#00ffcc' : '#223'}; padding:16px;">
                <div style="color:#00ffcc; font-size:0.65rem; font-weight:bold; letter-spacing:1px; margin-bottom:6px;">POEIRA DE SILÍCIO</div>
                <p style="font-size:0.55rem; color:#888899; margin-bottom:12px;">Item básico usado como catalisador na Alquimia. Essencial para novas fusões.</p>
                <div style="font-size:0.6rem; color:#aaa; margin-bottom:10px;">Custo: <b style="color:#00ffcc;">${itemCost} 🧩 Fragmentos</b></div>
                <button onclick="redeemFragment('item')"
                    style="width:100%; padding:10px; background:${canItem ? '#00ffcc22' : '#111'}; border:1px solid ${canItem ? '#00ffcc' : '#333'}; color:${canItem ? '#00ffcc' : '#555'}; font-family:'Space Mono',monospace; font-size:0.6rem; letter-spacing:1px; cursor:${canItem ? 'pointer' : 'not-allowed'}; font-weight:bold;">
                    ${canItem ? '🔁 RESGATAR ITEM' : `⏳ FALTAM ${itemCost - frags} FRAGMENTOS`}
                </button>
            </div>

            <div style="background:#070712; border:1px solid ${canTicket ? '#ffaa00' : '#223'}; padding:16px;">
                <div style="color:#ffaa00; font-size:0.65rem; font-weight:bold; letter-spacing:1px; margin-bottom:6px;">FREE ROLL TICKET</div>
                <p style="font-size:0.55rem; color:#888899; margin-bottom:12px;">Um ticket de redirecionamento de drop. Use como se fosse um DROP GRATUITO garantido.</p>
                <div style="font-size:0.6rem; color:#aaa; margin-bottom:10px;">Custo: <b style="color:#ffaa00;">${ticketCost} 🧩 Fragmentos</b></div>
                <button onclick="redeemFragment('ticket')"
                    style="width:100%; padding:10px; background:${canTicket ? '#ffaa0022' : '#111'}; border:1px solid ${canTicket ? '#ffaa00' : '#333'}; color:${canTicket ? '#ffaa00' : '#555'}; font-family:'Space Mono',monospace; font-size:0.6rem; letter-spacing:1px; cursor:${canTicket ? 'pointer' : 'not-allowed'}; font-weight:bold;">
                    ${canTicket ? '🎟 RESGATAR TICKET' : `⏳ FALTAM ${ticketCost - frags} FRAGMENTOS`}
                </button>
            </div>

        </div>
    </div>`;
}

// ── Resgata fragmentos por item ou ticket ──
async function redeemFragment(type) {
    if (!currentUser || !currentUser.loggedIn) {
        showCyberAlert('ACESSO NEGADO', 'Faça login pra resgatar fragmentos.', 'error');
        return;
    }
    const frags = currentUser.fragments || 0;
    const TICKET_COST = typeof FRAGMENTS_TO_REDEEM_TICKET !== 'undefined' ? FRAGMENTS_TO_REDEEM_TICKET : 30;
    const ITEM_COST   = typeof FRAGMENTS_TO_REDEEM_ITEM   !== 'undefined' ? FRAGMENTS_TO_REDEEM_ITEM   : 15;

    if (type === 'ticket') {
        if (frags < TICKET_COST) {
            showCyberAlert('FRAGMENTOS INSUFICIENTES', `Você precisa de ${TICKET_COST} fragmentos. Atual: ${frags}.`, 'warn');
            return;
        }
        currentUser.fragments -= TICKET_COST;
        await updateProfileInSupabase(currentUser.id, { fragments: currentUser.fragments });
        // Concede 1 ticket grátis: simula um executeHardwareRoll(false) imediato
        showCyberAlert('🎟 TICKET RESGATADO!',
            `Free Roll Ticket concedido!<br>Fragmentos restantes: <b>${currentUser.fragments}</b><br><br>O roll será ativado automaticamente...`,
            'success');
        setTimeout(() => {
            if (typeof executeHardwareRoll === 'function') executeHardwareRoll(false);
        }, 1800);
    } else if (type === 'item') {
        if (frags < ITEM_COST) {
            showCyberAlert('FRAGMENTOS INSUFICIENTES', `Você precisa de ${ITEM_COST} fragmentos. Atual: ${frags}.`, 'warn');
            return;
        }
        currentUser.fragments -= ITEM_COST;
        await updateProfileInSupabase(currentUser.id, { fragments: currentUser.fragments });
        // Concede Poeira de Silício
        if (typeof grantInventoryItem === 'function') {
            await grantInventoryItem(currentUser.id, 'poeira_silicio', 2);
        }
        showCyberAlert('🧩 ITEM RESGATADO!',
            `2x Poeira de Silício adicionada ao inventário!<br>Fragmentos restantes: <b>${currentUser.fragments}</b>`,
            'success');
    }

    // Atualiza display de fragmentos na loja se visível
    const fragDisplay = document.getElementById('lojaFragsDisplay');
    if (fragDisplay) fragDisplay.innerText = String(currentUser.fragments);
    // Re-renderiza aba de fragmentos
    const fragTab = document.getElementById('lojaTabFragmentos');
    if (fragTab) fragTab.innerHTML = lojaFragmentosTabMarkup();
}

// ── FILTRO HORIZONTAL DE CATEGORIAS DA ABA COSMÉTICOS ──
// Alterna visibilidade das seções de categoria dentro de #lojaTabCosmeticos
// sem afetar as abas Contratos/Fragmentos nem o restante do markup da Loja.
function lojaFilterCategory(cat) {
    const map = {
        molduras: 'lojaCatMolduras',
        subnet: 'lojaCatSubnet',
        fundo: 'lojaCatFundo',
        adereco: 'lojaCatAdereco',
        estante: 'lojaCatEstante',
        emoticon: 'lojaCatEmoticon'
    };
    document.querySelectorAll('.loja-filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.lojaCat === cat);
    });
    Object.entries(map).forEach(([key, id]) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.display = (cat === 'todos' || cat === key) ? '' : 'none';
    });
}

function lojaSwitchTab(tab) {
    try {
    const contratosPanel   = document.getElementById('lojaTabContratos');
    const cosmeticosPanel  = document.getElementById('lojaTabCosmeticos');
    const fragmentosPanel  = document.getElementById('lojaTabFragmentos');
    const btnContratos     = document.getElementById('lojaTabBtnContratos');
    const btnCosmeticos    = document.getElementById('lojaTabBtnCosmeticos');
    const btnFragmentos    = document.getElementById('lojaTabBtnFragmentos');
    if (!contratosPanel || !cosmeticosPanel) return;

    const activeBtnClasses   = ['bg-amber-500', 'text-black', 'border-amber-500'];
    const inactiveBtnClasses = ['bg-transparent', 'text-amber-800', 'border-transparent'];

    // Oculta tudo
    [contratosPanel, cosmeticosPanel, fragmentosPanel].forEach(p => p && p.classList.add('hidden'));
    [btnContratos, btnCosmeticos, btnFragmentos].forEach(b => {
        if (!b) return;
        b.classList.remove(...activeBtnClasses);
        b.classList.add(...inactiveBtnClasses);
        b.style.color = '';
    });

    if (tab === 'contratos') {
        contratosPanel.classList.remove('hidden');
        if (btnContratos) { btnContratos.classList.remove(...inactiveBtnClasses); btnContratos.classList.add(...activeBtnClasses); }
    } else if (tab === 'fragmentos') {
        if (fragmentosPanel) fragmentosPanel.classList.remove('hidden');
        if (btnFragmentos) {
            btnFragmentos.classList.remove(...inactiveBtnClasses);
            btnFragmentos.style.background = '#00ffcc22';
            btnFragmentos.style.color = '#00ffcc';
            btnFragmentos.style.borderColor = '#00ffcc';
        }
    } else {
        cosmeticosPanel.classList.remove('hidden');
        if (btnCosmeticos) { btnCosmeticos.classList.remove(...inactiveBtnClasses); btnCosmeticos.classList.add(...activeBtnClasses); }
    }
    } catch(e) { console.warn('lojaSwitchTab error:', e); }
}

// ── HANDLERS ESTRUTURADOS — INTEGRAÇÃO SUPABASE ──
async function lojaHandlePurchase(itemId) {
    const item = LOJA_ALL_ITEMS.find(i => i.id === itemId);
    if (!item) return;
    console.log('[LOJA] Tentativa de compra:', item.id, 'por', item.price, 'B$');

    if (!currentUser || !currentUser.loggedIn || !currentUser.id) {
        console.log('[LOJA] Compra recusada: usuário não autenticado.');
        if (typeof showCyberAlert === 'function') {
            showCyberAlert('ACESSO NEGADO', 'Você precisa estar conectado pra negociar com o ZRK.', 'error');
        }
        return;
    }

    if (!Array.isArray(currentUser.cosmetics)) currentUser.cosmetics = [];

    if (currentUser.cosmetics.includes(item.id)) {
        console.log('[LOJA] Compra recusada: item já está no inventário.');
        return;
    }

    const balance = currentUser.bumps || 0;
    if (balance < item.price) {
        console.log('[LOJA] Compra recusada: saldo insuficiente.');
        // TODO SUPABASE: chamar openDepositModal() ou showCyberAlert('FUNDOS INSUFICIENTES', ...)
        return;
    }

    // Débito + grant de cosmético: persistidos juntos numa única chamada,
    // pra nunca ficar um estado "pagou mas não recebeu o item" (ou
    // vice-versa) se a conexão cair no meio do caminho.
    const newBumps = balance - item.price;
    const newCosmetics = [...currentUser.cosmetics, item.id];

    console.log(`Supabase Update -> profiles set cosmetics = ${JSON.stringify(newCosmetics)}, bumps = ${newBumps} where id = ${currentUser.id}`);

    const { error } = await sb.from('profiles')
        .update({ cosmetics: newCosmetics, bumps: newBumps })
        .eq('id', currentUser.id);

    if (error) {
        console.error('[LOJA] Falha ao persistir compra no Supabase:', error.message);
        if (typeof showCyberAlert === 'function') {
            showCyberAlert('FALHA NA TRANSAÇÃO', 'O nó central recusou a gravação. Tenta novamente.', 'error');
        }
        return; // não atualiza estado local se o banco não confirmou
    }

    currentUser.bumps = newBumps;
    currentUser.cosmetics = newCosmetics;
    console.log('[LOJA] Compra confirmada:', item.id);
    renderLoja(); // re-renderiza pra atualizar saldo e estado "ATIVO"
    if (selectedProfileUser === currentUser.username) {
        renderEquipmentInventory(true); // sincroniza o bloco de equipamentos no Perfil, se estiver aberto
        renderRelicInventoryModal();    // sincroniza o modal de relíquias, se estiver aberto
        renderFrameSelectorRow(currentFrameFilter); // libera a moldura no seletor, se for o caso
    }
}

function lojaHandleAcceptContract(contractId) {
    console.log('[LOJA] Tentativa de aceitar contrato:', contractId);
    // TODO SUPABASE: validar card alocado, criar registro de empréstimo, travar card no cofre, ex:
    //   await createLoanContract({ userId: currentUser.id, contractId, cardId, expiresAt });
    console.log('[LOJA] Contrato ainda não habilitado nesta build (mock).');
}

// =========================================================
// PONTO 2 — MODAL [ INVENTÁRIO DE RELÍQUIAS ]
// Versão em modal do bloco de equipamentos: lista Acessórios de Vitrine,
// Cores de Fundo Neon e Cyber_Emoticons comprados, cada um com botão
// [ EQUIPAR / ATIVAR ] que persiste no Supabase e aplica o efeito na hora.
// =========================================================
function openRelicInventoryModal() {
    // Trava de usuário logado (camada extra além do display:none aplicado em
    // viewTargetUserCollection): nunca abre pra quem não é o dono do perfil.
    if (!currentUser.loggedIn || selectedProfileUser !== currentUser.username) return;
    const modal = document.getElementById('relicInventoryModal');
    if (!modal) return;
    ensureTailwindLoaded(() => {
        modal.style.display = 'flex';
        renderRelicInventoryModal();
    });
}

function closeRelicInventoryModal() {
    const modal = document.getElementById('relicInventoryModal');
    if (modal) modal.style.display = 'none';
}

function renderRelicInventoryModal() {
    // [ESCOPO 1] Slots visuais de hardware/artefatos cyberpunk — sem colchetes
    const grid = document.getElementById('relicInventoryGrid');
    if (!grid) return;

    const inv = getUserInventory();
    const equipped = currentUser.equippedCosmetics || {};
    const ownedCosmetics = Array.isArray(currentUser.cosmetics) ? currentUser.cosmetics : [];

    // Cosméticos comprados na loja (molduras, fundos, adereços, estantes, emoticons)
    const lojaItems = LOJA_ALL_ITEMS.filter(item => ownedCosmetics.includes(item.id));

    // Itens de inventário (catalisadores, núcleos, etc.)
    const invItems = inv.filter(i => i && i.templateId && ITEMS_DB[i.templateId]);

    grid.innerHTML = '';

    if (lojaItems.length === 0 && invItems.length === 0) {
        grid.innerHTML = `<div class="relic-slot relic-slot-empty">
            <div class="relic-slot-icon">◻</div>
            <div class="relic-slot-name">NENHUMA RELÍQUIA DETECTADA</div>
            <div class="relic-slot-desc">Visite o MERCADO NEGRO (Spike Store) para adquirir cosméticos de ostentação.</div>
        </div>`;
        return;
    }

    // Renderiza cosméticos da loja como slots de hardware cyberpunk
    lojaItems.forEach(item => {
        const slot = document.createElement('div');
        slot.className = 'relic-slot';
        const cat = item.category || '';
        const slotKey = cat === 'fundo' ? 'background' : cat === 'adereco' ? 'prop' : cat === 'estante' ? 'shelf' : cat === 'emoticon' ? 'emoticon' : null;
        const isEquipped = slotKey
            ? (equipped[slotKey] === item.id)
            : (currentUser.avatarFrame === item.id);

        const rarityLabel = item.rarity ? item.rarity.toUpperCase() : 'ITEM';
        const accentColor = item.accent || '#00ffff';

        slot.innerHTML = `
            <div class="relic-slot-header">
                <span class="relic-slot-type" style="color:${accentColor};">${rarityLabel} // ${cat.toUpperCase()}</span>
                ${isEquipped ? '<span class="relic-slot-equipped-badge">EQUIPADO</span>' : ''}
            </div>
            <div class="relic-slot-icon" style="color:${accentColor};">${item.rarity === 'ancestral' ? '☠' : item.rarity === 'lendario' ? '◈' : '⬡'}</div>
            <div class="relic-slot-name" style="color:${accentColor};">${item.name.toUpperCase()}</div>
            <div class="relic-slot-desc">${item.tagline || ''}</div>
            <div class="relic-slot-data-lines">
                <div class="relic-data-line"><span class="rdl-key">CATEGORIA</span><span class="rdl-val">${cat.toUpperCase()}</span></div>
                <div class="relic-data-line"><span class="rdl-key">SLOT</span><span class="rdl-val">${slotKey ? slotKey.toUpperCase() : 'MOLDURA'}</span></div>
                <div class="relic-data-line"><span class="rdl-key">STATUS</span><span class="rdl-val" style="color:${isEquipped ? '#00ff66' : '#888899'}">${isEquipped ? 'ATIVO' : 'INATIVO'}</span></div>
            </div>
            <button class="btn-action relic-equip-btn" style="border-color:${accentColor};color:${accentColor};margin-top:auto;"
                onclick="lojaEquipItem('${item.id}','${item.category}')">
                ${isEquipped ? '✓ DESATIVAR' : '▶ EQUIPAR'}
            </button>
        `;
        grid.appendChild(slot);
    });

    // Renderiza itens de inventário de fusão como slots secundários
    invItems.forEach(item => {
        const tpl = ITEMS_DB[item.templateId];
        if (!tpl) return;
        const slot = document.createElement('div');
        slot.className = 'relic-slot relic-slot-item';
        slot.innerHTML = `
            <div class="relic-slot-header">
                <span class="relic-slot-type" style="color:#ffaa00;">${tpl.category}</span>
                <span class="relic-slot-qty">x${item.qty || 1}</span>
            </div>
            <div class="relic-slot-icon">⚗</div>
            <div class="relic-slot-name">${tpl.name.toUpperCase()}</div>
            <div class="relic-slot-desc">${tpl.nameEN}</div>
            <div class="relic-slot-data-lines">
                <div class="relic-data-line"><span class="rdl-key">EFEITO</span><span class="rdl-val">${tpl.effect.type}</span></div>
                <div class="relic-data-line"><span class="rdl-key">USO</span><span class="rdl-val">FUSÃO / ALQUIMIA</span></div>
                <div class="relic-data-line"><span class="rdl-key">QTD</span><span class="rdl-val" style="color:#ffaa00;">${item.qty || 1}</span></div>
            </div>
        `;
        grid.appendChild(slot);
    });
}


function renderEquipmentInventory(isOwner) {
    const target = document.getElementById(EQUIPMENT_INVENTORY_TARGET_ID);
    if (!target) return;

    if (!isOwner || !currentUser.loggedIn) {
        target.innerHTML = '';
        target.style.display = 'none';
        return;
    }
    target.style.display = 'block';

    const owned = Array.isArray(currentUser.cosmetics) ? currentUser.cosmetics : [];
    const ownedItems = LOJA_ALL_ITEMS.filter(i => owned.includes(i.id));

    if (ownedItems.length === 0) {
        target.innerHTML = `
            <h4 class="equip-inv-title">[ INVENTÁRIO DE EQUIPAMENTOS ]</h4>
            <p class="equip-inv-empty">Nenhum cosmético comprado ainda. Visite o MERCADO_NEGRO_DO_ZRK na Loja.</p>
        `;
        return;
    }

    target.innerHTML = `
        <h4 class="equip-inv-title">[ INVENTÁRIO DE EQUIPAMENTOS ]</h4>
        <div class="equip-inv-list">
            ${ownedItems.map(equipmentInventoryItemMarkup).join('')}
        </div>
    `;
}

// Roteador de equipamento do inventário de relíquias:
// • categoria 'moldura' / 'subnet' → lojaEquipFrame (avatar_frame)
// • demais categorias (fundo, adereco, estante, emoticon) → lojaToggleCosmeticSlot
async function lojaEquipItem(itemId, category) {
    if (!currentUser || !currentUser.loggedIn) {
        if (typeof showCyberAlert === 'function') showCyberAlert('ACESSO NEGADO', 'Faça login para equipar itens.', 'error');
        return;
    }
    const cat = (category || '').toLowerCase();
    if (cat === 'moldura' || cat === 'subnet' || cat.includes('frame')) {
        await lojaEquipFrame(itemId);
    } else {
        await lojaToggleCosmeticSlot(itemId);
    }
}

// Equipar uma moldura comprada na Loja (reaproveita setAvatarFrame, que já
// atualiza a UI do avatar e persiste em profiles.avatar_frame).
async function lojaEquipFrame(itemId) {
    if (!currentUser || !currentUser.loggedIn) return;
    if (itemId !== FRAME_DEFAULT_ID && (!Array.isArray(currentUser.cosmetics) || !currentUser.cosmetics.includes(itemId))) {
        console.log('[LOJA] Equipar recusado: moldura não pertence ao inventário do usuário.', itemId);
        return;
    }
    console.log('[LOJA] Equipando moldura:', itemId);
    await setAvatarFrame(itemId);
    renderEquipmentInventory(true);
    renderRelicInventoryModal();
    renderFrameSelectorRow(currentFrameFilter);
}

// =========================================================
// PONTO 3 — ATIVAÇÃO REAL DOS EFEITOS (FRONT-END), AGORA POR SLOT
// As três funções abaixo recebem o objeto `equippedCosmetics` do PERFIL
// QUE ESTÁ SENDO EXIBIDO (não necessariamente currentUser — ver
// viewTargetUserCollection) — isso é o que garante que o cosmético do
// usuário A nunca "vaze" pro perfil do usuário B: cada chamada usa
// estritamente os dados de quem está na tela.
// =========================================================

// Luz Neon de Fundo: injeta classes Tailwind reais de glow/gradiente em
// .profile-main-box (#profileMainBox) conforme LOJA_BACKGROUND_ITEMS.
function applyEquippedAccessoryEffect(equippedCosmetics) {
    const box = document.getElementById('profileMainBox');
    if (!box) return;
    const eq = equippedCosmetics || { background: null };

    ensureTailwindLoaded(() => {
        box.classList.remove(...NEON_BG_TAILWIND_ALL_CLASSES);

        const item = eq.background && LOJA_BACKGROUND_ITEMS.find(i => i.id === eq.background);
        if (!item || !item.colorKey) {
            box.dataset.neonActive = '';
            return;
        }
        const classes = NEON_BG_TAILWIND_CLASSES[item.colorKey];
        if (classes && classes.length) {
            box.classList.add(...classes);
            box.dataset.neonActive = item.colorKey;
        }
    });
}

// Adereços de Card: injeta o glifo (chapéu/peruca/óculos) num elemento
// absoluto sobreposto exatamente acima da PFP do avatar (#avatarFrameWrap).
function applyEquippedPropEffect(equippedCosmetics) {
    const wrap = document.getElementById('avatarFrameWrap');
    if (!wrap) return;

    let layer = document.getElementById('avatarPropLayer');
    if (!layer) {
        layer = document.createElement('div');
        layer.id = 'avatarPropLayer';
        layer.className = 'avatar-prop-layer';
        wrap.appendChild(layer);
    }

    const eq = equippedCosmetics || { prop: null };
    const item = eq.prop && LOJA_PROP_ITEMS.find(i => i.id === eq.prop);
    layer.innerHTML = item
        ? `<span class="avatar-prop-glyph" style="filter: drop-shadow(0 0 6px ${item.accent});" title="${item.name}">${item.glyph}</span>`
        : '';
}

// Estantes/Expositores: troca o container temático do grid de vitrine
// (#showcaseGrid), mudando a borda/fundo de cada slot individual de card.
function applyEquippedShelfEffect(equippedCosmetics) {
    const grid = document.getElementById('showcaseGrid');
    if (!grid) return;
    grid.classList.remove('shelf-mainframe', 'shelf-neon');

    const eq = equippedCosmetics || { shelf: null };
    if (eq.shelf === 'shelf-suporte-mainframe') grid.classList.add('shelf-mainframe');
    else if (eq.shelf === 'shelf-estante-neon') grid.classList.add('shelf-neon');
}

// Aplica os 3 efeitos de uma vez só — chamada central usada tanto ao abrir
// um perfil (próprio ou de terceiros) quanto após equipar/ativar algo no
// modal de relíquias.
function applyAllEquippedEffects(equippedCosmetics) {
    applyEquippedAccessoryEffect(equippedCosmetics);
    applyEquippedPropEffect(equippedCosmetics);
    applyEquippedShelfEffect(equippedCosmetics);
}

// Ativa/desativa um cosmético de slot único (fundo neon, adereço de card,
// estante ou pack de emoticons) comprado na Loja. Apenas um item por slot
// fica ativo por vez (clicar no que já está ativo desativa). O objeto
// inteiro é persistido junto em profiles.equipped_cosmetics (jsonb).
async function lojaToggleCosmeticSlot(itemId) {
    if (!currentUser || !currentUser.loggedIn) return;
    if (!Array.isArray(currentUser.cosmetics) || !currentUser.cosmetics.includes(itemId)) return;

    const item = LOJA_ALL_ITEMS.find(i => i.id === itemId);
    const slot = item && cosmeticSlotForCategory(item.category);
    if (!slot) return;

    if (!currentUser.equippedCosmetics) currentUser.equippedCosmetics = { background: null, prop: null, shelf: null, emoticon: null };
    const newEquipped = { ...currentUser.equippedCosmetics };
    newEquipped[slot] = newEquipped[slot] === itemId ? null : itemId;

    console.log('[LOJA] Ativando cosmético de slot:', slot, '->', newEquipped[slot] || '(nenhum)');

    const ok = await updateProfileInSupabase(currentUser.id, { equippedCosmetics: newEquipped });
    if (!ok) {
        console.error('[LOJA] Falha ao persistir cosmético ativo.');
        if (typeof showCyberAlert === 'function') {
            showCyberAlert('FALHA NA TRANSAÇÃO', 'O nó central recusou a gravação do equipamento. Tenta novamente.', 'error');
        }
        return;
    }
    currentUser.equippedCosmetics = newEquipped;
    renderEquipmentInventory(true);
    renderRelicInventoryModal();
    applyAllEquippedEffects(currentUser.equippedCosmetics); // aplica/retira o efeito na hora, sem precisar de F5
}

// ── PONTO 1 — Efeito Sonoro "Ding-Dong Cyberpunk" tocado quando a Loja é
// aberta (não em re-renderizações internas pós-compra). Usa dois osciladores
// em sequência via AudioContext (sem dependência de link de áudio externo,
// que poderia cair/quebrar CORS) simulando o clássico sino de loja antiga
// com um timbre mais robótico (onda quadrada + decaimento rápido).
function playLojaChime() {
    try {
        initAudio();
        const now = audioCtx.currentTime;

        // "Ding" — nota mais aguda primeiro
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.type = 'square';
        osc1.frequency.setValueAtTime(1046.5, now); // C6
        gain1.gain.setValueAtTime(0.0001, now);
        gain1.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc1.connect(gain1); gain1.connect(audioCtx.destination);
        osc1.start(now); osc1.stop(now + 0.35);

        // "Dong" — nota mais grave logo em seguida, robótica (sawtooth leve)
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(783.99, now + 0.16); // G5
        gain2.gain.setValueAtTime(0.0001, now + 0.16);
        gain2.gain.exponentialRampToValueAtTime(0.1, now + 0.18);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
        osc2.connect(gain2); gain2.connect(audioCtx.destination);
        osc2.start(now + 0.16); osc2.stop(now + 0.55);
    } catch (e) { /* AudioContext bloqueado até primeira interação — silenciosamente ignora */ }
}

// ── VOZ SINTETIZADA DO ZRK (ET PUNK) ──
// Usa a mesma API nativa já utilizada em speakPhrase/speakRandom (Web
// Speech API — SpeechSynthesisUtterance). Pitch baixo + rate levemente
// acelerado pra soar mais "robótico-alienígena" e destacar do narrador
// padrão do sistema (CYBER_VOICES). Silenciosamente ignora se o
// navegador não suportar (mesmo padrão defensivo do resto do código).
function speakZrkLine(forcedText) {
    if (!('speechSynthesis' in window)) return;
    const text = forcedText || SPIKE_LINES_LOJA[Math.floor(Math.random() * SPIKE_LINES_LOJA.length)];

    // Sincroniza a fala com a frase já exibida na caixa de texto do ZRK,
    // pra não mostrar uma frase na tela e falar outra diferente.
    const lineBox = document.getElementById('lojaSpikeLine');
    if (lineBox && !forcedText) lineBox.innerHTML = `▸ ${text}`;

    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pt-BR'; // Voz da Loja fixa em PT-BR, independente do toggle global de idioma.
    u.rate = 1.15;   // levemente acelerado — cadência "nervosa" de hacker
    u.pitch = 0.35;  // bem grave — timbre alienígena/distorcido
    u.volume = 0.85;
    window.speechSynthesis.speak(u);

    // Pequeno feedback visual: avatar do ZRK "pulsa" enquanto fala.
    const avatar = document.getElementById('lojaEtAvatar');
    if (avatar) {
        avatar.classList.add('zrk-speaking');
        u.onend = () => avatar.classList.remove('zrk-speaking');
        u.onerror = () => avatar.classList.remove('zrk-speaking');
    }
}

// ── PONTO DE ENTRADA ──
// playChime=true toca o ding-dong (só ao NAVEGAR pra Loja, ver navigateTo).
// Re-renders internos pós-compra/equip chamam renderLoja() sem argumento,
// então o som/fala nunca repetem a cada clique — só na entrada real na tela.
function renderLoja(playChime) {
    const target = document.getElementById(LOJA_TARGET_ID);
    if (!target) {
        console.warn(`[LOJA] Elemento #${LOJA_TARGET_ID} não encontrado no DOM. Ajuste LOJA_TARGET_ID para o id da sua div de tela.`);
        return;
    }
    ensureTailwindLoaded(() => {
        target.innerHTML = lojaBuildMarkup();
        // [ESCOPO 2] Sincroniza com o sistema de abas externo (lojaTabBar)
        const activeTabOnLoad = _currentLojaTab || 'all';
        if (activeTabOnLoad !== 'all') {
            _applyLojaTabFilter(activeTabOnLoad);
        } else {
            lojaSwitchTab('cosmeticos');
        }
        if (playChime) {
            playLojaChime();
            // Pequeno atraso pro "ding-dong" tocar primeiro e não se
            // sobrepor à fala do ZRK — soa como o sininho da porta de
            // uma loja física tocando antes do vendedor falar.
            setTimeout(() => speakZrkLine(), 650);
        }
    });
}

/* ════════════════════════════════════════════════════════════════════
   MÓDULO: BROADCAST AÉREO (OVNI) + CHAT GLOBAL FLUTUANTE
   ────────────────────────────────────────────────────────────────────
   Segue o MESMO padrão já usado em eventos_globais/pushLedger/
   initGlobalRealtime: tabela pública no Supabase + canal Realtime
   (postgres_changes) assinado incondicionalmente no boot, pra qualquer
   aba — logada ou anônima — ver os mesmos eventos instantaneamente.

   Custo em Bumps é debitado de forma ATÔMICA via RPC debit_bumps
   (ver schema.sql), que faz "bumps = bumps - custo WHERE bumps >= custo"
   em uma única instrução no Postgres — evita o saldo ficar negativo por
   corrida entre abas/cliques rápidos, ao contrário do padrão antigo de
   "currentUser.bumps -= x; updateProfileInSupabase(...)" usado em outras
   partes do app.
   ════════════════════════════════════════════════════════════════════ */

// ── DÉBITO ATÔMICO DE BUMPS ──
// Retorna o novo saldo em caso de sucesso, ou null se falhar (saldo
// insuficiente, não logado, erro de rede). Em caso de sucesso, já
// sincroniza currentUser.bumps e qualquer label de saldo visível na tela
// (perfil, loja), pra nunca dessincronizar do banco.
async function debitBumpsAtomic(valor) {
    if (!currentUser || !currentUser.loggedIn || !currentUser.id) {
        showCyberAlert('ACESSO NEGADO', 'Você precisa estar conectado pra usar esta função.', 'error');
        return null;
    }
    if ((currentUser.bumps || 0) < valor) {
        showCyberAlert('FUNDOS INSUFICIENTES', `Saldo atual: <b>${currentUser.bumps} B$</b><br>Custo: <b>${valor} B$</b><br><br>Carregue o saldo no teu perfil.`, 'warn');
        return null;
    }
    try {
        const { data, error } = await sb.rpc('debit_bumps', { p_user: currentUser.id, p_valor: valor });
        if (error) {
            console.error('debitBumpsAtomic:', error.message);
            showCyberAlert('FUNDOS INSUFICIENTES', 'Saldo atual insuficiente ou recusado pela rede. Tente novamente.', 'warn');
            return null;
        }
        currentUser.bumps = data;
        const profBumpsEl = document.getElementById('profBumps'); if (profBumpsEl) profBumpsEl.innerText = `${currentUser.bumps} B$`;
        const lojaBalanceEl = document.getElementById('lojaBalanceDisplay'); if (lojaBalanceEl) lojaBalanceEl.innerText = `${currentUser.bumps.toLocaleString('pt-BR')} B$`;
        return data;
    } catch (e) {
        console.error('debitBumpsAtomic:', e);
        return null;
    }
}

/* ─────────────────────────────────────────────────────────────────────
   BROADCAST AÉREO — OVNI puxando faixa de texto pra rede inteira
   ───────────────────────────────────────────────────────────────────── */
