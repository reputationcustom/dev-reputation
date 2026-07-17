// Avatar circular com fallback de iniciais — primitivo compartilhado
// (components/ui/*, mesmo padrão de Spinner/Tooltip/etc.). Primeiro
// consumidor é /perfil (CLAUDE.md, redesenho da página) — feito genérico
// o bastante (tamanho configurável, sem nada específico de perfil) pra
// ser reaproveitado em qualquer lugar que precise mostrar o avatar de um
// usuário no futuro (ex: sidebar, lista de membros), sem duplicar a
// lógica de iniciais/fallback.
function initialsFromName(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

const SIZE_CLASSES = {
  sm: "h-8 w-8 text-xs",
  md: "h-12 w-12 text-sm",
  lg: "h-20 w-20 text-xl",
  xl: "h-28 w-28 text-2xl",
} as const;

export function Avatar({
  name,
  avatarUrl,
  size = "md",
  className = "",
}: {
  name: string | null;
  avatarUrl?: string | null;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
}) {
  const sizeClass = SIZE_CLASSES[size];

  if (avatarUrl) {
    return (
      /* Mesmo precedente já usado pelo logo (sidebar.tsx): avatar é uma
       * URL pública de um único arquivo, sem domínio remoto configurado
       * em next/image, não justifica o setup extra pra este caso. */
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name ?? "Avatar"}
        className={`flex-shrink-0 rounded-full object-cover ${sizeClass} ${className}`}
      />
    );
  }

  return (
    <div
      className={`flex flex-shrink-0 items-center justify-center rounded-full bg-accent-blue-bg font-bold text-accent-blue ${sizeClass} ${className}`}
      aria-hidden="true"
    >
      {initialsFromName(name)}
    </div>
  );
}
