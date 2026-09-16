"use client";
import { useT } from "@/hooks/i18n/useT";
import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { toast } from "sonner";
import { PaperPlaneTilt } from "@/lib/ui/icons";
import { Button } from "@/components/ui/button";
import { AttachMenu } from "@/components/inbox/composer/AttachMenu";
import { AttachmentPreviewDialog } from "@/components/inbox/composer/AttachmentPreviewDialog";
import { ContactPickerDialog } from "@/components/inbox/composer/ContactPickerDialog";
import { AudioRecorder } from "@/components/inbox/composer/AudioRecorder";
import { ReplyReviewPanel } from "@/components/inbox/composer/ReplyReviewPanel";
import { EmojiButton } from "@/components/inbox/composer/EmojiButton";
import { resolveSlash, TemplateMenu } from "@/components/inbox/composer/TemplateMenu";
import { useCreateNote } from "@/hooks/inbox/useCreateNote";
import { useMessageTemplates, type MessageTemplate } from "@/hooks/inbox/useMessageTemplates";
import { X } from "lucide-react";
import { useSendMessage } from "@/hooks/inbox/useSendMessage";
import { useUploadMedia } from "@/hooks/inbox/useUploadMedia";
import { imagensDoClipboard } from "@/lib/inbox/clipboard-image";
import { nomeDaImagemArrastada, urlsDeImagensArrastadas } from "@/lib/inbox/drop-image";
import { interpolateTemplate } from "@/lib/inbox/template-vars";
import { cn } from "@/lib/utils";

export interface ComposerHandle {
  focus: () => void;
  /** Chamado pelo `ConversationDropZone` quando o drop cai fora do composer
   * (cabeçalho, mensagens) — mesma extração/guardas do drop local. */
  handleExternalDrop: (dataTransfer: DataTransfer) => void;
}

interface Props {
  conversationId: string;
  disabled?: boolean;
  /** Set true when contact is blocked / anonymized — explanation shown. */
  blockedReason?: string | null;
  /**
   * Janela de 24h fechada: barra a RESPOSTA, e só ela.
   *
   * Separado de `blockedReason` porque a nota interna nunca chega ao cliente —
   * a regra da plataforma não a alcança, e barrá-la tira do atendente
   * justamente o lugar onde ele registra por que a conversa esfriou. A primeira
   * versão deste bloqueio usava `blockedReason` e levou a nota junto.
   */
  janelaFechada?: string | null;
  /**
   * A mensagem que esta resposta CITA, quando o atendente escolheu responder
   * "em cima" de uma. `null` = envio solto, o caso comum.
   *
   * Vem de fora e não daqui porque quem escolhe é a lista de mensagens: o
   * composer só precisa mostrar o que foi escolhido e mandá-lo junto.
   */
  respondendo?: { id: string; body: string | null; direction: string } | null;
  /** Desfaz a escolha — o `x` da faixa de citação. */
  onCancelarResposta?: () => void;
  /** Nome do contato da conversa, para interpolar {{nome}}/{{primeiro_nome}} do template escolhido. */
  contactName?: string | null;
  /** Contato da conversa — excluído do seletor de cartão compartilhado. */
  currentContactId?: string | null;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  {
    conversationId,
    disabled,
    blockedReason,
    janelaFechada,
    contactName,
    currentContactId,
    respondendo,
    onCancelarResposta,
  },
  ref,
) {
  const t = useT();
  const [text, setText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [buscandoImagemArrastada, setBuscandoImagemArrastada] = useState(false);
  const [enviandoLote, setEnviandoLote] = useState(false);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const send = useSendMessage();
  const upload = useUploadMedia();
  const createNote = useCreateNote();
  const templates = useMessageTemplates();
  const slash = resolveSlash(text);
  const menuOpen = mode === "reply" && slash.open && !menuDismissed;

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
    handleExternalDrop: (dataTransfer: DataTransfer) => {
      void processarImagemArrastada(dataTransfer);
    },
  }));

  // send/createNote fora do disable: o texto some na hora do envio; travar o campo
  // até a API voltar impedia digitar a próxima mensagem com o campo ainda cheio.
  const isDisabled = disabled || !!blockedReason || upload.isPending;
  // A janela só alcança o que SAI. Em modo nota o composer segue liberado: a
  // nota interna nunca chega ao cliente, e é onde o atendente registra por que
  // a conversa esfriou — barrá-la tira exatamente o que ainda dá para fazer.
  const respostaBarrada = isDisabled || (mode === "reply" && !!janelaFechada);

  function autoresize() {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }

  function handleSubmit() {
    const body = text.trim();
    if (!body || (mode === "note" ? isDisabled : respostaBarrada)) return;

    setText("");
    requestAnimationFrame(() => autoresize());

    const restoreOnError = () => {
      setText(body);
      requestAnimationFrame(() => autoresize());
    };

    if (mode === "note") {
      createNote.mutate({ conversation_id: conversationId, body }, { onError: restoreOnError });
      return;
    }
    send.mutate(
      {
        conversation_id: conversationId,
        body,
        type: "text",
        ...(respondendo ? { reply_to_message_id: respondendo.id } : {}),
      },
      {
        onSuccess: () => {
          setText("");
          // A citação vale para UMA mensagem. Mantê-la depois do envio faria a
          // próxima frase sair citando algo que o atendente já respondeu.
          onCancelarResposta?.();
          requestAnimationFrame(() => autoresize());
        },
        // Do upstream, e fica: sem isto o texto some quando o envio falha, e
        // quem escreveu um parágrafo o perde sem ter como recuperá-lo.
        onError: restoreOnError,
      },
    );
  }

  /**
   * Envia o lote de anexos pendentes, um atrás do outro — não em paralelo:
   * mensagens fora de ordem na conversa seriam mais confuso que o envio
   * demorar um pouco mais, e o servidor de mídia (WAHA) recebe um upload de
   * cada vez do jeito que ele já esperava antes de multi-imagem existir.
   *
   * A legenda vai SÓ na última foto (padrão WhatsApp: quem manda várias fotos
   * com legenda vê o texto embaixo da última, não repetido em cada uma).
   *
   * Uma foto falhar não trava as outras — cada `mutateAsync` já dispara o
   * próprio toast de erro (`useUploadMedia`/`useSendMessage`); aqui só evita
   * que a exceção pare o `for` no meio do lote.
   */
  async function enviarLote(legenda: string) {
    if (pendingFiles.length === 0) return;
    setEnviandoLote(true);
    // Quem falhou fica pro retry — fechar o dialog perderia a foto que não
    // saiu. Um lote de 1 que falha continua igual ao comportamento de sempre:
    // dialog aberto com o MESMO arquivo, pronto pra tentar de novo.
    const naoEnviados: File[] = [];
    try {
      const ultimo = pendingFiles.length - 1;
      for (let i = 0; i < pendingFiles.length; i++) {
        const arquivo = pendingFiles[i]!;
        try {
          const uploaded = await upload.mutateAsync({ conversationId, file: arquivo });
          await send.mutateAsync({
            conversation_id: conversationId,
            type: uploaded.kind,
            body: i === ultimo ? legenda || undefined : undefined,
            media_storage_path: uploaded.storage_path,
            media_mime: uploaded.media_mime,
            media_size_bytes: uploaded.media_size_bytes,
          });
        } catch {
          // toast já disparado pelo onError de upload/send — segue pro próximo do lote
          naoEnviados.push(arquivo);
        }
      }
    } finally {
      setEnviandoLote(false);
      setPendingFiles(naoEnviados);
    }
  }

  function applyTemplate(t: MessageTemplate) {
    const filled = interpolateTemplate(t.body, { name: contactName ?? null });
    setText(filled);
    setMenuDismissed(true);
    const ta = taRef.current;
    if (!ta) return;
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = filled.length;
      autoresize();
    });
  }

  /**
   * Ctrl/Cmd+V com imagem no clipboard cai no MESMO caminho do menu "+":
   * abre o preview com legenda e envia por ali. Nada de atalho paralelo — a
   * validação, o toast de erro e o retry já vivem lá. Cola mais de uma imagem
   * de uma vez (raro, mas existe) → mesmo preview em lote do multi-select.
   *
   * As três guardas antes de olhar o clipboard não são zelo: em "Nota interna"
   * não existe anexo (a nota é só texto e o envio nem passa pelo upload), com
   * um anexo já em preview a colagem substituiria em silêncio o que o operador
   * escolheu, e desabilitado é desabilitado. Em qualquer um desses casos o
   * Ctrl+V precisa continuar sendo o Ctrl+V de sempre.
   */
  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (mode !== "reply" || respostaBarrada || pendingFiles.length > 0) return;
    const imagens = imagensDoClipboard(e.clipboardData, new Date());
    if (imagens.length === 0) return; // colagem de texto segue o caminho normal do browser
    e.preventDefault();
    setPendingFiles(imagens);
  }

  /**
   * Arrastar uma foto de OUTRA ABA (o site da loja, um resultado de busca)
   * pra dentro da conversa — mesmo caminho do Ctrl+V: cai no preview com
   * legenda, sem atalho paralelo pra validação/erro/retry.
   *
   * Compartilhada entre o `onDrop` local (drop bem em cima do composer) e
   * `handleExternalDrop` (exposto no ref — o `ConversationDropZone` chama
   * quando o drop cai em qualquer outro lugar do painel, cabeçalho ou
   * mensagens; o alvo real ao arrastar rápido entre duas telas é "em cima da
   * conversa", não uma faixa de 60px lá embaixo).
   */
  /** Busca UMA url pela rota de proxy e devolve o File, ou `null` com o toast já disparado. */
  async function buscarImagemExterna(url: string): Promise<File | null> {
    try {
      const res = await fetch(`/api/v1/media/fetch-external?url=${encodeURIComponent(url)}`);
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast.error(json?.error?.message || t("Não foi possível carregar essa imagem."));
        return null;
      }
      const blob = await res.blob();
      return new File([blob], nomeDaImagemArrastada(url, blob.type, new Date()), { type: blob.type });
    } catch {
      toast.error(t("Não foi possível carregar essa imagem."));
      return null;
    }
  }

  async function processarImagemArrastada(dados: DataTransfer) {
    if (mode !== "reply" || respostaBarrada || pendingFiles.length > 0) return;

    const arquivos = imagensDoClipboard(dados, new Date());
    if (arquivos.length > 0) {
      setPendingFiles(arquivos);
      return;
    }

    // Chrome materializa File pra maioria das <img> arrastadas entre abas, mas
    // nem sempre — aqui só sobrou a URL (text/uri-list, raramente mais de
    // uma). Busca pelo servidor porque o browser esbarraria em CORS na
    // maioria dos CDNs.
    const urls = urlsDeImagensArrastadas(dados);
    if (urls.length === 0) return; // não era imagem nem link — solta sem travar nada

    setBuscandoImagemArrastada(true);
    try {
      const baixadas = await Promise.all(urls.map(buscarImagemExterna));
      const ok = baixadas.filter((f): f is File => f !== null);
      if (ok.length > 0) setPendingFiles(ok);
    } finally {
      setBuscandoImagemArrastada(false);
    }
  }

  /**
   * `preventDefault` SEMPRE — mesmo fora do modo resposta — é o que impede o
   * defeito relatado: sem ele o browser trata a imagem arrastada como
   * navegação (abria numa aba nova). `stopPropagation` no drop evita que o
   * `ConversationDropZone`, que escuta o painel inteiro por baixo, processe
   * o MESMO drop de novo.
   */
  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    void processarImagemArrastada(e.dataTransfer);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape" && menuOpen) {
      setMenuDismissed(true);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (menuOpen) return; // deixa o Enter pro menu; não envia /query como mensagem
      handleSubmit();
    }
  }

  if (blockedReason) {
    return (
      <div className="border-t border-border bg-muted/40 px-4 py-3 text-center text-xs text-muted-foreground">
        {blockedReason}
      </div>
    );
  }

  return (
    <>
      <div
        data-testid="composer-drop-zone"
        className={cn(
          "relative border-t border-border bg-background px-3 py-2",
          mode === "note" && "border-warning/40 bg-warning-bg",
        )}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        {buscandoImagemArrastada && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/90 text-sm text-muted-foreground">
            {t("Carregando imagem…")}
          </div>
        )}
        {mode === "reply" && (
          <ReplyReviewPanel conversationId={conversationId} disabled={isDisabled} />
        )}
        <TemplateMenu
          open={menuOpen}
          query={slash.query}
          templates={templates.data ?? []}
          onPick={applyTemplate}
          onClose={() => setMenuDismissed(true)}
        />
        <div className="mb-1.5 flex gap-1">
          <button
            type="button"
            onClick={() => setMode("reply")}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              mode === "reply"
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {t("Responder")}
          </button>
          <button
            type="button"
            onClick={() => setMode("note")}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              mode === "note"
                ? "bg-warning text-warning-fg"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {t("Nota interna")}
          </button>
        </div>
        {/*
          A FAIXA DA CITAÇÃO — o que o atendente escolheu responder.

          Fica ACIMA do campo, como no WhatsApp, e não dentro dele: o texto
          citado pode ter várias linhas, e empurrá-lo para dentro do campo faria
          o que se digita disputar espaço com o que se cita.

          `line-clamp-2` porque o objetivo é reconhecer qual mensagem é, não
          relê-la — ela está logo acima, no fio.
        */}
        {respondendo && mode === "reply" && (
          <div className="mb-1 flex items-start gap-2 rounded-md border-l-2 border-primary bg-muted/60 px-2 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium text-primary">
                {respondendo.direction === "outbound" ? t("Você") : t("Cliente")}
              </div>
              <div className="line-clamp-2 text-xs text-muted-foreground">
                {respondendo.body?.trim() || t("(sem texto)")}
              </div>
            </div>
            <button
              type="button"
              onClick={onCancelarResposta}
              aria-label={t("Cancelar resposta")}
              className="rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          {mode === "reply" && (
            <AttachMenu
              disabled={respostaBarrada}
              onPick={setPendingFiles}
              onPickContact={() => setContactPickerOpen(true)}
            />
          )}
          <EmojiButton
            disabled={isDisabled}
            onPick={(emoji) => {
              const ta = taRef.current;
              if (!ta) {
                setText((t) => t + emoji);
                return;
              }
              const start = ta.selectionStart ?? text.length;
              const end = ta.selectionEnd ?? text.length;
              const next = text.slice(0, start) + emoji + text.slice(end);
              setText(next);
              requestAnimationFrame(() => {
                ta.focus();
                ta.selectionStart = ta.selectionEnd = start + emoji.length;
                autoresize();
              });
            }}
          />
          <textarea
            ref={taRef}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (!resolveSlash(e.target.value).open) setMenuDismissed(false);
              autoresize();
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            // O atalho saiu do placeholder e foi para o diálogo de atalhos (`?`)
            // e para o `title` aqui. Dois motivos, nesta ordem: ele some assim
            // que se digita a primeira letra — isto é, some justamente quando
            // você ia quebrar linha —; e, com a coluna do inbox mais estreita
            // depois do conserto do layout, a frase quebrava em duas linhas
            // dentro de um campo de uma linha só.
            //
            // "(só o time vê)" FICA: não é atalho, é consequência. Quem escreve
            // uma nota interna precisa saber que ela não vai para o cliente, e
            // essa informação não pode depender de abrir um diálogo.
            placeholder={
              mode === "note"
                ? t("Escreva uma nota interna… (só o time vê)")
                : t("Escreva uma mensagem…")
            }
            title={
              mode === "note"
                ? t("Enter salva a nota · Shift+Enter quebra linha")
                : t("Enter envia · Shift+Enter quebra linha")
            }
            className={cn(
              "max-h-40 min-h-9 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm",
              "placeholder:text-muted-foreground focus:ring-1 focus:ring-ring focus:outline-hidden",
            )}
            disabled={mode === "note" ? isDisabled : respostaBarrada}
            aria-label={t("Mensagem")}
          />
          {text.trim() || mode === "note" ? (
            <Button
              type="button"
              size="icon"
              className="h-9 w-9 shrink-0"
              onClick={handleSubmit}
              disabled={(mode === "note" ? isDisabled : respostaBarrada) || !text.trim()}
              aria-label={t("Enviar")}
            >
              <PaperPlaneTilt size={16} weight="fill" aria-hidden />
            </Button>
          ) : (
            <AudioRecorder conversationId={conversationId} disabled={respostaBarrada} />
          )}
        </div>
      </div>
      <AttachmentPreviewDialog
        files={pendingFiles}
        sending={enviandoLote || upload.isPending || send.isPending}
        onCancel={() => setPendingFiles([])}
        onRemove={(i) => setPendingFiles((atual) => atual.filter((_, idx) => idx !== i))}
        onSend={(caption) => void enviarLote(caption)}
      />
      <ContactPickerDialog
        open={contactPickerOpen}
        onOpenChange={setContactPickerOpen}
        excludeContactId={currentContactId}
        sending={send.isPending}
        onPick={(payload) => {
          send.mutate(
            {
              conversation_id: conversationId,
              type: "contact",
              metadata: payload.contactId
                ? { shared_contact_id: payload.contactId }
                : {
                    shared_contact: {
                      name: payload.name,
                      phone_number: payload.phone_number,
                    },
                  },
            },
            { onSuccess: () => setContactPickerOpen(false) },
          );
        }}
      />
    </>
  );
});
