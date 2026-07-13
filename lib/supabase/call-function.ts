import { createClient } from "@/lib/supabase/client";
import { BACKEND_ERROR_MESSAGE } from "@/lib/errors";

// Wrapper fino sobre supabase.functions.invoke(): sempre checa o campo
// `error` explicitamente (nunca só o caminho feliz de `data` — ver
// CLAUDE.md, "Falha de comunicação com o backend") e traduz o corpo JSON de
// erro da Edge Function (`{ error: "mensagem amigável" }`, ver "Edge
// Functions nunca vazam erro técnico ao cliente") numa Error com essa
// mensagem, com fallback pro texto padrão de falha de comunicação.
export async function callFunction<T>(
  name: string,
  // `object` em vez de `Record<string, unknown>` — aceita tanto um literal
  // inline quanto uma variável de um tipo/interface nomeado (ex:
  // CommunicationFormValues em communications/), que TS não trata como
  // atribuível a um tipo com index signature explícito mesmo quando
  // estruturalmente compatível.
  body?: object,
): Promise<T> {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke(name, { body: body ?? {} });

  if (error) {
    let message = BACKEND_ERROR_MESSAGE;
    const context = (error as { context?: Response }).context;
    if (context) {
      try {
        const payload = await context.clone().json();
        if (payload?.error) message = payload.error;
      } catch {
        // mantém a mensagem genérica
      }
    }
    throw new Error(message);
  }

  return data as T;
}
