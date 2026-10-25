# REGRAS DO SISTEMA

Documento de referência do projeto. Atualize sempre que uma regra mudar.

## 1. Estrutura
| Pasta/arquivo | Função |
|---|---|
| `app_usuario/` | Portal do cliente (login por CNPJ) |
| `painel Admin/` | Painel do escritório (1 admin controla tudo) |
| `server.js` | Servidor + API (sem dependências, Node 18+) |
| `supabase.sql` | Cria tabelas e bucket privado `uploads` |
| `render.yaml` / `DEPLOY.md` | Publicação no Render |
| `.env` | Segredos locais (**nunca** vai ao GitHub) |

## 2. Acesso e perfis
- **Cliente:** login = CNPJ (somente números ou com máscara). Senha provisória **123456**.
- **Cada cliente vê apenas os próprios dados.** O servidor identifica o cliente pela sessão; nunca confie em ID enviado pelo navegador.
- **Admin:** usuário `admin`. Senha inicial vem de `ADMIN_PASSWORD` (padrão `admin123`) **somente na 1ª criação**; depois é alterada em *Config* e fica no Supabase.
- Sessão expira em 12 h. Bloquear cliente = marcar como *Bloqueado* em Clientes.
- Senhas são guardadas com hash (scrypt), nunca em texto puro.
- Nova senha do cliente: mínimo 6 caracteres e diferente de `123456`.

## 3. Cadastro de clientes
- CNPJ obrigatório, **válido** e **único**.
- Regimes: MEI, Simples Nacional, Lucro Presumido, Lucro Real, Outros.
- Cliente novo nasce com senha provisória; o admin envia o acesso (link + CNPJ + senha) pelo menu **Cadastrar usuário** ou botão **Acesso**.
- **Resetar senha** volta para 123456.
- Excluir cliente apaga também seus boletos, arquivos e chamados (irreversível).

## 4. Boletos
- Campos: descrição, competência, valor (> 0), vencimento, código de barras, PIX copia e cola, anexo (PDF/imagem).
- Situação é calculada: **A vencer**, **Vencido** (vencimento < hoje e não pago) e **Pago**.
- O cliente escolhe como pagar: copiar PIX, copiar código de barras, visualizar ou baixar o boleto.
- Só o admin marca como pago / desfaz.

## 5. Arquivos
- Limite de **20 MB** por arquivo.
- Origem registrada: *Escritório* ou *Cliente*.
- O cliente pode excluir **somente** o que ele mesmo enviou.
- Armazenados no bucket privado `uploads` do Supabase; download só pelo servidor, após validar o dono.

## 6. Chamados
- Status: **Aberto → Em análise → Aguardando cliente → Concluído**.
- Admin altera status e escreve a **observação** (visível ao cliente). Tudo vai para o histórico.
- Cliente pode complementar enquanto não estiver *Concluído*; se estava *Aguardando cliente*, volta para *Em análise*.
- Protocolo no formato `CH00001`.

## 7. Segurança
- Chave `service_role`/`sb_secret_...` fica **só no servidor** (`.env` / variáveis do Render). Se vazar, gere outra.
- Tabelas com RLS ligado e sem policies: o acesso público direto ao banco é bloqueado.
- Trocar a senha do admin logo no primeiro acesso.
- Faça backup periódico (Supabase → Database → Backups).

## 8. Desenvolvimento e publicação
- Fluxo: alterar código → testar local (`node server.js`) → `git push` na `main` → Render publica sozinho.
- Sem as variáveis do Supabase o sistema usa `data/` local (apenas para testes).
- Mudou estrutura de dados? Atualize `supabase.sql` e este documento.
- Layout deve funcionar no celular (tabelas viram cartões em telas pequenas).

## 9. Links (produção)
- Cliente: https://sandcontabilidade.onrender.com/
- Admin: https://sandcontabilidade.onrender.com/admin/
