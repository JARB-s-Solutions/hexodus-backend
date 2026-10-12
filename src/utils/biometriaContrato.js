import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export class BiometricError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "BiometricError";
    this.status = status;
    this.code = code;
  }
}

export const fail = (status, code, message) => { throw new BiometricError(status, code, message); };
export const legacyEnabled = () => process.env.BIOMETRIC_ALLOW_LEGACY === "true";
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
export const MAX_TEMPLATE_BYTES = 64 * 1024;

export function requireObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(400, "INVALID_INPUT", "Solicitud biométrica inválida.");
  return value;
}

export function onlyFields(value, names) {
  requireObject(value);
  if (Object.keys(value).some((key) => !names.includes(key))) fail(400, "INVALID_INPUT", "La solicitud contiene campos no permitidos.");
}

export function kioskId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/.test(value)) fail(400, "INVALID_DEVICE", "Identificador de dispositivo inválido.");
  return value;
}

export function socioCode(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || value.length < 1 || value.length > 30 || value.trim() !== value || /[\u0000-\u001f]/.test(value)) fail(400, "INVALID_SOCIO", "Código de socio inválido.");
  return value;
}

export function uuid(value) {
  if (typeof value !== "string" || !UUID.test(value)) fail(400, "INVALID_EVENT", "Identificador de evento o prueba inválido.");
  return value;
}

export function utcDate(value) {
  if (typeof value !== "string" || !UTC_DATE.test(value) || !Number.isFinite(Date.parse(value))) fail(400, "INVALID_DATE", "Fecha biométrica inválida.");
  // Reject normalized impossible calendar dates, while accepting .NET seven-digit fractions.
  if (new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)) fail(400, "INVALID_DATE", "Fecha biométrica inválida.");
  return new Date(value);
}

export function revision(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail(400, "INVALID_REVISION", "Revisión biométrica inválida.");
  return value;
}

export function deviceKey(id, env = process.env) {
  kioskId(id);
  let configured;
  try { configured = JSON.parse(env.BIOMETRIC_DEVICE_KEYS || "{}"); } catch { fail(503, "DEVICE_CONFIG", "Configuración biométrica no disponible."); }
  if (!configured || typeof configured !== "object" || Array.isArray(configured) || !Object.hasOwn(configured, id)) fail(403, "DEVICE_UNAUTHORIZED", "Dispositivo no autorizado.");
  const raw = configured[id];
  if (typeof raw !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) fail(503, "DEVICE_CONFIG", "Configuración biométrica no disponible.");
  const key = Buffer.from(raw, "base64");
  if (key.length < 32 || key.toString("base64") !== raw) fail(503, "DEVICE_CONFIG", "Configuración biométrica no disponible.");
  return key;
}

export function signToken(payload, env = process.env) {
  const segment = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", deviceKey(payload.kioskId, env)).update(segment, "ascii").digest("base64url");
  return `${segment}.${signature}`;
}

export function verifyToken(token, purpose, { env = process.env, maxBytes = 16384 } = {}) {
  if (typeof token !== "string" || token.length > maxBytes) fail(400, "INVALID_PROOF", "Prueba biométrica inválida.");
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every((part) => B64URL.test(part))) fail(400, "INVALID_PROOF", "Prueba biométrica inválida.");
  const [segment, signature] = parts;
  let payload;
  try {
    const bytes = Buffer.from(segment, "base64url");
    if (bytes.toString("base64url") !== segment) throw new Error();
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { fail(400, "INVALID_PROOF", "Prueba biométrica inválida."); }
  requireObject(payload);
  const expected = createHmac("sha256", deviceKey(payload.kioskId, env)).update(segment, "ascii").digest();
  const received = Buffer.from(signature, "base64url");
  if (received.toString("base64url") !== signature || received.length !== expected.length || !timingSafeEqual(expected, received)) fail(403, "INVALID_SIGNATURE", "Firma biométrica no válida.");
  if (payload.v !== 1 || payload.purpose !== purpose) fail(403, "INVALID_PURPOSE", "Propósito biométrico no autorizado.");
  return { payload, payloadHash: sha256(segment) };
}

export function checkLifetime(payload, maxDurationMs, now = new Date()) {
  const issued = utcDate(payload.issuedAtUtc);
  const expires = utcDate(payload.expiresAtUtc);
  if (issued.getTime() > now.getTime() + 30_000 || expires <= now || expires <= issued || expires - issued > maxDurationMs) fail(409, "PROOF_EXPIRED", "La prueba biométrica caducó. Sincroniza y captura nuevamente.");
}

export function templateBytes(value) {
  if (typeof value !== "string" || !value || value.length > Math.ceil(MAX_TEMPLATE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail(400, "INVALID_TEMPLATE", "La plantilla de huella tiene un formato o tamaño inválido.");
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > MAX_TEMPLATE_BYTES || bytes.toString("base64") !== value) fail(400, "INVALID_TEMPLATE", "La plantilla de huella tiene un formato o tamaño inválido.");
  let xml;
  try { xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail(400, "INVALID_TEMPLATE", "La plantilla debe contener XML UTF-8."); }
  // SDK deserialization and matching run only in the trusted motor. Do not parse XML entities here.
  if (!xml.trimStart().startsWith("<") || /<!\s*(DOCTYPE|ENTITY)\b/i.test(xml) || xml.includes("\u0000")) fail(400, "INVALID_TEMPLATE", "La plantilla debe contener XML biométrico válido.");
  return bytes;
}

export function validateEnrollmentProof(token, template, targetCode, options = {}) {
  const { payload } = verifyToken(token, "enrollment", options);
  onlyFields(payload, ["v", "purpose", "kioskId", "proofId", "revision", "codigoSocio", "templateSha256", "issuedAtUtc", "expiresAtUtc"]);
  uuid(payload.proofId);
  revision(payload.revision);
  socioCode(payload.codigoSocio, true);
  checkLifetime(payload, 300_000, options.now);
  if (payload.codigoSocio !== targetCode || !/^[a-f0-9]{64}$/.test(payload.templateSha256 || "") || sha256(templateBytes(template)) !== payload.templateSha256) fail(409, "PROOF_MISMATCH", "La prueba no corresponde al socio o a la huella. Captura nuevamente.");
  return payload;
}

export function validateRecognition(token, options = {}) {
  const verified = verifyToken(token, "recognition", options);
  const p = verified.payload;
  onlyFields(p, ["v", "purpose", "kioskId", "eventId", "instanceId", "codigoSocio", "tipo", "capturedAtUtc"]);
  uuid(p.eventId); uuid(p.instanceId); socioCode(p.codigoSocio);
  if (p.tipo !== "IN") fail(400, "INVALID_TYPE", "Tipo de evento biométrico no permitido.");
  if (utcDate(p.capturedAtUtc).getTime() > (options.now || new Date()).getTime() + 60_000) fail(400, "FUTURE_EVENT", "La hora del dispositivo está adelantada.");
  return verified;
}

export function validateLegacyAttendance(body) {
  onlyFields(body, ["socioId", "codigoSocio", "tipo", "kioskId", "confidence"]);
  const hasId = body.socioId !== undefined;
  const hasCode = body.codigoSocio !== undefined;
  if (hasId === hasCode) fail(400, "INVALID_SOCIO", "Envía exactamente un identificador de socio.");
  let where;
  if (hasId) {
    if (!(typeof body.socioId === "number" || typeof body.socioId === "string") || !/^[1-9]\d*$/.test(String(body.socioId)) || !Number.isSafeInteger(Number(body.socioId)) || Number(body.socioId) > 2147483647) fail(400, "INVALID_SOCIO", "ID de socio inválido.");
    where = { id: Number(body.socioId) };
  } else where = { codigoSocio: socioCode(body.codigoSocio) };
  if (body.tipo !== undefined && !["IN", "OUT"].includes(body.tipo)) fail(400, "INVALID_TYPE", "Tipo de asistencia inválido.");
  kioskId(body.kioskId);
  if (body.confidence !== undefined && (typeof body.confidence !== "number" || !Number.isFinite(body.confidence) || body.confidence < 0 || body.confidence > 100)) fail(400, "INVALID_CONFIDENCE", "Confianza inválida.");
  return where;
}

export function allowedOrigin(value, env = process.env) {
  let origins;
  try { origins = JSON.parse(env.BIOMETRIC_ALLOWED_ORIGINS || "[]"); } catch { fail(503, "ORIGIN_CONFIG", "Configuración biométrica no disponible."); }
  if (!Array.isArray(origins) || !origins.every((origin) => { try { return new URL(origin).origin === origin && !origin.includes("*"); } catch { return false; } })) fail(503, "ORIGIN_CONFIG", "Configuración biométrica no disponible.");
  if (typeof value !== "string" || !origins.includes(value)) fail(403, "ORIGIN_UNAUTHORIZED", "Origen no autorizado para el motor biométrico.");
  return value;
}

export function biometricErrorResponse(res, error) {
  if (error instanceof BiometricError) {
    res.status(error.status).json({ success: false, code: error.code, message: error.message });
    return true;
  }
  if (error?.code === "P2034" || error?.code === "P2002" && String(error.meta?.target).includes("proof")) {
    res.status(409).json({ success: false, code: "BIOMETRIC_CONFLICT", message: "La información biométrica cambió. Sincroniza y captura nuevamente." });
    return true;
  }
  return false;
}
