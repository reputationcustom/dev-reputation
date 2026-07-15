// supabase/functions/create-entity/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5, .dev/specs/_index.md)
// — sem import relativo de `_shared/`. Implementa o passo 5 do fluxo
// principal de .dev/specs/entities/entity-registration.md: cadastro de uma
// Entity (Cadastro Nacional de Entidades) + suas contas por
// plataforma/classificações adicionais.
//
// Chave secreta + Bearer token (não publicável+JWT como communications) —
// mesmo padrão já usado por todo admin-*/create-finops-manual-cost deste
// projeto para telas restritas a is_admin: RLS (is_current_user_admin())
// já garante o mesmo do lado do banco, a chave secreta aqui é só o padrão
// já estabelecido pelas outras telas /admin, não uma exceção nova.

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

const VALID_ENTITY_TYPES = ["person", "media_outlet", "party", "institution", "company", "movement", "other"];
const VALID_INFLUENCE_LEVELS = ["low", "medium", "high", "critical"];

interface AccountInput {
  platform?: string;
  username?: string;
  url?: string | null;
}

interface TagInput {
  tag_type?: string;
  tag_value?: string;
}

// Linhas incompletas (só plataforma OU só usuário preenchido) são um erro
// de validação, não silenciosamente ignoradas — mesma regra do "Fluxos
// alternativos e erros" da spec. Linhas totalmente vazias são descartadas
// (o form sempre manda uma linha extra vazia pronta pra edição).
function parseAccounts(raw: unknown): { accounts: { platform: string; username: string; url: string | null }[] } | { error: string } {
  if (!Array.isArray(raw)) return { accounts: [] };
  const accounts: { platform: string; username: string; url: string | null }[] = [];
  for (const item of raw as AccountInput[]) {
    const platform = typeof item?.platform === "string" ? item.platform.trim() : "";
    const username = typeof item?.username === "string" ? item.username.trim() : "";
    const url = typeof item?.url === "string" && item.url.trim() ? item.url.trim() : null;
    if (!platform && !username) continue;
    if (!platform || !username) {
      return { error: "Preencha plataforma e usuário em toda conta informada, ou remova a linha." };
    }
    accounts.push({ platform, username, url });
  }
  return { accounts };
}

function parseTags(raw: unknown): { tags: { tag_type: string; tag_value: string }[] } | { error: string } {
  if (!Array.isArray(raw)) return { tags: [] };
  const tags: { tag_type: string; tag_value: string }[] = [];
  for (const item of raw as TagInput[]) {
    const tagType = typeof item?.tag_type === "string" ? item.tag_type.trim() : "";
    const tagValue = typeof item?.tag_value === "string" ? item.tag_value.trim() : "";
    if (!tagType && !tagValue) continue;
    if (!tagType || !tagValue) {
      return { error: "Preencha a dimensão e o valor em toda classificação informada, ou remova a linha." };
    }
    tags.push({ tag_type: tagType, tag_value: tagValue });
  }
  return { tags };
}

// Traduz a violação de entity_accounts_unique_handle (23505) numa mensagem
// amigável, identificando a linha específica quando possível (Postgres
// inclui o par no detalhe: 'Key (platform, username)=(twitter, foo) already
// exists.') — nunca o erro cru do Postgres pro cliente (regra global "Edge
// Function error handling").
function parseUniqueHandleConflict(detail: string | null | undefined): { platform: string; username: string } | null {
  if (!detail) return null;
  const match = detail.match(/Key \(platform, username\)=\(([^,]+), ([^)]+)\)/);
  if (!match) return null;
  return { platform: match[1], username: match[2] };
}

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

    const body = await req.json().catch(() => ({}));

    const type = typeof body.type === "string" ? body.type : "";
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!VALID_ENTITY_TYPES.includes(type)) return jsonResponse({ error: "Selecione um tipo." }, 400);
    if (!name) return jsonResponse({ error: "Informe um nome." }, 400);

    const influenceLevel =
      typeof body.influence_level === "string" && VALID_INFLUENCE_LEVELS.includes(body.influence_level)
        ? body.influence_level
        : null;

    const accountsResult = parseAccounts(body.accounts);
    if ("error" in accountsResult) return jsonResponse({ error: accountsResult.error }, 400);
    const tagsResult = parseTags(body.tags);
    if ("error" in tagsResult) return jsonResponse({ error: tagsResult.error }, 400);

    const { data: entity, error: entityError } = await supabaseAdmin
      .from("entities")
      .insert({
        type,
        name,
        cargo: typeof body.cargo === "string" && body.cargo.trim() ? body.cargo.trim() : null,
        partido: typeof body.partido === "string" && body.partido.trim() ? body.partido.trim() : null,
        ideologia: typeof body.ideologia === "string" && body.ideologia.trim() ? body.ideologia.trim() : null,
        photo_url: typeof body.photo_url === "string" && body.photo_url.trim() ? body.photo_url.trim() : null,
        influence_level: influenceLevel,
        created_by: caller.id,
        updated_by: caller.id,
      })
      .select("id")
      .single();

    if (entityError) {
      console.error("[create-entity] entities insert failed", entityError);
      return jsonResponse({ error: "Não foi possível salvar. Tente novamente." }, 500);
    }

    const entityId = entity.id;

    if (accountsResult.accounts.length > 0) {
      const { error: accountsError } = await supabaseAdmin
        .from("entity_accounts")
        .insert(accountsResult.accounts.map((account) => ({ ...account, entity_id: entityId })));

      if (accountsError) {
        console.error("[create-entity] entity_accounts insert failed", accountsError);
        if (accountsError.code === "23505") {
          const conflict = parseUniqueHandleConflict(accountsError.details as string | undefined);
          return jsonResponse(
            {
              error: "Este usuário já está cadastrado em outra Entidade nesta plataforma.",
              conflict_account: conflict,
            },
            409,
          );
        }
        return jsonResponse({ error: "Não foi possível salvar as contas informadas." }, 500);
      }
    }

    if (tagsResult.tags.length > 0) {
      const { error: tagsError } = await supabaseAdmin
        .from("entity_tags")
        .insert(tagsResult.tags.map((tag) => ({ ...tag, entity_id: entityId })));

      if (tagsError) {
        console.error("[create-entity] entity_tags insert failed", tagsError);
        return jsonResponse({ error: "Não foi possível salvar as classificações informadas." }, 500);
      }
    }

    return jsonResponse({ success: true, id: entityId });
  } catch (err) {
    console.error("[create-entity] handler failed", err);
    return jsonResponse({ error: "Algo deu errado. Tente novamente." }, 500);
  }
});
