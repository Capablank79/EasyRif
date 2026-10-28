import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/modules/auth/auth-form";
import { getSessionUser } from "@/modules/auth/session";
import { Container } from "@/components/ui/container";

export const metadata: Metadata = { title: "Iniciar sesión" };
export const dynamic = "force-dynamic";

export default async function Page() {
  if (await getSessionUser()) redirect("/panel");
  return (
    <Container className="py-10">
      <AuthForm mode="login" />
    </Container>
  );
}
