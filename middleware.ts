import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Única verificação de "usuário logado" do produto (.dev/specs/auth/login.md,
// "Proteção de rota") — nenhuma página reimplementa esta checagem.
const PUBLIC_ROUTES = ["/login", "/forgot-password", "/reset-password"];

// Página que mostra "não foi possível conectar ao backend" (ver CLAUDE.md,
// "Falha de comunicação com o Supabase no middleware", 2026-07-16) — precisa
// sempre renderizar, mesmo com o Supabase inteiramente fora do ar, então
// nunca passa pelo bloco de auth abaixo (mesmo bypass de "/").
const BACKEND_UNAVAILABLE_ROUTE = "/backend-unavailable";

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // "/" nunca pode redirecionar no servidor — é a rota de health check da
  // Hostinger, que exige HTTP 200 sem redirect (ver CLAUDE.md, "Deploy
  // (Hostinger) — regras globais"). app/page.tsx é client component e faz
  // o redirect de fato, via router.replace() depois do HTML já ter
  // respondido 200. "/backend-unavailable" é para onde este middleware
  // redireciona quando a checagem abaixo falha — checar auth aqui de novo
  // reabriria o mesmo problema que a rota existe para contornar.
  if (pathname === "/" || pathname === BACKEND_UNAVAILABLE_ROUTE) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!supabaseUrl || !supabasePublishableKey) {
      throw new Error(
        "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY não configuradas."
      );
    }

    const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const isPublicRoute = PUBLIC_ROUTES.some(
      (route) => pathname === route || pathname.startsWith(`${route}/`)
    );

    if (!user && !isPublicRoute) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      redirectUrl.search = "";
      redirectUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(redirectUrl);
    }

    if (user && pathname === "/login") {
      const redirectUrl = request.nextUrl.clone();
      const next = request.nextUrl.searchParams.get("next");
      redirectUrl.pathname = next && next.startsWith("/") ? next : "/overview";
      redirectUrl.search = "";
      return NextResponse.redirect(redirectUrl);
    }

    return response;
  } catch (error) {
    // Falha de comunicação com o Supabase (rede/DNS/timeout) ou variável de
    // ambiente ausente — nunca deixa o middleware quebrar com uma exceção
    // não tratada. Isso NÃO é coberto por app/error.tsx (que só captura
    // exceções de Server Component sob o layout raiz) — middleware roda
    // antes de qualquer render, então uma exceção aqui resultaria na
    // página de erro genérica/interna do Next.js, não na mensagem amigável
    // do produto. O detalhe técnico completo só vai pro log do servidor
    // (nunca pro usuário, mesmo princípio de "Edge Function error
    // handling" do CLAUDE.md aplicado aqui); o usuário é redirecionado
    // para uma página estática que sempre renderiza, mesmo com o backend
    // inteiro fora do ar.
    console.error("[middleware] backend_unavailable", error);
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = BACKEND_UNAVAILABLE_ROUTE;
    redirectUrl.search = "";
    redirectUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectUrl);
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
