import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Regressão: a tela de "e-mail não corresponde" tinha um botão "Sair" que
 * postava pra `/api/auth/signout` — rota que nunca existiu neste repo (o
 * sign-out real é a Server Action `signOut`, usada em `/acesso-revogado`).
 * Achado ao testar de verdade a aceitação de convite com a conta errada
 * logada: o clique dava 404 e a pessoa ficava presa na tela, sem conseguir
 * trocar de conta pelo próprio fluxo do convite.
 */
const { signOutMock } = vi.hoisted(() => ({ signOutMock: vi.fn() }));

vi.mock("@/app/actions/auth/signOut", () => ({ signOut: signOutMock }));
vi.mock("@/lib/auth/rate-limit", () => ({
  authRateLimited: vi.fn().mockResolvedValue(false),
  AUTH_LIMITS: { invite_accept: {} },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1", email: "anderson@outlet360.com.br" } } }) },
  }),
}));

import { signInviteToken } from "@/lib/auth/invite-token";
import AcceptInvitePage from "./page";

afterEach(cleanup);

describe("AcceptInvitePage — e-mail não corresponde", () => {
  it("o botão Sair usa a Server Action de sign-out de verdade, não uma rota morta", async () => {
    const token = signInviteToken({
      invite_id: "11111111-1111-4111-8111-111111111111",
      email: "sac@outlet360.com.br", // diferente de quem está logado (anderson@)
      organization_id: "22222222-2222-4222-8222-222222222222",
      role: "agent",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    render(await AcceptInvitePage({ params: Promise.resolve({ token }) }));

    expect(screen.getByText("Email não corresponde")).toBeInTheDocument();

    const botao = screen.getByRole("button", { name: "Sair" });
    expect(botao.closest("form")).not.toHaveAttribute("action", "/api/auth/signout");

    await userEvent.click(botao);
    expect(signOutMock).toHaveBeenCalled();
  });
});
