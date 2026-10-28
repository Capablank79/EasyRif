import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/container";

export default function NotFound() {
  return (
    <Container className="py-20">
      <h1 className="text-3xl font-bold text-navy-950">Página no encontrada</h1>
      <p className="mt-3 text-muted">La dirección solicitada no existe.</p>
      <ButtonLink href="/" className="mt-6">
        Volver al inicio
      </ButtonLink>
    </Container>
  );
}
