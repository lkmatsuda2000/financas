/* Minhas finanças: app estático conectado ao Supabase.
   Todo o acesso aos dados é protegido pelo RLS do banco (só o seu e-mail lê e escreve). */
(function () {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  const app = document.getElementById('app');

  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('SEU-PROJETO')) {
    app.innerHTML = '<div class="login"><div class="login-card"><h1>Falta configurar</h1>' +
      '<p>Preencha o arquivo config.js com a URL e a chave anon do seu projeto Supabase.</p></div></div>';
    return;
  }

  // A biblioteca acrescenta /rest/v1 e /auth/v1 sozinha: aceita a URL mesmo que venha com esses sufixos.
  const urlBase = String(cfg.SUPABASE_URL).trim().replace(/\/+$/, '').replace(/\/(rest|auth)\/v1$/, '');
  const sb = window.supabase.createClient(urlBase, cfg.SUPABASE_ANON_KEY);

  const state = {
    user: null,
    contas: [],
    categorias: [],
    posicao: [],
    meses: [],
    filtros: { mes: null, conta: '', categoriaNome: '' },
    mostrarEncerrados: false,
    sideOculta: (() => { try { return localStorage.getItem('fin:sideOculta') === '1'; } catch (e) { return false; } })()
  };

  // ---------- Utilidades ----------
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const fmt = (v, moeda) => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: moeda || 'BRL', minimumFractionDigits: 2
  }).format(Number(v) || 0);

  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const mesNome = (iso) => MESES[Number(iso.slice(5, 7)) - 1] + '/' + iso.slice(2, 4);
  const mesLongo = (iso) => {
    const s = new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const diaLongo = (iso) => {
    const s = new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  // Datas sempre no fuso do aparelho (toISOString usaria UTC e, depois das 21h, marcaria o dia seguinte).
  const isoLocal = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const proximoMes = (iso) => {
    const d = new Date(iso + 'T12:00:00');
    d.setMonth(d.getMonth() + 1, 1);
    return isoLocal(d);
  };
  const hoje = () => isoLocal(new Date());

  const iniciais = (nome) => nome.replace(/[^\p{L}\p{N} ]/gu, '').split(' ')
    .filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
  const CORES = ['#3A6EA5', '#2F8F6B', '#8A5A9E', '#B8663D', '#4F7C8A', '#9E4F5C', '#6B7F3A', '#5A5FA8'];
  const corDe = (nome) => {
    let h = 5381;
    for (const ch of nome) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
    return CORES[h % CORES.length];
  };

  const conta = (id) => state.contas.find((c) => c.id === id);
  const categoria = (id) => state.categorias.find((c) => c.id === id);

  function toast(texto) {
    const el = document.getElementById('toast');
    el.textContent = texto;
    el.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2400);
  }

  async function q(promise) {
    const { data, error } = await promise;
    if (error) throw new Error(error.message);
    return data;
  }

  // ---------- Dados ----------
  async function carregarBase() {
    const [contas, categorias, posicao, fluxo] = await Promise.all([
      q(sb.from('contas').select('*').order('nome')),
      q(sb.from('categorias').select('*').order('nome')),
      q(sb.from('v_posicao_contas').select('*')),
      q(sb.from('v_fluxo_mensal').select('mes').order('mes', { ascending: false }))
    ]);
    state.contas = contas;
    state.categorias = categorias;
    state.posicao = posicao;
    state.meses = [...new Set(fluxo.map((f) => f.mes))];
    if (!state.filtros.mes) state.filtros.mes = state.meses[0] || hoje().slice(0, 8) + '01';
  }

  // ---------- Login ----------
  function renderLogin(msg) {
    app.innerHTML = `
      <div class="login"><div class="login-card">
        <h1>Minhas finanças</h1>
        <p>Entre com o seu e-mail. Você vai receber um link para acessar.</p>
        <form id="login-form">
          <label for="email">E-mail</label>
          <input id="email" type="email" required autocomplete="email">
          <button class="btn" type="submit">Enviar link de acesso</button>
        </form>
        <div class="msg" id="login-msg">${esc(msg || '')}</div>
      </div></div>`;
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value.trim();
      const out = document.getElementById('login-msg');
      out.textContent = 'Enviando...';
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: false }
      });
      out.textContent = error
        ? 'Não foi possível enviar o link: ' + error.message
        : 'Link enviado. Abra o e-mail neste mesmo aparelho e clique nele.';
    });
  }

  // ---------- Estrutura ----------
  const CANAIS = [
    { id: 'painel', nome: 'painel', topico: 'Patrimônio, saldos e o resultado dos últimos meses' },
    { id: 'transacoes', nome: 'transações', topico: 'Tudo o que entrou e saiu, dia a dia' },
    { id: 'cartoes', nome: 'cartões', topico: 'Fatura em aberto e compras de cada cartão' },
    { id: 'investimentos', nome: 'investimentos', topico: 'Quanto você aplicou, quanto rendeu e quanto vale hoje' },
    { id: 'projecao', nome: 'projeção', topico: 'O realizado até aqui e, daqui para frente, o que as suas premissas dizem' }
  ];

  function rotaAtual() {
    const id = (location.hash.replace('#/', '') || 'painel').split('?')[0];
    return CANAIS.find((c) => c.id === id) || CANAIS[0];
  }

  function renderShell() {
    const canal = rotaAtual();
    const contasLado = state.posicao
      .filter((p) => p.ativo && ['corrente', 'carteira_digital', 'cartao_credito', 'poupanca'].includes(p.tipo))
      .sort((a, b) => a.nome.localeCompare(b.nome));

    app.innerHTML = `
      <div class="shell ${state.sideOculta ? 'side-oculta' : ''}" id="shell">
        <aside class="sidebar" aria-label="Navegação">
          <div class="workspace">
            <div class="ws-name">Minhas finanças</div>
            <div class="ws-sub">${esc(state.user.email)}</div>
          </div>
          <div class="side-scroll">
            <div class="side-group">
              <div class="side-title">Canais</div>
              ${CANAIS.map((c) => `
                <a class="side-item" href="#/${c.id}" ${c.id === canal.id ? 'aria-current="page"' : ''}>
                  <span class="hash">#</span><span class="grow">${esc(c.nome)}</span>
                </a>`).join('')}
            </div>
            <div class="side-group">
              <div class="side-title">Contas</div>
              ${contasLado.map((p) => {
                const cls = p.tipo === 'cartao_credito' ? (p.valor_atual < 0 ? 'debt' : '') : (p.valor_atual > 0 ? 'on' : '');
                return `
                <button class="side-item" data-conta="${esc(p.conta_id)}" type="button">
                  <span class="dot ${cls}"></span><span class="grow">${esc(p.nome)}</span>
                  <span class="val num">${esc(fmt(p.valor_atual, p.moeda))}</span>
                </button>`;
              }).join('')}
            </div>
          </div>
          <div class="side-foot"><button type="button" id="sair">Sair</button></div>
        </aside>
        <main class="main">
          <header class="channel-header">
            <button class="menu-btn" type="button" id="menu" aria-label="Mostrar ou esconder a barra lateral" title="Mostrar ou esconder a barra lateral">☰</button>
            <div>
              <h1># ${esc(canal.nome)}</h1>
              <p class="topic">${esc(canal.topico)}</p>
            </div>
          </header>
          <section class="channel-body" id="body"><div class="empty">Carregando...</div></section>
          <footer class="composer">
            <button class="composer-box" type="button" id="novo">
              <span class="plus">+</span><span>Registrar um lançamento em #${esc(canal.nome)}</span>
            </button>
          </footer>
        </main>
      </div>`;

    document.getElementById('sair').onclick = () => sb.auth.signOut();
    document.getElementById('novo').onclick = () => abrirForm();
    document.getElementById('menu').onclick = () => {
      const shell = document.getElementById('shell');
      if (window.matchMedia('(max-width: 760px)').matches) { shell.classList.toggle('nav-open'); return; }
      state.sideOculta = !state.sideOculta;
      shell.classList.toggle('side-oculta', state.sideOculta);
      try { localStorage.setItem('fin:sideOculta', state.sideOculta ? '1' : '0'); } catch (e) { /* sem armazenamento */ }
      window.dispatchEvent(new Event('resize'));   // os gráficos se ajustam à nova largura
    };
    app.querySelectorAll('[data-conta]').forEach((b) => b.addEventListener('click', () => {
      state.filtros.conta = b.dataset.conta;
      state.filtros.categoriaNome = '';
      location.hash = '#/transacoes';
      if (rotaAtual().id === 'transacoes') renderRota();
    }));
    app.querySelectorAll('.side-item[href]').forEach((a) => a.addEventListener('click', () => {
      document.getElementById('shell').classList.remove('nav-open');
    }));
    renderCanal(canal.id);
  }

  async function renderCanal(id) {
    const body = document.getElementById('body');
    try {
      if (id === 'painel') await renderPainel(body);
      else if (id === 'transacoes') await renderTransacoes(body);
      else if (id === 'cartoes') await renderCartoes(body);
      else if (id === 'investimentos') await renderInvestimentos(body);
      else await renderProjecao(body);
    } catch (err) {
      body.innerHTML = `<div class="empty">Não foi possível carregar os dados: ${esc(err.message)}. Recarregue a página; se continuar, saia e entre de novo.</div>`;
    }
  }

  function renderRota() { renderShell(); }

  // ---------- Gráficos do painel (barras empilhadas por categoria) ----------
  // Gastos: visão "compras" (data da compra, inclusive no cartão) ou "caixa" (o que saiu das contas;
  // o cartão entra como "Faturas de cartão" no mês em que a fatura foi paga).
  // Entradas: receitas por categoria, com opção de incluir as extraordinárias (Doação, Herança).
  // Só considera lançamentos em reais e ignora categorias internas (transferências, repasses, saldo inicial).
  const FATURAS = 'Faturas de cartão';
  const DEMAIS = 'Categorias menores';   // soma das categorias que não cabem entre as 7 maiores do período
  const CORES_GRAF = ['#2F6FED', '#1C9A6C', '#E0A63B', '#8A5AC2', '#D8594C', '#2BA3B8', '#C2569B', '#7A8F2E',
    '#1E3A8A', '#B45309', '#0F766E', '#9F1239'];
  const COR_FATURAS = '#4A5866';
  const COR_DEMAIS = '#A7B0B9';
  const EXTRAORDINARIAS = ['Doação', 'Herança'];
  const MAX_SERIES = 7;

  const addMeses = (iso, n) => {
    const d = new Date(iso.slice(0, 7) + '-01T12:00:00');
    d.setMonth(d.getMonth() + n, 1);
    return isoLocal(d);
  };
  // Valores do gráfico em milhares de reais, sem unidade (a unidade vai no título do eixo).
  const emMil = (v) => (v / 1000).toLocaleString('pt-BR', { minimumFractionDigits: v >= 100000 ? 0 : 1, maximumFractionDigits: v >= 100000 ? 0 : 1 });
  // Cada categoria mantém a mesma cor em todos os gráficos e visões durante a sessão.
  const coresFixas = new Map();
  function corDaCategoria(nome) {
    if (nome === FATURAS) return COR_FATURAS;
    if (nome === DEMAIS) return COR_DEMAIS;
    if (!coresFixas.has(nome)) coresFixas.set(nome, CORES_GRAF[coresFixas.size % CORES_GRAF.length]);
    return coresFixas.get(nome);
  }

  const cacheTransacoes = new Map();
  async function transacoesDoPeriodo(de, ate) {
    const chave = de + '|' + ate;
    if (cacheTransacoes.has(chave)) return cacheTransacoes.get(chave);
    const tudo = [];
    const LOTE = 1000;   // o Supabase devolve no máximo 1.000 linhas por consulta
    for (let i = 0; ; i += LOTE) {
      const lote = await q(sb.from('transacoes')
        .select('conta_id, categoria_id, data_competencia, valor, tipo')
        .eq('moeda', 'BRL')
        .gte('data_competencia', de).lt('data_competencia', proximoMes(ate))
        .order('data_competencia', { ascending: true }).order('id', { ascending: true })
        .range(i, i + LOTE - 1));
      tudo.push(...lote);
      if (lote.length < LOTE) break;
    }
    cacheTransacoes.set(chave, tudo);
    return tudo;
  }

  // Categoria de nível mais alto (agrupa subcategorias no pai).
  function grupoDe(k) {
    let p = k;
    for (let i = 0; i < 5 && p && p.pai_id; i++) p = categoria(p.pai_id) || null;
    return (p || k).nome;
  }
  const ehExtra = (k) => k.extraordinaria === true || EXTRAORDINARIAS.includes(grupoDe(k)) || EXTRAORDINARIAS.includes(k.nome);

  function classificar(t, chave, g) {
    const c = conta(t.conta_id);
    const k = categoria(t.categoria_id);
    if (!c || !k) return null;
    const cartao = c.tipo === 'cartao_credito';
    if (chave === 'gastos') {
      if (g.visao === 'caixa' && cartao) {
        return t.tipo === 'entrada' && k.nome === CAT_TRANSF ? FATURAS : null;
      }
      return t.tipo === 'saida' && !k.interna ? grupoDe(k) : null;
    }
    if (t.tipo !== 'entrada' || k.interna) return null;
    if (!g.extra && ehExtra(k)) return null;
    return grupoDe(k);
  }

  function mesesDisponiveis() {
    const ms = state.meses.slice().sort();
    if (!ms.length) return [hoje().slice(0, 8) + '01'];
    const lista = [];
    for (let m = ms[0]; m <= ms[ms.length - 1]; m = addMeses(m, 1)) lista.push(m);
    return lista;
  }

  function estadoGrafico(chave) {
    state.graf = state.graf || {};
    if (!state.graf[chave]) {
      const todos = mesesDisponiveis();
      const ate = todos[todos.length - 1];
      state.graf[chave] = { ate, de: addMeses(ate, -11) < todos[0] ? todos[0] : addMeses(ate, -11),
        visao: 'compras', extra: false, ocultar: false, sel: null, modo: 'barras', linhas: [TOTAL] };
    }
    return state.graf[chave];
  }

  // ---------- Visão em linhas (evolução em R$) ----------
  // Mostra o total e/ou as categorias escolhidas. Quando só uma linha está visível, desenha também
  // a média móvel de 3 meses dela, para mostrar a tendência sem o ruído de meses atípicos.
  const TOTAL = 'Total';
  const COR_TOTAL = 'var(--text)';

  function escalaBonita(max) {
    if (max <= 0) return { topo: 1000, passo: 250 };
    const bruto = max / 4;
    const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
    const passo = [1, 2, 2.5, 5, 10].map((f) => f * pot).find((p) => p >= bruto);
    return { topo: Math.ceil(max / passo) * passo, passo };
  }

  function svgLinhas({ meses, series, corDe, g, largura }) {
    const H = 250, topo = 18, base = 28, esq = g.ocultar ? 22 : 40, dir = 26;
    const n = meses.length;
    const W = Math.max(largura, n * 22 + esq + dir);
    const passoX = n > 1 ? (W - esq - dir) / (n - 1) : 0;
    const x = (i) => (n > 1 ? esq + i * passoX : (W - esq - dir) / 2 + esq);

    const umaSo = series.length === 1;
    const maxV = Math.max(0, ...series.flatMap((s) => s.valores.map((v) => v.v)),
      ...(umaSo ? series[0].mediaMovel.filter((v) => v != null) : []));
    const { topo: yMax, passo } = escalaBonita(maxV);
    const y = (v) => topo + (1 - v / yMax) * (H - topo - base);

    let grade = '';
    for (let v = 0; v <= yMax + 0.001; v += passo) {
      grade += `<line x1="${esq}" x2="${W - dir}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`;
      if (!g.ocultar) grade += `<text x="${esq - 6}" y="${y(v) + 4}" class="tick" text-anchor="end">${esc(emMil(v))}</text>`;
    }
    const cada = Math.max(1, Math.ceil(34 / Math.max(passoX, 1)));
    const rotulos = meses.map((m, i) => ((i % cada === 0 && n - 1 - i >= cada) || i === n - 1)
      ? `<text x="${x(i)}" y="${H - 8}" class="tick ${m === g.sel ? 'sel' : ''}" text-anchor="middle">${esc(mesNome(m))}</text>` : '').join('');

    const caminho = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
    let linhas = '';
    for (const s of series) {
      if (umaSo && s.mediaMovel) {
        const pts = s.mediaMovel.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
        if (pts.length > 1) linhas += `<path d="${caminho(pts)}" class="ma" style="stroke:${corDe(s.nome)}"/>`;
      }
      linhas += `<path d="${caminho(s.valores.map((p, i) => [x(i), y(p.v)]))}" class="ln" style="stroke:${corDe(s.nome)}"/>`;
      if (n <= 36) linhas += s.valores.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="2.6" style="fill:${corDe(s.nome)}"/>`).join('');
    }

    // Mês selecionado: guia vertical, pontos maiores e valores
    const iSel = meses.indexOf(g.sel);
    let marca = '';
    if (iSel >= 0) {
      marca += `<line x1="${x(iSel)}" x2="${x(iSel)}" y1="${topo - 6}" y2="${H - base}" class="guia"/>`;
      const ladoEsq = x(iSel) > W - 70;
      const rot = [];
      for (const s of series) {
        const v = s.valores[iSel].v;
        marca += `<circle cx="${x(iSel)}" cy="${y(v)}" r="4.5" class="pt-sel" style="fill:${corDe(s.nome)}"/>`;
        rot.push({ yy: y(v) - 7, v, c: corDe(s.nome) });
      }
      if (!g.ocultar) {
        // Afasta os rótulos que ficariam um em cima do outro
        rot.sort((a, b) => a.yy - b.yy);
        for (let i = 1; i < rot.length; i++) if (rot[i].yy - rot[i - 1].yy < 13) rot[i].yy = rot[i - 1].yy + 13;
        for (const r of rot) {
          marca += `<text x="${x(iSel) + (ladoEsq ? -8 : 8)}" y="${Math.max(12, r.yy)}" class="val" style="fill:${r.c}" text-anchor="${ladoEsq ? 'end' : 'start'}">${esc(emMil(r.v))}</text>`;
        }
      }
    }
    const faixas = meses.map((m, i) => {
      const x0 = i === 0 ? 0 : (x(i - 1) + x(i)) / 2;
      const x1 = i === n - 1 ? W : (x(i) + x(i + 1)) / 2;
      return `<rect x="${x0}" y="0" width="${Math.max(1, x1 - x0)}" height="${H}" class="hit" data-mes="${m}"><title>${esc(mesLongo(m))}</title></rect>`;
    }).join('');

    return `<svg class="linechart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Evolução dos gastos">
      ${faixas}${grade}${rotulos}${linhas}${marca}</svg>`;
  }

  async function montarGrafico(el, chave) {
    if (!el || !el.isConnected) return;
    const g = estadoGrafico(chave);
    const todos = mesesDisponiveis();
    if (g.de > g.ate) [g.de, g.ate] = [g.ate, g.de];
    const titulo = chave === 'gastos' ? 'Gastos por mês' : 'Entradas por mês';
    const emLinhas = chave === 'gastos' && g.modo === 'linhas';
    // Em linhas, busca 2 meses antes do início para a média móvel já valer no primeiro mês.
    const deBusca = emLinhas ? (addMeses(g.de, -2) < todos[0] ? todos[0] : addMeses(g.de, -2)) : g.de;

    const vez = (el._vez = (el._vez || 0) + 1);   // descarta respostas de cliques anteriores
    let lista;
    try {
      const card = el.querySelector('.chart-card');
      if (card) card.classList.add('loading');
      else el.innerHTML = `<div class="chart-card"><h2>${titulo}</h2><div class="empty">Carregando...</div></div>`;
      lista = await transacoesDoPeriodo(deBusca, g.ate);
    } catch (err) {
      if (vez !== el._vez) return;
      el.innerHTML = `<div class="chart-card"><h2>${titulo}</h2><div class="empty">Não foi possível carregar: ${esc(err.message)}</div></div>`;
      return;
    }
    if (!el.isConnected || vez !== el._vez) return;

    // Meses do período e totais por mês e categoria
    const meses = [];
    for (let m = g.de; m <= g.ate; m = addMeses(m, 1)) meses.push(m);
    const mesesBusca = [];
    for (let m = deBusca; m <= g.ate; m = addMeses(m, 1)) mesesBusca.push(m);
    const porMes = new Map(mesesBusca.map((m) => [m, new Map()]));
    const totalCat = new Map();
    for (const t of lista) {
      const grupo = classificar(t, chave, g);
      if (!grupo) continue;
      const m = t.data_competencia.slice(0, 8) + '01';
      const mapa = porMes.get(m);
      if (!mapa) continue;
      const v = Number(t.valor) || 0;
      mapa.set(grupo, (mapa.get(grupo) || 0) + v);
      if (m >= g.de) totalCat.set(grupo, (totalCat.get(grupo) || 0) + v);
    }

    // Séries: as maiores categorias do período; o resto vai para "Demais categorias".
    const ordenadas = [...totalCat.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    let principais = ordenadas.filter((n) => n !== FATURAS).slice(0, MAX_SERIES);
    if (totalCat.has(FATURAS)) principais = [FATURAS, ...principais.slice(0, MAX_SERIES - 1)];
    const temDemais = ordenadas.some((n) => !principais.includes(n));
    const series = [...principais, ...(temDemais ? [DEMAIS] : [])];
    // Cores: evita repetir cor dentro do mesmo gráfico quando há mais categorias do que cores.
    const cor = new Map();
    const usadas = new Set();
    for (const n of series) {
      let c = corDaCategoria(n);
      if (usadas.has(c)) c = CORES_GRAF.find((x) => !usadas.has(x)) || c;
      usadas.add(c); cor.set(n, c);
    }

    const dados = meses.map((m) => {
      const valores = new Map(series.map((n) => [n, 0]));
      for (const [n, v] of porMes.get(m)) {
        const alvo = principais.includes(n) ? n : DEMAIS;
        valores.set(alvo, valores.get(alvo) + v);
      }
      const total = [...valores.values()].reduce((s, v) => s + v, 0);
      return { mes: m, valores, total };
    });
    const totalPeriodo = dados.reduce((s, d) => s + d.total, 0);
    const media = meses.length ? totalPeriodo / meses.length : 0;
    const maxTotal = Math.max(1, ...dados.map((d) => d.total));
    if (!g.sel || !meses.includes(g.sel)) g.sel = meses[meses.length - 1];
    const selecionado = dados.find((d) => d.mes === g.sel);

    const ALTURA = 190;   // px da área das barras
    const mostrar = !g.ocultar;
    const colunas = dados.map((d) => {
      const hTotal = (d.total / maxTotal) * ALTURA;
      const segs = series.filter((n) => d.valores.get(n) > 0).map((n) => {
        const v = d.valores.get(n);
        const h = d.total ? (v / d.total) * hTotal : 0;
        return `<div class="seg-bar" style="height:${h.toFixed(1)}px;background:${cor.get(n)}" title="${esc(n)}: ${esc(fmt(v))}">
          ${mostrar && h >= 16 ? `<span>${esc(emMil(v))}</span>` : ''}</div>`;
      }).join('');
      return `
        <button type="button" class="col ${d.mes === g.sel ? 'sel' : ''}" data-mes="${d.mes}"
          aria-label="${esc(mesLongo(d.mes))}: ${esc(fmt(d.total))}" aria-pressed="${d.mes === g.sel}">
          <div class="col-area">
            ${mostrar && d.total > 0 ? `<div class="col-total num">${esc(emMil(d.total))}</div>` : ''}
            <div class="stack">${segs}</div>
          </div>
          <div class="col-label">${esc(mesNome(d.mes))}</div>
        </button>`;
    }).join('');

    // O detalhe mostra cada categoria separada, inclusive as que estão somadas em "Categorias menores".
    const brutoSel = porMes.get(g.sel) || new Map();
    const detalhe = selecionado && selecionado.total > 0
      ? [...brutoSel.entries()].filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([n, v]) => {
          const menor = !principais.includes(n);
          return `<div class="row"><span class="dot" style="background:${cor.get(menor ? DEMAIS : n)}"></span>
            <div class="grow">${esc(n)}${menor ? ' <span class="muted" style="font-size:12px">· em categorias menores</span>' : ''}</div>
            <div class="muted num">${Math.round((v / selecionado.total) * 100)}%</div>
            <div class="num" style="min-width:110px;text-align:right">${esc(fmt(v))}</div></div>`;
        }).join('')
      : '<div class="row muted">Nada registrado neste mês.</div>';

    const opcoesMes = (sel) => todos.map((m) => `<option value="${m}" ${m === sel ? 'selected' : ''}>${esc(mesNome(m))}</option>`).join('');
    const presets = [[6, '6m'], [12, '12m'], [24, '24m'], [0, 'Tudo']];
    const presetAtivo = (n) => (n === 0
      ? g.de === todos[0] && g.ate === todos[todos.length - 1]
      : g.ate === todos[todos.length - 1] && g.de === addMeses(g.ate, -(n - 1)));

    const alternador = chave === 'gastos'
      ? `<div class="seg seg-sm" role="radiogroup" aria-label="Visão">
          <label><input type="radio" name="visao-${chave}" value="compras" ${g.visao === 'compras' ? 'checked' : ''}><span>Compras</span></label>
          <label><input type="radio" name="visao-${chave}" value="caixa" ${g.visao === 'caixa' ? 'checked' : ''}><span>Caixa</span></label>
        </div>`
      : `<label class="check"><input type="checkbox" data-extra ${g.extra ? 'checked' : ''}> Incluir extraordinárias</label>`;

    const explicacao = chave === 'gastos'
      ? (g.visao === 'compras'
        ? 'Pela data da compra, inclusive as feitas no cartão.'
        : 'Pelo que saiu das contas: o cartão aparece como fatura, no mês em que foi paga.')
      : (g.extra ? 'Todas as receitas, inclusive doações e herança.' : 'Receitas do dia a dia, sem doações e herança.');

    // Visão em linhas: séries mensais em R$ e média móvel de 3 meses
    let areaGrafico, legenda;
    if (emLinhas) {
      const valorMes = (nome, m) => {
        const mapa = porMes.get(m);
        if (!mapa) return 0;
        return nome === TOTAL ? [...mapa.values()].reduce((a, b) => a + b, 0) : (mapa.get(nome) || 0);
      };
      const corLinha = (nome) => (nome === TOTAL ? COR_TOTAL : (cor.has(nome) && nome !== DEMAIS ? cor.get(nome) : corDaCategoria(nome)));
      g.linhas = g.linhas.filter((nome) => nome === TOTAL || totalCat.has(nome));
      if (!g.linhas.length) g.linhas = [TOTAL];
      const serieDe = (nome) => {
        const valores = meses.map((m) => ({ m, v: valorMes(nome, m) }));
        const mediaMovel = meses.map((m) => {
          const janela = [addMeses(m, -2), addMeses(m, -1), m];
          if (janela[0] < deBusca) return null;
          return janela.reduce((a, j) => a + valorMes(nome, j), 0) / 3;
        });
        return { nome, valores, mediaMovel };
      };
      const largura = Math.max(280, (el.clientWidth || 800) - (window.innerWidth <= 760 ? 26 : 34));
      areaGrafico = svgLinhas({ meses, g, largura, corDe: corLinha, series: g.linhas.map(serieDe) });
      const opcoes = [TOTAL, ...ordenadas];
      legenda = `<div class="chart-legend line-legend" role="group" aria-label="Linhas visíveis">
          ${opcoes.map((nome) => {
            const on = g.linhas.includes(nome);
            return `<button type="button" class="leg-btn ${on ? 'on' : ''}" data-linha="${esc(nome)}" aria-pressed="${on}">
              <i style="background:${corLinha(nome)}"></i>${esc(nome)}</button>`;
          }).join('')}
        </div>
        <div class="meta muted" style="font-size:12.5px">${g.linhas.length === 1
          ? 'A linha tracejada é a média móvel de 3 meses. Clique em outras categorias para comparar.'
          : 'Clique numa categoria para ligar ou desligar a linha. Com uma só linha, aparece a média móvel de 3 meses.'}</div>`;
    } else {
      areaGrafico = `<div class="chart" style="--n:${meses.length};grid-template-columns:repeat(${meses.length}, minmax(44px, 1fr))">${colunas}</div>`;
      legenda = `<div class="chart-legend">
          ${series.map((n) => `<span ${n === DEMAIS ? `title="${esc(ordenadas.filter((x) => !principais.includes(x)).join(', '))}"` : ''}><i style="background:${cor.get(n)}"></i>${esc(n === DEMAIS ? `${DEMAIS} (${ordenadas.filter((x) => !principais.includes(x)).length})` : n)}</span>`).join('') || '<span class="muted">Nada registrado no período.</span>'}
        </div>`;
    }
    const modoBtn = chave === 'gastos'
      ? `<div class="seg seg-sm" role="radiogroup" aria-label="Tipo de gráfico">
          <label><input type="radio" name="modo-${chave}" value="barras" ${g.modo === 'barras' ? 'checked' : ''}><span>Barras</span></label>
          <label><input type="radio" name="modo-${chave}" value="linhas" ${g.modo === 'linhas' ? 'checked' : ''}><span>Linhas</span></label>
        </div>` : '';

    el.innerHTML = `
      <div class="chart-card">
        <div class="chart-head">
          <div>
            <h2>${titulo}</h2>
            <div class="meta muted">${esc(explicacao)}${mostrar ? ` Média no período: <span class="num">${esc(fmt(media))}</span>.` : ''}</div>
          </div>
          <button type="button" class="icon-btn" data-ocultar aria-pressed="${g.ocultar}"
            title="${g.ocultar ? 'Mostrar' : 'Ocultar'} valores no gráfico" aria-label="${g.ocultar ? 'Mostrar' : 'Ocultar'} valores no gráfico">
            ${g.ocultar
              ? '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.3 2.4-2.6 3.7M6.1 6.9C4.1 8.3 2.6 10.3 2 12c1 2.5 5 7 10 7 1.7 0 3.3-.5 4.7-1.3M9.9 10a3 3 0 0 0 4.1 4.1"/></svg>'
              : '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>'}
          </button>
        </div>
        <div class="chart-controls">
          <div class="modos">${modoBtn}${alternador}</div>
          <div class="periodo">
            ${presets.map(([n, r]) => `<button type="button" class="chip-btn ${presetAtivo(n) ? 'on' : ''}" data-preset="${n}">${r}</button>`).join('')}
            <span class="intervalo">
              <select data-de aria-label="Mês inicial">${opcoesMes(g.de)}</select>
              <span class="muted">até</span>
              <select data-ate aria-label="Mês final">${opcoesMes(g.ate)}</select>
            </span>
          </div>
        </div>
        ${mostrar ? '<div class="axis-title">R$ mil</div>' : ''}
        <div class="chart-scroll">${areaGrafico}</div>
        ${legenda}
        <div class="chart-detail">
          <h3>${esc(mesLongo(g.sel))} <span class="num">${esc(fmt(selecionado ? selecionado.total : 0))}</span></h3>
          <div class="rows">${detalhe}</div>
        </div>
      </div>`;

    const scroll = el.querySelector('.chart-scroll');
    const colSel = el.querySelector('.col.sel');
    if (colSel) scroll.scrollLeft = Math.max(0, colSel.offsetLeft - scroll.clientWidth + colSel.offsetWidth + 16);
    else if (emLinhas) scroll.scrollLeft = scroll.scrollWidth;

    const redesenhar = () => montarGrafico(el, chave);
    el.querySelector('[data-ocultar]').onclick = () => { g.ocultar = !g.ocultar; redesenhar(); };
    el.querySelectorAll('.col, .hit').forEach((b) => b.addEventListener('click', () => { g.sel = b.dataset.mes; redesenhar(); }));
    el.querySelectorAll(`input[name="modo-${chave}"]`).forEach((r) => r.addEventListener('change', (e) => { g.modo = e.target.value; redesenhar(); }));
    el.querySelectorAll('[data-linha]').forEach((b) => b.addEventListener('click', () => {
      const nome = b.dataset.linha;
      g.linhas = g.linhas.includes(nome) ? g.linhas.filter((x) => x !== nome) : [...g.linhas, nome];
      if (!g.linhas.length) g.linhas = [TOTAL];
      redesenhar();
    }));
    el.querySelectorAll(`input[name="visao-${chave}"]`).forEach((r) => r.addEventListener('change', (e) => { g.visao = e.target.value; redesenhar(); }));
    const extra = el.querySelector('[data-extra]');
    if (extra) extra.onchange = (e) => { g.extra = e.target.checked; redesenhar(); };
    el.querySelector('[data-de]').onchange = (e) => { g.de = e.target.value; redesenhar(); };
    el.querySelector('[data-ate]').onchange = (e) => { g.ate = e.target.value; redesenhar(); };
    el.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const n = Number(b.dataset.preset);
      g.ate = todos[todos.length - 1];
      g.de = n === 0 ? todos[0] : (addMeses(g.ate, -(n - 1)) < todos[0] ? todos[0] : addMeses(g.ate, -(n - 1)));
      redesenhar();
    }));
  }

  // ---------- # painel ----------
  async function renderPainel(body) {
    const ativos = state.posicao.filter((p) => p.ativo);
    const total = (moeda) => ativos.filter((p) => p.moeda === moeda).reduce((s, p) => s + Number(p.valor_atual), 0);
    const fluxo = await q(sb.from('v_fluxo_mensal').select('*').eq('moeda', 'BRL').order('mes', { ascending: false }).limit(6));
    const ult = fluxo[0];
    const cats = ult ? await q(sb.from('v_categorias_mensal').select('*')
      .eq('moeda', 'BRL').eq('tipo', 'saida').eq('mes', ult.mes).order('total', { ascending: false }).limit(6)) : [];

    const maxBar = Math.max(1, ...fluxo.map((f) => Math.max(Number(f.receitas_recorrentes) || 0, Number(f.gastos) || 0)));
    const porTipo = (tipos) => ativos.filter((p) => tipos.includes(p.tipo) && Number(p.valor_atual) !== 0);

    body.innerHTML = `
      <div class="block chart-block" id="g-gastos"></div>
      <div class="block chart-block" id="g-entradas"></div>

      <div class="intro">
        <div class="big num">${esc(fmt(total('BRL'), 'BRL'))}</div>
        <div class="sub">de patrimônio, mais <span class="num">${esc(fmt(total('USD'), 'USD'))}</span> em dólar</div>
      </div>

      <div class="block">
        <h2>Receitas e gastos dos últimos meses</h2>
        <div class="legend"><span class="l-in">Receitas do dia a dia</span><span class="l-out">Gastos</span></div>
        <div class="rows">
          ${fluxo.length ? fluxo.slice().reverse().map((f) => {
            const rec = Number(f.receitas_recorrentes) || 0;
            const gas = Number(f.gastos) || 0;
            const extra = Number(f.receitas_extraordinarias) || 0;
            const res = rec - gas;
            return `
            <div class="flow-row">
              <div>${esc(mesNome(f.mes))}</div>
              <div class="bars" title="Receitas ${esc(fmt(rec))}, gastos ${esc(fmt(gas))}">
                <div class="bar in" style="width:${(rec / maxBar) * 100}%"></div>
                <div class="bar out" style="width:${(gas / maxBar) * 100}%"></div>
              </div>
              <div class="num ${res >= 0 ? 'pos' : 'neg'}" style="text-align:right">
                ${esc(fmt(res))}${extra ? `<div class="muted" style="font-size:12px">+ ${esc(fmt(extra))} extra</div>` : ''}
              </div>
            </div>`;
          }).join('') : '<div class="row">Nenhum lançamento ainda.</div>'}
        </div>
      </div>

      ${ult ? `
      <div class="block">
        <h2>Onde o dinheiro foi em ${esc(mesLongo(ult.mes).toLowerCase())}</h2>
        <div class="rows">
          ${cats.map((c) => `
            <div class="row"><div class="grow"><div class="title">${esc(c.categoria)}</div>
            <div class="meta">${c.qtd} lançamento${c.qtd > 1 ? 's' : ''}</div></div>
            <div class="num">${esc(fmt(c.total))}</div></div>`).join('') || '<div class="row">Sem gastos neste mês.</div>'}
        </div>
      </div>` : ''}

      <div class="block">
        <h2>Contas</h2>
        <div class="rows">
          ${porTipo(['corrente', 'carteira_digital', 'poupanca', 'cartao_credito']).map(linhaConta).join('') || '<div class="row">Nenhuma conta com saldo.</div>'}
        </div>
      </div>
      <div class="block">
        <h2>Investimentos e bens</h2>
        <div class="rows">
          ${porTipo(['investimento', 'outro']).sort((a, b) => b.valor_atual - a.valor_atual).map(linhaConta).join('')}
        </div>
      </div>`;
    montarGrafico(document.getElementById('g-gastos'), 'gastos');
    montarGrafico(document.getElementById('g-entradas'), 'entradas');
  }

  function linhaConta(p) {
    return `<div class="row">
      <div class="avatar" style="background:${corDe(p.nome)}">${esc(iniciais(p.nome))}</div>
      <div class="grow"><div class="title">${esc(p.nome)}</div><div class="meta">${esc(tipoNome(p.tipo))}</div></div>
      <div class="num ${Number(p.valor_atual) < 0 ? 'neg' : ''}">${esc(fmt(p.valor_atual, p.moeda))}</div>
    </div>`;
  }
  function tipoNome(t) {
    return ({ corrente: 'Conta corrente', carteira_digital: 'Carteira digital', poupanca: 'Poupança',
      investimento: 'Investimento', cartao_credito: 'Cartão de crédito', outro: 'Bem' })[t] || t;
  }

  // ---------- # transações ----------
  async function renderTransacoes(body) {
    const f = state.filtros;
    let consulta = sb.from('transacoes')
      .select('id, conta_id, categoria_id, data_competencia, valor, moeda, descricao, tipo, transferencia_par_id')
      .gte('data_competencia', f.mes).lt('data_competencia', proximoMes(f.mes))
      .order('data_competencia', { ascending: true }).order('criado_em', { ascending: true })
      .limit(1000);
    if (f.conta) consulta = consulta.eq('conta_id', f.conta);
    if (f.categoriaNome) {
      const ids = state.categorias.filter((c) => c.nome === f.categoriaNome).map((c) => c.id);
      consulta = consulta.in('categoria_id', ids);
    }
    const lista = await q(consulta);

    const nomesCat = [...new Map(state.categorias.map((c) => [c.nome, c])).values()]
      .sort((a, b) => a.nome.localeCompare(b.nome));
    const meses = state.meses.includes(f.mes) ? state.meses : [f.mes, ...state.meses];

    let html = `
      <div class="filters">
        <select id="f-mes" aria-label="Mês">${meses.map((m) => `<option value="${m}" ${m === f.mes ? 'selected' : ''}>${esc(mesLongo(m))}</option>`).join('')}</select>
        <select id="f-conta" aria-label="Conta"><option value="">Todas as contas</option>
          ${state.contas.filter((c) => c.ativo || c.id === f.conta).map((c) => `<option value="${c.id}" ${c.id === f.conta ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>
        <select id="f-cat" aria-label="Categoria"><option value="">Todas as categorias</option>
          ${nomesCat.map((c) => `<option value="${esc(c.nome)}" ${f.categoriaNome === c.nome ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>
      </div>`;

    if (!lista.length) {
      html += '<div class="empty">Nenhum lançamento neste filtro. Use o campo abaixo para registrar um.</div>';
    } else {
      let diaAtual = '';
      for (const t of lista) {
        if (t.data_competencia !== diaAtual) {
          diaAtual = t.data_competencia;
          html += `<div class="day"><span>${esc(diaLongo(diaAtual))}</span></div>`;
        }
        const c = conta(t.conta_id) || { nome: '?' };
        const k = categoria(t.categoria_id) || { nome: '?' };
        const sinal = t.tipo === 'entrada' ? '+' : '−';
        const cls = k.interna ? 'muted' : (t.tipo === 'entrada' ? 'pos' : '');
        html += `
          <button class="msg" type="button" data-id="${t.id}">
            <div class="avatar" style="background:${corDe(c.nome)}">${esc(iniciais(c.nome))}</div>
            <div class="body">
              <div class="head"><span class="who">${esc(c.nome)}</span><span class="chip">${esc(k.nome)}</span></div>
              <div class="text">${esc(t.descricao || 'Sem descrição')}</div>
            </div>
            <div class="amount num ${cls}">${sinal} ${esc(fmt(t.valor, t.moeda))}</div>
          </button>`;
      }
    }
    body.innerHTML = html;
    body.scrollTop = body.scrollHeight;   // como numa conversa: o mais recente fica embaixo, perto do campo de registro

    document.getElementById('f-mes').onchange = (e) => { f.mes = e.target.value; renderCanal('transacoes'); };
    document.getElementById('f-conta').onchange = (e) => { f.conta = e.target.value; renderCanal('transacoes'); };
    document.getElementById('f-cat').onchange = (e) => {
      f.categoriaNome = e.target.value;
      renderCanal('transacoes');
    };
    body.querySelectorAll('.msg').forEach((b) => b.addEventListener('click', () => {
      abrirForm(lista.find((t) => t.id === b.dataset.id));
    }));
  }

  // ---------- # cartões ----------
  async function renderCartoes(body) {
    const cartoes = state.posicao.filter((p) => p.tipo === 'cartao_credito' && p.ativo);
    if (!cartoes.length) { body.innerHTML = '<div class="empty">Nenhum cartão cadastrado.</div>'; return; }
    const ids = cartoes.map((c) => c.conta_id);
    const compras = await q(sb.from('transacoes')
      .select('conta_id, data_competencia, valor, moeda, descricao, categoria_id, tipo')
      .in('conta_id', ids).eq('tipo', 'saida')
      .order('data_competencia', { ascending: false }).limit(300));

    body.innerHTML = cartoes.map((p) => {
      const lista = compras.filter((t) => t.conta_id === p.conta_id);
      const mes = lista[0] ? lista[0].data_competencia.slice(0, 8) + '01' : null;
      const doMes = mes ? lista.filter((t) => t.data_competencia >= mes) : [];
      const totalMes = doMes.reduce((s, t) => s + Number(t.valor), 0);
      const aberta = Math.max(0, -Number(p.valor_atual));
      return `
        <div class="block">
          <div class="intro">
            <div class="big num">${esc(fmt(aberta, p.moeda))}</div>
            <div class="sub">em aberto no ${esc(p.nome)}${mes ? `, com ${esc(fmt(totalMes, p.moeda))} em compras em ${esc(mesLongo(mes).toLowerCase())}` : ''}</div>
          </div>
          <h2>Últimas compras</h2>
          <div class="rows">
            ${lista.slice(0, 15).map((t) => `
              <div class="row"><div class="grow">
                <div class="title">${esc(t.descricao || 'Sem descrição')}</div>
                <div class="meta">${esc(new Date(t.data_competencia + 'T12:00:00').toLocaleDateString('pt-BR'))}, ${esc((categoria(t.categoria_id) || {}).nome || '')}</div>
              </div><div class="num">${esc(fmt(t.valor, t.moeda))}</div></div>`).join('') || '<div class="row">Nenhuma compra registrada.</div>'}
          </div>
        </div>`;
    }).join('');
  }

  // ---------- # investimentos ----------
  async function renderInvestimentos(body) {
    const inv = state.posicao.filter((p) => p.tipo === 'investimento' || (p.tipo === 'carteira_digital' && p.moeda === 'USD'));
    const abertos = inv.filter((p) => p.ativo && Math.abs(Number(p.valor_atual)) > 0.005);
    const encerrados = inv.filter((p) => !abertos.includes(p));
    const soma = (moeda, campo) => abertos.filter((p) => p.moeda === moeda).reduce((s, p) => s + Number(p[campo]), 0);

    const linha = (p, fechado) => `
      <tr class="${fechado ? 'closed' : ''}">
        <td>${esc(p.nome)}</td>
        <td class="num">${fechado ? '—' : esc(fmt(p.saldo_transacoes, p.moeda))}</td>
        <td class="num ${Number(p.rendimentos_acumulados) < 0 ? 'neg' : 'pos'}">${esc(fmt(p.rendimentos_acumulados, p.moeda))}</td>
        <td class="num">${esc(fmt(p.valor_atual, p.moeda))}</td>
        <td>${p.ultima_referencia ? esc(new Date(p.ultima_referencia + 'T12:00:00').toLocaleDateString('pt-BR')) : '—'}</td>
      </tr>`;

    body.innerHTML = `
      <div class="intro">
        <div class="big num">${esc(fmt(soma('BRL', 'valor_atual'), 'BRL'))}</div>
        <div class="sub">investidos em reais, com <span class="num">${esc(fmt(soma('BRL', 'rendimentos_acumulados'), 'BRL'))}</span> de rendimento acumulado.
        Em dólar: <span class="num">${esc(fmt(soma('USD', 'valor_atual'), 'USD'))}</span>.</div>
      </div>
      <div class="block" style="max-width:none">
        <div class="table-wrap"><table>
          <thead><tr><th>Investimento</th><th>Aplicado líquido</th><th>Rendimento</th><th>Valor atual</th><th>Atualizado em</th></tr></thead>
          <tbody>
            ${abertos.sort((a, b) => b.valor_atual - a.valor_atual).map((p) => linha(p, false)).join('')}
            ${state.mostrarEncerrados ? encerrados.map((p) => linha(p, true)).join('') : ''}
          </tbody>
        </table></div>
        <p><button class="link" type="button" id="toggle-enc">
          ${state.mostrarEncerrados ? 'Esconder' : 'Mostrar'} investimentos encerrados (${encerrados.length})
        </button></p>
      </div>`;
    document.getElementById('toggle-enc').onclick = () => {
      state.mostrarEncerrados = !state.mostrarEncerrados;
      renderCanal('investimentos');
    };
  }

  // =====================================================================
  // ---------- # projeção (modelo no formato de planilha) ----------
  // Meses fechados vêm da base (realizado). Nos meses seguintes, cada premissa é uma célula do P&L:
  //  - "nível" (taxas, % investido...): vale a partir do mês em que foi digitada até ser trocada;
  //  - "evento" (variação %, gasto pontual...): vale só no mês digitado;
  //  - linhas calculadas (salário, 13º, aportes, dólar...) têm fórmula padrão e aceitam um valor
  //    digitado por cima; o salário, o gasto e o dólar seguem a partir do valor digitado.
  // Regra do caixa: os aportes sempre acontecem e a diferença entre o resultado e os aportes vai para o caixa.
  // =====================================================================
  const CLASSES = [
    { id: 'caixa', nome: 'Caixa', cor: '#2BA3B8' },
    { id: 'rf', nome: 'Renda fixa', cor: '#2F6FED' },
    { id: 'rv', nome: 'Renda variável', cor: '#1C9A6C' },
    { id: 'outros', nome: 'Outros', cor: '#E0A63B' }
  ];
  const CLASSES_CONTA = [...CLASSES, { id: 'bens', nome: 'Imóvel e bens' }, { id: 'fora', nome: 'Não considerar' }];
  const INVEST = ['rf', 'rv', 'outros'];

  // Valores de partida das premissas de nível (valem até alguém digitar outro valor numa célula)
  const NIVEIS_PADRAO = {
    outrasRec: 0, pctInv: 20, pctRf: 60, pctRv: 30, pctOut: 10,
    cdi: 14, caixaCdi: 100, rfCdi: 105, rvRet: 8, outRet: 10,
    cambioVar: 3, inflacao: 4, irCaixa: 20, irRf: 10, irRv: 15, irOut: 15, caixaMin: 3
  };
  const PREMISSAS_PADRAO = { v: 2, horizonteAnos: 10, salarioCats: null, classes: {}, niveis: { ...NIVEIS_PADRAO }, celulas: {} };

  // Converte premissas salvas na versão anterior (painel lateral) para células.
  function migrarPremissas(salvo, primeiroProj, horizonte) {
    if (!salvo) return JSON.parse(JSON.stringify(PREMISSAS_PADRAO));
    if (salvo.v === 2) {
      return { ...JSON.parse(JSON.stringify(PREMISSAS_PADRAO)), ...salvo,
        niveis: { ...NIVEIS_PADRAO, ...(salvo.niveis || {}) }, celulas: salvo.celulas || {}, classes: salvo.classes || {} };
    }
    const p = JSON.parse(JSON.stringify(PREMISSAS_PADRAO));
    p.horizonteAnos = salvo.horizonteAnos || 10;
    p.salarioCats = salvo.salarioCats || null;
    p.classes = salvo.classes || {};
    const n = p.niveis, d = salvo.divisao || {}, ir = salvo.ir || {};
    Object.assign(n, {
      outrasRec: salvo.outrasReceitasMensal ?? n.outrasRec, pctInv: salvo.pctInvestir ?? n.pctInv,
      pctRf: d.rf ?? n.pctRf, pctRv: d.rv ?? n.pctRv, pctOut: d.outros ?? n.pctOut,
      cdi: salvo.cdiPct ?? n.cdi, caixaCdi: salvo.caixaPctCdi ?? n.caixaCdi, rfCdi: salvo.rfPctCdi ?? n.rfCdi,
      rvRet: salvo.rvRetornoPct ?? n.rvRet, outRet: salvo.outrosRetornoPct ?? n.outRet,
      cambioVar: salvo.cambioVariacaoPct ?? n.cambioVar, inflacao: salvo.gastoCrescimentoPct ?? salvo.inflacaoPct ?? n.inflacao,
      irCaixa: ir.caixa ?? n.irCaixa, irRf: ir.rf ?? n.irRf, irRv: ir.rv ?? n.irRv, irOut: ir.outros ?? n.irOut,
      caixaMin: salvo.caixaMinimoMeses ?? n.caixaMin
    });
    const set = (id, m, v) => { (p.celulas[id] = p.celulas[id] || {})[m] = v; };
    const meses = [];
    for (let k = 0; k < p.horizonteAnos * 12; k++) meses.push(addMeses(primeiroProj, k));
    if (salvo.salarioBase != null) set('sal', primeiroProj, Number(salvo.salarioBase));
    if (salvo.gastoBase != null) set('gasto', primeiroProj, Number(salvo.gastoBase));
    if (salvo.cambioInicial != null) set('cambio', primeiroProj, Number(salvo.cambioInicial));
    for (const m of meses) {
      const ma = Number(m.slice(5, 7));
      if (salvo.reajusteAnualPct && ma === Number(salvo.reajusteAnualMes)) set('salVar', m, Number(salvo.reajusteAnualPct));
      for (const b of salvo.bonus || []) if (Number(b.mesAno) === ma) set('bonusMult', m, Number(b.multiplo) || 0);
      for (const g of salvo.gastosSazonais || []) if (Number(g.mesAno) === ma) set('gastoPont', m, Number(g.valor) || 0);
    }
    for (const rj of salvo.reajustesPontuais || []) set('salVar', rj.mes, Number(rj.pct) || 0);
    for (const g of salvo.gastosPontuais || []) set('gastoPont', g.mes, Number(g.valor) || 0);
    if (salvo.decimoTerceiro === false) for (const m of meses) if (/-1[12]-/.test(m)) set('decimo', m, 0);
    return p;
  }

  function classePadrao(c) {
    if (c.tipo === 'outro') return 'bens';
    if (/caixinha/i.test(c.nome)) return 'caixa';
    if (c.moeda === 'USD') return 'rv';
    if (c.tipo === 'investimento') return /btc|bitcoin|ripio|cripto|ethereum|polkadot/i.test(c.nome) ? 'outros' : 'rf';
    return 'caixa';
  }
  const classeDe = (c, p) => (p.classes && p.classes[c.id]) || classePadrao(c);

  // ---------- Leitura do histórico completo ----------
  let cacheHist = null;
  async function todasAsLinhas(montar) {
    const out = [];
    const LOTE = 1000;
    for (let i = 0; ; i += LOTE) {
      const lote = await q(montar().range(i, i + LOTE - 1));
      out.push(...lote);
      if (lote.length < LOTE) break;
    }
    return out;
  }
  // As tabelas de snapshots e cotações não têm o nome da coluna de data garantido: procura a coluna certa.
  const chaveData = (row) => ['data_referencia', 'data', 'referencia', 'data_cotacao'].find((k) => row[k])
    || Object.keys(row).find((k) => /data|referencia/i.test(k) && /^\d{4}-\d{2}-\d{2}/.test(String(row[k])));

  async function carregarHistorico() {
    if (cacheHist) return cacheHist;
    const [tx, snaps, cot] = await Promise.all([
      todasAsLinhas(() => sb.from('transacoes').select('id, conta_id, categoria_id, data_competencia, valor, moeda, tipo')
        .order('data_competencia', { ascending: true }).order('id', { ascending: true })),
      todasAsLinhas(() => sb.from('investimentos_snapshots').select('*')).catch(() => []),
      todasAsLinhas(() => sb.from('cotacoes_cambio').select('*')).catch(() => [])
    ]);
    const cotacoes = [];
    for (const r of cot) {
      const kd = chaveData(r);
      if (!kd) continue;
      const texto = Object.values(r).filter((v) => typeof v === 'string').join(' ').toUpperCase();
      if (!texto.includes('USD')) continue;
      const kv = ['cotacao', 'valor', 'taxa', 'preco', 'fechamento', 'venda', 'compra'].find((k) => r[k] != null && Number(r[k]) > 0);
      if (!kv) continue;
      let v = Number(r[kv]);
      if (v < 1) v = 1 / v;   // par cadastrado como BRL/USD
      cotacoes.push({ data: String(r[kd]).slice(0, 10), v });
    }
    cotacoes.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
    const snapsOk = snaps.map((r) => {
      const kd = chaveData(r);
      return kd ? { conta_id: r.conta_id, data: String(r[kd]).slice(0, 10), valor: Number(r.valor_atual) || 0 } : null;
    }).filter(Boolean).sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
    cacheHist = { tx, snaps: snapsOk, cotacoes };
    return cacheHist;
  }

  function cambioAte(hist, dataLimite, reserva) {
    let v = null;
    for (const c of hist.cotacoes) { if (c.data < dataLimite) v = c.v; else break; }
    return v || (hist.cotacoes[0] && hist.cotacoes[0].v) || reserva;
  }

  // ---------- Realizado ----------
  const zeros = () => ({ caixa: 0, rf: 0, rv: 0, outros: 0, bens: 0 });
  const IR_ID = { caixa: 'irCaixa', rf: 'irRf', rv: 'irRv', outros: 'irOut' };

  function calcularRealizado(hist, p) {
    const disp = mesesDisponiveis();
    const primeiroTx = hist.tx.length ? hist.tx[0].data_competencia.slice(0, 8) + '01' : disp[0];
    const meses = [];
    for (let m = primeiroTx < disp[0] ? primeiroTx : disp[0]; m <= disp[disp.length - 1]; m = addMeses(m, 1)) meses.push(m);
    const n = meses.length;
    const idx = new Map(meses.map((m, i) => [m, i]));
    const cambios = meses.map((m) => cambioAte(hist, addMeses(m, 1), 5.5));
    const salCats = new Set(p.salarioCats || state.categorias
      .filter((k) => k.tipo === 'entrada' && !k.interna && /sal[aá]rio/i.test(k.nome)).map((k) => k.id));

    const regs = meses.map((m, i) => ({
      mes: m, real: true, drv: {},
      rec: { salario: 0, decimo: 0, ferias: 0, bonus: 0, outras: 0, extra: 0 },
      gas: { rec: 0, saz: 0 }, ap: zeros(), rend: zeros(), ir: zeros(), saldo: zeros(),
      outrosMov: 0, alerta: false, cambio: cambios[i]
    }));

    const movTotal = new Map();
    const movInterno = new Map();
    const arr = (mapa, id) => { if (!mapa.has(id)) mapa.set(id, new Array(n).fill(0)); return mapa.get(id); };
    for (const t of hist.tx) {
      const i = idx.get(t.data_competencia.slice(0, 8) + '01');
      if (i == null) continue;
      const c = conta(t.conta_id);
      if (!c) continue;
      const k = categoria(t.categoria_id);
      const v = Number(t.valor) || 0;
      const s = t.tipo === 'entrada' ? v : -v;
      arr(movTotal, c.id)[i] += s;
      if (k && k.interna) arr(movInterno, c.id)[i] += s;
      const cls = classeDe(c, p);
      if (cls !== 'caixa' || !k || k.interna) continue;
      const vBRL = (t.moeda === 'USD' ? cambios[i] : 1) * v;
      const r = regs[i];
      if (t.tipo === 'entrada') {
        if (salCats.has(k.id)) r.rec.salario += vBRL;
        else if (ehExtra(k)) r.rec.extra += vBRL;
        else r.rec.outras += vBRL;
      } else r.gas.rec += vBRL;
    }

    const snapsPorConta = new Map();
    for (const s of hist.snaps) { if (!snapsPorConta.has(s.conta_id)) snapsPorConta.set(s.conta_id, []); snapsPorConta.get(s.conta_id).push(s); }
    for (const c of state.contas) {
      const cls = classeDe(c, p);
      if (cls === 'fora') continue;
      const mt = movTotal.get(c.id) || new Array(n).fill(0);
      const mi = movInterno.get(c.id) || new Array(n).fill(0);
      const ss = snapsPorConta.get(c.id) || [];
      let acum = 0, j = 0, ultimoSnap = null, anteriorBRL = 0;
      for (let i = 0; i < n; i++) {
        acum += mt[i];
        const limite = addMeses(meses[i], 1);
        while (j < ss.length && ss[j].data < limite) { ultimoSnap = ss[j].valor; j++; }
        const saldo = ultimoSnap != null ? ultimoSnap : acum;
        const conv = c.moeda === 'USD' ? cambios[i] : 1;
        const saldoBRL = saldo * conv;
        const r = regs[i];
        r.saldo[cls] += saldoBRL;
        if (cls === 'caixa') {
          if (ss.length) r.rend.caixa += saldoBRL - anteriorBRL - mt[i] * conv;
        } else {
          r.ap[cls] += mi[i] * conv;
          if (cls !== 'bens') r.rend[cls] += saldoBRL - anteriorBRL - mi[i] * conv;
        }
        anteriorBRL = saldoBRL;
      }
    }

    for (let i = 0; i < n; i++) {
      const r = regs[i];
      const receitas = Object.values(r.rec).reduce((a, b) => a + b, 0);
      const aportado = r.ap.rf + r.ap.rv + r.ap.outros + r.ap.bens;
      const varCaixa = r.saldo.caixa - (i ? regs[i - 1].saldo.caixa : 0);
      r.outrosMov = varCaixa - (receitas - r.gas.rec - aportado + r.rend.caixa);
      for (const cls of ['caixa', ...INVEST]) r.ir[cls] = Math.max(0, r.rend[cls]) * (Number(p.niveis[IR_ID[cls]]) || 0) / 100;
    }

    const ult = regs.slice(-12);
    const derivados = {
      salario: regs.slice(-3).reduce((a, r) => a + r.rec.salario, 0) / Math.max(1, Math.min(3, regs.length)),
      gasto: ult.reduce((a, r) => a + r.gas.rec, 0) / Math.max(1, ult.length),
      cambio: hist.cotacoes.length ? hist.cotacoes[hist.cotacoes.length - 1].v : regs[regs.length - 1].cambio
    };
    return { regs, derivados };
  }

  // ---------- Leitura das células ----------
  const celula = (p, id, m) => (p.celulas[id] && p.celulas[id][m] != null ? Number(p.celulas[id][m]) : undefined);
  function nivel(p, id, m) {
    // último valor digitado até este mês; se não houver, o valor de partida
    const cel = p.celulas[id];
    let melhor = null;
    if (cel) for (const k of Object.keys(cel)) if (k <= m && cel[k] != null && (melhor == null || k > melhor)) melhor = k;
    return melhor != null ? Number(cel[melhor]) : Number(p.niveis[id]) || 0;
  }

  // ---------- Projeção ----------
  function projetar(real, p) {
    const d = real.derivados;
    const ultimo = real.regs[real.regs.length - 1];
    const taxaM = (a) => Math.pow(1 + (Number(a) || 0) / 100, 1 / 12) - 1;
    const saldo = { caixa: ultimo.saldo.caixa, rf: ultimo.saldo.rf, outros: ultimo.saldo.outros, bens: ultimo.saldo.bens };
    let cambioAnt = d.cambio || ultimo.cambio || 5.5;
    let rvUSD = ultimo.saldo.rv / (ultimo.cambio || cambioAnt);
    let salAnt = d.salario;
    let gastoAnt = d.gasto;
    const n = Math.max(1, Math.round(Number(p.horizonteAnos) || 1)) * 12;
    const regs = [];
    let fatorInf = 1;

    for (let k = 1; k <= n; k++) {
      const m = addMeses(ultimo.mes, k);
      const mesAno = Number(m.slice(5, 7));
      const drv = {};
      const niv = (id) => (drv[id] = nivel(p, id, m));
      const evt = (id) => (drv[id] = celula(p, id, m) || 0);
      const ovr = (id, formula) => { const c = celula(p, id, m); return c != null ? c : formula; };

      // Receitas
      const salVar = evt('salVar');
      const salario = ovr('sal', salAnt * (1 + salVar / 100));
      salAnt = salario;
      const bonusMult = evt('bonusMult');
      const rec = {
        salario,
        decimo: ovr('decimo', mesAno === 11 || mesAno === 12 ? salario / 2 : 0),
        ferias: ovr('ferias', mesAno === 1 ? salario / 3 : 0),
        bonus: ovr('bonus', bonusMult * salario),
        outras: niv('outrasRec'),
        extra: ovr('extra', 0)
      };

      // Gastos: seguem a inflação mês a mês e aceitam variação pontual ou valor digitado
      const infl = niv('inflacao');
      const gastoVar = evt('gastoVar');
      const gasto = ovr('gasto', gastoAnt * (1 + taxaM(infl)) * (1 + gastoVar / 100));
      gastoAnt = gasto;
      const gas = { rec: gasto, saz: ovr('gastoPont', 0) };
      const receitas = Object.values(rec).reduce((a, b) => a + b, 0);
      const resultado = receitas - gas.rec - gas.saz;

      // Aportes
      const pctInv = niv('pctInv');
      const divs = { rf: niv('pctRf'), rv: niv('pctRv'), outros: niv('pctOut') };
      const somaDiv = divs.rf + divs.rv + divs.outros || 1;
      const aporteBase = salario * pctInv / 100;
      const ap = {
        rf: ovr('apRf', aporteBase * divs.rf / somaDiv),
        rv: ovr('apRv', aporteBase * divs.rv / somaDiv),
        outros: ovr('apOut', aporteBase * divs.outros / somaDiv),
        bens: 0, caixa: 0
      };
      const aporte = ap.rf + ap.rv + ap.outros;

      // Mercado
      const cdi = niv('cdi');
      const r = { caixa: taxaM(cdi * niv('caixaCdi') / 100), rf: taxaM(cdi * niv('rfCdi') / 100), rv: taxaM(niv('rvRet')), outros: taxaM(niv('outRet')) };
      const cambio = ovr('cambio', cambioAnt * (1 + taxaM(niv('cambioVar'))));
      const aliq = { caixa: niv('irCaixa') / 100, rf: niv('irRf') / 100, rv: niv('irRv') / 100, outros: niv('irOut') / 100 };
      const caixaMin = niv('caixaMin');

      const rend = zeros();
      const ir = zeros();
      rend.caixa = Math.max(0, saldo.caixa) * r.caixa;
      rend.rf = saldo.rf * r.rf;
      rend.outros = saldo.outros * r.outros;
      for (const cls of ['caixa', 'rf', 'outros']) ir[cls] = Math.max(0, rend[cls]) * aliq[cls];
      const rvRendUSD = rvUSD * r.rv;
      ir.rv = Math.max(0, rvRendUSD) * cambio * aliq.rv;
      const rvAntesBRL = rvUSD * cambioAnt;
      rvUSD += rvRendUSD - ir.rv / cambio + ap.rv / cambio;
      rend.rv = rvUSD * cambio - rvAntesBRL - ap.rv + ir.rv;

      saldo.rf += rend.rf - ir.rf + ap.rf;
      saldo.outros += rend.outros - ir.outros + ap.outros;
      saldo.caixa += resultado - aporte + rend.caixa - ir.caixa;
      cambioAnt = cambio;
      fatorInf *= 1 + taxaM(infl);

      regs.push({
        mes: m, real: false, k, drv, rec, gas, ap, rend, ir, outrosMov: 0, cambio, fatorInf,
        saldo: { caixa: saldo.caixa, rf: saldo.rf, rv: rvUSD * cambio, outros: saldo.outros, bens: saldo.bens },
        alerta: saldo.caixa < caixaMin * gas.rec
      });
    }
    return regs;
  }

  // ---------- Carregar e salvar ----------
  async function carregarPremissas(primeiroProj) {
    try {
      const row = await q(sb.from('premissas_projecao').select('dados').eq('id', 'principal').maybeSingle());
      const dados = row && row.dados;
      return { p: migrarPremissas(dados, primeiroProj), tabelaFalta: false, migrado: !!(dados && dados.v !== 2) };
    } catch (err) {
      return { p: migrarPremissas(null, primeiroProj), tabelaFalta: true };
    }
  }
  let tSalvar;
  function agendarSalvar() {
    const P = state.proj;
    P.status = P.tabelaFalta ? 'sem-tabela' : 'pendente';
    atualizarStatusProj();
    if (P.tabelaFalta) return;
    clearTimeout(tSalvar);
    tSalvar = setTimeout(async () => {
      P.status = 'salvando'; atualizarStatusProj();
      try {
        await q(sb.from('premissas_projecao').upsert({ id: 'principal', dados: P.p, atualizado_em: new Date().toISOString() }, { onConflict: 'id' }));
        P.status = 'salvo';
      } catch (err) { P.status = 'erro'; P.erroSalvar = err.message; }
      atualizarStatusProj();
    }, 1200);
  }
  function atualizarStatusProj() {
    const el = document.getElementById('pj-status');
    if (!el) return;
    const P = state.proj;
    el.className = 'pj-status ' + (P.status || '');
    el.textContent = ({ pendente: 'alterações não salvas', salvando: 'salvando...', salvo: 'salvo',
      erro: 'erro ao salvar: ' + (P.erroSalvar || ''), 'sem-tabela': 'não salva: falta a tabela no Supabase' })[P.status] || '';
  }

  // ---------- Formatação ----------
  const fmtInt = (v) => {
    const r = Math.round(Number(v) || 0);
    if (r === 0) return '–';
    const s = Math.abs(r).toLocaleString('pt-BR');
    return r < 0 ? `(${s})` : s;
  };
  const fmtPct = (v) => (v == null || v === '' ? '' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
  const fmtCambio = (v) => (v == null ? '' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const lerNumero = (s) => {
    const t = String(s).trim().replace(/\s|R\$|%/g, '').replace(/^\((.*)\)$/, '-$1');
    if (t === '' || t === '–' || t === '-') return null;
    const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : (/^-?\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, '') : t));
    return Number.isFinite(n) ? n : null;
  };

  // ---------- Tela ----------
  async function renderProjecao(body) {
    if (!state.proj) {
      body.innerHTML = '<div class="empty">Carregando histórico e premissas...</div>';
      await carregarHistorico();
      const primeiroProj = addMeses(mesesDisponiveis().slice(-1)[0], 1);
      const pr = await carregarPremissas(primeiroProj);
      const anoUlt = mesesDisponiveis().slice(-1)[0].slice(0, 4);
      state.proj = { ...pr, status: pr.tabelaFalta ? 'sem-tabela' : '', visao: 'mes', desde: anoUlt, valores: 'nominal', fechados: new Set(['rend']) };
      if (pr.migrado) agendarSalvar();
    } else {
      await carregarHistorico();
    }
    const P = state.proj;
    body.innerHTML = `
      ${P.tabelaFalta ? `<div class="aviso">A tabela <code>premissas_projecao</code> ainda não existe no Supabase: as premissas funcionam, mas somem ao recarregar. Rode o SQL que acompanha o app e recarregue.</div>` : ''}
      <div id="proj-resumo"></div>
      <div class="chart-card" id="proj-grafico"></div>
      <div class="pj-barra" id="pj-barra"></div>
      <div class="pj-celula" id="pj-celula"><span class="muted">Clique numa célula azul para editar uma premissa. Digite e aperte Enter ou Tab.</span></div>
      <div id="proj-tabela"></div>`;
    renderBarraProj();
    recalcularProjecao();
  }

  function recalcularProjecao(foco) {
    const P = state.proj;
    if (!document.getElementById('proj-tabela')) return;
    const real = calcularRealizado(cacheHist, P.p);
    const proj = projetar(real, P.p);
    P.ultimo = { real, proj };
    const todos = [...real.regs, ...proj];
    const visiveis = todos.filter((r) => r.mes.slice(0, 4) >= P.desde);
    const defl = (r) => (P.valores === 'hoje' && !r.real ? r.fatorInf : 1);
    renderResumo(real, proj);
    renderGraficoPatrimonio(visiveis, real.regs[real.regs.length - 1].mes, defl);
    renderTabelaProj(visiveis, defl, real);
    if (foco) {
      const alvo = document.querySelector(`.pl input[data-linha="${foco.linha}"][data-mes="${foco.mes}"]`);
      if (alvo) { alvo.focus({ preventScroll: true }); alvo.select(); }
    }
  }

  const somaPat = (s) => s.caixa + s.rf + s.rv + s.outros;

  function renderResumo(real, proj) {
    const hoje = real.regs[real.regs.length - 1];
    const fim = proj[proj.length - 1];
    const alerta = proj.find((r) => r.alerta);
    const aportado = proj.reduce((a, r) => a + r.ap.rf + r.ap.rv + r.ap.outros, 0);
    const rendLiq = proj.reduce((a, r) => a + ['caixa', ...INVEST].reduce((b, c) => b + r.rend[c] - r.ir[c], 0), 0);
    document.getElementById('proj-resumo').innerHTML = `
      <div class="kpis">
        <div class="kpi"><div class="kpi-l">Patrimônio financeiro em ${esc(mesNome(hoje.mes))}</div>
          <div class="kpi-v num">${esc(fmt(somaPat(hoje.saldo)))}</div><div class="kpi-s muted">último mês realizado</div></div>
        <div class="kpi"><div class="kpi-l">Em ${esc(mesNome(fim.mes))}</div>
          <div class="kpi-v num">${esc(fmt(somaPat(fim.saldo)))}</div>
          <div class="kpi-s muted">${esc(fmt(somaPat(fim.saldo) / fim.fatorInf))} em valores de hoje</div></div>
        <div class="kpi"><div class="kpi-l">Até lá, de onde vem</div>
          <div class="kpi-v num" style="font-size:18px">${esc(fmt(aportado))}</div>
          <div class="kpi-s muted">aportados, mais ${esc(fmt(rendLiq))} de rendimento líquido de IR</div></div>
        <div class="kpi ${alerta ? 'kpi-alerta' : ''}"><div class="kpi-l">Caixa x mínimo</div>
          <div class="kpi-v" style="font-size:18px">${alerta ? 'Abaixo em ' + esc(mesNome(alerta.mes)) : 'Sempre acima'}</div>
          <div class="kpi-s muted">${alerta ? 'os aportes consomem o caixa' : 'no horizonte projetado'}</div></div>
      </div>`;
  }

  function renderGraficoPatrimonio(regs, mesUltimoReal, defl) {
    const el = document.getElementById('proj-grafico');
    if (!regs.length) { el.innerHTML = ''; return; }
    const W = Math.max(320, (el.clientWidth || 800) - 34), H = 210, esq = 44, dir = 12, topo = 14, base = 24;
    const n = regs.length;
    const x = (i) => esq + (n > 1 ? (i * (W - esq - dir)) / (n - 1) : 0);
    const pilhas = regs.map((r) => {
      const f = defl(r);
      let acc = 0;
      return CLASSES.map((c) => { const y0 = acc; acc += Math.max(0, r.saldo[c.id] / f); return [y0, acc]; });
    });
    const maxV = Math.max(1, ...pilhas.map((p) => p[p.length - 1][1]));
    const { topo: yMax, passo } = escalaBonita(maxV);
    const y = (v) => topo + (1 - v / yMax) * (H - topo - base);
    let svg = '';
    const iUlt = regs.findIndex((r) => r.mes === mesUltimoReal);
    if (iUlt >= 0 && iUlt < n - 1) svg += `<rect x="${x(iUlt)}" y="${topo}" width="${W - dir - x(iUlt)}" height="${H - topo - base}" class="proj-zona"/>`;
    for (let v = 0; v <= yMax + 0.001; v += passo) {
      svg += `<line x1="${esq}" x2="${W - dir}" y1="${y(v)}" y2="${y(v)}" class="grid"/>`;
      svg += `<text x="${esq - 6}" y="${y(v) + 4}" class="tick" text-anchor="end">${esc(emMil(v))}</text>`;
    }
    CLASSES.forEach((c, ci) => {
      const sup = pilhas.map((p, i) => `${x(i).toFixed(1)},${y(p[ci][1]).toFixed(1)}`);
      const inf = pilhas.map((p, i) => `${x(i).toFixed(1)},${y(p[ci][0]).toFixed(1)}`).reverse();
      svg += `<path d="M${sup.join('L')}L${inf.join('L')}Z" style="fill:${c.cor}" class="area"/>`;
    });
    const liquido = regs.map((r, i) => `${x(i).toFixed(1)},${y(Math.max(0, somaPat(r.saldo) / defl(r))).toFixed(1)}`);
    const temNegativo = regs.some((r) => r.saldo.caixa < 0);
    svg += `<path d="M${liquido.join('L')}" class="ln" style="stroke:var(--text);stroke-width:1.6"/>`;
    if (iUlt >= 0 && iUlt < n - 1) {
      svg += `<line x1="${x(iUlt)}" x2="${x(iUlt)}" y1="${topo - 4}" y2="${H - base}" class="guia"/>`;
      svg += `<text x="${x(iUlt) + 6}" y="${topo + 8}" class="tick">projetado →</text>`;
    }
    regs.forEach((r, i) => {
      if (r.mes.slice(5, 7) === '01' && (n <= 60 || Number(r.mes.slice(0, 4)) % 2 === 0)) {
        svg += `<text x="${x(i)}" y="${H - 6}" class="tick" text-anchor="middle">${r.mes.slice(0, 4)}</text>`;
      }
    });
    el.innerHTML = `
      <div class="chart-head"><div><h2>Patrimônio financeiro por classe</h2>
        <div class="meta muted">${state.proj.valores === 'hoje' ? 'Projetado em valores de hoje (descontada a inflação).' : 'Valores nominais.'} Não inclui imóvel e bens.</div></div></div>
      <div class="axis-title">R$ mil</div>
      <div class="chart-scroll"><svg class="linechart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Patrimônio por classe">${svg}</svg></div>
      <div class="chart-legend">${CLASSES.map((c) => `<span><i style="background:${c.cor}"></i>${esc(c.nome)}</span>`).join('')}
        <span><i style="background:var(--text);height:2px;vertical-align:3px"></i>Patrimônio financeiro${temNegativo ? ' (já descontado o caixa negativo)' : ''}</span></div>`;
  }

  function renderBarraProj() {
    const P = state.proj;
    const ultimoReal = mesesDisponiveis().slice(-1)[0];
    const primeiro = cacheHist.tx.length ? cacheHist.tx[0].data_competencia.slice(0, 4) : ultimoReal.slice(0, 4);
    const fim = Number(ultimoReal.slice(0, 4)) + Math.round(Number(P.p.horizonteAnos) || 1);
    const anos = [];
    for (let a = Number(primeiro); a <= fim; a++) anos.push(String(a));
    const el = document.getElementById('pj-barra');
    el.innerHTML = `
      <div class="seg seg-sm" role="radiogroup" aria-label="Agrupar por">
        ${[['mes', 'Mês'], ['tri', 'Trimestre'], ['ano', 'Ano']].map(([v, r]) => `<label><input type="radio" name="pj-visao" value="${v}" ${P.visao === v ? 'checked' : ''}><span>${r}</span></label>`).join('')}
      </div>
      <div class="seg seg-sm" role="radiogroup" aria-label="Valores">
        <label><input type="radio" name="pj-val" value="nominal" ${P.valores === 'nominal' ? 'checked' : ''}><span>Nominais</span></label>
        <label><input type="radio" name="pj-val" value="hoje" ${P.valores === 'hoje' ? 'checked' : ''}><span>De hoje</span></label>
      </div>
      <label class="check">Desde <select id="pj-desde">${anos.map((a) => `<option ${a === P.desde ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
      <span class="spacer"></span>
      <span class="pj-status" id="pj-status"></span>
      <button type="button" class="btn ghost btn-sm" id="pj-config">Configurações</button>`;
    el.querySelectorAll('input[name="pj-visao"]').forEach((r) => r.onchange = (e) => { P.visao = e.target.value; recalcularProjecao(); });
    el.querySelectorAll('input[name="pj-val"]').forEach((r) => r.onchange = (e) => { P.valores = e.target.value; recalcularProjecao(); });
    el.querySelector('#pj-desde').onchange = (e) => { P.desde = e.target.value; recalcularProjecao(); };
    el.querySelector('#pj-config').onclick = abrirConfigProj;
    atualizarStatusProj();
  }

  // ---------- Linhas do P&L ----------
  // tipo: 'calc' (só leitura), 'ovr' (fórmula com valor digitável), 'evento' (só no mês), 'nivel' (vale até mudar)
  // fmt: 'rs' | 'pct' | 'cambio' | 'mult' ; agg (trimestre/ano): 'soma' | 'fim' | 'comp' (variação composta)
  function linhasPL() {
    const receitas = (r) => Object.values(r.rec).reduce((a, b) => a + b, 0);
    const gastos = (r) => r.gas.rec + r.gas.saz;
    const aportado = (r) => r.ap.rf + r.ap.rv + r.ap.outros + r.ap.bens;
    const rendCaixaLiq = (r) => (r.real ? r.rend.caixa : r.rend.caixa - r.ir.caixa);
    const rendBruto = (r) => r.rend.caixa + r.rend.rf + r.rend.rv + r.rend.outros;
    const irTot = (r) => r.ir.caixa + r.ir.rf + r.ir.rv + r.ir.outros;
    const drv = (id) => (r) => r.drv[id];
    const L = (id, nome, tipo, get, o = {}) => ({ id, nome, tipo, get, fmt: 'rs', agg: 'soma', ...o });
    return [
      { grupo: 'rec', nome: 'Receitas', linhas: [
        L('sal', 'Salário', 'ovr', (r) => r.rec.salario),
        L('salVar', 'Variação do salário no mês', 'evento', drv('salVar'), { fmt: 'pct', agg: 'comp', sub: true }),
        L('decimo', '13º salário', 'ovr', (r) => r.rec.decimo),
        L('ferias', 'Férias (terço)', 'ovr', (r) => r.rec.ferias),
        L('bonusMult', 'Bônus ou PLR, em salários', 'evento', drv('bonusMult'), { fmt: 'mult', sub: true }),
        L('bonus', 'Bônus e PLR', 'ovr', (r) => r.rec.bonus),
        L('outrasRec', 'Outras receitas', 'nivel', (r) => r.rec.outras),
        L('extra', 'Receitas extraordinárias', 'ovr', (r) => r.rec.extra)
      ], total: ['Total de receitas', receitas] },
      { grupo: 'gas', nome: 'Gastos', linhas: [
        L('gasto', 'Gastos do dia a dia', 'ovr', (r) => r.gas.rec),
        L('gastoVar', 'Variação dos gastos no mês, além da inflação', 'evento', drv('gastoVar'), { fmt: 'pct', agg: 'comp', sub: true }),
        L('gastoPont', 'Gastos pontuais e sazonais', 'ovr', (r) => r.gas.saz)
      ], total: ['Total de gastos', gastos] },
      { destaque: ['Resultado', (r) => receitas(r) - gastos(r)] },
      { grupo: 'dest', nome: 'Destino do resultado', linhas: [
        L('pctInv', 'Parte do salário investida', 'nivel', drv('pctInv'), { fmt: 'pct', agg: 'fim', sub: true }),
        L('apRf', 'Aporte em renda fixa', 'ovr', (r) => r.ap.rf),
        L('pctRf', 'Para renda fixa, % do aporte', 'nivel', drv('pctRf'), { fmt: 'pct', agg: 'fim', sub: true }),
        L('apRv', 'Aporte em renda variável', 'ovr', (r) => r.ap.rv),
        L('pctRv', 'Para renda variável, % do aporte', 'nivel', drv('pctRv'), { fmt: 'pct', agg: 'fim', sub: true }),
        L('apOut', 'Aporte em outros', 'ovr', (r) => r.ap.outros),
        L('pctOut', 'Para outros, % do aporte', 'nivel', drv('pctOut'), { fmt: 'pct', agg: 'fim', sub: true }),
        L('apBens', 'Aporte em imóvel e bens', 'calc', (r) => r.ap.bens),
        L('rendCx', 'Rendimento líquido do caixa', 'calc', rendCaixaLiq),
        L('outMov', 'Outros movimentos', 'calc', (r) => r.outrosMov)
      ], total: ['Variação do caixa', (r) => receitas(r) - gastos(r) - aportado(r) + rendCaixaLiq(r) + r.outrosMov] },
      { grupo: 'pat', nome: 'Patrimônio no fim do período', linhas: [
        ...CLASSES.map((c) => L('sal_' + c.id, c.nome, 'calc', (r) => r.saldo[c.id], { agg: 'fim' })),
        L('caixaMin', 'Caixa mínimo, em meses de gasto', 'nivel', drv('caixaMin'), { fmt: 'mult', agg: 'fim', sub: true })
      ], total: ['Patrimônio financeiro', (r) => somaPat(r.saldo), 'fim'],
      extra: [L('bens', 'Imóvel e bens', 'calc', (r) => r.saldo.bens, { agg: 'fim' }),
        { ...L('patTot', 'Patrimônio total', 'calc', (r) => somaPat(r.saldo) + r.saldo.bens, { agg: 'fim' }), forte: true }] },
      { grupo: 'rend', nome: 'Rendimentos e IR', linhas: [
        L('rb', 'Rendimento bruto', 'calc', rendBruto),
        L('irv', 'IR estimado*', 'calc', (r) => -irTot(r))
      ], total: ['Rendimento líquido', (r) => rendBruto(r) - irTot(r)] },
      { grupo: 'merc', nome: 'Premissas de mercado', linhas: [
        L('cdi', 'CDI, % a.a.', 'nivel', drv('cdi'), { fmt: 'pct', agg: 'fim' }),
        L('caixaCdi', 'Caixa rende, % do CDI', 'nivel', drv('caixaCdi'), { fmt: 'pct', agg: 'fim' }),
        L('rfCdi', 'Renda fixa rende, % do CDI', 'nivel', drv('rfCdi'), { fmt: 'pct', agg: 'fim' }),
        L('rvRet', 'Renda variável, % a.a. em dólar', 'nivel', drv('rvRet'), { fmt: 'pct', agg: 'fim' }),
        L('outRet', 'Outros, % a.a.', 'nivel', drv('outRet'), { fmt: 'pct', agg: 'fim' }),
        L('cambio', 'Dólar, R$', 'ovr', (r) => r.cambio, { fmt: 'cambio', agg: 'fim' }),
        L('cambioVar', 'Variação do dólar, % a.a.', 'nivel', drv('cambioVar'), { fmt: 'pct', agg: 'fim' }),
        L('inflacao', 'Inflação, % a.a.', 'nivel', drv('inflacao'), { fmt: 'pct', agg: 'fim' }),
        L('irCaixa', 'IR do caixa, %', 'nivel', drv('irCaixa'), { fmt: 'pct', agg: 'fim' }),
        L('irRf', 'IR da renda fixa, %', 'nivel', drv('irRf'), { fmt: 'pct', agg: 'fim' }),
        L('irRv', 'IR da renda variável, %', 'nivel', drv('irRv'), { fmt: 'pct', agg: 'fim' }),
        L('irOut', 'IR de outros, %', 'nivel', drv('irOut'), { fmt: 'pct', agg: 'fim' })
      ] }
    ];
  }
  const EDITAVEL = new Set(['ovr', 'evento', 'nivel']);

  function renderTabelaProj(regs, defl, real) {
    const P = state.proj;
    const p = P.p;
    const porMes = P.visao === 'mes';
    const chave = (m) => (porMes ? m : P.visao === 'tri' ? m.slice(0, 4) + 'T' + Math.ceil(Number(m.slice(5, 7)) / 3) : m.slice(0, 4));
    const periodos = [];
    for (const r of regs) {
      const c = chave(r.mes);
      let per = periodos[periodos.length - 1];
      if (!per || per.chave !== c) { per = { chave: c, regs: [] }; periodos.push(per); }
      per.regs.push(r);
    }
    const rotulo = (per) => (porMes ? mesNome(per.chave) : P.visao === 'tri' ? per.chave.slice(5) + 'T' + per.chave.slice(2, 4) : per.chave);
    const tipoPer = (per) => (per.regs.every((r) => r.real) ? 'real' : per.regs.some((r) => r.real) ? 'misto' : 'proj');

    // valor de uma linha num período (R$ divididos pelo deflator quando em valores de hoje)
    const valor = (l, per) => {
      const rs = l.fmt === 'rs';
      const vals = per.regs.map((r) => { const v = l.get(r); return v == null ? null : (rs ? v / defl(r) : v); });
      const ok = vals.filter((v) => v != null);
      if (!ok.length) return null;
      if (l.agg === 'fim') return ok[ok.length - 1];
      if (l.agg === 'comp') return (ok.reduce((a, v) => a * (1 + v / 100), 1) - 1) * 100;
      return ok.reduce((a, v) => a + v, 0);
    };
    const texto = (l, v) => {
      if (v == null) return '';
      if (l.fmt === 'pct') return Math.abs(v) < 1e-9 && l.tipo === 'evento' ? '' : fmtPct(v);
      if (l.fmt === 'mult') return Math.abs(v) < 1e-9 && l.tipo === 'evento' ? '' : fmtPct(v);
      if (l.fmt === 'cambio') return fmtCambio(v);
      return fmtInt(v);
    };
    const explicito = (l, m) => celula(p, l.id, m) != null;

    const celulas = (l, cls) => periodos.map((per) => {
      const t = tipoPer(per);
      const v = valor(l, per);
      const negativo = l.fmt === 'rs' && v != null && v < -0.5;
      // Célula editável: visão mensal, mês projetado, linha de premissa
      if (porMes && t === 'proj' && EDITAVEL.has(l.tipo)) {
        const m = per.chave;
        const set = explicito(l, m);
        const herdado = l.tipo === 'nivel' && !set;
        const val = l.fmt === 'rs' && P.valores === 'hoje' ? per.regs[0] && l.get(per.regs[0]) : v; // edita sempre em valor nominal
        const mostra = l.fmt === 'rs' ? (val ? Math.round(val).toLocaleString('pt-BR') : '') : texto(l, val);
        return `<td class="proj ed ${set ? 'set' : ''} ${herdado ? 'herd' : ''} ${l.tipo}"><input type="text" inputmode="decimal"
          data-linha="${l.id}" data-mes="${m}" value="${esc(mostra)}" aria-label="${esc(l.nome)}, ${esc(mesNome(m))}"></td>`;
      }
      return `<td class="num ${t} ${cls || ''} ${negativo ? 'neg-v' : ''} ${l.sub ? 'drv' : ''}">${esc(l.fmt === 'rs' ? (v == null ? '' : fmtInt(v)) : texto(l, v))}</td>`;
    }).join('');
    const vazia = (l) => !EDITAVEL.has(l.tipo) && periodos.every((per) => { const v = valor(l, per); return v == null || Math.abs(v) < 0.5; });

    let html = '';
    for (const g of linhasPL()) {
      if (g.destaque) {
        const l = { fmt: 'rs', agg: 'soma', get: g.destaque[1] };
        html += `<tr class="t-destaque"><th scope="row">${esc(g.destaque[0])}</th>${celulas(l)}</tr>`;
        continue;
      }
      const fechado = P.fechados.has(g.grupo);
      html += `<tr class="t-grupo"><th scope="row"><button type="button" class="grupo-btn" data-grupo="${g.grupo}" aria-expanded="${!fechado}">${fechado ? '▸' : '▾'} ${esc(g.nome)}</button></th><td colspan="${periodos.length}"></td></tr>`;
      if (!fechado) {
        for (const l of g.linhas) {
          if (vazia(l)) continue;
          const ed = EDITAVEL.has(l.tipo);
          html += `<tr class="${l.sub ? 't-drv' : ''} ${ed ? 't-ed' : ''}"><th scope="row" class="t-linha ${l.sub ? 't-sub' : ''}" title="${esc(dicaLinha(l))}">${esc(l.nome)}</th>${celulas(l)}</tr>`;
        }
      }
      if (g.total) {
        const l = { fmt: 'rs', agg: g.total[2] || 'soma', get: g.total[1] };
        html += `<tr class="t-total"><th scope="row">${esc(g.total[0])}</th>${celulas(l)}</tr>`;
      }
      if (g.grupo === 'dest' && periodos.some((per) => per.regs.some((r) => r.alerta))) {
        html += `<tr class="t-alerta"><th scope="row" class="t-linha muted">Caixa x mínimo</th>${periodos.map((per) =>
          `<td class="${tipoPer(per)}">${per.regs.some((r) => r.alerta) ? '<span class="tag-alerta">abaixo</span>' : ''}</td>`).join('')}</tr>`;
      }
      if (g.extra) for (const l of g.extra) {
        if (!l.forte && vazia(l)) continue;
        html += `<tr class="${l.forte ? 't-total' : ''}"><th scope="row" class="${l.forte ? '' : 't-linha'}">${esc(l.nome)}</th>${celulas(l)}</tr>`;
      }
    }

    const cab = periodos.map((per) => {
      const t = tipoPer(per);
      return `<th class="${t}" scope="col">${esc(rotulo(per))}<span class="t-tag">${t === 'real' ? 'realizado' : t === 'misto' ? 'real + proj.' : 'projetado'}</span></th>`;
    }).join('');

    const el = document.getElementById('proj-tabela');
    const wrapAnt = el.querySelector('.pl-wrap');
    const rolagem = wrapAnt ? { x: wrapAnt.scrollLeft, y: wrapAnt.scrollTop } : null;
    el.innerHTML = `
      <div class="pl-wrap"><table class="pl ${porMes ? 'pl-mes' : ''}">
        <thead><tr><th scope="col" class="pl-canto">R$ ${P.valores === 'hoje' ? '(valores de hoje)' : ''}</th>${cab}</tr></thead>
        <tbody>${html}</tbody>
      </table></div>
      <p class="muted pl-nota">${porMes ? 'Células azuis são premissas: <b>negrito</b> é valor digitado; cinza é valor herdado do mês anterior ou da fórmula. Apagar o conteúdo volta para o padrão.'
        : 'Para editar premissas, use a visão Mês. Aqui os percentuais mostram o valor no fim do período; as variações aparecem acumuladas.'}
      ${P.valores === 'hoje' && porMes ? ' Com "De hoje" ligado, as células editáveis continuam em valores nominais.' : ''}<br>
      * No realizado, o IR é só estimativa: os saldos continuam brutos. "Outros movimentos" concilia o caixa realizado com repasses, saldos iniciais e dinheiro em trânsito.</p>`;
    const wrap = el.querySelector('.pl-wrap');
    if (rolagem) { wrap.scrollLeft = rolagem.x; }
    else {
      const primeiroProj = el.querySelector('thead th.proj, thead th.misto');
      if (primeiroProj) {
        const rotuloW = el.querySelector('thead th.pl-canto').offsetWidth;
        wrap.scrollLeft = Math.max(0, primeiroProj.offsetLeft - rotuloW - 2 * primeiroProj.offsetWidth);
      }
    }
    el.querySelectorAll('[data-grupo]').forEach((b) => b.onclick = () => {
      const id = b.dataset.grupo;
      if (P.fechados.has(id)) P.fechados.delete(id); else P.fechados.add(id);
      recalcularProjecao();
    });
    const barraCel = document.getElementById('pj-celula');
    if (barraCel) barraCel.hidden = !porMes;
    ligarCelulas(el);
    void real;
  }

  function dicaLinha(l) {
    return ({
      ovr: 'Calculado pela fórmula; digite um valor num mês para substituir.',
      evento: 'Vale só no mês em que for digitado.',
      nivel: 'Vale a partir do mês digitado até ser trocado.',
      calc: 'Calculado.'
    })[l.tipo] || '';
  }

  // ---------- Edição das células ----------
  function linhaPorId(id) {
    for (const g of linhasPL()) for (const l of [...(g.linhas || []), ...(g.extra || [])]) if (l.id === id) return l;
    return null;
  }
  function gravarCelula(id, m, v) {
    const p = state.proj.p;
    if (v == null) { if (p.celulas[id]) delete p.celulas[id][m]; }
    else (p.celulas[id] = p.celulas[id] || {})[m] = v;
    if (p.celulas[id] && !Object.keys(p.celulas[id]).length) delete p.celulas[id];
  }
  function mesesProjetados() {
    const ult = mesesDisponiveis().slice(-1)[0];
    const n = Math.round(Number(state.proj.p.horizonteAnos) || 1) * 12;
    const out = [];
    for (let k = 1; k <= n; k++) out.push(addMeses(ult, k));
    return out;
  }

  function ligarCelulas(el) {
    const barra = document.getElementById('pj-celula');
    const inputs = el.querySelectorAll('.pl input[data-linha]');
    inputs.forEach((inp) => {
      inp.addEventListener('focus', () => { inp.select(); mostrarBarraCelula(barra, inp.dataset.linha, inp.dataset.mes); });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); moverFoco(inp, e.shiftKey ? -1 : 1); inp.blur(); }
        else if (e.key === 'Escape') { inp.value = inp.defaultValue; inp.blur(); }
      });
      inp.addEventListener('change', () => {
        const v = lerNumero(inp.value);
        if (inp.value.trim() !== '' && v == null) { inp.value = inp.defaultValue; toast('Número inválido'); return; }
        gravarCelula(inp.dataset.linha, inp.dataset.mes, v);
        agendarSalvar();
        // espera o foco ir para a próxima célula e redesenha mantendo esse foco
        setTimeout(() => {
          const a = document.activeElement;
          const foco = a && a.dataset && a.dataset.linha ? { linha: a.dataset.linha, mes: a.dataset.mes } : proximoFoco;
          proximoFoco = null;
          recalcularProjecao(foco);
        }, 0);
      });
    });
  }
  let proximoFoco = null;
  function moverFoco(inp, passo) {
    const linha = inp.dataset.linha;
    const lista = [...document.querySelectorAll(`.pl input[data-linha="${linha}"]`)];
    const i = lista.indexOf(inp);
    const alvo = lista[i + passo];
    proximoFoco = alvo ? { linha, mes: alvo.dataset.mes } : null;
    if (alvo) alvo.focus();
  }

  function mostrarBarraCelula(barra, id, m) {
    const l = linhaPorId(id);
    if (!l) return;
    const p = state.proj.p;
    const tem = celula(p, id, m) != null;
    const tipoTexto = { ovr: 'fórmula com valor digitável', evento: 'vale só neste mês', nivel: 'vale deste mês em diante, até mudar' }[l.tipo];
    barra.innerHTML = `
      <span><b>${esc(l.nome)}</b> · ${esc(mesLongo(m))} <span class="muted">(${esc(tipoTexto)})</span></span>
      <span class="spacer"></span>
      ${l.tipo !== 'nivel' ? '<button type="button" class="link" data-acao="anual">Repetir este valor todo ano neste mês</button>' : ''}
      ${l.tipo === 'evento' || l.tipo === 'ovr' ? '<button type="button" class="link" data-acao="todos">Repetir em todos os meses seguintes</button>' : ''}
      ${tem ? '<button type="button" class="link" data-acao="limpar">Voltar ao padrão</button>' : ''}
      ${p.celulas[id] ? '<button type="button" class="link" data-acao="limparLinha">Limpar a linha</button>' : ''}`;
    barra.querySelectorAll('[data-acao]').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
    barra.querySelectorAll('[data-acao]').forEach((b) => b.onclick = () => {
      const inp = document.querySelector(`.pl input[data-linha="${id}"][data-mes="${m}"]`);
      let v = inp ? lerNumero(inp.value) : celula(p, id, m);
      if (v == null) v = celula(p, id, m);
      const acao = b.dataset.acao;
      if (acao === 'limpar') gravarCelula(id, m, null);
      else if (acao === 'limparLinha') delete p.celulas[id];
      else if (v != null) {
        gravarCelula(id, m, v);
        for (const mm of mesesProjetados()) {
          if (mm <= m) continue;
          if (acao === 'todos' || (acao === 'anual' && mm.slice(5, 7) === m.slice(5, 7))) gravarCelula(id, mm, v);
        }
      }
      agendarSalvar();
      recalcularProjecao({ linha: id, mes: m });
      mostrarBarraCelula(barra, id, m);
    });
  }

  // ---------- Configurações (o que não é célula) ----------
  function abrirConfigProj() {
    const P = state.proj;
    const p = P.p;
    const catsEntrada = state.categorias.filter((k) => k.tipo === 'entrada' && !k.interna).sort((a, b) => a.nome.localeCompare(b.nome));
    const salSel = new Set(p.salarioCats || catsEntrada.filter((k) => /sal[aá]rio/i.test(k.nome)).map((k) => k.id));
    const contasOrd = state.contas.slice().sort((a, b) => (b.ativo - a.ativo) || a.nome.localeCompare(b.nome));
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="cfg-t" style="max-width:600px">
        <header><h2 id="cfg-t">Configurações da projeção</h2><button class="close" type="button" aria-label="Fechar">×</button></header>
        <div class="cfg">
          <label class="pm"><span>Horizonte da projeção</span><span class="pm-in"><input id="cfg-h" type="text" inputmode="numeric" value="${esc(String(p.horizonteAnos))}"><i>anos</i></span></label>
          <h3>Categorias que contam como salário</h3>
          <div class="cfg-grid">${catsEntrada.map((k) => `<label class="pm-check"><input type="checkbox" data-salcat="${k.id}" ${salSel.has(k.id) ? 'checked' : ''}> ${esc(k.nome)}</label>`).join('')}</div>
          <h3>Contas por classe</h3>
          <div class="cfg-contas">${contasOrd.map((c) => `<label class="pm"><span class="${c.ativo ? '' : 'muted'}">${esc(c.nome)}${c.moeda !== 'BRL' ? ` (${esc(c.moeda)})` : ''}</span>
            <select data-classe="${c.id}">${CLASSES_CONTA.map((k) => `<option value="${k.id}" ${classeDe(c, p) === k.id ? 'selected' : ''}>${esc(k.nome)}</option>`).join('')}</select></label>`).join('')}</div>
          <h3>Valores de partida das premissas</h3>
          <p class="muted" style="margin:0 0 6px;font-size:13px">Valem até você digitar outro valor numa célula. Salário, gasto e dólar partem do realizado (média dos últimos 3 meses, média dos últimos 12 meses e última cotação).</p>
          <div class="cfg-grid">${Object.keys(NIVEIS_PADRAO).map((id) => {
            const l = linhaPorId(id);
            return l ? `<label class="pm"><span>${esc(l.nome)}</span><span class="pm-in"><input type="text" inputmode="decimal" data-nivel="${id}" value="${esc(fmtPct(p.niveis[id]))}"></span></label>` : '';
          }).join('')}</div>
          <div class="actions">
            <button type="button" class="btn danger" id="cfg-zerar">Apagar todas as premissas digitadas</button>
            <span class="spacer"></span>
            <button type="button" class="btn" id="cfg-ok">Aplicar</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(back);
    const fechar = () => back.remove();
    back.querySelector('.close').onclick = fechar;
    back.addEventListener('click', (e) => { if (e.target === back) fechar(); });
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });
    back.querySelector('#cfg-zerar').onclick = () => {
      if (!confirm('Apagar todas as células digitadas? Os valores de partida continuam.')) return;
      p.celulas = {};
      fechar(); agendarSalvar(); recalcularProjecao();
    };
    back.querySelector('#cfg-ok').onclick = () => {
      const h = Math.round(lerNumero(back.querySelector('#cfg-h').value) || 0);
      if (h >= 1 && h <= 50) p.horizonteAnos = h;
      const marcadas = [...back.querySelectorAll('[data-salcat]:checked')].map((x) => x.dataset.salcat);
      p.salarioCats = marcadas;
      back.querySelectorAll('[data-classe]').forEach((s) => {
        const c = conta(s.dataset.classe);
        if (s.value === classePadrao(c)) delete p.classes[c.id]; else p.classes[c.id] = s.value;
      });
      back.querySelectorAll('[data-nivel]').forEach((i) => { const v = lerNumero(i.value); if (v != null) p.niveis[i.dataset.nivel] = v; });
      fechar(); agendarSalvar(); renderBarraProj(); recalcularProjecao();
    };
  }

  // ---------- Formulário de lançamento ----------
  // Transferências: os dois lados ficam ligados por transferencia_par_id (cada um aponta para o outro),
  // e editar ou apagar age sempre no par inteiro.
  const CAT_TRANSF = 'Transferencia entre contas';
  const catTransf = (tipoCat) => (state.categorias.find((c) => c.nome === CAT_TRANSF && c.tipo === tipoCat)
    || state.categorias.find((c) => c.nome === CAT_TRANSF) || {}).id;

  async function abrirForm(t) {
    const editando = !!t;

    // Se for um lado de transferência ligada, busca o outro lado.
    let par = null;
    if (t && t.transferencia_par_id) {
      try {
        const outro = await q(sb.from('transacoes')
          .select('id, conta_id, categoria_id, data_competencia, valor, moeda, descricao, tipo, transferencia_par_id')
          .eq('id', t.transferencia_par_id).maybeSingle());
        if (outro) par = t.tipo === 'saida' ? { saida: t, entrada: outro } : { saida: outro, entrada: t };
      } catch (err) {
        toast('Não foi possível carregar o outro lado da transferência');
        return;
      }
    }
    const editandoTransf = !!par;
    const transfSolta = editando && !par && (categoria(t.categoria_id) || {}).nome === CAT_TRANSF;

    const ativas = state.contas.filter((c) => c.ativo
      || (t && c.id === t.conta_id)
      || (par && (c.id === par.saida.conta_id || c.id === par.entrada.conta_id)));
    const opcoesConta = (sel) => ativas.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.nome)} (${esc(c.moeda)})</option>`).join('');
    const tipoInicial = editandoTransf ? 'transf' : (t ? t.tipo : 'saida');
    const fmtCampo = (v) => (v == null ? '' : String(v).replace('.', ','));

    // Descrição automática não é reaproveitada na edição: é refeita com os nomes das contas escolhidas.
    let descInicial = t ? (t.descricao || '') : '';
    if (editandoTransf) {
      const nomeDestino = (conta(par.entrada.conta_id) || {}).nome;
      descInicial = par.saida.descricao === 'Transferência para ' + nomeDestino ? '' : (par.saida.descricao || '');
    }

    const radios = editandoTransf
      ? '<label><input type="radio" name="tipo" value="transf" checked><span>Transferência</span></label>'
      : `<label><input type="radio" name="tipo" value="saida" ${tipoInicial === 'saida' ? 'checked' : ''}><span>Gasto</span></label>
         <label><input type="radio" name="tipo" value="entrada" ${tipoInicial === 'entrada' ? 'checked' : ''}><span>Receita</span></label>
         ${editando ? '' : '<label><input type="radio" name="tipo" value="transf"><span>Transferência</span></label>'}`;

    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-titulo">
        <header><h2 id="m-titulo">${editandoTransf ? 'Editar transferência' : (editando ? 'Editar lançamento' : 'Novo lançamento')}</h2>
          <button class="close" type="button" aria-label="Fechar">×</button></header>
        <form novalidate>
          <div class="seg" role="radiogroup" aria-label="Tipo">${radios}</div>
          ${transfSolta ? '<p class="muted" style="margin:0;font-size:13px">Este lançamento é um lado de uma transferência antiga, sem ligação com o outro lado. Alterar ou apagar mexe só nele.</p>' : ''}
          <div class="two">
            <div class="field"><label for="m-valor">Valor</label><input id="m-valor" inputmode="decimal" placeholder="0,00" value="${esc(fmtCampo(editandoTransf ? par.saida.valor : (t && t.valor)))}"></div>
            <div class="field"><label for="m-data">Data</label><input id="m-data" type="date" value="${esc(editandoTransf ? par.saida.data_competencia : (t ? t.data_competencia : hoje()))}"></div>
          </div>
          <div class="field" id="w-conta"><label for="m-conta">Conta</label><select id="m-conta">${opcoesConta(t && !editandoTransf ? t.conta_id : '')}</select></div>
          <div class="field" id="w-cat"><label for="m-cat">Categoria</label><select id="m-cat"></select></div>
          <div class="two" id="w-transf" hidden>
            <div class="field"><label for="m-origem">Sai de</label><select id="m-origem">${opcoesConta(editandoTransf ? par.saida.conta_id : '')}</select></div>
            <div class="field"><label for="m-destino">Entra em</label><select id="m-destino">${opcoesConta(editandoTransf ? par.entrada.conta_id : '')}</select></div>
          </div>
          <div class="field" id="w-valor2" hidden><label for="m-valor2">Valor recebido (moeda do destino)</label><input id="m-valor2" inputmode="decimal" placeholder="0,00" value="${esc(editandoTransf ? fmtCampo(par.entrada.valor) : '')}"></div>
          <div class="field"><label for="m-desc">Descrição</label><input id="m-desc" maxlength="200" value="${esc(descInicial)}"></div>
          <div class="form-error" id="m-erro"></div>
          <div class="actions">
            ${editando ? '<button class="btn danger" type="button" id="m-apagar">Apagar</button><span class="spacer"></span>' : ''}
            <button class="btn ghost" type="button" id="m-cancelar">Cancelar</button>
            <button class="btn" type="submit" id="m-salvar">${editando ? 'Salvar alterações' : 'Registrar'}</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(back);

    const $ = (sel) => back.querySelector(sel);
    const fechar = () => back.remove();
    $('.close').onclick = fechar;
    $('#m-cancelar').onclick = fechar;
    back.addEventListener('click', (e) => { if (e.target === back) fechar(); });
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(); });

    const tipo = () => back.querySelector('input[name="tipo"]:checked').value;

    function atualizarCampos() {
      const tp = tipo();
      const transf = tp === 'transf';
      $('#w-conta').hidden = transf;
      $('#w-cat').hidden = transf;
      $('#w-transf').hidden = !transf;
      if (!transf) {
        const cats = state.categorias.filter((c) => c.tipo === tp).sort((a, b) => a.nome.localeCompare(b.nome));
        const sel = t && t.tipo === tp ? t.categoria_id : '';
        $('#m-cat').innerHTML = cats.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
      }
      const o = conta($('#m-origem').value);
      const d = conta($('#m-destino').value);
      $('#w-valor2').hidden = !(transf && o && d && o.moeda !== d.moeda);
    }
    back.querySelectorAll('input[name="tipo"]').forEach((r) => r.addEventListener('change', atualizarCampos));
    if (!editandoTransf && ativas.length > 1) $('#m-destino').selectedIndex = 1;
    $('#m-origem').onchange = atualizarCampos;
    $('#m-destino').onchange = atualizarCampos;
    atualizarCampos();
    setTimeout(() => $('#m-valor').focus(), 30);

    // Aceita "1.234,56", "1234,56", "35.98" e "1.234". Com vírgula, o ponto é milhar;
    // sem vírgula, o ponto é decimal, exceto no formato de milhar (1.234 ou 12.345.678).
    const lerValor = (s) => {
      let txt = String(s).trim().replace(/\s|R\$/g, '');
      if (!txt) return NaN;
      if (txt.includes(',')) txt = txt.replace(/\./g, '').replace(',', '.');
      else if (/^\d{1,3}(\.\d{3})+$/.test(txt)) txt = txt.replace(/\./g, '');
      if (!/^\d+(\.\d+)?$/.test(txt)) return NaN;
      const v = Number(txt);
      return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
    };

    $('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const erro = $('#m-erro');
      erro.textContent = '';
      const valor = lerValor($('#m-valor').value);
      const data = $('#m-data').value;
      const descricao = $('#m-desc').value.trim() || null;
      if (!(valor > 0)) { erro.textContent = 'Informe um valor maior que zero (ex.: 35,98).'; return; }
      if (!data) { erro.textContent = 'Informe a data.'; return; }

      const btn = $('#m-salvar');
      btn.disabled = true;
      try {
        const tp = tipo();
        if (tp === 'transf') {
          const o = conta($('#m-origem').value);
          const d = conta($('#m-destino').value);
          if (!o || !d || o.id === d.id) throw new Error('Escolha duas contas diferentes.');
          let valorDestino = valor;
          if (o.moeda !== d.moeda) {
            valorDestino = lerValor($('#m-valor2').value);
            if (!(valorDestino > 0)) throw new Error('Informe o valor recebido na moeda do destino.');
          }
          if (!catTransf('saida')) throw new Error('A categoria "' + CAT_TRANSF + '" não foi encontrada.');

          const idSaida = editandoTransf ? par.saida.id : crypto.randomUUID();
          const idEntrada = editandoTransf ? par.entrada.id : crypto.randomUUID();
          const linhas = [
            { id: idSaida, transferencia_par_id: idEntrada, conta_id: o.id, categoria_id: catTransf('saida'),
              data_competencia: data, valor, moeda: o.moeda, tipo: 'saida',
              descricao: descricao || 'Transferência para ' + d.nome },
            { id: idEntrada, transferencia_par_id: idSaida, conta_id: d.id, categoria_id: catTransf('entrada'),
              data_competencia: data, valor: valorDestino, moeda: d.moeda, tipo: 'entrada',
              descricao: descricao || 'Transferência de ' + o.nome }
          ];
          // Uma única chamada grava os dois lados juntos: ou os dois entram, ou nenhum.
          if (editandoTransf) {
            await q(sb.from('transacoes').upsert(linhas, { onConflict: 'id' }));
            toast('Transferência atualizada');
          } else {
            await q(sb.from('transacoes').insert(linhas));
            toast('Transferência registrada');
          }
        } else {
          const c = conta($('#m-conta').value);
          const catId = $('#m-cat').value;
          if (!c) throw new Error('Escolha a conta.');
          if (!catId) throw new Error('Escolha a categoria.');
          const registro = { conta_id: c.id, categoria_id: catId, data_competencia: data, valor, moeda: c.moeda, tipo: tp, descricao };
          if (editando) {
            await q(sb.from('transacoes').update(registro).eq('id', t.id));
            toast('Alterações salvas');
          } else {
            await q(sb.from('transacoes').insert(registro));
            toast('Lançamento registrado');
          }
        }
        fechar();
        await recarregar();
      } catch (err) {
        erro.textContent = err.message;
        btn.disabled = false;
      }
    });

    if (editando) {
      $('#m-apagar').onclick = async () => {
        const texto = editandoTransf
          ? 'Apagar esta transferência? Os dois lados (saída e entrada) serão apagados. Não dá para desfazer.'
          : 'Apagar este lançamento? Não dá para desfazer.';
        if (!confirm(texto)) return;
        try {
          const ids = editandoTransf ? [par.saida.id, par.entrada.id] : [t.id];
          await q(sb.from('transacoes').delete().in('id', ids));
          toast(editandoTransf ? 'Transferência apagada' : 'Lançamento apagado');
          fechar();
          await recarregar();
        } catch (err) { $('#m-erro').textContent = err.message; }
      };
    }
  }

  async function recarregar() {
    cacheTransacoes.clear();
    cacheHist = null;
    await carregarBase();
    renderShell();
  }

  // O gráfico de linhas é desenhado na largura da tela: redesenha ao girar o celular ou redimensionar a janela.
  let tResize;
  window.addEventListener('resize', () => {
    clearTimeout(tResize);
    tResize = setTimeout(() => {
      const el = document.getElementById('g-gastos');
      if (el && state.graf && state.graf.gastos && state.graf.gastos.modo === 'linhas') montarGrafico(el, 'gastos');
      if (document.getElementById('proj-grafico') && state.proj && state.proj.ultimo) recalcularProjecao();
    }, 200);
  });

  // ---------- Início ----------
  window.addEventListener('hashchange', () => { if (state.user) renderShell(); });

  // Erro devolvido pelo link do e-mail (ex.: link expirado ou já usado)
  const erroLink = (() => {
    const h = new URLSearchParams(location.hash.replace(/^#\/?/, ''));
    const qs = new URLSearchParams(location.search);
    const msg = h.get('error_description') || qs.get('error_description');
    return msg ? 'O link não funcionou: ' + msg.replace(/\+/g, ' ') + '. Peça um novo link.' : '';
  })();

  async function entrar(user) {
    state.user = user;
    app.innerHTML = '<div class="login"><div class="login-card"><p>Carregando suas finanças...</p></div></div>';
    try {
      await carregarBase();
      if (location.hash.includes('access_token') || location.hash.includes('error')) {
        history.replaceState(null, '', location.pathname + '#/painel');
      }
      renderShell();
    } catch (err) {
      renderLogin('Você entrou, mas os dados não carregaram: ' + err.message +
        '. Confira se este e-mail é o mesmo do script de segurança.');
    }
  }

  // As consultas ficam fora do callback de autenticação para não travar a sessão.
  sb.auth.onAuthStateChange((_evento, session) => {
    const user = session ? session.user : null;
    setTimeout(() => {
      if (user && (!state.user || state.user.id !== user.id)) entrar(user);
      else if (!user) { state.user = null; renderLogin(erroLink); }
    }, 0);
  });
})();
