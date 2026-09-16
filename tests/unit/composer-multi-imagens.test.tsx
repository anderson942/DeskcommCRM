import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Enviar várias imagens de uma vez — pedido do time (2026-09-16), no mesmo
 * fôlego do drag-and-drop: quem seleciona 5 fotos do picker do sistema, ou
 * arrasta um lote, espera ver as 5 no preview e sair como 5 mensagens, não
 * perder 4 delas porque o composer só sabia guardar uma.
 *
 * Convenção testada aqui, e só aqui: a legenda digitada UMA VEZ pro lote sai
 * só na ÚLTIMA foto — o mesmo que o WhatsApp faz — e uma falha no meio do
 * lote não perde as que já saíram nem trava as de trás; só a que falhou fica
 * no preview pra tentar de novo (mesma garantia que já existia pra 1 foto só,
 * agora estendida pro lote).
 */

const uploadMock = vi.fn(async ({ file }: { file: File }) => ({
  storage_path: `org/conv/${file.name}`,
  media_mime: file.type,
  media_size_bytes: file.size,
  kind: "image" as const,
}));
const sendMock = vi.fn();

vi.mock("@/hooks/inbox/useUploadMedia", () => ({
  useUploadMedia: () => ({ mutateAsync: uploadMock, isPending: false }),
}));
vi.mock("@/hooks/inbox/useSendMessage", () => ({
  useSendMessage: () => ({ mutate: sendMock, mutateAsync: sendMock, isPending: false }),
}));

import { Composer } from "@/components/inbox/Composer";

function renderComposer() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Composer conversationId="conv-1" />
    </QueryClientProvider>,
  );
}

function png(nome: string) {
  return new File([new Uint8Array([1, 2, 3])], nome, { type: "image/png" });
}

/** DataTransfer falso de um `drop` — só o que os handlers leem. */
function dropData(files: File[]) {
  return { files, items: [], getData: () => "" } as unknown as DataTransfer;
}

const dropZone = () => screen.getByTestId("composer-drop-zone");

describe("Composer — multi-imagens", () => {
  beforeEach(() => {
    uploadMock.mockClear();
    sendMock.mockClear();
  });

  it("selecionar 3 fotos mostra as 3 no preview e o botão conta o lote", async () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /anexar/i }));
    const input = document.querySelector('input[accept^="image"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [png("a.png"), png("b.png"), png("c.png")] } });

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar 3" })).toBeInTheDocument();
    expect(screen.getByText(/legenda vai só na última foto/i)).toBeInTheDocument();
  });

  it("envia as 3 em sequência e a legenda vai só na última", async () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /anexar/i }));
    const input = document.querySelector('input[accept^="image"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [png("a.png"), png("b.png"), png("c.png")] } });

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/legenda/i), { target: { value: "olha o kit" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar 3" }));

    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(3));
    expect(uploadMock).toHaveBeenCalledTimes(3);
    expect(sendMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ media_storage_path: "org/conv/a.png", body: undefined }),
    );
    expect(sendMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ media_storage_path: "org/conv/b.png", body: undefined }),
    );
    expect(sendMock).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ media_storage_path: "org/conv/c.png", body: "olha o kit" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("remover uma foto do preview tira ela do lote enviado", async () => {
    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /anexar/i }));
    const input = document.querySelector('input[accept^="image"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [png("a.png"), png("b.png")] } });

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /remover/i })[0]!);
    expect(screen.getByRole("button", { name: /^enviar$/i })).toBeInTheDocument(); // caiu pra lote de 1

    fireEvent.click(screen.getByRole("button", { name: /^enviar$/i }));
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(1));
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ media_storage_path: "org/conv/b.png" }));
  });

  it("uma falha no meio do lote não trava as outras, e só ela fica pro retry", async () => {
    uploadMock.mockImplementationOnce(async ({ file }) => ({
      storage_path: `org/conv/${file.name}`,
      media_mime: file.type,
      media_size_bytes: file.size,
      kind: "image" as const,
    }));
    uploadMock.mockRejectedValueOnce(new Error("upload_failed")); // a segunda falha
    uploadMock.mockImplementationOnce(async ({ file }) => ({
      storage_path: `org/conv/${file.name}`,
      media_mime: file.type,
      media_size_bytes: file.size,
      kind: "image" as const,
    }));

    renderComposer();
    fireEvent.click(screen.getByRole("button", { name: /anexar/i }));
    const input = document.querySelector('input[accept^="image"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [png("a.png"), png("falha.png"), png("c.png")] } });

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Enviar 3" }));

    // a e c saíram; falha.png ficou — dialog continua aberto, agora com 1 só
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: /^enviar$/i })).toBeInTheDocument());
    expect(screen.queryByText("falha.png")).not.toBeInTheDocument(); // é imagem, não mostra nome — a miniatura é que ficou
  });

  it("colar várias imagens de uma vez abre o preview em lote", async () => {
    renderComposer();
    const campo = screen.getByLabelText("Mensagem");
    const clipboard = {
      files: [png("x.png"), png("y.png")],
      items: [],
      getData: () => "",
    } as unknown as DataTransfer;

    fireEvent.paste(campo, { clipboardData: clipboard });

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar 2" })).toBeInTheDocument();
  });

  /**
   * O BUG RELATADO (2026-09-16): "consigo arrastar múltiplas imagens, mas o
   * popup só mostra uma e só manda a primeira". A causa era o composer tratar
   * "já tem um anexo pendente" como MOTIVO PRA IGNORAR o próximo drop — a
   * regra certa pra 1 arquivo (não deixar uma colagem sem querer substituir o
   * que já estava escolhido) virou a regra ERRADA pra vários, porque quem
   * arrasta de uma página só consegue segurar UM elemento por vez: um lote de
   * 3 fotos são 3 gestos de drag separados, não um só.
   */
  it("arrastar uma foto, depois outra, monta um lote — não ignora a segunda", async () => {
    renderComposer();
    fireEvent.drop(dropZone(), { dataTransfer: dropData([png("a.png")]) });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^enviar$/i })).toBeInTheDocument(); // ainda é 1

    fireEvent.drop(dropZone(), { dataTransfer: dropData([png("b.png")]) });
    expect(await screen.findByRole("button", { name: "Enviar 2" })).toBeInTheDocument();

    fireEvent.drop(dropZone(), { dataTransfer: dropData([png("c.png")]) });
    expect(await screen.findByRole("button", { name: "Enviar 3" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Enviar 3" }));
    await waitFor(() => expect(sendMock).toHaveBeenCalledTimes(3));
    expect(sendMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ media_storage_path: "org/conv/a.png" }));
    expect(sendMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ media_storage_path: "org/conv/b.png" }));
    expect(sendMock).toHaveBeenNthCalledWith(3, expect.objectContaining({ media_storage_path: "org/conv/c.png" }));
  });
});

// A fixture exercita um atendente autorizado a consultar modelos de mensagem.
vi.mock("@/hooks/auth/AuthProvider", () => ({ usePermission: () => true }));
