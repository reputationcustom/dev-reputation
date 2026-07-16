// Slot paralelo `@modal` (ver app/(intelligence-center)/(analytics)/layout.tsx)
// — precisa de um `default.tsx` pra quando nenhuma rota interceptadora
// bateu (a maior parte do tempo: qualquer navegação que não seja pra
// `/narratives/[id]` via link client-side). Sem isso o Next.js não sabe o
// que renderizar nesse slot e a navegação quebra.
export default function ModalSlotDefault() {
  return null;
}
