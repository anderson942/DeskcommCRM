"use client";
import { useState, type DragEvent, type ReactNode, type RefObject } from "react";
import { useT } from "@/hooks/i18n/useT";
import type { ComposerHandle } from "@/components/inbox/Composer";

interface Props {
  composerRef: RefObject<ComposerHandle | null>;
  children: ReactNode;
}

/**
 * Área onde soltar uma imagem arrastada de outra aba do navegador — o painel
 * de conversa INTEIRO (cabeçalho, mensagens, composer), não só a faixa fina
 * do composer.
 *
 * Por que não basta o Composer sozinho: dor relatada pelo time de WhatsApp
 * (2026-09-16) — trabalham com duas telas, uma com o site e outra com o CRM,
 * arrastando rápido entre elas. O alvo real é "em cima da conversa", e uma
 * faixa de ~60px lá embaixo é fácil de errar; quem soltava sobre as mensagens
 * via o browser abrir a imagem numa aba nova, porque nada ali escutava.
 *
 * A extração do arquivo/URL e as regras de quando vira anexo (modo nota,
 * campo travado, anexo já pendente) continuam DENTRO do Composer — aqui só
 * mora a escuta da área larga e o aviso visual; `handleExternalDrop` (no
 * ref) é o elo. O Composer trata o próprio drop (e para a propagação — sem
 * isso o mesmo drop seria processado duas vezes: uma aqui, outra lá), então
 * este wrapper só vê drops que caem FORA dele.
 */
export function ConversationDropZone({ composerRef, children }: Props) {
  const t = useT();
  const [draggingOver, setDraggingOver] = useState(false);

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault(); // habilita o drop em QUALQUER ponto do painel
    setDraggingOver(true);
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    // `relatedTarget` dentro do wrapper = só passou de um filho pro outro,
    // cada um disparando o próprio par enter/leave — sem este check o realce
    // pisca a cada pixel cruzado entre header, mensagens e composer.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDraggingOver(false);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDraggingOver(false);
    composerRef.current?.handleExternalDrop(e.dataTransfer);
  }

  return (
    <div
      className="relative flex h-full min-h-0 flex-1 flex-col"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {children}
      {draggingOver && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-primary bg-background/90 text-sm font-medium text-primary">
          {t("Solte para anexar a imagem")}
        </div>
      )}
    </div>
  );
}
