# EasyRif

Plataforma para crear y administrar rifas, con un módulo especializado para colegios. **Estado: Fase 0 (base técnica).** No hay funcionalidades de negocio, pagos ni conexión a servicios externos.

## Requisitos

- Node.js 20.19+ (probado con 24)
- npm

## Instalación y ejecución

```bash
npm install
cp .env.example .env.local   # DATABASE_URL, solo para trabajo con base de datos
npm run dev                  # http://localhost:3000
```

## Scripts

| Script | Descripción |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` / `npm start` | Compilación y ejecución de producción |
| `npm run lint` | ESLint |
| `npm run typecheck` | Verificación de tipos (`tsc --noEmit`) |
| `npm test` | Tests (Vitest) |
| `npm run check` | lint + typecheck + test |

## Rutas

- `/` página inicial (en desarrollo)
- `/estado` estado del proyecto y qué aún no funciona
- `/registro`, `/iniciar-sesion` autenticación (Better Auth, usuarios y sesiones en PostgreSQL)
- `/panel` dashboard privado del organizador (requiere sesión; `src/proxy.ts` filtra y el servidor valida)
- `/panel/rifas`, `/panel/rifas/nueva`, `/panel/rifas/[id]` administración de rifas (borrador, premios, numeración, publicación)
- `/r/[slug]` ficha pública informativa de una rifa publicada (sin compras)
- `/panel/rifas/[id]/talonarios`, `/panel/rifas/[id]/responsables` talonarios, avance y responsables (BUILD-008)
- `/panel/rifas/[id]/sorteos` simulación de sorteos (BUILD-009, sin validez)
- `/v/[token]` portal del responsable de venta (enlace opaco, `noindex`)
- `/api/auth/*` endpoints de Better Auth

## Estructura

```
src/
  app/          rutas (App Router), layout, estilos y tokens de diseño
  components/   ui/ (Button, Badge, Card, Container) y layout/ (header, footer)
  lib/          utilidades (cn, lectura de entorno)
  modules/      límites de módulos: auth, organizations, raffles,
                numbered-products, orders, schools, drawings (+ registry.ts)
tests/          tests unitarios
```

Es una única aplicación modular. El núcleo no depende de `schools`; este lo extiende.

## Diseño

Tokens en [src/app/globals.css](src/app/globals.css): azul profundo (`navy`), verde lima (`lime`), azul claro (`sky`) y blanco. El texto sobre verde lima usa azul oscuro para mantener el contraste. Mobile-first, con enlace de salto al contenido, foco visible y soporte de `prefers-reduced-motion`.

## Variables de entorno

Ver [.env.example](.env.example): `DATABASE_URL` (rol `easyrif_app`), `DATABASE_URL_MIGRATOR` (rol `easyrif_migrator`), `BETTER_AUTH_SECRET` y `BETTER_AUTH_URL`. Solo servidor, nunca `NEXT_PUBLIC_*`. `.env.local` no se versiona; guárdelo en UTF-8 **sin BOM**.

## Base de datos (PostgreSQL 18 + Drizzle)

Decisión: PostgreSQL independiente, sin plataformas BaaS. Modelo y seguridad: [docs/modelo-de-datos.md](docs/modelo-de-datos.md).
Desarrollo: PostgreSQL 18.6 en `localhost:5433`, base `easyrif_dev`, roles separados de migración y aplicación.

```bash
# 1) Una vez, con un superusuario local (pide las contraseñas por psql, no se guardan):
psql -h localhost -p 5433 -U postgres -v migrator_pw=... -v app_pw=... -f scripts/db/01-crear-roles-y-base.sql
# 2) Copiar .env.example a .env.local y completar credenciales
npm run db:migrate     # aplica drizzle/*.sql con el rol migrador
npm run db:permisos    # permisos mínimos del rol de aplicación (scripts/db/02-permisos-app.sql)
npm run db:generate    # tras cambiar el esquema en src/platform/db/schema
```

`docker-compose.yml` (PostgreSQL 18) es una alternativa si dispone de Docker.

### Verificación real (PostgreSQL 18.6)

- Migraciones 0000–0003 aplicadas sobre `easyrif_dev`: 19 tablas, 29 triggers.
- `tests/pg/real-postgres.test.ts` (9 tests): versión, triggers/FKs, atributos de roles, el rol de aplicación no puede ALTER/TRUNCATE/DDL ni modificar `audit_events`, unicidad y FKs compuestas, atomicidad, 10 pedidos simultáneos sobre un número con un único ganador, inmutabilidad y último propietario.
- `tests/pg/auth.test.ts` (5 tests): registro con hash Argon2id, organización y propietario creados, duplicados, login/logout con sesión en PostgreSQL, aislamiento entre organizaciones, aprovisionamiento idempotente.
- Ambos se omiten sin `.env.local`; entonces no cuentan como verificación. Limpieza de residuos: `node --env-file=.env.local scripts/db/limpiar-datos-prueba.mjs`.
- `tests/db/*` usa PGlite (sin servidor).

## Autenticación

Better Auth + adaptador Drizzle, tablas `auth_*` en PostgreSQL. Contraseñas con Argon2id (`@node-rs/argon2`), mínimo 12 caracteres. Cookie de sesión HttpOnly, SameSite=Lax, Secure en producción, 7 días. Registro y login devuelven mensajes genéricos (no revelan si un correo existe). El registro crea la organización individual y la membresía de propietario (en una transacción; si faltara, el panel la reaprovisiona de forma idempotente). La organización activa se elige solo entre las membresías activas del usuario; un `org` enviado por el cliente se valida y nunca se confía.

**Límites conocidos:** no hay verificación de correo ni recuperación de contraseña (sin proveedor de correo; se implementarán cuando exista). RLS sigue desactivada: el aislamiento lo aplica el servidor (`modules/organizations`) y las FKs compuestas; decidir antes de producción. Límite de intentos (rate limit) en memoria: insuficiente para despliegues con varias instancias. El origen de las peticiones se valida contra `BETTER_AUTH_URL` (en desarrollo debe coincidir con el puerto usado).

## Rifas (BUILD-005)

Código en `src/modules/raffles/` (`validation.ts` puro, `service.ts` con las reglas, `actions.ts` server actions, `forms.tsx` UI cliente).

- Ciclo: `draft` → `published` (solo informativa; no habilita compras). Crear/editar/premios/numeración requieren `raffle:edit_draft` (editor, admin, propietario); publicar requiere `raffle:publish` (admin, propietario).
- Autorización por la organización **dueña de la rifa** (nunca por el `org` del cliente); una rifa ajena responde como inexistente. Las mutaciones bloquean la fila (`FOR UPDATE`) y todas las consultas filtran por rifa y organización.
- Números: `INSERT … SELECT generate_series … ON CONFLICT DO NOTHING` en una transacción; idempotente y seguro ante concurrencia. Ancho = dígitos de la cantidad (`001`…`120`).
- Precio en unidad menor (entero, sin flotantes); CLP sin decimales, USD/EUR/ARS/PEN/COP/MXN con 2. Para publicar el precio debe ser > 0.
- Slug generado desde el título (sufijo aleatorio si colisiona); inmutable tras crear.
- Migración `0004`: trigger `raffles_guard_publication` (tras publicar son inmutables slug, cantidad, precio y moneda; no vuelve a borrador; publicar exige premios y todos los números).
- Cantidad máxima de números: `RAFFLE_MAX_NUMBERS` (por defecto 10000, tope 100000).
- La fecha estimada del sorteo se guarda en `ends_at` (solo informativa).
- **No implementado:** pagos, ventas reales, sorteos, PDF, colegios.

## Reservas de demostración e imágenes (BUILD-006)

Código en `src/modules/reservations/` y `src/modules/storage/`. Migraciones `0005` y `0006`.

- Ficha pública `/r/[slug]` con selector de números; reservar crea un **pedido demo** (`orders.is_demo`, `pending`) con `expires_at`. Los números pasan a `reserved` (nunca `sold`); un check en BD impide confirmar un pedido demo. No hay pagos ni compras reales.
- Atomicidad: transacción con `FOR SHARE` sobre la rifa y `FOR UPDATE` de los números en orden. Idempotencia por clave hasheada (`request_key_hash`). Caducidad perezosa (`RESERVATION_TTL_MINUTES`, 10 por defecto); una reserva vencida cuenta como disponible. Máximo por reserva: `RESERVATION_MAX_SELECTION` (10).
- Acceso a la reserva por token HMAC no adivinable (solo se guarda su hash); `/r/[slug]/reserva/[token]` permite liberarla.
- Imágenes de rifa y premios: solo en borrador; JPG/PNG/WebP ≤ 3 MB, validadas por firma, re-codificadas a WebP (sin EXIF) con sharp. Servidas por `/api/imagenes/[key]` (públicas si la rifa está publicada; borradores solo para miembros).
- **Limitaciones:** el almacenamiento local (`STORAGE_LOCAL_DIR`, `.storage/`) no sirve en hosting serverless; hace falta un proveedor de objetos. El rate limit es en memoria por instancia. Reservar en una rifa real retiene números hasta liberar o caducar.

## Comprobante PDF con QR (BUILD-007)

Solo modo demostración: no hay pagos ni ventas reales.

- En la página de reserva, «Descargar comprobante de demostración» → `GET /api/comprobante/<token>` genera **un PDF por pedido** (A4, estilo entrada de cine, identidad EasyRif) con todos los números de la reserva y **un único QR**. Más de ~56 números continúan en páginas siguientes (máx. 200). Cada página lleva la leyenda «DEMOSTRACIÓN — SIN VALIDEZ DE COMPRA NI PARTICIPACIÓN» y marca de agua.
- El QR abre `/verificar/<código>`, una página pública de solo lectura con el estado (activa, vencida, liberada, no verificable), la referencia y los números. No muestra contacto del comprador, ids internos ni el token de la reserva; está marcada `noindex`.
- Seguridad: el código de verificación es un HMAC derivado del id del pedido (solo se guarda su SHA-256), separado del token de acceso; no permite liberar ni consultar la reserva. Rutas con rate limit (en memoria, por instancia), respuestas 404 genéricas, `Cache-Control: private, no-store`. La URL del QR sale de `NEXT_PUBLIC_APP_URL` (o `BETTER_AUTH_URL`), nunca del Host de la petición. Un trigger en PostgreSQL impide marcar como `sold` números de pedidos demo.
- Política: el PDF se regenera en cada descarga con datos persistidos y es idéntico byte a byte (fecha de emisión fijada en la primera emisión). No se actualiza solo; el estado vigente se consulta por el QR.
- Librerías: `pdfkit` (PDF, mantenida, local) y `qrcode` (QR). En pruebas: `pdfjs-dist`, `@napi-rs/canvas` y `jsqr` para renderizar el PDF y decodificar el QR. Revisión visual: `VISUAL_OUT=<carpeta> npx vitest run tests/visual-pdf.test.ts` genera PNG.
- V0.7.1: tipografía Noto Sans / Noto Sans Mono (SIL OFL 1.1, paquetes `@expo-google-fonts`, leídas de `node_modules`, no copiadas al repositorio); acentos, ñ y alfabetos latinos extendidos se representan correctamente. Etiqueta de fecha según estado: «Válida hasta» (activa), «Venció el» (vencida), «Fecha límite original» (liberada), en formato `27 oct 2026, 13:10 UTC`. `NEXT_PUBLIC_APP_URL` se valida: en producción es obligatoria, https y con host público (se rechaza localhost/IP local; la ruta responde 503). Descargar varias veces el PDF no crea pedidos, números, participaciones ni cambia QR o estado (cubierto por tests contra PostgreSQL).
- Limitaciones: aparece el nombre de la organización en el PDF; emoji y CJK no están en la fuente y se muestran como `?`.

## Talonarios foliados y colaborativos (BUILD-008)

Solo modo demostración: sin pagos, ventas ni sorteos.

- Al crear una rifa se elige numeración individual o **talonarios foliados** (p. ej. 10 × 20 = 200 participaciones únicas `T-0007 / N-14`). Las rifas individuales (MIGUELITO, martin) no cambian.
- Talonarios exigen **fecha de cierre de ventas** y **fecha de sorteo** posterior (zona `APP_TIMEZONE`, por defecto `America/Santiago`). Tras el cierre no se aceptan reservas; el organizador puede extenderlo (auditado).
- **Responsables**: se asignan uno o varios folios, se pueden reasignar (historial conservado) y cada uno tiene un enlace propio `/v/<token>`. Rotar `BETTER_AUTH_SECRET` invalida esos enlaces. La ficha general `/r/<slug>` muestra todos los talonarios.
- Cada número reservado lleva su propio participante (nombre y correo obligatorios) y el comprador confirma su autorización. Los datos solo aparecen en el PDF privado y el panel; nunca en el QR ni en la verificación pública.
- Panel de avance en `/panel/rifas/<id>/responsables`. Detalle técnico: `docs/modelo-de-datos.md`.

## Sorteos — solo simulación (BUILD-009)

Ruta privada `/panel/rifas/<id>/sorteos`. **Todo resultado es una simulación sin validez**; el sorteo oficial está bloqueado siempre (backend e interfaz) y no existe acción para ejecutarlo.

- Dos etapas por premio: se sortea el folio con peso igual a sus participaciones elegibles restantes y luego el número uniformemente dentro del folio; cada participación tiene así probabilidad 1/N. Una extracción independiente por premio; solo la participación ganadora se excluye (el talonario y la persona siguen participando).
- Aleatoriedad con `crypto.randomInt`. Cada ejecución guarda instantánea, parámetros, pesos y digests SHA-256 (detectan alteraciones; no prueban aleatoriedad). Tablas `simulation_runs` y `simulation_draws` (inmutables, migración 0010), separadas de `drawings` y `winners`.
- Fuentes: configuración de la rifa (solo rifas por talonarios; no lee ventas, reservas ni compradores) o datos sintéticos (hasta 100.000 participaciones). Idempotente por clave; máximo 200 ejecuciones por rifa.
- Permisos: leer (`draws:read`, editor o superior), simular (`draws:simulate`, administrador o propietario). Auditoría `draw.simulated` y `draw.official_blocked`, sin datos personales.

## Aún pendiente

- Sorteo oficial, ventas reales y colegios (BUILD-010 en adelante).
- Verificación de correo, recuperación de contraseña, gestión de miembros e invitaciones.
- Pagos, validación y envío de comprobantes: fase futura, con nueva especificación.