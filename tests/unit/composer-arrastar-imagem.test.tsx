import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Arrastar uma foto de OUTRA ABA do navegador (o site da loja, uma busca de
 * imagens) pra dentro da conversa — dor real relatada pelo time (2026-09-16):
 * com dois monitores, um com o site e outro com o CRM, arrastar a foto pro
 * chat abria a imagem numa aba nova em vez de anexar.
 *
 * A propriedade em disputa é a mesma do Ctrl+V (`composer-colar-imagem`): o
 * handler precisa `preventDefault` SEMPRE no `dragOver`/`drop` — é isso que
 * impede o browser de tratar a imagem arrastada como navegação —, mas só
 * ANEXAR quando faz sentido (modo resposta, sem anexo já pendente, campo
 * liberado).
 */

const uploadResult = {
  storage_path: "org/conv/out-1.png",
  media_mime: "image/png",
  media_size_bytes: 3,
  kind: "image" as const,
};
const uploadMock = vi.fn(async () => uploadResult);
const sendMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock("@/hooks/inbox/useUploadMedia", () => ({
  useUploadMedia: () => ({ mutateAsync: uploadMock, isPending: false }),
}));
vi.mock("@/hooks/inbox/useSendMessage", () => ({
  useSendMessage: () => ({ mutate: sendMock, mutateAsync: sendMock, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastErrorMock(...a), success: vi.fn() } }));

import { Composer } from "@/components/inbox/Composer";
import { nomeDaImagemArrastada, urlDaImagemArrastada } from "@/lib/inbox/drop-image";

const CARIMBO = new Date("2026-09-16T12:00:00.000Z");

function png(nome = "image.png", bytes = [1, 2, 3], tipo = "image/png") {
  return new File([new Uint8Array(bytes)], nome, { type: tipo });
}

/** DataTransfer falso de um `drop`: só o que os handlers leem. */
function dropData(opts: { files?: File[]; uriList?: string; texto?: string }) {
  return {
    files: opts.files ?? [],
    items: [],
    getData: (tipo: string) => {
      if (tipo === "text/uri-list") return opts.uriList ?? "";
      if (tipo === "text/plain") return opts.texto ?? "";
      return "";
    },
  } as unknown as DataTransfer;
}

function renderComposer(props: Partial<React.ComponentProps<typeof Composer>> = {}) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Composer conversationId="conv-1" {...props} />
    </QueryClientProvider>,
  );
}

const dropZone = () => screen.getByTestId("composer-drop-zone");

describe("urlDaImagemArrastada", () => {
  it("lê a primeira linha de text/uri-list", () => {
    expect(urlDaImagemArrastada(dropData({ uriList: "https://outlet360.com.br/foto.jpg" }))).toBe(
      "https://outlet360.com.br/foto.jpg",
    );
  });

  it("ignora linhas de comentário do RFC 2483", () => {
    const dt = dropData({ uriList: "# comentário\nhttps://outlet360.com.br/foto.jpg" });
    expect(urlDaImagemArrastada(dt)).toBe("https://outlet360.com.br/foto.jpg");
  });

  it("cai pra text/plain quando uri-list vem vazio", () => {
    expect(urlDaImagemArrastada(dropData({ texto: "https://outlet360.com.br/foto.jpg" }))).toBe(
      "https://outlet360.com.br/foto.jpg",
    );
  });

  it("devolve null quando não há URL nenhuma", () => {
    expect(urlDaImagemArrastada(dropData({ texto: "bom dia" }))).toBeNull();
  });

  it("devolve null sem dataTransfer", () => {
    expect(urlDaImagemArrastada(null)).toBeNull();
  });
});

describe("nomeDaImagemArrastada", () => {
  it("preserva o nome real do arquivo na URL", () => {
    const nome = nomeDaImagemArrastada("https://outlet360.com.br/produto/camiseta-preta.jpg", "image/jpeg", CARIMBO);
    expect(nome).toBe("camiseta-preta.jpg");
  });

  it("inventa um nome com horário quando a URL não tem extensão reconhecível", () => {
    const nome = nomeDaImagemArrastada("https://outlet360.com.br/img?id=42", "image/png", CARIMBO);
    expect(nome).toBe("imagem-arrastada-2026-09-16-12-00-00.png");
  });
});

describe("Composer — arrastar imagem de outra aba", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    uploadMock.mockClear();
    sendMock.mockClear();
    toastErrorMock.mockClear();
    global.fetch = originalFetch;
  });

  it("Chrome já entrega o File pronto — abre o preview sem chamar a API", async () => {
    renderComposer();
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    fireEvent.drop(dropZone(), { dataTransfer: dropData({ files: [png()] }) });

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("só a URL veio (text/uri-list) — busca pela rota de proxy e abre o preview", async () => {
    renderComposer();
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
    global.fetch = vi.fn(async (url: string) => {
      expect(url).toContain("/api/v1/media/fetch-external?url=");
      return { ok: true, blob: async () => blob } as Response;
    }) as unknown as typeof fetch;

    fireEvent.drop(dropZone(), { dataTransfer: dropData({ uriList: "https://outlet360.com.br/foto.jpg" }) });

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("proxy falha — mostra erro e não abre preview", async () => {
    renderComposer();
    global.fetch = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: { message: "A URL arrastada não é uma imagem." } }),
    })) as unknown as typeof fetch;

    fireEvent.drop(dropZone(), { dataTransfer: dropData({ uriList: "https://outlet360.com.br/pagina.html" }) });

    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("A URL arrastada não é uma imagem."));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("drop sem imagem nem URL não quebra nada e não chama a API", () => {
    renderComposer();
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    fireEvent.drop(dropZone(), { dataTransfer: dropData({ texto: "bom dia" }) });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("dragOver sempre previne o default — é o que impede abrir a imagem numa aba nova", () => {
    renderComposer();
    const seguiu = fireEvent.dragOver(dropZone(), { dataTransfer: dropData({}) });
    expect(seguiu, "sem preventDefault aqui o drop nem chega a disparar").toBe(false);
  });

  it("em 'Nota interna' o drop não vira anexo, mas ainda previne a navegação", () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /nota interna/i }));
    const seguiu = fireEvent.drop(dropZone(), { dataTransfer: dropData({ files: [png()] }) });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(seguiu, "preventDefault continua obrigatório mesmo sem anexar").toBe(false);
  });

  it("com anexo já em preview, o drop não substitui em silêncio o que o operador escolheu", async () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /anexar/i }));
    const inputDoc = document.querySelector('input[accept^=".pdf"]') as HTMLInputElement;
    const doc = new File([new Uint8Array([1])], "contrato-assinado.pdf", { type: "application/pdf" });
    fireEvent.change(inputDoc, { target: { files: [doc] } });

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("contrato-assinado.pdf")).toBeInTheDocument();

    fireEvent.drop(dropZone(), { dataTransfer: dropData({ files: [png()] }) });

    expect(screen.getByText("contrato-assinado.pdf")).toBeInTheDocument();
  });

  it("composer desabilitado ignora o drop", () => {
    renderComposer({ disabled: true });
    fireEvent.drop(dropZone(), { dataTransfer: dropData({ files: [png()] }) });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("enviar a imagem arrastada dispara upload + send, igual ao Ctrl+V", async () => {
    renderComposer();
    fireEvent.drop(dropZone(), { dataTransfer: dropData({ files: [png()] }) });

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^enviar$/i }));

    await waitFor(() => expect(uploadMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({ conversation_id: "conv-1", type: "image" }),
      ),
    );
  });
});

// A fixture exercita um atendente autorizado a consultar modelos de mensagem.
vi.mock("@/hooks/auth/AuthProvider", () => ({ usePermission: () => true }));
