"use client";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/hooks/i18n/useT";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FileText, X } from "@/lib/ui/icons";
import { formatBytes } from "@/components/inbox/media/media-utils";

interface Props {
  files: File[];
  sending: boolean;
  onCancel: () => void;
  /** Tira UM arquivo do lote antes de enviar — não existe pra lote de 1: aí é cancelar tudo. */
  onRemove: (index: number) => void;
  onSend: (caption: string) => void;
}

/** Preview antes do envio (padrão WhatsApp): thumb/card único, ou tira de miniaturas p/ várias fotos + legenda. */
export function AttachmentPreviewDialog({ files, sending, onCancel, onRemove, onSend }: Props) {
  const t = useT();
  const [caption, setCaption] = useState("");
  useEffect(() => setCaption(""), [files.length === 0]);

  // Uma URL por arquivo, só pra imagem/vídeo — pdf/doc cai no card com ícone.
  const objectUrls = useMemo(
    () => files.map((f) => (/^(image|video)\//.test(f.type) ? URL.createObjectURL(f) : null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refaz por CONTEÚDO da lista (via files.map abaixo), não pela referência do array
    [files],
  );
  useEffect(
    () => () => {
      for (const url of objectUrls) if (url) URL.revokeObjectURL(url);
    },
    [objectUrls],
  );

  if (files.length === 0) return null;
  const multiplos = files.length > 1;

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{multiplos ? t("Enviar {n} anexos").replace("{n}", String(files.length)) : t("Enviar anexo")}</DialogTitle>
        </DialogHeader>

        {multiplos ? (
          <div className="flex gap-2 overflow-x-auto rounded-lg bg-muted/40 p-2">
            {files.map((file, i) => {
              const url = objectUrls[i];
              const isImage = file.type.startsWith("image/");
              const isVideo = file.type.startsWith("video/");
              return (
                <div key={`${file.name}-${i}`} className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    disabled={sending}
                    aria-label={t("Remover")}
                    className="absolute -right-1.5 -top-1.5 z-10 rounded-full bg-foreground text-background shadow-sm disabled:opacity-50"
                  >
                    <X className="size-4 p-0.5" />
                  </button>
                  {isImage && url ? (
                    <img src={url} alt={file.name} className="size-20 rounded-md object-cover" />
                  ) : isVideo && url ? (
                    <video src={url} className="size-20 rounded-md object-cover" />
                  ) : (
                    <div className="flex size-20 flex-col items-center justify-center gap-1 rounded-md border border-border px-1 text-center">
                      <FileText size={20} weight="duotone" className="text-primary" aria-hidden />
                      <span className="line-clamp-2 text-[10px] text-muted-foreground">{file.name}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-lg bg-muted/40 p-3">
            {files[0]!.type.startsWith("image/") && objectUrls[0] && (
              <img src={objectUrls[0]} alt={files[0]!.name} className="max-h-64 rounded-md object-contain" />
            )}
            {files[0]!.type.startsWith("video/") && objectUrls[0] && (
              <video src={objectUrls[0]} controls className="max-h-64 rounded-md" />
            )}
            {!files[0]!.type.startsWith("image/") && !files[0]!.type.startsWith("video/") && (
              <div className="flex items-center gap-3 py-4">
                <FileText size={28} weight="duotone" className="text-primary" aria-hidden />
                <div className="text-sm">
                  <p className="font-medium">{files[0]!.name}</p>
                  <p className="text-xs text-muted-foreground">{formatBytes(files[0]!.size)}</p>
                </div>
              </div>
            )}
          </div>
        )}

        <div>
          <Input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder={t("Legenda (opcional)")}
            aria-label={t("Legenda")}
            onKeyDown={(e) => e.key === "Enter" && !sending && onSend(caption.trim())}
          />
          {/* Padrão WhatsApp: uma legenda para o lote todo sai só na ÚLTIMA foto —
              sem isto quem digita uma legenda acha que ela sumiu, porque nenhuma
              das miniaturas acima mostra o texto. */}
          {multiplos && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("A legenda vai só na última foto, como no WhatsApp.")}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCancel} disabled={sending}>
            {t("Cancelar")}
          </Button>
          <Button onClick={() => onSend(caption.trim())} disabled={sending}>
            {multiplos ? t("Enviar {n}").replace("{n}", String(files.length)) : t("Enviar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
