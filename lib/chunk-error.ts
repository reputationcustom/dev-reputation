const RELOAD_GUARD_KEY = "chunk-error-reload-attempted";

export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === "ChunkLoadError" ||
    /Loading chunk [\w.-]+ failed/.test(error.message) ||
    /Loading CSS chunk [\w.-]+ failed/.test(error.message)
  );
}

// Hostinger sobrescreve _next/static/chunks/ inteiro a cada deploy (sem
// manter a build anterior coexistindo, ver CLAUDE.md "Deploy (Hostinger)").
// Uma aba já aberta antes de um deploy referencia hashes de chunk que não
// existem mais no servidor assim que tenta um import() dinâmico (ex: uma
// rota lazy-loaded) — resulta em 404 + ChunkLoadError. Um hard reload busca
// o HTML novo com as referências corretas. O guard em sessionStorage evita
// um loop de reload infinito caso o erro persista por outro motivo.
export function reloadOnceForChunkError(): boolean {
  if (typeof window === "undefined") return false;
  if (window.sessionStorage.getItem(RELOAD_GUARD_KEY)) return false;
  window.sessionStorage.setItem(RELOAD_GUARD_KEY, "1");
  window.location.reload();
  return true;
}
