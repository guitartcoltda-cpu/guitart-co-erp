/* ============================================================
   Configuração de ambiente do Guitart & Co.

   Deixe SUPABASE_URL e SUPABASE_ANON_KEY vazios ("") para o sistema
   rodar 100% offline (localStorage), exatamente como a versão baixada
   em zip — é o padrão deste arquivo.

   Para ligar o sistema ao Supabase (modo online, com dados
   compartilhados entre todos os aparelhos), preencha os dois valores
   abaixo com o que aparece em Supabase → Project Settings → API:
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
