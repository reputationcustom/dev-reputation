"use client";

import { useLayoutEffect, useRef, useState } from "react";

// Componente compartilhado — pedido do usuário (2026-07-14, em 5 widgets de
// síntese de IA diferentes): "se a descrição for maior que cabe no frame,
// inclua a opção mostrar mais e mostrar menos." Mede se o texto de fato
// transborda o clamp (`scrollHeight > clientHeight`) antes de mostrar
// qualquer botão — um texto curto o bastante pra caber no clamp nunca
// ganha um toggle à toa (nada a "mostrar mais").
export function ExpandableText({
  text,
  maxLines = 4,
  className = "text-sm leading-relaxed text-text-primary",
}: {
  text: string;
  maxLines?: number;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text, maxLines]);

  return (
    <div className="flex flex-col gap-2">
      <p
        ref={ref}
        className={className}
        style={
          expanded
            ? undefined
            : { display: "-webkit-box", WebkitLineClamp: maxLines, WebkitBoxOrient: "vertical", overflow: "hidden" }
        }
      >
        {text}
      </p>
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="self-start text-xs font-semibold text-accent-blue hover:underline"
        >
          {expanded ? "Mostrar menos" : "Mostrar mais"}
        </button>
      )}
    </div>
  );
}
