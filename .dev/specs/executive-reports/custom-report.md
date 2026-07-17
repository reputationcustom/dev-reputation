---
tipo: feature-spec
módulo: executive-reports
funcionalidade: custom-report
status: pronto
atualizado: 2026-07-17
---

# Relatório Personalizado

## Objetivo

"Sugira algo que dê liberdade para o usuário extrair informações em texto
e em gráficos" — pedido explícito do usuário, desenho em aberto por
decisão dele. Diferente do Relatório Executivo (conteúdo fixo, IA sempre
presente), o Relatório Personalizado é um **construtor**: o usuário
escolhe período, quais blocos de dado incluir (qualquer combinação de
KPIs/gráficos/tabelas já disponíveis no produto), se quer ou não um
parágrafo gerado por IA, e pode escrever suas próprias observações em
texto livre — tudo montado numa prévia antes de exportar em PDF.

## Usuários afetados

Mesmo público do Relatório Executivo — qualquer usuário autenticado,
membro de ao menos uma organização.

## Fluxo principal — construtor de relatório

1. Usuário acessa `/reports/custom` pelo item "Relatório Personalizado".
2. **Passo 1 — Identificação**: título do relatório (texto livre,
   pré-preenchido com "Relatório Personalizado — \<período\>"), período
   (mesmos 2 campos de data do Relatório Executivo, `period.mode:
   'custom'`).
3. **Passo 2 — Seleção de conteúdo** (checklist, não arrastar-e-soltar —
   ver "Fora de escopo"): lista de seções disponíveis, cada uma com uma
   checkbox e um rótulo curto do que ela mostra:
   - KPIs principais
   - Sentimento geral (barra positivo/neutro/negativo)
   - Sentimento por plataforma
   - Sentimento por pauta
   - Evolução de volume e sentimento no tempo (gráfico de linha)
   - Tabela de Narrativas (top por risco)
   - Ranking de autores e influenciadores
   - Termos em destaque (positivos/negativos)
   - Eventos do radar no período
   - Resumo executivo gerado por IA (opt-in — ver "Regras de negócio")

   Pelo menos 1 seção precisa estar marcada para habilitar a prévia (não
   faz sentido gerar um PDF vazio).
4. **Passo 3 — Notas do usuário**: uma caixa de texto livre (`<textarea>`,
   sem limite rígido além de um razoável de UI, ex: 5000 caracteres) — o
   espaço para o próprio usuário escrever sua análise/comentário,
   incluído no PDF como uma seção própria ("Notas") antes do rodapé. Este
   é o "texto" que o usuário pode extrair por conta própria, sem depender
   da IA.
5. Botão **"Gerar prévia"**: busca o envelope (`get-page-reports-custom`,
   todos os blocos de uma vez — ver `data-model.md`) e, só se a seção
   "Resumo executivo gerado por IA" estiver marcada, chama
   `compose-narrative-synthesis` (`section: 'executive_summary'`, a
   mesma seção Camada 2 do Relatório Executivo, reaproveitada — não uma
   terceira variante de prompt). Renderiza a prévia mostrando **só** as
   seções marcadas no passo 2, sempre na mesma ordem fixa da lista acima
   (nenhuma UI de reordenação — ver "Fora de escopo"), seguida das notas
   do usuário.
6. Botão **"Baixar PDF"** — mesmo mecanismo do Relatório Executivo
   (`@react-pdf/renderer` no client + `export-report`), `type: 'custom'`,
   `params` gravando `{ sections, include_ai_summary, notes }`.
7. Mesmo widget "Relatórios gerados recentemente" (filtrado por
   `type = 'custom'`) no rodapé.

## Interface (UI)

- Os 3 passos aparecem como um formulário único, com seções colapsáveis —
  não um wizard multi-tela com "Próximo"/"Voltar". Todos os 3 passos
  cabem numa única página (mesmo princípio de simplicidade já usado em
  outros formulários do produto — `EntityFormModal` tem 3 seções numa
  única tela, não um wizard).
- Prévia lado a lado do formulário em telas largas (ou abaixo, em telas
  estreitas — mesmo padrão responsivo `lg:grid-cols-[...]` já usado em
  `/narratives`), atualizada só ao clicar "Gerar prévia" — nunca em
  tempo real a cada checkbox marcada, para não refazer a chamada de IA a
  cada clique quando "Resumo executivo" está marcado.
- Cada checkbox de seção mostra um pequeno ícone indicando o tipo de
  conteúdo (tabela/gráfico/lista/texto) — apoio visual para quem não
  lembra o que cada nome significa, sem precisar abrir a prévia primeiro.

## Regras de negócio

- **IA é opt-in, não automática** — diferente do Relatório Executivo. Um
  relatório personalizado pode ser 100% determinístico (só dado + notas
  do próprio usuário, zero chamadas de IA, zero custo) se a checkbox
  "Resumo executivo gerado por IA" ficar desmarcada — o caso default.
  Justificativa: "liberdade" inclui a liberdade de não gastar em IA
  quando o usuário só quer extrair números/gráficos brutos.
- Uma seção sem dado no período (ex: "Eventos do radar" quando não houve
  nenhum) ainda é incluída no PDF se marcada, mas rendendo um
  `<EmptyState/>` equivalente ("Nenhum evento detectado neste período")
  — nunca omitida silenciosamente do documento, para o usuário saber que
  a seção foi considerada mas não tinha conteúdo, não que foi esquecida.
- Notas do usuário nunca passam por nenhum processamento de IA — texto
  literal, exatamente como digitado (diferente do resumo executivo, que
  é gerado/reescrito por Claude).

## Fora de escopo (decisão desta spec, não uma pendência)

- **Reordenação das seções por arrastar** — a ordem é sempre a mesma
  lista fixa acima; o usuário escolhe *quais* seções entram, não *em que
  ordem*. Reduz a complexidade de UI/exportação (o layout do PDF pode ser
  um template fixo com blocos condicionais, em vez de um layout dinâmico
  arbitrário) sem perder a "liberdade" pedida, que era sobre conteúdo, não
  sequência. Revisitar se um usuário real pedir isso.
- **Gráficos customizados além dos já existentes no produto** (ex:
  escolher eixos/métricas livres para montar um gráfico do zero) — usa os
  mesmos gráficos já construídos para as 5 páginas de análise; não é um
  "criador de gráficos" genérico.
- **Múltiplas notas por seção** (uma nota geral só, no fim do documento)
  — se o produto precisar de comentários por seção específica no futuro,
  é uma extensão aditiva de `params`, não uma mudança de schema.
- **Compartilhar o construtor** (link para outro usuário preencher) —
  cada usuário monta e exporta o seu próprio relatório; o que é
  compartilhável é só o PDF final, já baixado.

## Dependências técnicas

- Mesmas de `executive-report.md`, mais: `get-page-reports-custom` (nova
  Edge Function, `page: 'reports_custom'`) — ver `data-model.md`.
- `compose-narrative-synthesis` reaproveitado com
  `section: 'executive_summary'`, só quando o usuário optar por incluir
  IA — nenhuma nova Edge Function de composição.
