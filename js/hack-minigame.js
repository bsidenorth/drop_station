// =========================================================
// dr0p_station — MÓDULO: hack-minigame.js
// MINI-GAME DE DECODIFICAÇÃO (estilo Cyberpunk/Fallout) +
// COLEÇÕES TEMÁTICAS COM MINT LIMITADO
//
// Adicionar ao index.html ANTES de loja-shop.js:
//   <script src="js/hack-minigame.js"></script>
//
// Zero queries extras em idle — tudo lazy e cacheado.
// =========================================================

// =========================================================
// ── PARTE 1: MINI-GAME DE DECODIFICAÇÃO ──────────────────
// Aparece ao clicar em "ENVIAR AO COFRE VIRTUAL" (roll grátis)
// e ao iniciar uma Fusão normal (botão FUNDIR).
// Vencer: +5% chance de sucesso na fusão OU drop "LIMPO"
//         (sem tag [CORROMPIDO] e com bonus de raridade leve).
// Perder/timeout: fusão mantém chances padrão; drop ganha
//                 tag "[CORROMPIDO]" (cosmética, não impede resgate).
// =========================================================

// Paleta de bytes hexadecimais usados na matriz
const HACK_BYTES = [
    'FF','9A','1D','C3','7F','0E','B2','44',
    'A1','5C','38','D0','6B','EE','12','F7',
    'CC','80','3A','91','55','27','BE','4D'
];

// Sequências-alvo por dificuldade
const HACK_SEQUENCES = {
    easy:   { len: 3, time: 8000  },
    medium: { len: 4, time: 6000  },
    hard:   { len: 5, time: 4500  }
};

// Estado global do mini-game
window._hackGame = {
    active:      false,
    target:      [],      // sequência que o jogador precisa acertar
    selected:    [],      // bytes já clicados neste round
    timerHandle: null,
    timerBar:    null,
    onWin:       null,    // callback(true)
    onFail:      null,    // callback(false)
    context:     null     // 'drop' | 'fusion'
};

/**
 * Abre o overlay do mini-game.
 * @param {'drop'|'fusion'} context - onde está sendo chamado
 * @param {function} onWin  - chamado se o jogador vencer
 * @param {function} onFail - chamado se falhar ou timeout
 * @param {'easy'|'medium'|'hard'} difficulty
 */
function openHackMinigame(context, onWin, onFail, difficulty = 'easy') {
    if (window._hackGame.active) return;

    const cfg = HACK_SEQUENCES[difficulty];
    const pool = [...HACK_BYTES].sort(() => Math.random() - 0.5);

    // Escolhe sequência-alvo aleatória do pool
    const target = pool.slice(0, cfg.len);

    // Monta uma matriz 6×6 embaralhando o pool + repetições do target
    const matrixBytes = [];
    for (let i = 0; i < 36; i++) {
        matrixBytes.push(HACK_BYTES[Math.floor(Math.random() * HACK_BYTES.length)]);
    }
    // Garante que todos os bytes do target aparecem na matriz
    target.forEach((byte, i) => { matrixBytes[i * 6] = byte; });
    matrixBytes.sort(() => Math.random() - 0.5);

    window._hackGame = {
        active: true, target, selected: [],
        timerHandle: null, timerBar: null,
        onWin, onFail, context
    };

    // ── Cria overlay ──────────────────────────────────────
    const overlay = document.createElement('div');
    overlay.id = 'hackMinigameOverlay';
    Object.assign(overlay.style, {
        position: 'fixed', inset: '0', zIndex: '10001',
        background: 'rgba(0,0,0,0.96)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        fontFamily: '"Space Mono", monospace',
        padding: '16px'
    });

    const contextLabel = context === 'fusion'
        ? '⚗️ PROTOCOLO DE FUSÃO — DECIFRE A CHAVE'
        : '📡 PROTOCOLO DE RESGATE — DECIFRE A CHAVE';

    const rewardLabel = context === 'fusion'
        ? 'VITÓRIA: <span style="color:#00ff66">+5% CHANCE DE SUCESSO</span>'
        : 'VITÓRIA: <span style="color:#00ff66">DROP LIMPO — SEM CORRUPÇÃO</span>';

    overlay.innerHTML = `
        <div style="width:100%; max-width:400px; border:1px solid #00ffcc; background:#030a06; padding:20px; box-shadow:0 0 30px rgba(0,255,200,0.15);">

            <!-- Header -->
            <div style="font-size:0.5rem; color:#00ffcc88; letter-spacing:3px; margin-bottom:4px;">
                ${contextLabel}
            </div>
            <div style="font-size:0.9rem; font-weight:bold; color:#00ffcc; letter-spacing:2px; margin-bottom:12px;">
                [ BREACH_PROTOCOL ]
            </div>

            <!-- Timer bar -->
            <div style="background:#0a1a10; border:1px solid #00ffcc33; height:5px; margin-bottom:14px; overflow:hidden;">
                <div id="hackTimerBar" style="height:100%; width:100%; background:#00ffcc; transition:width ${cfg.time}ms linear; box-shadow:0 0 8px #00ffcc;"></div>
            </div>

            <!-- Recompensa -->
            <div style="font-size:0.5rem; color:#888899; margin-bottom:14px; border-left:2px solid #00ffcc44; padding-left:8px;">
                ${rewardLabel}<br>
                DERROTA: <span style="color:#ff4444">CHANCE PADRÃO${context === 'drop' ? ' + TAG [CORROMPIDO]' : ''}</span>
            </div>

            <!-- Sequência-alvo -->
            <div style="font-size:0.5rem; color:#555566; letter-spacing:2px; margin-bottom:6px;">SEQUÊNCIA ALVO:</div>
            <div id="hackTargetDisplay" style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap;">
                ${target.map((b, i) => `
                    <div id="hackTarget_${i}" style="border:1px solid #00ffcc55; padding:6px 10px; font-size:0.75rem; color:#00ffcc88; letter-spacing:2px; min-width:44px; text-align:center; background:#030d08;">
                        ${b}
                    </div>
                `).join('')}
            </div>

            <!-- Progresso do jogador -->
            <div style="font-size:0.5rem; color:#555566; letter-spacing:2px; margin-bottom:6px;">SEU INPUT:</div>
            <div id="hackPlayerInput" style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap; min-height:34px;">
                <span style="color:#333344; font-size:0.6rem; align-self:center;">— aguardando —</span>
            </div>

            <!-- Matriz de bytes -->
            <div style="font-size:0.5rem; color:#555566; letter-spacing:2px; margin-bottom:8px;">MATRIZ DE ACESSO:</div>
            <div id="hackMatrix" style="display:grid; grid-template-columns:repeat(6,1fr); gap:4px; margin-bottom:16px;">
                ${matrixBytes.map((b, i) => `
                    <button
                        id="hackCell_${i}"
                        data-byte="${b}"
                        onclick="hackCellClick(this)"
                        style="background:#030d08; border:1px solid #00ffcc22; color:#00ffcc99;
                               font-family:'Space Mono',monospace; font-size:0.55rem; padding:6px 2px;
                               cursor:pointer; letter-spacing:1px; transition:all 0.1s;"
                        onmouseover="this.style.borderColor='#00ffcc'; this.style.color='#00ffcc';"
                        onmouseout="if(!this.dataset.used) { this.style.borderColor='#00ffcc22'; this.style.color='#00ffcc99'; }">
                        ${b}
                    </button>
                `).join('')}
            </div>

            <!-- Botão pular -->
            <button onclick="hackSkip()"
                style="background:transparent; border:1px solid #333344; color:#444455;
                       font-family:'Space Mono',monospace; font-size:0.5rem; padding:8px 16px;
                       cursor:pointer; letter-spacing:2px; width:100%;">
                IGNORAR PROTOCOLO (aceitar risco)
            </button>
        </div>
    `;

    document.body.appendChild(overlay);

    // Inicia timer com rAF para a barra animar suavemente
    requestAnimationFrame(() => {
        const bar = document.getElementById('hackTimerBar');
        if (bar) { bar.style.width = '0%'; }
        window._hackGame.timerBar = bar;
    });

    window._hackGame.timerHandle = setTimeout(() => {
        if (window._hackGame.active) _hackEnd(false, 'TIMEOUT — BREACH BLOQUEADO');
    }, cfg.time);

    // Som de início
    if (typeof playSynthSound === 'function') playSynthSound('click');
}

/** Chamado ao clicar num byte da matriz */
function hackCellClick(btn) {
    const g = window._hackGame;
    if (!g.active || btn.dataset.used) return;

    btn.dataset.used = '1';
    btn.style.borderColor = '#00ffcc';
    btn.style.color = '#00ffcc';
    btn.style.background = '#001a0d';
    btn.disabled = true;

    const byte = btn.dataset.byte;
    g.selected.push(byte);

    // Atualiza display do input do jogador
    const inputEl = document.getElementById('hackPlayerInput');
    if (inputEl) {
        const idx = g.selected.length - 1;
        const isCorrect = byte === g.target[idx];
        inputEl.innerHTML = g.selected.map((b, i) => `
            <div style="border:1px solid ${b === g.target[i] ? '#00ff66' : '#ff4444'};
                        padding:5px 9px; font-size:0.7rem;
                        color:${b === g.target[i] ? '#00ff66' : '#ff4444'};
                        background:${b === g.target[i] ? '#001a00' : '#1a0000'};
                        letter-spacing:2px;">
                ${b}
            </div>
        `).join('');
    }

    // Ilumina a célula-alvo correspondente
    const targetCell = document.getElementById(`hackTarget_${g.selected.length - 1}`);
    if (targetCell) {
        const isRight = byte === g.target[g.selected.length - 1];
        targetCell.style.borderColor = isRight ? '#00ff66' : '#ff4444';
        targetCell.style.color = isRight ? '#00ff66' : '#ff4444';
        targetCell.style.background = isRight ? '#001a00' : '#1a0000';
    }

    if (typeof playSynthSound === 'function') playSynthSound('click');

    // Checa vitória: todos os bytes na ordem certa
    const allCorrect = g.selected.every((b, i) => b === g.target[i]);
    if (g.selected.length === g.target.length) {
        if (allCorrect) {
            setTimeout(() => _hackEnd(true, 'BREACH CONCLUÍDO — ACESSO LIBERADO'), 300);
        } else {
            setTimeout(() => _hackEnd(false, 'SEQUÊNCIA INCORRETA — ACESSO NEGADO'), 300);
        }
    } else if (!allCorrect) {
        // Erro imediato no byte errado
        setTimeout(() => _hackEnd(false, 'BYTE INVÁLIDO — BREACH ABORTADO'), 300);
    }
}

/** Jogador pula o mini-game voluntariamente */
function hackSkip() {
    _hackEnd(false, 'PROTOCOLO IGNORADO');
}

/** Finaliza o mini-game */
function _hackEnd(won, message) {
    const g = window._hackGame;
    if (!g.active) return;
    g.active = false;
    clearTimeout(g.timerHandle);

    const overlay = document.getElementById('hackMinigameOverlay');
    if (overlay) {
        const color = won ? '#00ff66' : '#ff4444';
        const icon  = won ? '✓' : '✕';

        // Mostra resultado brevemente antes de fechar
        overlay.innerHTML = `
            <div style="text-align:center; font-family:'Space Mono',monospace; padding:40px;">
                <div style="font-size:2.5rem; color:${color}; margin-bottom:16px;">${icon}</div>
                <div style="font-size:0.8rem; color:${color}; letter-spacing:3px;">${message}</div>
                ${won
                    ? `<div style="font-size:0.55rem; color:#00ff6688; margin-top:12px;">
                        ${g.context === 'fusion' ? '+5% DE CHANCE APLICADO' : 'DROP PROTEGIDO DE CORRUPÇÃO'}
                       </div>`
                    : `<div style="font-size:0.55rem; color:#ff444488; margin-top:12px;">
                        ${g.context === 'drop' && g.context !== 'fusion' ? 'TAG [CORROMPIDO] PODE SER APLICADA' : 'CHANCES PADRÃO MANTIDAS'}
                       </div>`
                }
            </div>
        `;
        if (typeof playSynthSound === 'function') {
            playSynthSound(won ? 'success' : 'shatter');
        }

        setTimeout(() => {
            overlay.remove();
            if (won && typeof g.onWin === 'function')  g.onWin(true);
            if (!won && typeof g.onFail === 'function') g.onFail(false);
        }, 900);
    } else {
        if (won && typeof g.onWin === 'function')  g.onWin(true);
        if (!won && typeof g.onFail === 'function') g.onFail(false);
    }
}

// ── INTEGRAÇÃO COM O DROP (executeHardwareRoll) ──────────
// Sobrescreve o comportamento do botão de resgate para
// interceptar o clique e mostrar o mini-game primeiro.
// Chamado por drop-vault.js logo após montar downloadBtn.
function patchDownloadBtnWithHack() {
    const btn = document.getElementById('downloadBtn');
    if (!btn || btn.dataset.hackPatched) return;
    btn.dataset.hackPatched = '1';

    // Guarda o handler original (claimAssetLogic)
    const originalOnclick = btn.onclick;
    btn.onclick = null;

    btn.addEventListener('click', function _hackInterceptDrop(e) {
        e.stopImmediatePropagation();

        // Não mostra o game se for Premium (já garantido)
        if (window.activeAssetData && window.activeAssetData.isPremium) {
            if (typeof claimAssetLogic === 'function') claimAssetLogic();
            return;
        }

        // Determina dificuldade pela raridade do drop atual
        const rarity = window.activeAssetData ? window.activeAssetData.rarityType : 'common';
        const diff = rarity === 'ancestral' ? 'hard'
                   : rarity === 'legendary' ? 'hard'
                   : rarity === 'epic'      ? 'medium'
                   : 'easy';

        openHackMinigame(
            'drop',
            // onWin: drop limpo — marca flag no activeAssetData
            () => {
                if (window.activeAssetData) window.activeAssetData._hackClean = true;
                if (typeof claimAssetLogic === 'function') claimAssetLogic();
            },
            // onFail: drop pode ser corrompido
            () => {
                if (window.activeAssetData) window.activeAssetData._hackClean = false;
                if (typeof claimAssetLogic === 'function') claimAssetLogic();
            },
            diff
        );
    }, { capture: true });
}

// Expõe globalmente para drop-vault.js chamar após montar o botão
window.patchDownloadBtnWithHack = patchDownloadBtnWithHack;

// ── INTEGRAÇÃO COM A FUSÃO (fuseCards) ───────────────────
// Envolve a chamada a fuseCards com o mini-game.
// Chame openFusionHackMinigame(id1, id2, mods) no lugar de fuseCards(id1,id2,mods).
function openFusionHackMinigame(id1, id2, modificadores = []) {
    const c1 = (typeof savedAssets !== 'undefined') ? savedAssets.find(a => a.id === id1) : null;
    const c2 = (typeof savedAssets !== 'undefined') ? savedAssets.find(a => a.id === id2) : null;
    const score = (c) => !c ? 1 : c.rarityType === 'ancestral' ? 4 : c.rarityType === 'legendary' ? 3 : c.rarityType === 'epic' ? 2 : 1;
    const total = score(c1) + score(c2);
    const diff  = total >= 6 ? 'hard' : total >= 4 ? 'medium' : 'easy';

    openHackMinigame(
        'fusion',
        // onWin: aplica +5% de ps via flag global
        () => {
            window._fusionHackBonus = 0.05;
            if (typeof fuseCards === 'function') fuseCards(id1, id2, modificadores);
        },
        // onFail: sem bônus
        () => {
            window._fusionHackBonus = 0;
            if (typeof fuseCards === 'function') fuseCards(id1, id2, modificadores);
        },
        diff
    );
}
window.openFusionHackMinigame = openFusionHackMinigame;

// ── APLICAÇÃO DO BÔNUS EM fuseCards ──────────────────────
// Patch não-invasivo: intercepta fuseCards e injeta o bônus
// de _fusionHackBonus em ps antes de o roll acontecer.
// Roda UMA vez no boot, depois de fusion.js já ter carregado.
(function _patchFuseCardsForHack() {
    const _origFuse = window.fuseCards;
    if (typeof _origFuse !== 'function' || window._fuseHackPatched) return;
    window._fuseHackPatched = true;
    window.fuseCards = function(id1, id2, modificadores = []) {
        // O bônus é consumido UMA VEZ por chamada
        if (window._fusionHackBonus > 0) {
            modificadores = [...modificadores];
            // Injeta um modificador sintético de SURVIVAL_BONUS
            modificadores.push({ _hackBonus: true, templateId: '__hack_bonus__' });
            // Intercepta ITEMS_DB temporariamente
            if (typeof ITEMS_DB !== 'undefined' && !ITEMS_DB['__hack_bonus__']) {
                ITEMS_DB['__hack_bonus__'] = {
                    effect: { type: 'SURVIVAL_BONUS', value: window._fusionHackBonus }
                };
                window._fusionHackBonus = 0;
                const result = _origFuse.apply(this, [id1, id2, modificadores]);
                delete ITEMS_DB['__hack_bonus__'];
                return result;
            }
            window._fusionHackBonus = 0;
        }
        return _origFuse.apply(this, [id1, id2, modificadores]);
    };
})();

// ── PATCH DO TAG [CORROMPIDO] em claimAssetLogic ─────────
// Adiciona a tag cosmética ao card se _hackClean === false.
// Aplicado depois de cards-inventory-db.js carregar.
(function _patchClaimForCorruption() {
    const _origClaim = window.claimAssetLogic;
    if (typeof _origClaim !== 'function' || window._claimCorruptPatchApplied) return;
    window._claimCorruptPatchApplied = true;
    window.claimAssetLogic = async function(...args) {
        if (window.activeAssetData && window.activeAssetData._hackClean === false) {
            // Adiciona tag [CORROMPIDO] ao card antes de salvar
            if (!Array.isArray(window.activeAssetData.tags)) window.activeAssetData.tags = [];
            if (!window.activeAssetData.tags.includes('corrompido')) {
                window.activeAssetData.tags.push('corrompido');
            }
            // Marca no estilo visualmente (sufixo no styleName)
            if (window.activeAssetData.styleName && !window.activeAssetData.styleName.includes('[CORROMPIDO]')) {
                window.activeAssetData.styleName    += ' [CORROMPIDO]';
                window.activeAssetData.styleNameEN  += ' [CORRUPTED]';
            }
        }
        return _origClaim.apply(this, args);
    };
})();

// Ativa o patch do botão de resgate toda vez que o drop
// resolve (drop-vault.js seta downloadBtn.style.display="block")
// usando um MutationObserver leve no botão.
(function _observeDownloadBtn() {
    const observer = new MutationObserver(() => {
        const btn = document.getElementById('downloadBtn');
        if (btn && btn.style.display !== 'none') {
            patchDownloadBtnWithHack();
        }
    });

    function _tryObserve() {
        const btn = document.getElementById('downloadBtn');
        if (btn) {
            observer.observe(btn, { attributes: true, attributeFilter: ['style'] });
        } else {
            setTimeout(_tryObserve, 300);
        }
    }
    _tryObserve();
})();


// =========================================================
// ── PARTE 2: COLEÇÕES TEMÁTICAS COM MINT LIMITADO ────────
//
// Lógica de escassez baseada na tabela card_supply já existente
// (supply_cap + minted_count por style_name), aproveitando
// getSupplyData / buildSupplyBarHTML / invalidateSupplyCache
// do cards-inventory-db.js sem nenhuma query nova.
//
// NOVA FUNCIONALIDADE:
// - Catálogo de coleções temáticas (THEMED_COLLECTIONS)
// - Badge de coleção injetado nos cards do drop + cofre
// - Bloqueio de drop quando supply_cap atingido
// - Banner de coleção ativa na tela de engine
// =========================================================

const THEMED_COLLECTIONS = [
    {
        id:        'ghost_protocol',
        name:      'Ghost Protocol',
        nameEN:    'Ghost Protocol',
        supply:    500,
        accent:    '#00ffcc',
        icon:      '👻',
        desc:      'Primeira tiragem — operadores fantasma da rede original.',
        styleIds:  [] // se vazio, aplica a TODOS os styles; preencher com style_name específicos para restringir
    },
    {
        id:        'crimson_byte',
        name:      'Crimson Byte',
        nameEN:    'Crimson Byte',
        supply:    250,
        accent:    '#ff0044',
        icon:      '🩸',
        desc:      'Coleção de alto risco — somente cards ÉPICO+ elegíveis.',
        styleIds:  [],
        rarityFilter: ['epic','legendary','ancestral']
    },
    {
        id:        'void_genesis',
        name:      'Void Genesis',
        nameEN:    'Void Genesis',
        supply:    100,
        accent:    '#9933ff',
        icon:      '🌑',
        desc:      'Tiragem ultra-limitada — apenas ANCESTRAL.',
        styleIds:  [],
        rarityFilter: ['ancestral']
    }
];
window.THEMED_COLLECTIONS = THEMED_COLLECTIONS;

// Cache em memória: { collectionId: { minted, cap, exhausted } }
const _collectionCache = {};

/**
 * Retorna a coleção ativa para um card dado rarityType e styleName.
 * Prioriza a coleção mais restrita (menor supply ainda não esgotada).
 */
function getActiveCollectionForCard(rarityType, styleName) {
    const eligible = THEMED_COLLECTIONS.filter(col => {
        if (col.rarityFilter && !col.rarityFilter.includes(rarityType)) return false;
        if (col.styleIds && col.styleIds.length > 0 && !col.styleIds.includes(styleName)) return false;
        const cached = _collectionCache[col.id];
        if (cached && cached.exhausted) return false;
        return true;
    });
    // Ordena por supply menor (mais raro primeiro)
    eligible.sort((a, b) => a.supply - b.supply);
    return eligible[0] || null;
}
window.getActiveCollectionForCard = getActiveCollectionForCard;

/**
 * Busca o minted_count de uma coleção no Supabase (via card_supply).
 * Usa o cache de supply já existente (getSupplyData) para evitar
 * queries extras — mapeia collectionId para o style_name da coleção.
 * Se não houver entrada em card_supply, considera minted=0.
 */
async function getCollectionMintedCount(collection) {
    if (_collectionCache[collection.id]) return _collectionCache[collection.id];

    // Busca direto na tabela card_supply pelo id da coleção
    try {
        const { data, error } = await sb.from('card_supply')
            .select('supply_cap, minted_count')
            .eq('style_name', collection.id)
            .maybeSingle();

        const minted = data ? (data.minted_count || 0) : 0;
        const cap    = data ? (data.supply_cap    || collection.supply) : collection.supply;
        const result = { minted, cap, exhausted: minted >= cap };
        _collectionCache[collection.id] = result;
        return result;
    } catch (e) {
        return { minted: 0, cap: collection.supply, exhausted: false };
    }
}
window.getCollectionMintedCount = getCollectionMintedCount;

/**
 * Incrementa o contador de mint de uma coleção no Supabase.
 * Faz upsert na tabela card_supply usando o id da coleção como style_name.
 * Chamado por claimAssetLogic (via patch abaixo) após salvar o card.
 */
async function incrementCollectionMint(collectionId) {
    if (!collectionId) return;
    try {
        // Tenta incrementar via RPC (mais seguro contra race)
        const { error } = await sb.rpc('increment_supply_minted', {
            p_style: collectionId
        });
        if (error) {
            // Fallback: upsert manual se a RPC não existir ainda
            const current = _collectionCache[collectionId];
            const newCount = (current ? current.minted : 0) + 1;
            await sb.from('card_supply').upsert({
                style_name:   collectionId,
                supply_cap:   (current ? current.cap : 500),
                minted_count: newCount
            }, { onConflict: 'style_name' });
        }
        // Invalida cache local
        delete _collectionCache[collectionId];
        if (typeof invalidateSupplyCache === 'function') invalidateSupplyCache(collectionId);
    } catch (e) {
        console.warn('[Collection] incrementCollectionMint falhou:', e);
    }
}
window.incrementCollectionMint = incrementCollectionMint;

/**
 * Gera o HTML do badge de coleção para injetar num card.
 * Zero-query: usa dados já carregados via getCollectionMintedCount.
 */
function buildCollectionBadgeHTML(collection, minted, cap) {
    if (!collection) return '';
    const pct      = Math.min(100, Math.round((minted / cap) * 100));
    const isAlmost = pct >= 80 && pct < 100;
    const isMaxed  = minted >= cap;
    const barColor = isMaxed ? '#ff0033' : isAlmost ? '#ffaa00' : collection.accent;

    return `
        <div class="collection-badge" style="
            border-top: 1px solid ${collection.accent}33;
            padding: 5px 0 3px;
            margin-top: 4px;
        ">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
                <span style="font-size:0.42rem; color:${collection.accent}; letter-spacing:1px; font-family:'Space Mono',monospace;">
                    ${collection.icon} ${collection.name.toUpperCase()}
                </span>
                <span style="font-size:0.42rem; color:${barColor}; font-family:'Space Mono',monospace; font-weight:bold;">
                    ${isMaxed ? '⬛ ESGOTADO' : `${minted}/${cap}`}
                </span>
            </div>
            <div style="height:3px; background:#0d0d1e; border-radius:2px; overflow:hidden;">
                <div style="height:100%; width:${pct}%; background:${barColor}; border-radius:2px; box-shadow:0 0 4px ${barColor}66; transition:width 0.5s;"></div>
            </div>
            ${isAlmost && !isMaxed ? `<div style="font-size:0.38rem; color:#ffaa00; margin-top:2px; letter-spacing:1px;">⚠ ESGOTANDO — ${cap - minted} RESTANTES</div>` : ''}
        </div>
    `;
}
window.buildCollectionBadgeHTML = buildCollectionBadgeHTML;

/**
 * Injeta o badge de coleção num elemento de card já renderizado no DOM.
 * Chamado após renderVaultGrid / o modal de Inspect.
 */
async function injectCollectionBadgeIntoCard(cardEl, rarityType, styleName) {
    if (!cardEl || cardEl.querySelector('.collection-badge')) return;
    const col = getActiveCollectionForCard(rarityType, styleName);
    if (!col) return;
    const { minted, cap } = await getCollectionMintedCount(col);
    const html = buildCollectionBadgeHTML(col, minted, cap);
    if (!html) return;
    const target = cardEl.querySelector('.album-meta, .card-body, .album-card-meta') || cardEl;
    target.insertAdjacentHTML('beforeend', html);
}
window.injectCollectionBadgeIntoCard = injectCollectionBadgeIntoCard;

/**
 * Enriquece todos os cards visíveis no DOM com badges de coleção.
 * Chamado após renderVaultGrid (via patch abaixo).
 * Agrupa queries por collectionId para minimizar round-trips.
 */
async function enrichAllCardsWithCollectionBadges() {
    const cardEls = document.querySelectorAll('.album-card[data-rarity], .market-card[data-rarity], .vault-card[data-rarity]');
    if (!cardEls.length) return;

    // Pré-carrega todos os supply counts únicos em paralelo
    const uniqueCols = new Set();
    cardEls.forEach(el => {
        const col = getActiveCollectionForCard(el.dataset.rarity || '', el.dataset.style || '');
        if (col) uniqueCols.add(col.id);
    });
    await Promise.all([...uniqueCols].map(id => {
        const col = THEMED_COLLECTIONS.find(c => c.id === id);
        return col ? getCollectionMintedCount(col) : Promise.resolve();
    }));

    for (const el of cardEls) {
        await injectCollectionBadgeIntoCard(el, el.dataset.rarity || '', el.dataset.style || '');
    }
}
window.enrichAllCardsWithCollectionBadges = enrichAllCardsWithCollectionBadges;

// ── Patch de claimAssetLogic para incrementar mint da coleção ──
(function _patchClaimForCollection() {
    const _origClaim = window.claimAssetLogic;
    if (typeof _origClaim !== 'function' || window._claimCollectionPatchApplied) return;
    window._claimCollectionPatchApplied = true;

    window.claimAssetLogic = async function(...args) {
        const result = await _origClaim.apply(this, args);

        // Após salvar com sucesso, incrementa o contador da coleção
        if (window.activeAssetData === null && typeof savedAssets !== 'undefined' && savedAssets.length > 0) {
            // activeAssetData é null após claim bem-sucedido — pega o último card salvo
            const last = savedAssets[savedAssets.length - 1];
            if (last) {
                const col = getActiveCollectionForCard(last.rarityType, last.styleName);
                if (col) {
                    await incrementCollectionMint(col.id);
                    // Injeta o badge no card recém-adicionado ao grid do cofre
                    setTimeout(() => {
                        const el = document.querySelector(`.album-card[data-id="${last.id}"]`);
                        if (el) injectCollectionBadgeIntoCard(el, last.rarityType, last.styleName);
                    }, 800);
                }
            }
        }
        return result;
    };
})();

// ── Exibe badge de coleção na tela de drop (target-container) ──
// Chamado por drop-vault.js após montar o card (via MutationObserver já declarado acima)
async function updateDropCollectionBadge(rarityType, styleName) {
    const badgeEl = document.getElementById('dropCollectionBadge');
    const col = getActiveCollectionForCard(rarityType || 'common', styleName || '');

    if (!col) {
        if (badgeEl) badgeEl.innerHTML = '';
        return;
    }

    const { minted, cap, exhausted } = await getCollectionMintedCount(col);

    // Se esgotado, bloqueia o drop visualmente
    if (exhausted) {
        if (badgeEl) badgeEl.innerHTML = `
            <div style="font-size:0.5rem; color:#ff0033; letter-spacing:2px; text-align:center; margin-top:6px; font-family:'Space Mono',monospace;">
                ${col.icon} COLEÇÃO ${col.name.toUpperCase()} ESGOTADA
            </div>
        `;
        return;
    }

    if (badgeEl) {
        badgeEl.innerHTML = buildCollectionBadgeHTML(col, minted, cap);
    }
}
window.updateDropCollectionBadge = updateDropCollectionBadge;

// ── Patch de renderVaultGrid para injetar badges após render ──
(function _patchRenderVaultForCollections() {
    const _origRender = window.renderVaultGrid;
    if (typeof _origRender !== 'function' || window._vaultCollectionPatchApplied) return;
    window._vaultCollectionPatchApplied = true;
    window.renderVaultGrid = function(...args) {
        const result = _origRender.apply(this, args);
        setTimeout(() => enrichAllCardsWithCollectionBadges(), 200);
        return result;
    };
})();

console.log('[hack-minigame] Mini-game de decodificação + Coleções temáticas carregados.');
