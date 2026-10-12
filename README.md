# Backend HEXODUS

El backend de producción se mantiene en `main`. La entrega biométrica de octubre de 2026 se documenta en [`docs/BIOMETRIA-SSE-RELEASE-2026-10-12.md`](docs/BIOMETRIA-SSE-RELEASE-2026-10-12.md).

## Alcance de la entrega

Esta rama agrega la comunicación segura entre el motor local y el backend, comprobantes firmados para enrolamiento y asistencia, control de permisos actuales, protección contra eventos duplicados y el aviso de membresía dos días antes del vencimiento.

La carpeta `prisma/` no forma parte de esta entrega: su esquema y sus migraciones permanecen sin cambios. El despliegue del código no ejecuta migraciones ni modifica Supabase por sí mismo.

## Pruebas

```powershell
npm test
```

Las pruebas que requieren PostgreSQL solo se habilitan con `BIOMETRIC_TEST_DATABASE_URL` apuntando explícitamente a una base local cuyo nombre termine en `_test`; nunca usan la base de producción.
