// =========================================================
// dr0p_station — MÓDULO: gifts-trade.js
// PRESENTES (gifts) + CHAT/PROPOSTAS DE TROCA (trade)
//
// Parte 8 de 14 do script.js original (split automático,
// ORDEM DE CARREGAMENTO PRESERVADA — não mudar a ordem dos <script> no HTML).
// =========================================================

    function _setGiftFabState(gifts) {
        const fab = document.getElementById('giftFab');
        const badge = document.getElementById('giftFabBadge');
        const glitch = document.getElementById('giftScreenGlitch');
        if (!fab || !badge || !glitch) return;
        if (gifts.length > 0) {
            fab.classList.add('has-gifts');
            glitch.classList.add('active');
            badge.innerText = gifts.length > 99 ? '99+' : String(gifts.length);
        } else {
            fab.classList.remove('has-gifts');
            glitch.classList.remove('active');
            badge.innerText = '0';
        }
    }

    function openReceivedGiftsModal() {
        const modal = document.getElementById('receivedGiftsModal');
        const grid = document.getElementById('receivedGiftsGrid');
        if (!modal || !grid) return;
        if (pendingGiftsCache.length === 0) {
            grid.innerHTML = '<div class="empty-vault-notice">Nenhum presente pendente.</div>';
        } else {
            grid.innerHTML = pendingGiftsCache.map(g => {
                const snap = g.card_snapshot || {};
                const rarityColor = snap.rarity_type === 'legendary' ? '#00ffff' : snap.rarity_type === 'epic' ? '#ffaa00' : '#aaa';
                return `
                <div class="received-gift-item" style="display:flex; align-items:center; gap:10px; padding:10px; border:1px solid #2a1530; border-radius:6px; margin-bottom:8px; background:#0c0810;">
                    ${snap.img_src ? `<img src="${snap.img_src}" style="width:48px;height:48px;object-fit:cover;border-radius:4px;border:1px solid ${rarityColor};">` : ''}
                    <div style="flex:1;">
                        <div style="font-size:0.62rem; color:${rarityColor};">${snap.display_id || g.card_display_id}</div>
                        <div style="font-size:0.54rem; color:#888899;">de <b style="color:#ff00ff;">${g.remetente_username}</b></div>
                    </div>
                    <button class="btn-action" style="border-color:#00ff66; font-size:0.5rem; padding:6px 10px;" onclick="claimReceivedGift('${g.id}')">ABRIR</button>
                </div>`;
            }).join('');
        }
        modal.classList.add('active');
    }

    function closeReceivedGiftsModal() {
        const modal = document.getElementById('receivedGiftsModal');
        if (modal) modal.classList.remove('active');
    }


    // =========================================================
    // [FIX CAIXA DE PRESENTE] triggerFireworks — animação de fogos de artifício
    // Injetada via JS puro (divs de partículas) ao fazer Claim de presente.
    // Dispara partículas coloridas que sobem e explodem na tela, sem bibliotecas.
    // =========================================================
    function triggerFireworks() {
        const COLORS = ['#ff007f', '#00ffff', '#ffaa00', '#00ff66', '#ff6600', '#ff00ff', '#ffffff'];
        const PARTICLE_COUNT = 60;
        const BURST_COUNT = 4;

        for (let b = 0; b < BURST_COUNT; b++) {
            setTimeout(() => {
                const bx = 15 + Math.random() * 70; // % da viewport
                const by = 15 + Math.random() * 50;
                for (let i = 0; i < PARTICLE_COUNT; i++) {
                    const particle = document.createElement('div');
                    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
                    const angle = (Math.random() * 360) * (Math.PI / 180);
                    const speed = 40 + Math.random() * 120; // px
                    const size  = 3 + Math.random() * 5;
                    const dur   = 600 + Math.random() * 800; // ms

                    particle.style.cssText = [
                        'position:fixed',
                        'z-index:99999',
                        'pointer-events:none',
                        'border-radius:50%',
                        'background:' + color,
                        'width:' + size + 'px',
                        'height:' + size + 'px',
                        'left:' + bx + 'vw',
                        'top:' + by + 'vh',
                        'box-shadow:0 0 ' + (size * 2) + 'px ' + color,
                        'transition:transform ' + dur + 'ms ease-out, opacity ' + dur + 'ms ease-out'
                    ].join(';');
                    document.body.appendChild(particle);

                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            const tx = Math.cos(angle) * speed;
                            const ty = Math.sin(angle) * speed + (Math.random() * 60); // gravidade simulada
                            particle.style.transform = 'translate(' + tx + 'px, ' + ty + 'px) scale(0.1)';
                            particle.style.opacity = '0';
                            setTimeout(() => { if (particle.parentNode) particle.parentNode.removeChild(particle); }, dur + 50);
                        });
                    });
                }
            }, b * 280);
        }

        // Flash de tela breve para dramatizar
        triggerAncestralFlash('#ff007f');
        setTimeout(() => triggerAncestralFlash('#00ffff'), 350);
    }

    async function claimReceivedGift(presenteId) {
        const { error } = await sb.rpc('resgatar_presente', {
            p_destinatario_id: currentUser.id,
            p_presente_id: presenteId
        });
        if (error) {
            console.error('resgatar_presente:', error.message);
            showCyberAlert('ERRO', 'Falha ao resgatar o presente. Tente novamente.', 'error');
            return;
        }
        playSynthSound('success');
        triggerFireworks(); // [FIX CAIXA DE PRESENTE] dispara fogos de artifício
        speakPhrase("Presente Recebido. Novo Lootbox detectado.", "New Lootbox Detected. Gift received.");
        showCyberAlert('✓ LOOTBOX ABERTA', 'Card adicionado ao seu cofre.', 'success');

        // Recarrega cofre e a lista de presentes pendentes
        savedAssets = await loadCardsFromSupabase(currentUser.id);
        await refreshPendingGifts();
        if (pendingGiftsCache.length === 0) closeReceivedGiftsModal();
        else openReceivedGiftsModal();
        renderVaultGrid();
    }

    // Realtime: assim que uma linha pendente é inserida em `presentes`
    // para este usuário, atualiza o FAB sem precisar de refresh manual.
    function initGiftRealtime() {
        if (!currentUser.loggedIn || !currentUser.id) return;
        sb.channel('presentes-' + currentUser.id)
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'presentes',
                filter: `destinatario_id=eq.${currentUser.id}`
            }, () => { refreshPendingGifts(); })
            .subscribe();
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

    async function renderMarketGrid() {
        const grid = document.getElementById('marketGrid'); if(!grid) return;
        grid.innerHTML = '<div class="empty-vault-notice">CARREGANDO MERCADO...</div>';

        // Fonte de verdade real: tabela `cards` (for_sale + is_listed = true).
        marketAssets = await loadMarketFromSupabase();

        document.getElementById('market-count-badge').innerText = `${marketAssets.length} CARDS`;

        const filtered = marketFilter === 'all' ? marketAssets : marketAssets.filter(a => a.rarityType === marketFilter);
        const pageItems = filtered.slice(marketPage * PAGE_SIZE, (marketPage + 1) * PAGE_SIZE);

        grid.innerHTML = '';
        if(filtered.length === 0) { grid.innerHTML = '<div class="empty-vault-notice">NENHUM ATIVO NESTA CATEGORIA.</div>'; renderPagination('marketPagination',0,0,()=>{}); return; }

        pageItems.forEach((a) => {
            const card = document.createElement('div');
            card.className = `album-card rare-${a.rarityType}`;
            card.innerHTML = `
                <div class="album-preview-wrapper"><img src="${a.imgSrc}" loading="lazy"></div>
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
                buyBtn.addEventListener('click', () => buyMarketAsset(a));

                const tradeBtn = document.createElement('button');
                tradeBtn.className = 'btn-action'; tradeBtn.style.borderColor = '#ff00ff';
                tradeBtn.innerText = "FAZER PROPOSTA";
                tradeBtn.addEventListener('click', () => initiateTradeContact(a.creator, a.id));

                actionsZone.appendChild(buyBtn);
                actionsZone.appendChild(tradeBtn);
            } else {
                const removeBtn = document.createElement('button');
                removeBtn.className = 'btn-action'; removeBtn.style.borderColor = '#ff0044';
                removeBtn.innerText = "REMOVER ANÚNCIO";
                removeBtn.addEventListener('click', () => removeAssetFromMarket(a));
                actionsZone.appendChild(removeBtn);
            }
            grid.appendChild(card);
        });

        renderPagination('marketPagination', filtered.length, marketPage, (p) => { marketPage = p; renderMarketGrid(); });
    }

    // `asset` aqui é um objeto vindo de marketAssets (já tem _dbId, pois veio
    // de rowToCard via loadMarketFromSupabase).
    async function buyMarketAsset(asset) {
        if (!asset) return;
        if (!currentUser.loggedIn) { navigateTo('auth'); return; }

        if (currentUser.bumps < asset.price) {
            playTerminalSound('error');
            showCyberAlert('FUNDOS INSUFICIENTES', `Saldo actual: <b>${currentUser.bumps} B$</b><br>Custo do ativo: <b>${asset.price} B$</b><br><br>Carregue o saldo no teu perfil.`, 'warn');
            return;
        }

        const sellerName = asset.creator;

        // buyCardFromMarket faz a transação inteira de forma atômica no banco
        // (débito do comprador, crédito do vendedor, transferência da linha
        // do card) via a function security definer buy_market_card — não dá
        // pra fazer isso com updates diretos porque a RLS de `cards` só
        // libera update para o dono da linha.
        const result = await buyCardFromMarket(asset._dbId);
        if (!result.ok) return; // buyCardFromMarket já mostra o alerta de erro

        // Reflete o card recém-adquirido no cofre local (currentUser já é o dono na linha do banco)
        savedAssets.push(result.card);

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

        renderMarketGrid();
    }

    // `asset` aqui é um objeto vindo de marketAssets (já tem _dbId).
    async function removeAssetFromMarket(asset) {
        if (!asset) return;
        const ok = await unlistCardFromMarket(asset);
        if (!ok) {
            showCyberAlert('ERRO_DE_REDE', 'Falha ao remover o anúncio. Tenta novamente.', 'error');
            return;
        }
        // Espelha a mudança no objeto correspondente em savedAssets (cofre local),
        // caso seja o mesmo card que o usuário tem carregado em memória.
        const vaultItem = savedAssets.find(m => m.id === asset.id);
        if (vaultItem) { vaultItem.forSale = false; vaultItem.exposed = false; vaultItem.isListed = false; }
        renderMarketGrid();
    }

    async function openInspectModal(cardAsset) {
        if(!cardAsset) return;
        const ownerName = cardAsset.creator || cardAsset.owner;

        // [RESTRUTURAÇÃO INSPECT] O nó de mídia recebe SOMENTE o caminho do
        // arquivo (src) + a classe/atributo de movimento quando aplicável.
        // Nenhuma bounding box dinâmica é aplicada aqui — dimensões/proporção
        // ficam inteiramente a cargo do CSS estático do elemento, nunca de
        // estilos inline calculados em JS, para não achatar a proporção do ativo.
        const inspectImgEl = document.getElementById('inspectImg');
        inspectImgEl.src = cardAsset.imgSrc;
        applyCardMotionAttrs(inspectImgEl, cardAsset);
        document.getElementById('inspectTitle').innerText = `INSPECT // ${cardAsset.id}`;

        // [ESCOPO 4] CARIMBO DE EXCLUSÃO — exibe chamas pixel art + selo
        // PURGED/DETONADA quando o card foi sacrificado/consumido em
        // fusão, fornalha ou descarte. Os dois textos (EN+PT) aparecem
        // juntos sempre — não depende do idioma ativo.
        const purgedStamp = document.getElementById('purgedStamp');
        const purgedFireLayer = document.getElementById('purgedFireLayer');
        if (purgedStamp && purgedFireLayer) {
            if (cardAsset.isPurged) {
                purgedStamp.style.display = 'flex';
                purgedFireLayer.classList.add('active');
            } else {
                purgedStamp.style.display = 'none';
                purgedFireLayer.classList.remove('active');
            }
        }

        // CRT glow baseado na raridade
        const rarityColors = {
            legendary: '#00ffff',
            epic:      '#ffaa00',
            ancestral: '#ff007f',
            common:    '#aaaaaa'
        };
        const rarityColor = rarityColors[cardAsset.rarityType] || '#aaaaaa';

        const glow = document.getElementById('holoGlow');
        glow.style.display = 'block';
        glow.style.background = `radial-gradient(circle, ${rarityColor}55 0%, transparent 70%)`;

        // Aplica borda/glow CRT ao modal conforme raridade
        const modalCard = document.querySelector('.modal-card');
        if (modalCard) {
            modalCard.style.borderColor = rarityColor;
            modalCard.style.boxShadow = `0 0 30px ${rarityColor}55, inset 0 0 20px ${rarityColor}11, 0 0 2px ${rarityColor}`;
        }

        // Linhas decorativas CRT injetadas acima dos metadados
        const crtLines = [
            `> SYS // INTEGRIDADE: OPERACIONAL`,
            `> NET // AUTENTICIDADE: VERIFICADA`,
            `> ID  // CHAIN: CRIPTOGRAFADO`,
            `> RNG // SEED: ${cardAsset.id}`,
        ];

        // BUGFIX (veracidade do nível): antes este número vinha de uma fórmula
        // paralela (globalFeed.filter(creator).length * 5), que ficava estática/errada
        // e não batia com o nível mostrado na Vitrine do perfil. Agora busca a coleção
        // REAL do dono do card e usa a MESMA fórmula (scoreFromAssets) da Vitrine.
        let ownerScore;
        if (ownerName === currentUser.username) {
            ownerScore = scoreFromAssets(savedAssets);
        } else {
            const ownerProfile = await fetchProfileByUsername(ownerName);
            const ownerAssets = ownerProfile ? await loadCardsFromSupabase(ownerProfile.id) : [];
            ownerScore = scoreFromAssets(ownerAssets);
        }

        const metaBox = document.getElementById('inspectMetaBox');
        metaBox.innerHTML = `
            <div class="inspect-crt-lines" style="
                font-size:0.5rem; color:${rarityColor}88; margin-bottom:12px;
                border:1px solid ${rarityColor}33; padding:6px 10px;
                background: rgba(0,0,0,0.6);
                font-family:'Space Mono',monospace; letter-spacing:1px;
                line-height:1.8;
            ">${crtLines.map(l => `<div>${l}</div>`).join('')}</div>
            <div class="inspect-meta-grid">
                <div class="inspect-meta-block">
                    <span class="inspect-meta-label">CÓDIGO ID</span>
                    <span class="inspect-meta-value">${cardAsset.id}</span>
                </div>
                <div class="inspect-meta-block">
                    <span class="inspect-meta-label">ESTILO VISUAL</span>
                    <span class="inspect-meta-value">${currentLang === 'PT' ? cardAsset.styleName : (cardAsset.styleNameEN || cardAsset.styleName)}</span>
                </div>
                <div class="inspect-meta-block">
                    <span class="inspect-meta-label">RARIDADE</span>
                    <span class="inspect-meta-value" style="color:${rarityColor}">${(currentLang === 'PT' ? cardAsset.rarityName : cardAsset.rarityNameEN).toUpperCase()}</span>
                </div>
                <div class="inspect-meta-block">
                    <span class="inspect-meta-label">NÍVEL DO PROPRIETÁRIO</span>
                    <span class="inspect-meta-value">LVL ${ownerScore || 1}</span>
                </div>
                <div class="inspect-meta-block">
                    <span class="inspect-meta-label">DONO DA ASSINATURA</span>
                    <span class="inspect-meta-value inspect-author" style="color:#00ff66; text-decoration:underline; cursor:pointer;">${ownerName}</span>
                </div>
                <div class="inspect-meta-block">
                    <span class="inspect-meta-label">ESTADO NA REDE</span>
                    <span class="inspect-meta-value">${cardAsset.registered ? 'CRIPTOGRAFADO EM WALLET' : 'FLUXO VOLÁTIL'}</span>
                </div>
            </div>
        `;

        metaBox.querySelector('.inspect-author').addEventListener('click', () => viewExternalProfile(ownerName));

        const zone = document.getElementById('inspectActionZone'); zone.innerHTML = '';
        if (cardAsset.registered && ownerName !== currentUser.username && !cardAsset.isPurged) {
            const btn = document.createElement('button'); btn.className = 'btn-action'; btn.style.borderColor = '#ff00ff';
            btn.innerText = `📝 FAZER PROPOSTA PARA ${ownerName}`;
            btn.onclick = () => { closeInspectModal(); initiateTradeContact(ownerName, cardAsset.id); };
            zone.appendChild(btn);
        }

        // ── PROVENIÊNCIA: exibe hash, timestamp e botão Web3 ──────────
        const prov = cardAsset.provenance;
        const provHtml = prov
            ? `<div class="inspect-provenance-box" style="
                    margin-top:12px; padding:8px 10px; border:1px solid ${rarityColor}33;
                    background:rgba(0,0,0,0.5); font-family:'Space Mono',monospace;
                    font-size:0.48rem; letter-spacing:1px; line-height:1.9; color:#666688;
                    display:flex; gap:10px; align-items:flex-start;">
                    <div style="flex:1; min-width:0;">
                        <div style="color:${rarityColor}; margin-bottom:4px; font-size:0.5rem; font-weight:bold;">// PROVENIÊNCIA INTERNA</div>
                        <div>HASH &nbsp;&nbsp;: <span style="color:#fff;">${prov.hash}</span></div>
                        <div>EMITIDO: <span style="color:#fff;">${new Date(prov.timestamp).toLocaleString('pt-BR')}</span></div>
                        <div>ORIGEM &nbsp;: <span style="color:#fff;">${prov.origin}</span></div>
                        ${prov.parentIds ? `<div>LINHAGEM: <span style="color:#ffaa00;">${prov.parentIds.join(' + ')}</span></div>` : ''}
                        ${cardAsset.isTokenized
                            ? `<div style="color:#00ff66; margin-top:4px;">✓ TOKENIZADO EM NFT</div>`
                            : (ownerName === currentUser.username
                                ? `<button class="btn-action inspect-web3-btn" style="margin-top:8px; border-color:#9933ff; color:#9933ff; font-size:0.5rem; padding:5px 12px; width:auto;"
                                    onclick="showTokenizeModal(${JSON.stringify(cardAsset.id).replace(/"/g,'&quot;')})">
                                    ⬡ TOKENIZAR CARD (Web3)
                                   </button>`
                                : '')
                        }
                    </div>
                    <div id="inspectQrCanvas" style="flex-shrink:0;"></div>
               </div>`
            : `<div style="font-size:0.45rem; color:#333344; margin-top:10px; font-family:'Space Mono',monospace;">
                    // sem proveniência registrada (card legado)
               </div>`;

        // Appenda a caixa de proveniência ao metaBox
        const provDiv = document.createElement('div');
        provDiv.innerHTML = provHtml;
        metaBox.appendChild(provDiv);

        // ── QR CODE DINÂMICO: agora renderizado dentro do caixote de proveniência ──
        if (prov) renderQRCode(cardAsset, 'inspectQrCanvas');
        const qrBox = document.getElementById('inspectQrBox');
        if (qrBox) qrBox.style.display = 'none';

        document.getElementById('inspectModal').style.display = 'flex';
    }

    function closeInspectModal() {
        // Reseta borda do modal ao fechar
        const modalCard = document.querySelector('.modal-card');
        if (modalCard) {
            modalCard.style.borderColor = '';
            modalCard.style.boxShadow = '';
        }
        document.getElementById('inspectModal').style.display = 'none';
    }

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

    // =========================================================
    // [ESCOPO 5] LEDGER DE OFERTAS DE TROCA — tabela propostas_p2p
    // BUGFIX CRÍTICO: a versão antiga guardava as propostas em
    // localStorage (chave 'cyber_global_offers'), que é por NAVEGADOR,
    // não por conta. Isso é a causa raiz do "histórico de propostas
    // desaparecia": se o outro jogador estivesse num dispositivo
    // diferente (o caso normal, já que são contas reais no Supabase),
    // a oferta simplesmente nunca existia do lado dele — não é que o
    // dado "sumia", é que nunca esteve lá. Substituído pela tabela real
    // public.propostas_p2p (RLS: cada parte só vê as próprias propostas),
    // que persiste no servidor e é visível para AMBOS os jogadores
    // envolvidos, em qualquer dispositivo.
    // =========================================================

    // Cache local da contagem de pendentes para o badge — atualizado por
    // refreshIncomingProposals() (polling leve) e Realtime.
    let _incomingProposalsCache = [];

    async function createOffer({ owner, receiver, assetId, targetAssetDbId, bumpsOffered, offeredAssetDbId, offeredAssetDisplayId }) {
        if (!owner || !receiver || !currentUser.id) return null;

        const targetProfile = await fetchProfileByUsername(receiver.startsWith('@') ? receiver : '@' + receiver.replace(/^@/, ''));
        if (!targetProfile) {
            console.error('createOffer: destinatário não encontrado', receiver);
            return null;
        }

        // O card alvo da proposta é o card do DESTINATÁRIO que o remetente
        // quer adquirir — vem de thread.targetAsset (ver submitCounterProposal).
        const targetAssetDisplayId = assetId;

        if (!targetAssetDbId) {
            console.error('createOffer: card alvo sem _dbId, não é possível registrar a proposta.');
            return null;
        }

        const { data, error } = await sb.from('propostas_p2p').insert({
            remetente_id: currentUser.id,
            remetente_username: currentUser.username,
            destinatario_id: targetProfile.id,
            destinatario_username: targetProfile.username,
            card_id: targetAssetDbId,
            card_display_id: targetAssetDisplayId,
            bumps_ofertados: bumpsOffered || 0,
            card_ofertado_id: offeredAssetDbId || null,
            card_ofertado_display_id: offeredAssetDisplayId || null
        }).select().single();

        if (error) { console.error('createOffer:', error.message); return null; }
        return { id: data.id, ...data };
    }

    async function updateOfferStatus(offerId, status) {
        if (status === 'rejected') {
            const { error } = await sb.from('propostas_p2p')
                .update({ status: 'recusada', recusada_em: new Date().toISOString() })
                .eq('id', offerId)
                .eq('destinatario_id', currentUser.id)
                .eq('status', 'pendente');
            if (error) console.error('updateOfferStatus (recusar):', error.message);
        }
        // 'accepted' é tratado por acceptCurrentProposal via RPC aceitar_proposta_p2p
        // (precisa ser atômico com a transferência real de cards/bumps).
        await refreshIncomingProposals();
        renderGlobalOffers('offersContainer');
    }

    // Carrega propostas onde o usuário logado é remetente OU destinatário,
    // para renderizar o painel offersContainer (substitui loadGlobalOffers).
    async function loadGlobalOffers() {
        if (!currentUser.loggedIn || !currentUser.id) return [];
        const { data, error } = await sb.from('propostas_p2p')
            .select('id, remetente_username, destinatario_username, card_display_id, bumps_ofertados, card_ofertado_display_id, status, created_at')
            .or(`remetente_id.eq.${currentUser.id},destinatario_id.eq.${currentUser.id}`)
            .order('created_at', { ascending: false })
            .limit(50);
        if (error) { console.error('loadGlobalOffers:', error.message); return []; }
        // Mapeia para o shape que renderGlobalOffers já espera (owner/receiver/assetId/bumpsOffered)
        return (data || []).map(p => ({
            id: p.id,
            owner: p.remetente_username,
            receiver: p.destinatario_username,
            assetId: p.card_display_id,
            bumpsOffered: p.bumps_ofertados,
            status: p.status === 'pendente' ? 'pending' : p.status === 'concluida' ? 'accepted' : p.status === 'recusada' ? 'rejected' : p.status,
            createdAt: new Date(p.created_at).getTime()
        }));
    }

    // [ESCOPO 5] Badge de notificação — pendentes onde o usuário é destinatário
    async function refreshIncomingProposals() {
        if (!currentUser.loggedIn || !currentUser.id) { _setProposalBadgeState([]); return; }
        const { data, error } = await sb.from('propostas_p2p')
            .select('id, remetente_username, card_display_id, bumps_ofertados, created_at')
            .eq('destinatario_id', currentUser.id)
            .eq('status', 'pendente')
            .order('created_at', { ascending: false });
        if (error) { console.error('refreshIncomingProposals:', error.message); return; }
        _incomingProposalsCache = data || [];
        _setProposalBadgeState(_incomingProposalsCache);
    }

    function _setProposalBadgeState(pending) {
        const dot = document.getElementById('newOfferAlertDot');
        if (!dot) return;
        dot.classList.toggle('active', pending.length > 0);
        dot.style.display = pending.length > 0 ? 'block' : 'none';
    }

    // Realtime: nova linha em propostas_p2p destinada a este usuário acende
    // o ponto de alerta imediatamente, sem precisar abrir a tela de Propostas.
    function initProposalsRealtime() {
        if (!currentUser.loggedIn || !currentUser.id) return;
        sb.channel('propostas-' + currentUser.id)
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'propostas_p2p',
                filter: `destinatario_id=eq.${currentUser.id}`
            }, () => { refreshIncomingProposals(); })
            .subscribe();
    }

    async function renderGlobalOffers(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '<div style="font-size:0.6rem;color:#444;padding:8px 0;">Carregando propostas...</div>';
        if (!currentUser.loggedIn) { container.innerHTML = ''; return; }

        const offers = await loadGlobalOffers();
        container.innerHTML = '';
        const me = currentUser.username;

        if (offers.length === 0) {
            container.innerHTML = '<div style="font-size:0.6rem;color:#444;padding:8px 0;">Nenhuma proposta registrada ainda.</div>';
            return;
        }

        offers.forEach(offer => {
            const isReceiver = offer.receiver === me;
            const isOwner = offer.owner === me;
            if (!isReceiver && !isOwner) return;

            const card = document.createElement('div');
            card.className = 'offer-card';

            if (isReceiver && offer.status === 'pending') {
                card.innerHTML = `
                    <span>Proposta de <b>${offer.owner}</b> — ${offer.bumpsOffered} B$ pelo ativo ${offer.assetId}</span>
                    <span>
                        <button class="btn-action accept-offer">Aceitar</button>
                        <button class="btn-action decline-offer">Recusar</button>
                    </span>
                `;
                card.querySelector('.accept-offer').addEventListener('click', () => acceptOfferFromList(offer));
                card.querySelector('.decline-offer').addEventListener('click', () => updateOfferStatus(offer.id, 'rejected'));
            } else {
                const statusLabel = offer.status === 'pending' ? 'Pendente' : (offer.status === 'accepted' ? 'Aceita' : 'Recusada');
                const directionLabel = isOwner ? `Proposta enviada a <b>${offer.receiver}</b>` : `Proposta de <b>${offer.owner}</b>`;
                card.innerHTML = `<span>${directionLabel} — ${offer.bumpsOffered} B$ pelo ativo ${offer.assetId} — <b>${statusLabel}</b></span>`;
            }

            container.appendChild(card);
        });

        if (container.innerHTML === '') {
            container.innerHTML = '<div style="font-size:0.6rem;color:#444;padding:8px 0;">Nenhuma proposta registrada ainda.</div>';
        }
    }

    // Aceitar diretamente da lista de Propostas (fora de uma thread de chat
    // aberta) — usa a mesma RPC atômica aceitar_proposta_p2p.
    async function acceptOfferFromList(offer) {
        const { error } = await sb.rpc('aceitar_proposta_p2p', {
            p_destinatario_id: currentUser.id,
            p_proposta_id: offer.id
        });
        if (error) {
            console.error('aceitar_proposta_p2p:', error.message);
            showCyberAlert('ERRO', 'Não foi possível concluir a proposta. Ela pode já ter expirado ou os itens não estarem mais disponíveis.', 'error');
            return;
        }
        playSynthSound('success');
        showCyberAlert('✓ PROPOSTA ACEITA', 'Itens e Bumps transferidos com sucesso.', 'success');
        pushLedger(`${offer.owner} e ${offer.receiver} concluíram uma troca P2P: ${offer.bumpsOffered} B$ pelo ativo ${offer.assetId}`);

        // Recarrega estado local afetado
        savedAssets = await loadCardsFromSupabase(currentUser.id);
        const freshProfile = await fetchProfile(currentUser.id);
        if (freshProfile) currentUser.bumps = freshProfile.bumps;
        renderVaultGrid();
        await refreshIncomingProposals();
        renderGlobalOffers('offersContainer');
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
    async function submitCounterProposal() {
        if(!activeThreadUser || !messageThreads[activeThreadUser]) return;
        let thread = messageThreads[activeThreadUser];

        if(thread.activeProposal && thread.activeProposal.status === "ACCEPTED") {
            showCyberAlert('LOG_ERRO:', 'Este canal de negociação já foi finalizado com sucesso.', 'error'); return;
        }

        const bumpsOffered = parseInt(document.getElementById('counterBumpsInput').value) || 0;
        const selectedAssetId = document.getElementById('counterAssetSelect').value;

        if(bumpsOffered < 0) { showCyberAlert('LOG_ERRO:', 'Valor inválido de Bumps.', 'error'); return; }
        if(bumpsOffered > currentUser.bumps) { showCyberAlert('ACESSO_NEGADO:', 'Você não possui saldo de Bumps suficiente em conta para cobrir esta proposta.', 'error'); return; }

        if (!thread.targetAsset || !thread.targetAsset._dbId) {
            showCyberAlert('LOG_ERRO:', 'Ativo alvo sem registro válido no servidor. Reabra a negociação a partir do mercado.', 'error'); return;
        }

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

        // PROPOSTA GLOBAL — agora persistida em propostas_p2p (Supabase),
        // visível para ambas as partes em qualquer dispositivo.
        const offerRecord = await createOffer({
            owner: currentUser.username,
            receiver: activeThreadUser,
            assetId: thread.targetAsset.id,
            targetAssetDbId: thread.targetAsset._dbId,
            bumpsOffered,
            offeredAssetDbId: assetObject ? assetObject._dbId : null,
            offeredAssetDisplayId: assetObject ? assetObject.id : null
        });
        thread.activeProposal.globalOfferId = offerRecord ? offerRecord.id : null;

        if (!offerRecord) {
            showCyberAlert('ERRO_DE_REDE', 'Falha ao registrar a proposta no servidor. Tente novamente.', 'error');
            return;
        }

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

    async function acceptCurrentProposal() {
        if(!activeThreadUser || !messageThreads[activeThreadUser]) return;
        let thread = messageThreads[activeThreadUser];
        let prop = thread.activeProposal;

        if(!thread.targetAsset) return;
        if(!prop || !prop.globalOfferId) {
            showCyberAlert('LOG_ERRO:', 'Esta proposta não tem um registro de servidor válido para ser concluída.', 'error');
            return;
        }

        let sellerName = thread.targetAsset.creator;

        // Só quem é dono do card alvo (destinatário da proposta) pode aceitar —
        // a RPC aceitar_proposta_p2p valida isso novamente no servidor.
        if (currentUser.username !== sellerName) {
            showCyberAlert('ACESSO_NEGADO:', 'Apenas o dono do ativo alvo pode aceitar esta proposta.', 'error');
            return;
        }

        // ── RPC ATÔMICA: transfere card alvo + card ofertado (se houver) +
        // Bumps ofertados (se houver), tudo numa única transação no servidor,
        // e grava a transição em historico_propostas_p2p. Substitui a
        // simulação antiga que lia/escrevia em localStorage chaves
        // "user_<nome>" — o que nunca refletia a conta real do outro
        // jogador (ela está no Supabase, não no localStorage deste navegador).
        const { error } = await sb.rpc('aceitar_proposta_p2p', {
            p_destinatario_id: currentUser.id,
            p_proposta_id: prop.globalOfferId
        });

        if (error) {
            console.error('aceitar_proposta_p2p:', error.message);
            showCyberAlert('ERRO_DE_REDE:', 'Não foi possível concluir a troca. O item pode já não estar mais disponível.', 'error');
            return;
        }

        // Recarrega o cofre e o saldo reais a partir do Supabase — fonte de
        // verdade única, em vez de mutar savedAssets/bumps na mão.
        savedAssets = await loadCardsFromSupabase(currentUser.id);
        const freshProfile = await fetchProfile(currentUser.id);
        if (freshProfile) currentUser.bumps = freshProfile.bumps;
        renderVaultGrid();

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
        if (thread.activeProposal.globalOfferId) updateOfferStatus(thread.activeProposal.globalOfferId, 'rejected');
        thread.messages.push({ sender: currentUser.username, text: `✕ A proposta ativa na mesa de negociação foi rejeitada.` });
        playSynthSound('shatter');
        saveThreadToStorage(activeThreadUser);
        renderChatWindow();
    }

    // =========================================================
    // DOWNLOAD DO ASSET (Ponto 6) — SOMENTE IMAGEM ESTÁTICA HD
    // O botão "Obter Item 📥" baixa EXCLUSIVAMENTE a imagem
    // estática (.png/.jpg) em alta definição, mesmo que o card
    // possua variações animadas. Download em lote removido.
    // =========================================================
    // Botão "Obter Item 📥" do cofre — ÚNICO ponto de download HD do app.
    // Agora busca o ativo de alta resolução REAL no bucket privado
    // high-res-assets (Signed URL de 60s), em vez de re-baixar a prévia
    // já vista na tela (asset.imgSrc, que é só o canvas baked/watermarked).
    async function downloadVaultAsset(index) {
        const asset = savedAssets[index];
        if (!asset) return;
        await executeDoubleAssetDownload(asset);
    }

    // Gera um WebP animado simples (2 frames com glow pulsante) a partir
    // do dataURL estático. Usa canvas + captureStream de forma síncrona
    // via sequência de frames desenhados — sem dependências externas.
    async function _generateAnimatedWebP(srcDataUrl, rarityType) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const SIZE = 400;
                const c = document.createElement('canvas');
                c.width = SIZE; c.height = SIZE;
                const ctx = c.getContext('2d');
                const glowColor = rarityType === 'ancestral' ? 'rgba(255,0,127,' :
                                  rarityType === 'legendary' ? 'rgba(0,255,255,' :
                                  rarityType === 'epic'      ? 'rgba(255,170,0,' : 'rgba(180,180,180,';

                // Tenta usar MediaRecorder para capturar canvas animado
                if (!c.captureStream || !window.MediaRecorder) { resolve(null); return; }
                const stream = c.captureStream(8); // 8fps
                const chunks = [];
                let mr;
                try { mr = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' }); }
                catch(e) { resolve(null); return; }

                mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
                mr.onstop = () => {
                    const blob = new Blob(chunks, { type: 'video/webm' });
                    resolve(URL.createObjectURL(blob));
                };

                mr.start();
                let frame = 0;
                const TOTAL_FRAMES = 16;
                const interval = setInterval(() => {
                    const alpha = 0.2 + 0.35 * Math.abs(Math.sin(frame * Math.PI / TOTAL_FRAMES));
                    ctx.clearRect(0, 0, SIZE, SIZE);
                    ctx.drawImage(img, 0, 0, SIZE, SIZE);
                    ctx.save();
                    ctx.shadowBlur = 30; ctx.shadowColor = glowColor + '0.8)';
                    ctx.strokeStyle = glowColor + alpha + ')';
                    ctx.lineWidth = 4;
                    ctx.strokeRect(4, 4, SIZE - 8, SIZE - 8);
                    ctx.restore();
                    frame++;
                    if (frame >= TOTAL_FRAMES) { clearInterval(interval); mr.stop(); }
                }, 125);
            };
            img.onerror = () => resolve(null);
            img.src = srcDataUrl;
        });
    }

    // =========================================================
    // ALQUIMIA — FUSÃO DE 2 CARDS COM PROBABILIDADE (VAULT ONLY)
    // =========================================================

    // Estado de seleção da galeria de alquimia
    let _alchSelected = { alpha: null, beta: null }; // { id, asset }
    // Estado de seleção da Fornalha (até 3 cards)
    let _furnSelected = []; // array de cards
    // Estado de navegação interna da Central de Alquimia: 'menu' | 'fusao' | 'fornalha'
    let _alchMode = 'menu';

