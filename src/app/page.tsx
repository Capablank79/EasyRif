import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { getSessionUser } from "@/modules/auth/session";

export const dynamic = "force-dynamic";

const AVAILABLE = [
  {
    title: "Cuenta segura",
    text: "Regístrate e inicia sesión con tu correo. Las contraseñas se protegen con Argon2id y las sesiones se guardan en PostgreSQL.",
  },
  {
    title: "Tu organización",
    text: "Al registrarte se crea tu organización con tu rol de propietario. Tus datos quedan separados de los de otras organizaciones.",
  },
  {
    title: "Panel del organizador",
    text: "Un panel privado, adaptado a móvil y escritorio, con el resumen de tu organización.",
  },
];

const COMING = [
  "Creación y publicación de rifas",
  "Productos digitales numerados",
  "Vendedores y pedidos",
  "Sorteos y solución para colegios",
];

export default async function HomePage() {
  let authenticated = false;
  try {
    authenticated = Boolean(await getSessionUser());
  } catch {
    authenticated = false;
  }

  return (
    <>
      <section className="bg-sky-100">
        <Container className="py-14 sm:py-20">
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-navy-950 sm:text-5xl">
            Organiza tus rifas y productos numerados en un solo lugar
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-navy-900">
            EasyRif es una plataforma para crear y administrar rifas, con una solución
            pensada también para colegios. Hoy puedes crear tu cuenta y preparar tu
            organización.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            {authenticated ? (
              <ButtonLink href="/panel">Ir a mi panel</ButtonLink>
            ) : (
              <>
                <ButtonLink href="/registro">Crear mi cuenta</ButtonLink>
                <ButtonLink href="/iniciar-sesion" variant="ghost">
                  Iniciar sesión
                </ButtonLink>
              </>
            )}
          </div>
        </Container>
      </section>

      <section>
        <Container className="py-12">
          <h2 className="text-2xl font-bold text-navy-900">Disponible hoy</h2>
          <ul className="mt-6 grid gap-4 md:grid-cols-3">
            {AVAILABLE.map((a) => (
              <li key={a.title}>
                <Card className="h-full">
                  <h3 className="font-semibold text-navy-900">{a.title}</h3>
                  <p className="mt-2 text-sm text-muted">{a.text}</p>
                </Card>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section className="bg-sky-50">
        <Container className="py-12">
          <h2 className="text-2xl font-bold text-navy-900">Próximamente</h2>
          <p className="mt-2 max-w-2xl text-muted">
            Estas funciones aún no están disponibles.
          </p>
          <ul className="mt-4 grid gap-2 text-sm text-navy-900 sm:grid-cols-2">
            {COMING.map((c) => (
              <li key={c} className="rounded-xl border border-line bg-white px-4 py-3">
                {c}
              </li>
            ))}
          </ul>
        </Container>
      </section>
    </>
  );
}
