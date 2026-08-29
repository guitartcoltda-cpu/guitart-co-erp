/* ============================================================
   Configuração de ambiente do Guitart & Co.

   Chaves de conexão com o Supabase (banco de dados real, compartilhado
   entre todos os aparelhos/pessoas que usam o sistema) — sem elas o
   sistema não tem como carregar nem salvar nada (ver assets/js/db.js).
   Valores em Supabase → Project Settings → API:
     - SUPABASE_URL      -> campo "Project URL"
     - SUPABASE_ANON_KEY -> campo "anon public" (a chave pública, NUNCA
                              a "service_role", que é secreta)
   Esses dois valores são seguros para ficar num arquivo público do
   site — são feitos pra isso (a proteção de verdade fica nas regras
   de acesso configuradas dentro do Supabase).
   ============================================================ */

window.ENV = {
  SUPABASE_URL: "https://gtdhpvorzpqjqnrumosv.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_OrRgw8DlDdkpSpXcQ40PEw_iamNThsy"
};
