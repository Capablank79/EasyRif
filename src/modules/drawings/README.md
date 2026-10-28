# drawings

Sorteos. BUILD-009 implementa **solo simulación** (`simulation.ts` dominio puro, `service.ts`, `actions.ts`, `forms.tsx`). El sorteo oficial está bloqueado siempre (`launchOfficialDraw` lanza `blocked` y audita). Las tablas `drawings` y `winners` quedan reservadas al sorteo oficial. Ver `docs/modelo-de-datos.md`.
