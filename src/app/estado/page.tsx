import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { isDatabaseConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Estado del proyecto" };

const DONE = [
  "Estructura de aplicación Next.js (App Router) y TypeScript estricto",
  "Sistema de diseño base y layout responsive",
  "Límites de módulos definidos",
  "Modelo de datos PostgreSQL + Drizzle y migraciones SQL definidos (24 tablas, 43 triggers) y verificado en PostgreSQL 18.6 real",
  "Autenticación (registro, inicio y cierre de sesión) con sesiones en PostgreSQL y dashboard privado del organizador",
  "Aislamiento entre organizaciones por autorización en servidor; roles de BD separados (migraciones y aplicación)",
  "Creación y administración de rifas: borradores, premios, numeración única y publicación informativa",
  "Ficha pública rediseñada con selector de números, filtros y paginación (BUILD-006)",
  "Reservas temporales de demostración (migraciones 0005 y 0006): atómicas, idempotentes, con caducidad y liberación; sin pagos",
  "Imágenes de rifa y premios (JPG/PNG/WebP ≤ 3 MB, re-codificadas a WebP) en almacenamiento local",
  "Comprobante PDF único por reserva de demostración (migración 0007), con todos los números y un QR verificable en /verificar; sin validez de compra",
    "Talonarios foliados (migración 0008): p. ej. 10 talonarios × 20 números = 200 participaciones únicas por folio y número, con panel por folio, selector, reservas y comprobantes; las rifas individuales no cambian",
    "Talonarios colaborativos (migración 0009): fechas de cierre de ventas y de sorteo, responsables con enlace propio, asignación y reasignación con historial, participante distinto por número, panel de avance y PDF con participantes; todo en demostración",
        "Simulación de sorteos (migración 0010): dos etapas (folio y número), una extracción por premio, probabilidad equitativa, resultados auditables e inmutables; solo simulación, sin validez",
      ];

const PENDING = [
  "Verificación de correo y recuperación de contraseña (sin proveedor de correo)",
  "Row-Level Security en PostgreSQL (decisión pendiente antes de producción)",
  "Almacenamiento de imágenes apto para producción: el disco local no sirve en hosting serverless",
  "Límite de peticiones compartido entre instancias (hoy en memoria)",
  "Sorteo oficial (bloqueado siempre; solo existe simulación), ventas reales y colegios (BUILD-010 en adelante); el PDF no se actualiza solo y muestra el nombre de la organización",
  "Los enlaces de responsables derivan de BETTER_AUTH_SECRET: rotarlo los invalida",
  "Pagos y validación: postergados a una fase futura",
];

function List({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

export default function EstadoPage() {
  const configured = isDatabaseConfigured();
  return (
    <Container className="py-12">
      <Badge tone="demo">Fase 1 · BUILD-009 V0.9</Badge>
      <h1 className="mt-4 text-3xl font-bold text-navy-950">
        Estado del proyecto
      </h1>
      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Disponible</h2>
          <List items={DONE} />
        </Card>
        <Card>
          <h2 className="font-semibold">Aún no funciona</h2>
          <List items={PENDING} />
        </Card>
      </div>
      <Card className="mt-4">
        <h2 className="font-semibold">        Configuración de PostgreSQL</h2>
        <p className="mt-2 text-sm text-muted">
          {configured
                    ? "DATABASE_URL presente. Esta página no comprueba la conexión."
                    : "DATABASE_URL no configurada. No hay conexión activa en esta etapa."}
        </p>
      </Card>
    </Container>
  );
}
