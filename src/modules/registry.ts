export type ModuleStatus = "limite-definido" | "pendiente";

export interface ModuleInfo {
  slug: string;
  name: string;
  description: string;
  /** Fase del plan en la que se implementará. */
  phase: string;
  status: ModuleStatus;
}

/** Límites de módulos de la aplicación. Aún sin lógica operativa. */
export const MODULES: readonly ModuleInfo[] = [
  {
    slug: "auth",
    name: "Autenticación",
    description: "Registro, acceso y sesiones.",
    phase: "Fase 2",
    status: "limite-definido",
  },
  {
    slug: "organizations",
    name: "Organizaciones",
    description: "Organizaciones, membresías y roles.",
    phase: "Fase 1–2",
    status: "limite-definido",
  },
  {
    slug: "raffles",
    name: "Rifas",
    description: "Rifas, premios y estados de publicación.",
    phase: "Fase 3",
    status: "limite-definido",
  },
  {
    slug: "numbered-products",
    name: "Productos numerados",
    description: "Productos digitales asociados a números únicos.",
    phase: "Fase 3 y 6",
    status: "limite-definido",
  },
  {
    slug: "orders",
    name: "Pedidos",
    description: "Reservas y pedidos de demostración (sin pagos).",
    phase: "Fase 4–5",
    status: "limite-definido",
  },
  {
    slug: "schools",
    name: "Colegios",
    description: "Cursos, alumnado y vendedores. Extiende el núcleo.",
    phase: "Fase 7",
    status: "limite-definido",
  },
  {
    slug: "drawings",
    name: "Sorteos",
    description: "Sorteos, resultados, QR y canje con auditoría.",
    phase: "Fase 8",
    status: "limite-definido",
  },
];
