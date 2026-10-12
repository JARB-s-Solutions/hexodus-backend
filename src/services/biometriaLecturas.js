// Parameterized reads over the existing schema. Keep these on the supplied client
// so recognition reads stay inside the same transaction as its durable receipt.
export async function leerUsuarioBiometrico(db, usuarioId) {
  const [row] = await db.$queryRaw`
    SELECT u.usuario_id AS id, u.status::text AS status,
           r.rol_id AS "rolId", r.es_administrador AS "esAdministrador", r.permisos
    FROM usuarios u
    LEFT JOIN roles r ON r.rol_id = u.rol_id
    WHERE u.usuario_id = ${usuarioId}`;
  if (!row) return null;
  return {
    id: row.id, status: row.status,
    rol: row.rolId == null ? null : {
      id: row.rolId, esAdministrador: row.esAdministrador, permisos: row.permisos,
    },
  };
}

export async function leerSocioParaAsistencia(db, codigoSocio) {
  const [row] = await db.$queryRaw`
    SELECT s.socio_id AS id, s.codigo_socio AS "codigoSocio",
           s.nombre_completo AS "nombreCompleto", s.foto_url AS "fotoUrl",
           s.status::text AS status, s.is_deleted AS "isDeleted",
           m.membresia_socio_id AS "membresiaId", m.status::text AS "membresiaStatus",
           m.estado_pago::text AS "estadoPago", m.fecha_fin AS "fechaFin",
           p.nombre AS "planNombre"
    FROM socios s
    LEFT JOIN LATERAL (
      SELECT membresia_socio_id, status, estado_pago, fecha_fin, plan_id
      FROM membresia_socio
      WHERE socio_id = s.socio_id AND status <> 'cancelada'
      ORDER BY fecha_fin DESC LIMIT 1
    ) m ON true
    LEFT JOIN membresia_planes p ON p.plan_id = m.plan_id
    WHERE s.codigo_socio = ${codigoSocio}`;
  if (!row) return null;
  return {
    id: row.id, codigoSocio: row.codigoSocio, nombreCompleto: row.nombreCompleto,
    fotoUrl: row.fotoUrl, status: row.status, isDeleted: row.isDeleted,
    membresias: row.membresiaId == null ? [] : [{
      id: row.membresiaId, status: row.membresiaStatus, estadoPago: row.estadoPago,
      fechaFin: row.fechaFin, plan: { nombre: row.planNombre },
    }],
  };
}
