// supabase/functions/update-entity/index.ts
//
// Edge Function autossuficiente (Princípio técnico 5) — .dev/specs/entities/
// entity-registration.md, passos 6-8. Dois usos do mesmo endpoint:
// 1) edição completa do formulário — `accounts`/`tags` sempre presentes
//    (mesmo `[]`) e substituem por completo o conjunto já cadastrado
//    (delete-all + reinsert, sem diff campo a campo — ver "Fluxo
//    principal" item 6);
// 2) Desativar/Reativar — só `{ id, is_active }`, sem `accounts`/`tags` no
//    corpo, então nenhuma das duas tabelas é tocada (chave ausente ≠ `[]`).
//
// Mesmo padrão de auth (chave secreta + Bearer token) de create-entity.

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
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return jsonResponse({ error: "Entidade não informada." }, 400);

    const updateFields: Record<string, unknown> = { updated_by: caller.id };

    if (body.type !== undefined) {
      if (!VALID_ENTITY_TYPES.includes(body.type)) return jsonResponse({ error: "Selecione um tipo." }, 400);
      updateFields.type = body.type;
    }
    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return jsonResponse({ error: "Informe um nome." }, 400);
      updateFields.name = name;
    }
    if (body.cargo !== undefined) {
      updateFields.cargo = typeof body.cargo === "string" && body.cargo.trim() ? body.cargo.trim() : null;
    }
    if (body.partido !== undefined) {
      updateFields.partido = typeof body.partido === "string" && body.partido.trim() ? body.partido.trim() : null;
    }
    if (body.ideologia !== undefined) {
      updateFields.ideologia =
        typeof body.ideologia === "string" && body.ideologia.trim() ? body.ideologia.trim() : null;
    }
    if (body.photo_url !== undefined) {
      updateFields.photo_url =
        typeof body.photo_url === "string" && body.photo_url.trim() ? body.photo_url.trim() : null;
    }
    if (body.influence_level !== undefined) {
      updateFields.influence_level =
        typeof body.influence_level === "string" && VALID_INFLUENCE_LEVELS.includes(body.influence_level)
          ? body.influence_level
          : null;
    }
    if (body.is_active !== undefined) {
      updateFields.is_active = body.is_active === true;
    }

    let accountsResult: { accounts: { platform: string; username: string; url: string | null }[] } | { error: string } | null = null;
    if (body.accounts !== undefined) {
      accountsResult = parseAccounts(body.accounts);
      if ("error" in accountsResult) return jsonResponse({ error: accountsResult.error }, 400);
    }

    let tagsResult: { tags: { tag_type: string; tag_value: string }[] } | { error: string } | null = null;
    if (body.tags !== undefined) {
      tagsResult = parseTags(body.tags);
      if ("error" in tagsResult) return jsonResponse({ error: tagsResult.error }, 400);
    }

    const { error: entityError } = await supabaseAdmin.from("entities").update(updateFields).eq("id", id);
    if (entityError) {
      console.error("[update-entity] entities update failed", entityError);
      return jsonResponse({ error: "Não foi possível salvar. Tente novamente." }, 500);
    }

    if (accountsResult && !("error" in accountsResult)) {
      const { error: deleteAccountsError } = await supabaseAdmin
        .from("entity_accounts")
        .delete()
        .eq("entity_id", id);
      if (deleteAccountsError) {
        console.error("[update-entity] entity_accounts delete failed", deleteAccountsError);
        return jsonResponse({ error: "Não foi possível salvar as contas informadas." }, 500);
      }

      if (accountsResult.accounts.length > 0) {
        const { error: insertAccountsError } = await supabaseAdmin
          .from("entity_accounts")
          .insert(accountsResult.accounts.map((account) => ({ ...account, entity_id: id })));

        if (insertAccountsError) {
          console.error("[update-entity] entity_accounts insert failed", insertAccountsError);
          if (insertAccountsError.code === "23505") {
            const conflict = parseUniqueHandleConflict(insertAccountsError.details as string | undefined);
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
    }

    if (tagsResult && !("error" in tagsResult)) {
      const { error: deleteTagsError } = await supabaseAdmin.from("entity_tags").delete().eq("entity_id", id);
      if (deleteTagsError) {
        console.error("[update-entity] entity_tags delete failed", deleteTagsError);
        return jsonResponse({ error: "Não foi possível salvar as classificações informadas." }, 500);
      }

      if (tagsResult.tags.length > 0) {
        const { error: insertTagsError } = await supabaseAdmin
          .from("entity_tags")
          .insert(tagsResult.tags.map((tag) => ({ ...tag, entity_id: id })));

        if (insertTagsError) {
          console.error("[update-entity] entity_tags insert failed", insertTagsError);
          return jsonResponse({ error: "Não foi possível salvar as classificações informadas." }, 500);
        }
      }
    }

    return jsonResponse({ success: true });
  } catch (err) {
    console.error("[update-entity] handler failed", err);
    return jsonResponse({ error: "Algo deu errado. Tente novamente." }, 500);
  }
});
