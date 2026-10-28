# auth

Registro, inicio y cierre de sesión con Better Auth sobre PostgreSQL (`src/platform/auth`).

- `validation.ts`: validación pura de formularios.
- `actions.ts`: Server Actions (mensajes genéricos que no revelan si un correo existe).
- `session.ts`: guardias de servidor (`requireUser`, `requireOrganizationContext`).
- `auth-form.tsx`: formularios accesibles y responsive.

Pendiente: verificación de correo y recuperación de contraseña (requieren proveedor de correo).
