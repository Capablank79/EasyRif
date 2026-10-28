import { Container } from "@/components/ui/container";

export function SiteFooter() {
  return (
    <footer className="mt-auto bg-navy-900 text-white">
      <Container className="py-8 text-sm">
        <p className="font-semibold">EasyRif</p>
        <p className="mt-1 text-sky-100">
          Plataforma en desarrollo. No se procesan pagos ni se realizan
          sorteos reales en esta etapa.
        </p>
      </Container>
    </footer>
  );
}
