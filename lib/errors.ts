// Mensagem padrão para falha de comunicação com o backend (Edge Function,
// REST direto via Supabase client, ou qualquer fetch) quando não há uma
// mensagem mais específica para o contexto — ver CLAUDE.md, "Falha de
// comunicação com o backend".
export const BACKEND_ERROR_MESSAGE =
  "Não foi possível conectar ao servidor. Tente novamente em instantes.";
