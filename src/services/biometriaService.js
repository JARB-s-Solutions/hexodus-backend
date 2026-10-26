import { evaluarAccesoSocio } from "../utils/membresiaVigencia.js";
import { leerSocioParaAsistencia } from "./biometriaLecturas.js";
import { fechaUTCADiaStr, fechaUTCAISOEnMerida } from "../utils/timezone.js";
import {
  BiometricError, fail, kioskId, socioCode, onlyFields, allowedOrigin,
  deviceKey, signToken, validateRecognition, validateEnrollmentProof,
  legacyEnabled, templateBytes, checkLifetime, sha256,
} from "../utils/biometriaContrato.js";

const INTERNAL_MODULE = "biometria_interna";
const proofLogId = (id) => `bio-proof:${id.toLowerCase()}`;
const eventLogId = (id) => `bio-event:${id.toLowerCase()}`;
const readFingerprints = (tx) => tx.socio.findMany({
  where: { isDeleted: false, huellaTemplate: { not: null } },
  select: { id: true, codigoSocio: true, huellaTemplate: true, huellaUpdatedAt: true, status: true },
  orderBy: { id: "asc" },
});

// Content version: no database counter, trigger, or schema change is required.
export function fingerprintRevision(rows) {
  const entries = rows
    .filter((row) => row.isDeleted !== true && row.huellaTemplate != null)
    .map((row) => [row.codigoSocio, row.huellaTemplate, row.status !== "bloqueado"])
    .sort((left, right) => left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0);
  return sha256(JSON.stringify(entries));
}

async function lockFingerprints(tx) {
  // Unlike an advisory lock, this also serializes existing INSERT/UPDATE/DELETE paths.
  // Ordinary reads remain available; acquire this before taking any member row locks.
  await tx.$executeRaw`LOCK TABLE "socios" IN SHARE ROW EXCLUSIVE MODE`;
}

export async function lockBiometricRevision(tx) {
  await lockFingerprints(tx);
  return fingerprintRevision(await readFingerprints(tx));
}

// Called before the mutation, then consumed in exactly the same transaction as the member write.
export function prepareFingerprint(biometria, targetCode, options = {}) {
  if (!biometria || !Object.hasOwn(biometria, "fingerprint_template")) return { changed: false };
  const template = biometria.fingerprint_template;
  if (template === null) return { changed: true, template: null, proof: null };
  templateBytes(template);
  if (!biometria.enrollment_proof && legacyEnabled()) return { changed: true, template, proof: null, legacy: true };
  if (!biometria.enrollment_proof) fail(403, "ENROLLMENT_PROOF_REQUIRED", "Captura la huella con un motor autorizado antes de guardar.");
  return { changed: true, template, proof: validateEnrollmentProof(biometria.enrollment_proof, template, targetCode, options) };
}

export async function consumeEnrollmentProof(tx, fingerprint, now = new Date()) {
  if (!fingerprint.changed) return;
  const current = await lockBiometricRevision(tx);
  if (!fingerprint.proof) return; // Null removal or explicit legacy mode still serializes with signed enrollments.
  const proof = fingerprint.proof;
  checkLifetime(proof, 300_000, now);
  if (current !== proof.revision) fail(409, "BIOMETRIC_REVISION_STALE", "Las huellas cambiaron. Sincroniza y captura nuevamente.");
  const id = proofLogId(proof.proofId);
  const used = await tx.auditoriaLog.findUnique({ where: { id } });
  if (used) fail(409, "ENROLLMENT_PROOF_REUSED", "Esta prueba de huella ya fue utilizada. Captura nuevamente.");
  await tx.auditoriaLog.create({ data: {
    id, timestamp: now, modulo: INTERNAL_MODULE, accion: "enrolamiento",
    descripcion: "Comprobación biométrica consumida al guardar al socio.",
    detalles: { version: 1, kind: "enrollment", proofId: proof.proofId,
      kioskId: proof.kioskId, codigoSocio: proof.codigoSocio,
      revision: proof.revision, consumedAtUtc: now.toISOString() },
  } });
}

export function createBiometricService({ db, env = process.env, clock = () => new Date(), requirePermissions }) {
  return {
    async session(req) {
      onlyFields(req.body, ["kioskId", "scope", "codigoSocio"]);
      const id = kioskId(req.body.kioskId);
      deviceKey(id, env);
      if (!["kiosk", "enrollment"].includes(req.body.scope)) fail(400, "INVALID_SCOPE", "Ámbito del motor inválido.");
      const target = req.body.codigoSocio === undefined ? null : socioCode(req.body.codigoSocio, true);
      if (req.body.scope === "kiosk" && target !== null) fail(400, "INVALID_SCOPE", "El kiosco no requiere un socio objetivo.");
      const permissions = req.body.scope === "kiosk"
        ? [["asistencia", "crear"], ["biometria", "sincronizar"]]
        : [["biometria", "enrolar"], ["biometria", "sincronizar"], ["socios", target ? "editar" : "crear"]];
      await requirePermissions(req, permissions);
      if (target) {
        const socio = await db.socio.findUnique({ where: { codigoSocio: target }, select: { isDeleted: true } });
        if (!socio || socio.isDeleted) fail(404, "SOCIO_NOT_FOUND", "Socio no encontrado.");
      }
      const origin = allowedOrigin(req.headers.origin, env);
      const now = clock();
      const expiresAtUtc = new Date(now.getTime() + (req.body.scope === "kiosk" ? 8 * 60 * 60_000 : 600_000)).toISOString();
      const motorToken = signToken({ v: 1, purpose: "session", kioskId: id, scope: req.body.scope,
        codigoSocio: target, origin, issuedAtUtc: now.toISOString(), expiresAtUtc }, env);
      return { success: true, data: { motorToken, expiresAtUtc } };
    },

    async snapshot(req) {
      await requirePermissions(req, [["biometria", "sincronizar"]]);
      const id = kioskId(req.query.kioskId);
      deviceKey(id, env);
      const { rows, revision, issuedAtUtc } = await db.$transaction(async (tx) => {
        await lockFingerprints(tx);
        const rows = await readFingerprints(tx);
        // Database time, sampled under the same lock, orders snapshots from every backend instance.
        const [stamp] = await tx.$queryRaw`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "issuedAtUtc"`;
        if (typeof stamp?.issuedAtUtc !== "string") fail(503, "SNAPSHOT_UNAVAILABLE", "No se pudo fechar la sincronización biométrica.");
        return { rows, revision: fingerprintRevision(rows), issuedAtUtc: stamp.issuedAtUtc };
      }, { maxWait: 5000, timeout: 20000 });
      const snapshot = signToken({ v: 1, purpose: "cache", kioskId: id, revision,
        issuedAtUtc, expiresAtUtc: new Date(Date.parse(issuedAtUtc) + 300_000).toISOString(),
        baseDeDatos: rows.map((s) => ({ codigoSocio: s.codigoSocio, huellaTemplate: s.huellaTemplate, habilitado: s.status !== "bloqueado" })),
      }, env);
      const data = rows.filter((s) => s.status !== "bloqueado").map(({ status, ...s }) => s);
      return { success: true, message: "Sincronización de huellas exitosa", data, total: data.length, snapshot, revision };
    },

    async recognize(req) {
      await requirePermissions(req, [["asistencia", "crear"]]);
      onlyFields(req.body, ["eventProof"]);
      const now = clock();
      const { payload: event, payloadHash } = validateRecognition(req.body.eventProof, { env, now });
      const returnExisting = async (row) => {
        const record = row.detalles;
        if (row.modulo !== INTERNAL_MODULE || !record || typeof record !== "object" || Array.isArray(record) || record.version !== 1 || record.kind !== "recognition")
          fail(503, "EVENT_RECEIPT_INVALID", "El comprobante del evento no está disponible.");
        if (record.payloadHash !== payloadHash || record.kioskId !== event.kioskId || record.eventId !== event.eventId || record.instanceId !== event.instanceId)
          fail(409, "EVENT_CONFLICT", "El identificador del evento ya tiene otro contenido.");
        if (!record.response || typeof record.response !== "object" || Array.isArray(record.response) || record.response.success !== true || typeof record.response.receipt !== "string" || !["permitido", "denegado"].includes(record.response.data?.decision))
          fail(503, "EVENT_PENDING", "El evento sigue pendiente de procesamiento.");
        if (record.accesoId !== null) {
          if (!Number.isSafeInteger(record.accesoId)) fail(503, "BIO_RECEIPT_INCONSISTENT", "El comprobante requiere revisión administrativa. No se volverá a registrar la asistencia.");
          const attendance = await db.acceso.findUnique({ where: { id: record.accesoId }, select: {
            socioId: true, fechaHora: true, dispositivoId: true, metodo: true,
          } });
          if (!attendance || attendance.socioId !== record.response.data.socio?.id ||
              attendance.fechaHora.getTime() !== Date.parse(event.capturedAtUtc) ||
              attendance.dispositivoId !== event.kioskId || attendance.metodo !== "huella")
            fail(503, "BIO_RECEIPT_INCONSISTENT", "El comprobante y la asistencia no coinciden. Requiere revisión administrativa; no se creará otra asistencia.");
        } else if (record.response.data.asistencia !== null) {
          fail(503, "BIO_RECEIPT_INCONSISTENT", "El comprobante de asistencia requiere revisión administrativa.");
        }
        return record.response;
      };
      const id = eventLogId(event.eventId);
      const existing = await db.auditoriaLog.findUnique({ where: { id } });
      if (existing) return returnExisting(existing);
      const record = { version: 1, kind: "recognition", eventId: event.eventId,
        kioskId: event.kioskId, instanceId: event.instanceId, payloadHash,
        capturedAtUtc: event.capturedAtUtc, receivedAtUtc: now.toISOString() };
      try {
        return await db.$transaction(async (tx) => {
          // The existing audit primary key reserves the event atomically with its attendance.
          // Do not use the best-effort audit helper here: failures must roll back the transaction.
          await tx.auditoriaLog.create({ data: {
            id, timestamp: now, usuarioId: req.user.id, modulo: INTERNAL_MODULE, accion: "evento",
            descripcion: "Comprobante interno de asistencia biométrica.", detalles: record,
          } });
          const socio = await leerSocioParaAsistencia(tx, event.codigoSocio);
          const membership = socio?.membresias?.[0];
          const decision = evaluarAccesoSocio(socio, membership, now, 2);
          if (decision.permitido) {
            // Preserve existing membership/status normalization within this transaction.
            if (socio.status !== "activo") await tx.socio.update({ where: { id: socio.id }, data: { status: "activo" } });
            if (membership.status !== "activa") await tx.membresiaSocio.update({ where: { id: membership.id }, data: { status: "activa" } });
          }
          const processedAtUtc = clock();
          const acceso = socio ? await tx.acceso.create({ data: {
            socioId: socio.id, tipo: decision.permitido ? event.tipo : "DENEGADO", dispositivoId: event.kioskId,
            metodo: "huella", validado: decision.permitido, confidence: null,
            estadoAcceso: decision.permitido ? "permitido" : "denegado", motivoCodigo: decision.motivoCodigo,
            motivo: decision.motivoTexto, fechaHora: new Date(event.capturedAtUtc), usuarioId: req.user.id,
          } }) : null;
          const receipt = signToken({ v: 1, purpose: "receipt", kioskId: event.kioskId, eventId: event.eventId, processedAtUtc: processedAtUtc.toISOString() }, env);
          const response = { success: true, data: {
            decision: decision.permitido ? "permitido" : "denegado", motivo_codigo: decision.motivoCodigo,
            motivo_texto: decision.motivoTexto,
            socio: socio ? { id: socio.id, codigo_socio: socio.codigoSocio, nombre_completo: socio.nombreCompleto,
              foto_perfil_url: socio.fotoUrl, membresia: membership?.plan?.nombre || "Sin plan",
              fecha_fin_membresia: membership ? fechaUTCADiaStr(membership.fechaFin) : null } : null,
            asistencia: acceso ? { id: acceso.id, tipo: acceso.tipo, timestamp: fechaUTCAISOEnMerida(acceso.fechaHora),
              metodo: "huella", estado_acceso: acceso.estadoAcceso, capturedAtUtc: event.capturedAtUtc,
              receivedAtUtc: now.toISOString(), processedAtUtc: processedAtUtc.toISOString() } : null,
            recovered: now.getTime() - new Date(event.capturedAtUtc).getTime() > 120_000,
          }, receipt };
          await tx.auditoriaLog.update({ where: { id }, data: {
            detalles: { ...record, processedAtUtc: processedAtUtc.toISOString(), accesoId: acceso?.id || null, response },
          } });
          return response;
        }, { maxWait: 5000, timeout: 20000 });
      } catch (error) {
        if (error?.code === "P2002") {
          // PostgreSQL's unique constraint waits for the concurrent transaction before returning P2002.
          const committed = await db.auditoriaLog.findUnique({ where: { id } });
          if (committed) return returnExisting(committed);
        }
        throw error;
      }
    },
  };
}
