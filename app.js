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

  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const state = {
    user: null,
    contas: [],
    categorias: [],
    posicao: [],
    meses: [],
    filtros: { mes: null, conta: '', categoriaNome: '' },
    mostrarEncerrados: false
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
  const proximoMes = (iso) => {
    const d = new Date(iso + 'T12:00:00');
    d.setMonth(d.getMonth() + 1, 1);
    return d.toISOString().slice(0, 10);
  };
  const hoje = () => new Date().toISOString().slice(0, 10);

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
        options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true }
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
    { id: 'investimentos', nome: 'investimentos', topico: 'Quanto você aplicou, quanto rendeu e quanto vale hoje' }
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
      <div class="shell" id="shell">
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
            <button class="menu-btn" type="button" id="menu" aria-label="Abrir menu">☰</button>
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
    document.getElementById('menu').onclick = () => document.getElementById('shell').classList.toggle('nav-open');
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
      else await renderInvestimentos(body);
    } catch (err) {
      body.innerHTML = `<div class="empty">Não foi possível carregar os dados: ${esc(err.message)}. Recarregue a página; se continuar, saia e entre de novo.</div>`;
    }
  }

  function renderRota() { renderShell(); }

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
      .select('id, conta_id, categoria_id, data_competencia, valor, moeda, descricao, tipo')
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
          ${nomesCat.map((c) => `<option value="${c.nome}" ${f.categoriaNome === c.nome ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select>
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

  // ---------- Formulário de lançamento ----------
  function abrirForm(t) {
    const editando = !!t;
    const ativas = state.contas.filter((c) => c.ativo || (t && c.id === t.conta_id));
    const opcoesConta = (sel) => ativas.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.nome)} (${esc(c.moeda)})</option>`).join('');
    const tipoInicial = t ? t.tipo : 'saida';

    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="m-titulo">
        <header><h2 id="m-titulo">${editando ? 'Editar lançamento' : 'Novo lançamento'}</h2>
          <button class="close" type="button" aria-label="Fechar">×</button></header>
        <form novalidate>
          <div class="seg" role="radiogroup" aria-label="Tipo">
            <label><input type="radio" name="tipo" value="saida" ${tipoInicial === 'saida' ? 'checked' : ''}><span>Gasto</span></label>
            <label><input type="radio" name="tipo" value="entrada" ${tipoInicial === 'entrada' ? 'checked' : ''}><span>Receita</span></label>
            ${editando ? '' : '<label><input type="radio" name="tipo" value="transf"><span>Transferência</span></label>'}
          </div>
          <div class="two">
            <div class="field"><label for="m-valor">Valor</label><input id="m-valor" inputmode="decimal" placeholder="0,00" value="${t ? String(t.valor).replace('.', ',') : ''}"></div>
            <div class="field"><label for="m-data">Data</label><input id="m-data" type="date" value="${t ? t.data_competencia : hoje()}"></div>
          </div>
          <div class="field" id="w-conta"><label for="m-conta">Conta</label><select id="m-conta">${opcoesConta(t ? t.conta_id : '')}</select></div>
          <div class="field" id="w-cat"><label for="m-cat">Categoria</label><select id="m-cat"></select></div>
          <div class="two" id="w-transf" hidden>
            <div class="field"><label for="m-origem">Sai de</label><select id="m-origem">${opcoesConta('')}</select></div>
            <div class="field"><label for="m-destino">Entra em</label><select id="m-destino">${opcoesConta('')}</select></div>
          </div>
          <div class="field" id="w-valor2" hidden><label for="m-valor2">Valor recebido (moeda do destino)</label><input id="m-valor2" inputmode="decimal" placeholder="0,00"></div>
          <div class="field"><label for="m-desc">Descrição</label><input id="m-desc" maxlength="200" value="${t ? esc(t.descricao || '') : ''}"></div>
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
    if (ativas.length > 1) $('#m-destino').selectedIndex = 1;
    $('#m-origem').onchange = atualizarCampos;
    $('#m-destino').onchange = atualizarCampos;
    atualizarCampos();
    setTimeout(() => $('#m-valor').focus(), 30);

    const lerValor = (s) => {
      const v = Number(String(s).trim().replace(/\./g, '').replace(',', '.'));
      return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
    };

    $('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const erro = $('#m-erro');
      const valor = lerValor($('#m-valor').value);
      const data = $('#m-data').value;
      const descricao = $('#m-desc').value.trim() || null;
      if (!(valor > 0)) { erro.textContent = 'Informe um valor maior que zero.'; return; }
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
          const catT = (tipoCat) => (state.categorias.find((c) => c.nome === 'Transferencia entre contas' && c.tipo === tipoCat)
            || state.categorias.find((c) => c.nome === 'Transferencia entre contas') || {}).id;
          if (!catT('saida')) throw new Error('A categoria "Transferencia entre contas" não foi encontrada.');
          await q(sb.from('transacoes').insert([
            { conta_id: o.id, categoria_id: catT('saida'), data_competencia: data, valor, moeda: o.moeda, tipo: 'saida',
              descricao: descricao || 'Transferência para ' + d.nome },
            { conta_id: d.id, categoria_id: catT('entrada'), data_competencia: data, valor: valorDestino, moeda: d.moeda, tipo: 'entrada',
              descricao: descricao || 'Transferência de ' + o.nome }
          ]));
          toast('Transferência registrada');
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
        if (!confirm('Apagar este lançamento? Não dá para desfazer.')) return;
        try {
          await q(sb.from('transacoes').delete().eq('id', t.id));
          toast('Lançamento apagado');
          fechar();
          await recarregar();
        } catch (err) { $('#m-erro').textContent = err.message; }
      };
    }
  }

  async function recarregar() {
    await carregarBase();
    renderShell();
  }

  // ---------- Início ----------
  window.addEventListener('hashchange', () => { if (state.user) renderShell(); });

  sb.auth.onAuthStateChange(async (_evento, session) => {
    const user = session ? session.user : null;
    if (user && (!state.user || state.user.id !== user.id)) {
      state.user = user;
      app.innerHTML = '<div class="login"><div class="login-card"><p>Carregando suas finanças...</p></div></div>';
      try {
        await carregarBase();
        renderShell();
      } catch (err) {
        renderLogin('Entrou, mas não foi possível ler os dados: ' + err.message);
      }
    } else if (!user) {
      state.user = null;
      renderLogin();
    }
  });
})();
