// supabase/functions/update-finops-manual-cost/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5) — módulo `finops`.
// Edita um custo extra já cadastrado. Admin-only, mesma validação de
// create-finops-manual-cost (duplicada — Princípio técnico 5, sem import
// entre funções).

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const VALID_RECURRENCES = ["one_time", "monthly", "annual"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "");
    if (!token) return jsonResponse({ error: "Não autenticado." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const secretKey =
      Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(supabaseUrl, secretKey);

    const {
      data: { user: caller },
      error: callerError,
    } = await supabaseAdmin.auth.getUser(token);
    if (callerError || !caller) return jsonResponse({ error: "Não autenticado." }, 401);

    const { data: callerProfile } = await supabaseAdmin
      .from("user_profiles")
      .select("is_admin")
      .eq("id", caller.id)
      .single();

    if (!callerProfile?.is_admin) {
      return jsonResponse({ error: "Acesso restrito a administradores." }, 403);
    }

    const body = await req.json();
    const id = body.id;
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const amountUsd = Number(body.amount_usd);
    const recurrence = body.recurrence;
    const effectiveDate = body.effective_date;
    const endDate = body.end_date ?? null;

    if (typeof id !== "string" || !id) {
      return jsonResponse({ error: "Custo extra não identificado." }, 400);
    }
    if (!description) {
      return jsonResponse({ error: "Descrição é obrigatória." }, 400);
    }
    if (!Number.isFinite(amountUsd) || amountUsd < 0) {
      return jsonResponse({ error: "Valor deve ser um número maior ou igual a zero." }, 400);
    }
    if (!VALID_RECURRENCES.includes(recurrence)) {
      return jsonResponse({ error: "Recorrência inválida." }, 400);
    }
    if (typeof effectiveDate !== "string" || !DATE_PATTERN.test(effectiveDate)) {
      return jsonResponse({ error: "Data efetiva inválida." }, 400);
    }
    if (endDate !== null && (typeof endDate !== "string" || !DATE_PATTERN.test(endDate))) {
      return jsonResponse({ error: "Data de término inválida." }, 400);
    }
    if (endDate !== null && endDate < effectiveDate) {
      return jsonResponse({ error: "Data de término não pode ser anterior à data efetiva." }, 400);
    }

    const { error } = await supabaseAdmin
      .from("manual_costs")
      .update({
        description,
        amount_usd: amountUsd,
        recurrence,
        effective_date: effectiveDate,
        end_date: endDate,
      })
      .eq("id", id);

    if (error) {
      console.error("[update-finops-manual-cost] update failed", error);
      return jsonResponse({ error: "Não foi possível salvar. Tente novamente." }, 500);
    }

    return jsonResponse({ ok: true });
  } catch (err) {
    console.error("[update-finops-manual-cost] handler failed", err);
    return jsonResponse({ error: "Não foi possível salvar. Tente novamente." }, 500);
  }
});
