// =========================================================
// dr0p_station — MÓDULO: missions-leaderboard.js
// MISSÕES DIÁRIAS, PROVENANCE/QR, LEADERBOARD, badges e efeitos visuais (glitch, flash, overload)
//
// Parte 6 de 14 do script.js original (split automático,
// ORDEM DE CARREGAMENTO PRESERVADA — não mudar a ordem dos <script> no HTML).
// =========================================================

    function loadDailyMissions() {
        try {
            const all = JSON.parse(localStorage.getItem(DAILY_MISSIONS_KEY)) || {};
            return all[currentUser.username] || { lastReset: 0, completed: [] };
        } catch(e) { return { lastReset: 0, completed: [] }; }
    }

    function saveDailyMissions(data) {
        try {
            const all = JSON.parse(localStorage.getItem(DAILY_MISSIONS_KEY)) || {};
            all[currentUser.username] = data;
            localStorage.setItem(DAILY_MISSIONS_KEY, JSON.stringify(all));
        } catch(e) {}
    }

    function checkDailyMissionsReset() {
        const data = loadDailyMissions();
        const now = Date.now();
        if (now - data.lastReset >= 86400000) {
            // Reseta painel após 24h
            saveDailyMissions({ lastReset: now, completed: [] });
            return { lastReset: now, completed: [] };
        }
        return data;
    }

    async function claimDailyMission(missionId) {
        if (!currentUser.loggedIn) { navigateTo('auth'); return; }
        const mission = DAILY_MISSIONS_DB.find(m => m.id === missionId);
        if (!mission) return;

        const data = checkDailyMissionsReset();
        if (data.completed.includes(missionId)) return;

        // Verifica requisito: conta cards da raridade no cofre
        const count = savedAssets.filter(a => a.rarityType === mission.reqRarity).length;
        if (count < mission.reqCount) {
            showCyberAlert('MISSÃO NÃO CONCLUÍDA',
                `Requisito: <b>${mission.reqCount} card(s) ${mission.reqRarity.toUpperCase()}</b> no cofre.<br>Você tem: <b>${count}</b>.`, 'warn');
            return;
        }

        // Log de terminal antes de creditar
        const logLines = [
            `> INICIANDO PROCESSO DE VERIFICAÇÃO...`,
            `> MISSÃO [${missionId}]: ${mission.name.toUpperCase()}`,
            `> REQUISITO VALIDADO: ${count} CARD(S) ${mission.reqRarity.toUpperCase()} DETECTADO(S)`,
            `> CALCULANDO RECOMPENSA: ${mission.reward} B$`,
            `> CREDITANDO NO TERMINAL...`,
            `> OPERAÇÃO CONCLUÍDA. +${mission.reward} B$ ADICIONADOS.`
        ];

        // Credita recompensa
        currentUser.bumps += mission.reward;
        await updateProfileInSupabase(currentUser.id, { bumps: currentUser.bumps });

        // Marca missão como concluída
        data.completed.push(missionId);
        saveDailyMissions(data);

        // Atualiza badge de saldo
        const profBumpsEl = document.getElementById('profBumps');
        if (profBumpsEl) profBumpsEl.innerText = `${currentUser.bumps} B$`;

        playSynthSound('success');
        if (mission.reqRarity === 'ancestral') triggerAncestralFlash('#ff007f');

        showCyberAlert(
            '// MISSÃO CONCLUÍDA //',
            `<div style="font-family:'Space Mono',monospace; font-size:0.6rem; color:#00ff6699; text-align:left; margin-bottom:12px; line-height:2;">${logLines.map(l => `<div>${l}</div>`).join('')}</div>` +
            `<b style="color:#ffaa00; font-size:0.9rem;">+${mission.reward} B$</b> creditados.<br>Saldo atual: <b>${currentUser.bumps} B$</b>`,
            'success'
        );

        renderDailyMissions();
    }

    function renderDailyMissions() {
        const container = document.getElementById('dailyMissionsContainer');
        if (!container) return;
        container.innerHTML = '';

        if (!currentUser.loggedIn) {
            container.innerHTML = '<div class="empty-vault-notice">Login necessário para ver missões diárias.</div>';
            return;
        }

        const data = checkDailyMissionsReset();
        const now = Date.now();
        const remaining = Math.max(0, 86400000 - (now - data.lastReset));
        const h = Math.floor(remaining / 3600000);
        const m = Math.floor((remaining % 3600000) / 60000);

        // Header com reset timer
        const header = document.createElement('div');
        header.style.cssText = 'font-size:0.55rem; color:#555566; letter-spacing:1px; margin-bottom:12px;';
        header.innerText = `> MISSÕES_DIÁRIAS // RESET EM ${String(h).padStart(2,'0')}h${String(m).padStart(2,'0')}m`;
        container.appendChild(header);

        DAILY_MISSIONS_DB.forEach(mission => {
            const isDone = data.completed.includes(mission.id);
            const isAncestral = mission.reqRarity === 'ancestral';

            // Missão concluída some da lista
            if (isDone) return;

            const card = document.createElement('div');
            card.style.cssText = `
                background: ${isAncestral ? '#120008' : '#07070f'};
                border: 1px solid ${isAncestral ? '#ff007f' : '#333344'};
                padding: 14px 16px; margin-bottom: 8px; position: relative; overflow: hidden;
                ${isAncestral ? 'box-shadow: 0 0 12px rgba(255,0,127,0.2);' : ''}
            `;

            const countOwned = savedAssets.filter(a => a.rarityType === mission.reqRarity).length;
            const canClaim = countOwned >= mission.reqCount;

            card.innerHTML = `
                <div style="font-size:0.5rem; color:${isAncestral ? '#ff007f' : '#666680'}; letter-spacing:2px; margin-bottom:4px;">${mission.id} ${isAncestral ? '// ⚠ MISSÃO RARA' : ''}</div>
                <div style="font-family:'Archivo Black',sans-serif; font-size:0.8rem; color:${isAncestral ? '#ff007f' : '#fff'}; margin-bottom:4px;">${mission.name}</div>
                <div style="font-size:0.58rem; color:#888899; margin-bottom:8px;">${mission.desc}</div>
                <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
                    <span style="font-size:0.55rem; color:${isAncestral ? '#ff007f' : '#ffaa00'}; border:1px solid currentColor; padding:2px 7px;">💰 +${mission.rewardLabel}</span>
                    <span style="font-size:0.5rem; color:#666;">VOCÊ TEM: ${countOwned}/${mission.reqCount}</span>
                    <button class="btn-action" style="border-color:${canClaim ? (isAncestral ? '#ff007f' : '#00ff66') : '#333'}; color:${canClaim ? (isAncestral ? '#ff007f' : '#00ff66') : '#555'}; ${canClaim ? '' : 'cursor:not-allowed; opacity:0.5;'} padding:6px 14px; width:auto;" ${canClaim ? `onclick="claimDailyMission('${mission.id}')"` : 'disabled'}>
                        ${canClaim ? '▶ RESGATAR' : 'INCOMPLETA'}
                    </button>
                </div>
            `;
            container.appendChild(card);
        });

        // Se todas concluídas
        if (container.querySelectorAll('div[style]').length <= 1) {
            const done = document.createElement('div');
            done.className = 'empty-vault-notice';
            done.innerHTML = '✅ TODAS AS MISSÕES DO DIA CONCLUÍDAS.<br><small style="color:#444;font-size:0.55rem;">Volta amanhã para novas missões.</small>';
            container.appendChild(done);
        }
    }

    // =========================================================
    // PROVENIÊNCIA — ID Único, Hash Criptográfico e Timestamp
    // Sistema interno de prova de origem: todo card gerado no
    // dr0p_station carrega uma assinatura imutável. Mesmo sem
    // blockchain, o registro no localStorage funciona como
    // "ata de nascimento" do ativo. Útil para detectar cópias
    // e como base para tokenização futura (Web3).
    // =========================================================

    /**
     * Hash leve e determinístico (DJB2) a partir dos dados do card.
     * Roda de forma síncrona e offline, sem depender de SubtleCrypto.
     * O resultado muda se qualquer campo-semente do card mudar.
     */
    function _djb2Hash(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) {
            h = ((h << 5) + h) ^ str.charCodeAt(i);
            h |= 0; // força inteiro 32 bits
        }
        return (h >>> 0).toString(16).padStart(8, '0').toUpperCase();
    }

    /**
     * Gera o objeto de proveniência para um card.
     * @param {object} cardData  Objeto parcial ou completo do card (precisa de id, rarityType, styleName, creator)
     * @returns {{ hash: string, timestamp: number, origin: string }}
     */
    function generateProvenance(cardData) {
        const ts   = Date.now();
        const seed = [cardData.id, cardData.rarityType, cardData.styleName, cardData.creator, ts].join('|');
        return {
            hash:      `DS-${_djb2Hash(seed)}`,   // ex: DS-4A2F9C1B
            timestamp: ts,
            origin:    'DROP_STATION_INTERNAL'
        };
    }

    /**
     * Injeta proveniência + flag Web3 no objeto do card SE ainda não tiver.
     * Cards do feed global legado ou demo ficam sem — comportamento esperado.
     * A partir desta versão, também inicializa o Survival Counter (fusion_count),
     * o histórico genético (genetic_history) e a assinatura visual do QR Code.
     * @param {object} cardObj  Objeto do card (mutado in-place e retornado)
     */
    function attachProvenance(cardObj) {
        if (cardObj.provenance) return cardObj; // já tem — nunca sobrescrever
        cardObj.provenance  = generateProvenance(cardObj);
        cardObj.isTokenized = false; // preparação para fluxo Web3

        // ── ALQUIMIA: contador de sobrevivência + linhagem genética ──
        if (typeof cardObj.fusion_count !== 'number') cardObj.fusion_count = 0;
        if (!Array.isArray(cardObj.genetic_history)) cardObj.genetic_history = [];
        cardObj.eliteEligible = cardObj.fusion_count >= 3;

        // ── Resoluções: UI leve (500px) sempre disponível; HD só sob demanda ──
        if (!cardObj.resolutions) {
            cardObj.resolutions = { ui: { w: 500, h: 500 }, hd: { w: 4000, h: 4000, src: null } };
        }

        regenerateQrSignature(cardObj);
        return cardObj;
    }

    /**
     * Regera a assinatura visual do QR Code de um card sempre que seu estado muda:
     * criação, transferência de propriedade ou sobrevivência a uma fusão.
     * O hash base (provenance.hash) nunca muda — só o sufixo de estado "-Fxx".
     */
    function regenerateQrSignature(cardObj) {
        const suffix = `F${cardObj.fusion_count || 0}`;
        cardObj.qr_code_hash   = `${cardObj.provenance.hash}-${suffix}`;
        // URL pública de inspeção direta do card
        const cardDisplayId = encodeURIComponent(cardObj.id || cardObj.qr_code_hash);
        cardObj.qr_payload_url = `${location.origin}${location.pathname}?card=${cardDisplayId}&hash=${encodeURIComponent(cardObj.qr_code_hash)}`;
        return cardObj;
    }

    /**
     * Desenha o QR Code dinâmico de um card num container do DOM.
     * Usa a lib QRCode (qrcodejs) carregada no <head> do index.html.
     * Sempre limpa o container antes de redesenhar (necessário pois o
     * QR muta a cada novo estado do card).
     */
    function renderQRCode(cardObj, containerId) {
        const el = document.getElementById(containerId);
        if (!el || typeof QRCode === 'undefined' || !cardObj.qr_payload_url) return;
        el.innerHTML = ''; // limpa render anterior — o QR é regenerado, não acumulado
        new QRCode(el, {
            text: cardObj.qr_payload_url,
            width: 120,
            height: 120,
            colorDark: '#00ffff',
            colorLight: '#020204',
            correctLevel: QRCode.CorrectLevel.M
        });
    }

    // ITEMS_DB, getUserInventory e consumeInventoryItem agora vêm da Parte 3 (Supabase), no final do arquivo.

    // DAILY DROPS — Recompensa diária (cooldown de 24h)
    const DAILY_DROP_REWARD_BUMPS = 30; // 30 B$ garantidos — nunca trava o usuário

    function getDailyDropKey() {
        return `cyber_daily_drop_${currentUser.username}`;
    }

    async function claimDailyDrop() {
        if (!currentUser.loggedIn) { navigateTo('auth'); return; }
        const key = getDailyDropKey();
        const last = parseInt(localStorage.getItem(key) || '0', 10);
        const now = Date.now();
        if (now - last < 86400000) { renderDailyDropButton(); return; }

        currentUser.bumps += DAILY_DROP_REWARD_BUMPS;
        localStorage.setItem(key, String(now));
        await updateProfileInSupabase(currentUser.id, { bumps: currentUser.bumps });

        showCyberAlert('PROCESSO_CONCLUÍDO:', `Subsídio de rede coletado! +${DAILY_DROP_REWARD_BUMPS} B$ creditados na conta.`, 'success');
        playTerminalSound('claim');
        renderDailyDropButton();
    }

    function renderDailyDropButton() {
        const btn = document.getElementById('dailyDropBtn');
        if (!btn) return;
        if (!currentUser.loggedIn) { btn.innerText = '🛰️ LOGIN PARA COLHER SUBSÍDIO'; btn.disabled = true; return; }

        const last = parseInt(localStorage.getItem(getDailyDropKey()) || '0', 10);
        const remaining = 86400000 - (Date.now() - last);

        if (remaining <= 0) {
            btn.disabled = false;
            btn.innerText = `🛰️ COLHER SUBSÍDIO DA REDE (+${DAILY_DROP_REWARD_BUMPS} B$)`;
        } else {
            btn.disabled = true;
            const h = Math.floor(remaining / 3600000);
            const m = Math.floor((remaining % 3600000) / 60000);
            const s = Math.floor((remaining % 60000) / 1000);
            btn.innerText = `⏳ PRÓXIMO SUBSÍDIO EM ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
        }
    }
    setInterval(renderDailyDropButton, 1000);

    // =========================================================
    // LEADERBOARD — Placar Global de Operadores
    // =========================================================
    let leaderboardMode = 'bumps'; // 'bumps' | 'legendary'

    function setLeaderboardMode(mode) {
        leaderboardMode = mode;
        document.querySelectorAll('#leaderboardModeBar .filter-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === mode);
        });
        renderLeaderboard();
    }

    async function renderLeaderboard() {
        const list = document.getElementById('leaderboardList');
        if (!list) return;

        // Busca todos os perfis (substitui loadRegistry()) + contagem de lendários por usuário
        // Também busca avatar, avatar_frame e avatar_motion_filter pra renderizar a moldura
        // neon + o filtro de movimento (quando o avatar é um card "isAnimated") de cada
        // operador no Placar.
        const { data: profilesData, error: profErr } = await sb.from('profiles').select('id, username, bumps, fusion_count, avatar, avatar_frame, avatar_motion_filter');
        if (profErr) { console.error('renderLeaderboard (profiles):', profErr.message); list.innerHTML = '<div class="empty-vault-notice">FALHA AO CARREGAR PLACAR.</div>'; return; }

        const { data: legendaryRows, error: cardsErr } = await sb.from('cards').select('id_usuario').eq('rarity_type', 'legendary');
        if (cardsErr) console.error('renderLeaderboard (cards):', cardsErr.message);
        const legendaryCounts = {};
        (legendaryRows || []).forEach(r => { legendaryCounts[r.id_usuario] = (legendaryCounts[r.id_usuario] || 0) + 1; });

        // [FIX AVATAR RANKING] Antes, todo perfil sem avatar customizado caía no MESMO
        // placeholder fixo (Homer Simpson) — com vários operadores sem foto própria no
        // Top 5, a lista toda parecia "puxar o avatar errado" porque mostrava a mesma
        // imagem repetida pra gente diferente. Agora o fallback é gerado de forma
        // DETERMINÍSTICA a partir do username (DiceBear), então cada operador sem
        // avatar customizado ganha um ícone único e estável — sem depender de upload.
        const fallbackAvatarFor = (username) => `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(username || 'anon')}`;

        const rows = (profilesData || []).map(u => ({
            username: u.username,
            bumps: u.bumps || 0,
            legendaryCount: legendaryCounts[u.id] || 0,
            avatar: u.avatar || fallbackAvatarFor(u.username),
            avatarFrame: u.avatar_frame || FRAME_DEFAULT_ID,
            avatarMotionFilter: u.avatar_motion_filter || null
        }));

        rows.sort((a, b) => leaderboardMode === 'bumps' ? (b.bumps - a.bumps) : (b.legendaryCount - a.legendaryCount));
        const top5 = rows.slice(0, 5);

        if (top5.length === 0) {
            list.innerHTML = '<div class="empty-vault-notice">NENHUM OPERADOR REGISTRADO NA REDE.</div>';
            return;
        }

        // Recompensas sazonais (simuladas, sem valor real) atreladas a cada posição do Placar Global.
        const SEASON_REWARDS = [
            '+500 B$ + Caixa Lendária',
            '+300 B$ + Caixa Épica',
            '+150 B$ + Caixa Épica',
            '+75 B$ + Caixa Comum',
            '+50 B$ + Caixa Comum'
        ];

        list.innerHTML = top5.map((r, i) => {
            const medal = ['🥇','🥈','🥉','🎖️','🎖️'][i] || '▫️';
            const value = leaderboardMode === 'bumps' ? `${r.bumps} B$` : `${r.legendaryCount} LENDÁRIOS`;
            const isMe = r.username === currentUser.username ? ' style="color:#00ffff;"' : '';
            // Mostra SOMENTE recompensas em Bumps na coluna de recompensas
            const bumpsReward = ['500 B$', '300 B$', '150 B$', '75 B$', '50 B$'][i] || '—';
            const avatarSrc = r.avatar || fallbackAvatarFor(r.username);
            const avatarFallback = fallbackAvatarFor(r.username);
            // [FIX AVATAR ANIMADO] mesma lógica de filtro de movimento do Perfil/Inventário
            // (card-motion-active + data-motion-filter), aplicada só no .cyber-frame interno
            // pra não deformar a moldura redonda/quadrada do avatar na linha do ranking.
            const motionClass = r.avatarMotionFilter ? ' card-motion-active' : '';
            const motionAttr = r.avatarMotionFilter ? ` data-motion-filter="${r.avatarMotionFilter}"` : '';
            return `<div class="leaderboard-row" onclick="viewExternalProfile('${r.username.replace(/'/g,"\\'")}');"${isMe}>
                <span>${medal} #${i+1}</span>
                <span class="avatar-container ${r.avatarFrame}"><span class="cyber-frame${motionClass}"${motionAttr}><img src="${avatarSrc}" draggable="false" loading="lazy" onerror="this.onerror=null;this.src='${avatarFallback}'"></span></span>
                <span>${r.username}</span>
                <span>${value}</span>
                <span class="lb-rewards">💰 ${bumpsReward}</span>
            </div>`;
        }).join('');
    }

    // =========================================================
    // BADGES DE CONQUISTA
    // =========================================================
    function computeBadges(userData) {
        const badges = [];
        const fusionCount = (userData && userData.fusionCount) || 0;
        const bumps = (userData && userData.bumps) || 0;
        if (fusionCount >= 10) badges.push({ icon: '⚗️', label: 'MESTRE ALQUIMISTA' });
        if (bumps >= 1000) badges.push({ icon: '🐋', label: 'BALEIA DA REDE' });
        const legendaryCount = ((userData && userData.savedAssets) || []).filter(a => a.rarityType === 'legendary').length;
        if (legendaryCount >= 3) badges.push({ icon: '💎', label: 'CAÇADOR DE LENDAS' });
        return badges;
    }

    async function renderProfileBadges(username) {
        const zone = document.getElementById('profBadgesZone');
        if (!zone) return;
        const profile = await fetchProfileByUsername(username);
        if (!profile) { zone.innerHTML = '<span class="badge-tag badge-empty">SEM INSÍGNIAS REGISTRADAS</span>'; return; }
        const { data: legendaryRows } = await sb.from('cards').select('id').eq('id_usuario', profile.id).eq('rarity_type', 'legendary');
        const userData = {
            fusionCount: profile.fusion_count || 0,
            bumps: profile.bumps || 0,
            savedAssets: (legendaryRows || []).map(() => ({ rarityType: 'legendary' }))
        };
        const badges = computeBadges(userData);
        zone.innerHTML = badges.length === 0
            ? '<span class="badge-tag badge-empty">SEM INSÍGNIAS REGISTRADAS</span>'
            : badges.map(b => `<span class="badge-tag">${b.icon} ${b.label}</span>`).join('');
    }

    async function registerFusionForBadges() {
        if (!currentUser.id) return;
        const newCount = (currentUser.fusionCount || 0) + 1;
        currentUser.fusionCount = newCount;
        await updateProfileInSupabase(currentUser.id, { fusion_count: newCount });
    }

    // =========================================================
    // EVENTO DE SISTEMA — SOBRECARGA NA REDE (boost temporário de Épicos)
    // =========================================================
    let networkOverloadActive = false;
    const NETWORK_OVERLOAD_EPIC_MULTIPLIER = 2.5;
    const NETWORK_OVERLOAD_DURATION_MS = 5 * 60 * 1000;
    const NETWORK_OVERLOAD_CHECK_INTERVAL_MS = 90 * 1000; // checa a cada 90s
    const NETWORK_OVERLOAD_CHANCE_PER_CHECK = 0.12; // 12% de chance por checagem

    function triggerNetworkOverload() {
        if (networkOverloadActive) return;
        networkOverloadActive = true;
        const indicator = document.getElementById('overloadIndicator');
        if (indicator) indicator.style.display = 'inline-flex';

        showCyberAlert(
            '⚠️ ALERTA_DE_REDE:',
            'Sobrecarga na rede! Chance de dropar cards ÉPICOS aumentada por 5 minutos!',
            'warn'
        );
        playTerminalSound('overload');

        setTimeout(() => {
            networkOverloadActive = false;
            if (indicator) indicator.style.display = 'none';
            showCyberAlert('LOG_ERRO:', 'Sobrecarga de rede estabilizada. Probabilidades normalizadas.', 'warn');
        }, NETWORK_OVERLOAD_DURATION_MS);
    }

    function startNetworkOverloadLoop() {
        setInterval(() => {
            if (networkOverloadActive) return;
            if (Math.random() < NETWORK_OVERLOAD_CHANCE_PER_CHECK) triggerNetworkOverload();
        }, NETWORK_OVERLOAD_CHECK_INTERVAL_MS);
    }
    startNetworkOverloadLoop();

    // =========================================================
    // FX — CURTO-CIRCUITO NA LOGO + ESTALO ELÉTRICO SINTETIZADO
    // =========================================================
    function playElectricZap() {
        try {
            initAudio();
            const bufferSize = audioCtx.sampleRate * 0.18;
            const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
            const data = noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);

            const noise = audioCtx.createBufferSource();
            noise.buffer = noiseBuffer;
            const filter = audioCtx.createBiquadFilter();
            filter.type = 'highpass'; filter.frequency.setValueAtTime(1800, audioCtx.currentTime);
            const gain = audioCtx.createGain();
            gain.gain.setValueAtTime(0.18, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.18);

            noise.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination);
            noise.start();

            const osc = audioCtx.createOscillator();
            osc.type = 'square'; osc.frequency.setValueAtTime(90, audioCtx.currentTime);
            osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.12);
            const oGain = audioCtx.createGain();
            oGain.gain.setValueAtTime(0.08, audioCtx.currentTime);
            oGain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.14);
            osc.connect(oGain); oGain.connect(audioCtx.destination);
            osc.start(); osc.stop(audioCtx.currentTime + 0.14);
        } catch(e) {}
    }

    // =========================================================
    // FX — FLASH DE TELA ANCESTRAL (rosa se sucesso, vermelho se quebrar)
    // =========================================================
    function triggerAncestralFlash(color) {
        const flash = document.createElement('div');
        flash.style.cssText = `
            position:fixed; inset:0; z-index:99999;
            background:${color};
            opacity:0; pointer-events:none;
            transition: opacity 0.08s ease;
        `;
        document.body.appendChild(flash);
        // Pulsa 3 vezes
        let count = 0;
        const pulse = () => {
            flash.style.opacity = '0.35';
            setTimeout(() => {
                flash.style.opacity = '0';
                count++;
                if (count < 3) setTimeout(pulse, 160);
                else setTimeout(() => flash.remove(), 200);
            }, 100);
        };
        setTimeout(pulse, 20);
    }

    // =========================================================
    // WEB3 — Modal Simulado de Tokenização (Pré-Mint)
    // Nenhuma transação real acontece aqui. O objetivo é mostrar
    // ao usuário o fluxo e educá-lo sobre custos de gas, mantendo
    // controle e custo do lado dele. O card já tem isTokenized:false
    // como placeholder para integração futura com MetaMask/ERC-721.
    // =========================================================
    function showTokenizeModal(cardId) {
        closeInspectModal();
        const card = savedAssets.find(a => a.id === cardId);
        if (!card) return;

        const prov = card.provenance;
        const rarityColor = card.rarityType === 'ancestral' ? '#ff007f'
            : card.rarityType === 'legendary' ? '#00ffff'
            : card.rarityType === 'epic'      ? '#ffaa00'
            : '#aaaaaa';

        // Injeta modal de tokenização como overlay temporário
        const overlay = document.createElement('div');
        overlay.id = 'tokenizeOverlay';
        overlay.style.cssText = `
            position:fixed; inset:0; z-index:10000;
            background:rgba(2,2,8,0.97);
            display:flex; align-items:center; justify-content:center;
            padding:20px;
        `;
        overlay.innerHTML = `
            <div style="max-width:480px; width:100%; background:#070712; border:1px solid #9933ff;
                        padding:28px; font-family:'Space Mono',monospace; position:relative;">
                <!-- Header -->
                <div style="color:#9933ff; font-size:0.65rem; letter-spacing:3px; margin-bottom:4px;">⬡ TOKENIZAÇÃO WEB3 // SIMULAÇÃO</div>
                <div style="color:#fff; font-family:'Archivo Black',sans-serif; font-size:1rem; margin-bottom:16px;">
                    Transformar em NFT
                </div>

                <!-- Info do card -->
                <div style="background:#0d0020; border:1px solid #9933ff33; padding:12px; margin-bottom:16px; font-size:0.52rem; line-height:2; color:#aaaacc;">
                    <div>CARD &nbsp;&nbsp;&nbsp;: <span style="color:${rarityColor};">${card.id}</span></div>
                    <div>RARIDADE: <span style="color:${rarityColor};">${card.rarityNameEN}</span></div>
                    ${prov ? `<div>HASH &nbsp;&nbsp;&nbsp;: <span style="color:#fff;">${prov.hash}</span></div>
                    <div>EMITIDO : <span style="color:#fff;">${new Date(prov.timestamp).toLocaleString('pt-BR')}</span></div>` : ''}
                </div>

                <!-- Explicação do fluxo -->
                <div style="font-size:0.53rem; color:#888899; line-height:1.8; margin-bottom:18px;">
                    <p style="margin:0 0 8px;">Para transformar este card num <b style="color:#9933ff;">NFT ERC-721</b> na blockchain, você precisará:</p>
                    <div style="padding-left:8px; border-left:2px solid #9933ff44;">
                        <div>① Conectar sua carteira (ex: <b style="color:#fff;">MetaMask</b>)</div>
                        <div>② Aprovar o contrato do dr0p_station</div>
                        <div>③ Pagar o <b style="color:#ffaa00;">gas fee</b> em ETH (custo variável da rede)</div>
                        <div>④ Aguardar a confirmação on-chain (~30s)</div>
                    </div>
                    <p style="margin:10px 0 0; color:#555566; font-size:0.48rem;">O controle e o custo são <b style="color:#fff;">inteiramente seus</b>. O dr0p_station nunca cobra taxas de mint — apenas o gás da rede Ethereum.</p>
                </div>

                <!-- Aviso de simulação -->
                <div style="background:#1a0033; border:1px dashed #9933ff55; padding:8px 12px; margin-bottom:18px; font-size:0.48rem; color:#9933ff88; text-align:center;">
                    ⚠ MODO SIMULAÇÃO — Nenhuma transação real será executada.
                    <br>A integração com MetaMask será ativada em breve.
                </div>

                <!-- Botões -->
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                    <button class="btn-action" style="border-color:#9933ff; color:#9933ff; flex:1;"
                        onclick="simulateMintAttempt('${cardId}')">
                        🦊 SIMULAR MINT COM METAMASK
                    </button>
                    <button class="btn-action" style="border-color:#333344; color:#555566;"
                        onclick="document.getElementById('tokenizeOverlay').remove()">
                        CANCELAR
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    /** Simula o fluxo de mint — não faz nenhuma transação real. */
    function simulateMintAttempt(cardId) {
        const overlay = document.getElementById('tokenizeOverlay');
        if (overlay) overlay.remove();

        // Abre o modal de inspect novamente com confirmação simulada
        showCyberAlert(
            '⬡ METAMASK // SIMULAÇÃO',
            `<div style="font-family:'Space Mono',monospace; font-size:0.55rem; line-height:2; text-align:left;">
                <div style="color:#9933ff; margin-bottom:8px;">> CONECTANDO CARTEIRA...</div>
                <div>> CARTEIRA: 0x71C7...4F3a <span style="color:#00ff66;">✓ CONECTADA</span></div>
                <div>> REDE: Ethereum Mainnet</div>
                <div>> GAS ESTIMADO: ~0.0018 ETH (~$4.20)</div>
                <div style="color:#ffaa00; margin-top:8px;">> AGUARDANDO ASSINATURA...</div>
                <div style="color:#555566; font-size:0.45rem; margin-top:10px;">
                    [ Integração real será ativada na próxima fase do projeto. ]<br>
                    Teu card <b>${cardId}</b> já tem hash e timestamp registrados e estará pronto para mint quando o contrato for implantado.
                </div>
            </div>`,
            'success'
        );
    }

    function triggerLogoGlitch() {
        const logo = document.getElementById('appLogo');
        if (!logo) return;
        logo.classList.add('logo-shortcircuit');
        playElectricZap();
        setTimeout(() => logo.classList.remove('logo-shortcircuit'), 450);
    }

    function startLogoGlitchLoop() {
        setInterval(() => {
            // dispara aleatoriamente, em média a cada ~20-40s
            if (Math.random() < 0.35) triggerLogoGlitch();
        }, 12000);
    }
    startLogoGlitchLoop();

    // =========================================================
    // [ESCOPO 6] FILTROS AVANÇADOS DO DROP HUB — Free Roll / Premium Drop
    // Permite o jogador restringir o pool de raridade, estilo visual e/ou
    // modo (free/premium) antes de girar. Em vez de re-rolar até bater
    // (caro e impreciso), os filtros restringem diretamente os arrays de
    // candidatos usados por executeHardwareRoll — ver _applyDropFilters().
    // =========================================================
    // =========================================================
    // [ESCOPO 6] BANCO DE DADOS DE FILTROS — 15+ VARIAÇÕES POR RARIDADE
    // Cada raridade tem um pool de variações estéticas (sub-raças) que são
    // embaralhadas aleatoriamente no momento da dropagem.
    // =========================================================
    const DROP_FILTER_DB = {
        common: [
            { name: 'CHROME DECAY',       filter: 'contrast(180%) saturate(30%) invert(10%)' },
            { name: 'BINARY DEEP',        filter: 'saturate(400%) contrast(150%)' },
            { name: 'RETRO GLITCH',       filter: 'invert(100%) hue-rotate(180deg)' },
            { name: 'STATIC NOISE',       filter: 'contrast(200%) brightness(80%) saturate(0%)' },
            { name: 'STEEL PULSE',        filter: 'sepia(60%) contrast(140%) brightness(110%)' },
            { name: 'GHOST SIGNAL',       filter: 'opacity(80%) saturate(20%) brightness(140%)' },
            { name: 'ACID WASH',          filter: 'hue-rotate(45deg) saturate(250%) contrast(120%)' },
            { name: 'DARK MATTER',        filter: 'brightness(60%) contrast(180%) saturate(50%)' },
            { name: 'FLUX STATIC',        filter: 'contrast(160%) saturate(60%) hue-rotate(200deg)' },
            { name: 'VOID REMNANT',       filter: 'invert(30%) sepia(40%) contrast(130%)' },
            { name: 'DATA SMEAR',         filter: 'blur(0.3px) contrast(170%) saturate(80%)' },
            { name: 'PHANTOM_WIRE',       filter: 'hue-rotate(270deg) contrast(150%) brightness(90%)' },
            { name: 'JUNK_PULSE',         filter: 'sepia(100%) brightness(120%) saturate(200%)' },
            { name: 'PALE_SIGNAL',        filter: 'saturate(10%) brightness(130%) contrast(120%)' },
            { name: 'CARBON_DRIFT',       filter: 'grayscale(80%) contrast(160%) brightness(95%)' }
        ],
        epic: [
            { name: 'GOTHIC APOCALYPSE',  filter: 'grayscale(100%) brightness(120%) contrast(200%)' },
            { name: 'VIRTUAL OVERDRIVE',  filter: 'sepia(80%) hue-rotate(320deg) saturate(300%)' },
            { name: 'NEON PULSE',         filter: 'hue-rotate(60deg) saturate(180%) invert(5%)' },
            { name: 'PLASMA BURN',        filter: 'hue-rotate(15deg) saturate(350%) contrast(160%)' },
            { name: 'ULTRAVIOLET',        filter: 'hue-rotate(240deg) saturate(400%) brightness(85%)' },
            { name: 'GLITCH_LAYER',       filter: 'saturate(500%) hue-rotate(120deg) contrast(180%)' },
            { name: 'TOXIC_GLITCH',       filter: 'hue-rotate(90deg) saturate(600%) contrast(200%) brightness(80%)' },
            { name: 'SOLAR_FLARE',        filter: 'hue-rotate(30deg) saturate(450%) brightness(110%) contrast(150%)' },
            { name: 'SHOCK_WAVE',         filter: 'contrast(220%) saturate(280%) hue-rotate(165deg)' },
            { name: 'PROTOCOL_9',         filter: 'invert(20%) saturate(350%) hue-rotate(75deg) contrast(190%)' },
            { name: 'CIRCUIT_BURN',       filter: 'sepia(60%) hue-rotate(280deg) saturate(400%) contrast(170%)' },
            { name: 'DARK_SURGE',         filter: 'brightness(70%) saturate(500%) hue-rotate(200deg)' },
            { name: 'EMERALD_STATIC',     filter: 'hue-rotate(100deg) saturate(300%) contrast(140%) brightness(95%)' },
            { name: 'CRIMSON_BYTE',       filter: 'hue-rotate(345deg) saturate(450%) contrast(175%)' },
            { name: 'HYPERION_DRIFT',     filter: 'saturate(600%) contrast(160%) hue-rotate(50deg) brightness(90%)' }
        ],
        legendary: [
            { name: 'ROSE PHANTOM',       filter: 'hue-rotate(60deg) saturate(180%) invert(5%)' },
            { name: 'CYBER_VOID',         filter: 'hue-rotate(185deg) saturate(500%) contrast(200%) brightness(75%)' },
            { name: 'OBSIDIAN_CORE',      filter: 'brightness(50%) contrast(250%) saturate(200%) hue-rotate(220deg)' },
            { name: 'AQUA_GENESIS',       filter: 'hue-rotate(175deg) saturate(400%) contrast(160%) brightness(90%)' },
            { name: 'SILVER_PROTOCOL',    filter: 'saturate(0%) brightness(140%) contrast(200%) invert(10%)' },
            { name: 'GOLDEN_BREACH',      filter: 'sepia(100%) hue-rotate(20deg) saturate(350%) contrast(160%)' },
            { name: 'ELECTRIC_DEITY',     filter: 'hue-rotate(195deg) saturate(600%) brightness(85%) contrast(190%)' },
            { name: 'TEMPEST_CORE',       filter: 'hue-rotate(210deg) saturate(450%) brightness(70%) contrast(220%)' },
            { name: 'STARFALL_DRIFT',     filter: 'brightness(80%) saturate(300%) hue-rotate(240deg) contrast(180%)' },
            { name: 'VOID_CIRCUIT',       filter: 'invert(15%) hue-rotate(190deg) saturate(550%) contrast(210%)' },
            { name: 'NEON_FROST',         filter: 'hue-rotate(168deg) saturate(500%) brightness(95%) contrast(170%)' },
            { name: 'AURORA_SIGNAL',      filter: 'hue-rotate(150deg) saturate(400%) brightness(85%) contrast(160%)' },
            { name: 'PHANTOM_CIRCUIT',    filter: 'invert(10%) hue-rotate(200deg) saturate(480%) contrast(195%)' },
            { name: 'DEEP_NETWORK',       filter: 'brightness(65%) saturate(550%) hue-rotate(205deg) contrast(230%)' },
            { name: 'CHROME_DEITY',       filter: 'saturate(20%) contrast(280%) brightness(85%) hue-rotate(190deg)' }
        ],
        ancestral: [
            { name: 'ROSA PHANTASMA',     filter: 'hue-rotate(300deg) saturate(400%) contrast(130%) brightness(90%)' },
            { name: 'ROSE_PHANTASMA_MkII',filter: 'hue-rotate(320deg) saturate(600%) contrast(180%) brightness(80%)' },
            { name: 'BLOOD_PROTOCOL',     filter: 'hue-rotate(350deg) saturate(700%) contrast(200%) brightness(70%)' },
            { name: 'VOID_MONARCH',       filter: 'invert(30%) hue-rotate(280deg) saturate(800%) contrast(220%) brightness(65%)' },
            { name: 'DARK_ANCESTRAL',     filter: 'brightness(45%) saturate(900%) hue-rotate(310deg) contrast(250%)' },
            { name: 'CRIMSON_GOD',        filter: 'hue-rotate(340deg) saturate(750%) brightness(75%) contrast(210%)' },
            { name: 'SILICON_DEITY',      filter: 'sepia(100%) hue-rotate(330deg) saturate(600%) contrast(190%)' },
            { name: 'OMEGA_FLUX',         filter: 'invert(20%) saturate(800%) hue-rotate(305deg) contrast(230%) brightness(70%)' },
            { name: 'PHANTOM_SOUL',       filter: 'hue-rotate(295deg) saturate(700%) brightness(60%) contrast(240%)' },
            { name: 'TOXIC_GLITCH_MkII',  filter: 'hue-rotate(285deg) saturate(900%) contrast(260%) brightness(55%)' },
            { name: 'VOID_GENESIS',       filter: 'brightness(50%) saturate(1000%) hue-rotate(315deg) contrast(270%)' },
            { name: 'INFERNO_CORE',       filter: 'hue-rotate(355deg) saturate(800%) contrast(220%) brightness(65%)' },
            { name: 'ABYSS_PROTOCOL',     filter: 'invert(25%) hue-rotate(300deg) saturate(750%) brightness(60%)' },
            { name: 'SPECTRAL_MONARCH',   filter: 'hue-rotate(275deg) saturate(850%) contrast(240%) brightness(70%)' },
            { name: 'NEURAL_PHANTOM',     filter: 'invert(15%) saturate(950%) hue-rotate(290deg) contrast(260%) brightness(62%)' }
        ]
    };

    // Helpers para selecionar variações aleatórias do banco de filtros
