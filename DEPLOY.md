# Colocar online (Render)

1. Acesse https://render.com e entre com sua conta GitHub (gratuito).
2. **New +** → **Blueprint** → escolha o repositório `boramobioficial/contador` → **Apply**.
   (ou **New + → Web Service**: Build vazio, Start `node server.js`.)
3. Quando pedir as variáveis, preencha:
   - `SUPABASE_URL` = `https://uhnkslaqljsqhvqnwgvh.supabase.co`
   - `SUPABASE_SERVICE_KEY` = sua chave secreta (`sb_secret_...`)
   - `ADMIN_PASSWORD` = senha inicial do painel admin
4. Aguarde o deploy. O Render mostra o link, ex.: `https://contador.onrender.com`
   - App do cliente: `https://contador.onrender.com/`
   - Painel admin: `https://contador.onrender.com/admin/`
5. Esse é o link que você envia aos clientes (a tela "Acesso" do painel já usa o endereço certo).

Observações
- Plano gratuito "dorme" após ~15 min sem uso; o primeiro acesso demora ~30 s. Plano pago remove isso.
- Cada `git push` na branch `main` publica automaticamente.
- Nunca suba o `.env` para o GitHub.
