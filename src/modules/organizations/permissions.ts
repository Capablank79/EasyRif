export const ORG_ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const ORG_ACTIONS = [
  "organization:read",
  "organization:update",
  "members:read",
  "members:manage",
  "raffle:read",
  "raffle:edit_draft",
  "raffle:delete_draft",
  "raffle:publish",
  "raffle:close",
  "numbers:read",
  "orders:read",
  "buyers:read",
  "sellers:read",
  "sellers:manage",
  "audit:read",
  "draws:read",
  "draws:simulate",
] as const;
export type OrgAction = (typeof ORG_ACTIONS)[number];

const VIEWER: readonly OrgAction[] = [
  "organization:read",
  "raffle:read",
  "numbers:read",
  "orders:read",
];
const EDITOR: readonly OrgAction[] = [
  ...VIEWER,
  "raffle:edit_draft",
  "sellers:read",
  "draws:read",
];
const ADMIN: readonly OrgAction[] = [
  ...EDITOR,
  "organization:update",
  "members:read",
  "raffle:delete_draft",
  "raffle:publish",
  "raffle:close",
  "buyers:read",
  "sellers:manage",
  "audit:read",
  "draws:simulate",
];
const OWNER: readonly OrgAction[] = [...ADMIN, "members:manage"];

/**
 * Matriz inicial (provisional) de acciones por rol organizacional. El
 * superadministrador de plataforma NO está aquí: es un concepto separado y
 * no otorga permisos organizacionales implícitos.
 */
export const ROLE_PERMISSIONS: Record<OrgRole, ReadonlySet<OrgAction>> = {
  owner: new Set(OWNER),
  admin: new Set(ADMIN),
  editor: new Set(EDITOR),
  viewer: new Set(VIEWER),
};

export function can(role: OrgRole | null | undefined, action: OrgAction): boolean {
  return role ? ROLE_PERMISSIONS[role].has(action) : false;
}

export class AuthorizationError extends Error {
  constructor(action: OrgAction) {
    super(`No autorizado para ${action}`);
    this.name = "AuthorizationError";
  }
}

export function assertCan(
  role: OrgRole | null | undefined,
  action: OrgAction,
): asserts role is OrgRole {
  if (!can(role, action)) throw new AuthorizationError(action);
}
