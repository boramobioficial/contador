# Sistema Contábil

Portal do cliente (`app_usuario/`) + painel administrativo (`painel Admin/`) + servidor (`server.js`, sem dependências).

## Rodar
1. Node 18+ instalado.
2. Copie `.env.example` para `.env` e preencha (sem Supabase, usa arquivos locais em `data/`).
3. `node server.js`
   - App do cliente: `/`  |  Painel admin: `/admin/`

## Supabase
1. SQL Editor → rode o conteúdo de `supabase.sql` (cria tabelas e bucket privado `uploads`).
2. Settings → API → copie **Project URL** e a chave **service_role** para o `.env`.
3. Nunca coloque a `service_role` no GitHub nem no navegador.

## Acesso
- Cliente: login = CNPJ, senha provisória `123456`.
- Admin: usuário `admin`, senha = `ADMIN_PASSWORD` (padrão `admin123` se não definida). Troque em Config.

## Hospedagem (Render, Railway, etc.)
Build: nenhum · Start: `node server.js` · Variáveis: as do `.env`.
