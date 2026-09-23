# Minhas finanças

App pessoal de finanças: site estático (HTML, CSS e JavaScript) publicado no GitHub Pages e conectado ao Supabase.

**Dono e uso:** pessoal, um único usuário.
**Dados:** contas, transações, categorias, investimentos e snapshots, guardados no Supabase.
**Acesso:** login por link enviado ao e-mail (Supabase Auth). O RLS do banco só libera leitura e escrita para o seu e-mail.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | Página do app |
| `styles.css` | Visual |
| `app.js` | Telas e acesso aos dados |
| `config.js` | URL e chave pública do Supabase (você preenche) |

## Passo a passo para publicar

### 1. Preencher o `config.js`
No Supabase, em **Project Settings → API**, copie:
- **Project URL** para `SUPABASE_URL`;
- a chave **anon public** para `SUPABASE_ANON_KEY`.

Nunca use a chave `service_role`: ela ignora o RLS e daria acesso total ao banco.

### 2. Subir no GitHub
1. Crie um repositório (no plano gratuito, o GitHub Pages exige repositório público).
2. Envie os quatro arquivos para a raiz do repositório (botão **Add file → Upload files**).
3. Em **Settings → Pages**, escolha **Deploy from a branch**, branch `main`, pasta `/ (root)`, e salve.
4. Depois de um ou dois minutos, o endereço aparece nessa mesma tela, no formato `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/`.

### 3. Informar o endereço ao Supabase
Em **Authentication → URL Configuration**:
- **Site URL:** o endereço do GitHub Pages;
- **Redirect URLs:** adicione o mesmo endereço.

Sem isso, o link enviado por e-mail não traz você de volta ao app.

### 4. Primeiro acesso e bloqueio de novos cadastros
1. Abra o app, digite o seu e-mail (o mesmo do RLS) e clique no link que chegar.
2. Depois de entrar, no Supabase, em **Authentication → Sign In / Providers**, desative **Allow new users to sign up**.

## Segurança

- O código e a chave `anon` ficam públicos no GitHub, o que é esperado: quem protege os dados é o RLS, ligado em todas as tabelas, que só aceita o seu e-mail.
- As views usam `security_invoker = true`, então também respeitam o RLS.
- O app não guarda nenhum dado no navegador além da sessão de login do Supabase.

## Telas

- **# painel:** patrimônio, receitas × gastos dos últimos 6 meses, principais gastos do mês e saldos.
- **# transações:** lançamentos do mês, agrupados por dia, com filtros por conta e categoria. Clique em um lançamento para editar ou apagar.
- **# cartões:** fatura em aberto e últimas compras de cada cartão.
- **# investimentos:** aplicado, rendimento e valor atual de cada investimento, com opção de ver os encerrados.

O campo na parte de baixo de cada tela registra gastos, receitas e transferências entre contas (inclusive o pagamento de fatura, que é uma transferência da conta para o cartão).
