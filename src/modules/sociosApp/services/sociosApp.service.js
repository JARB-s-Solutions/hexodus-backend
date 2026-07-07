import jwt from "jsonwebtoken";
import crypto from "crypto";
import { sendSocioOtpEmail } from "../mailers/sociosApp.mailer.js";
import { mapSocioForApp } from "../mappers/sociosApp.mapper.js";
import { markSocioAppAccountLogin, upsertSocioAppAccount } from "../repositories/sociosAppAccount.repository.js";
import { createSocioAppAuthEvent } from "../repositories/sociosAppAuthEvent.repository.js";
import {
  consumeSocioAppOtp,
  createSocioAppOtpTransaction,
  findSocioAppOtpByVerificationId,
  incrementSocioAppOtpAttempts,
} from "../repositories/sociosAppOtp.repository.js";
import { createSocioAppSession, revokeSocioAppSession } from "../repositories/sociosAppSession.repository.js";
import { findSocioAppByEmail, findSocioAppById, findSocioAppPhoneCandidates } from "../repositories/sociosAppSocio.repository.js";

const SOCIO_TOKEN_EXPIRES_IN = process.env.SOCIO_APP_JWT_EXPIRES_IN || "30d";
const OTP_TTL_MS = Number(process.env.SOCIO_APP_OTP_TTL_MS || 10 * 60 * 1000);
const OTP_MAX_ATTEMPTS = Number(process.env.SOCIO_APP_OTP_MAX_ATTEMPTS || 5);
const OTP_CHANNEL_EMAIL = "email";

const normalizeEmail = (value) => value.trim().toLowerCase();
const normalizePhone = (value) => value.replace(/\D/g, "");
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const hashCode = ({ verificationId, code }) =>
  crypto
    .createHash("sha256")
    .update(`${verificationId}:${code}:${process.env.JWT_SECRET || "hexodus-socios-app"}`)
    .digest("hex");

const findSocioByIdentifier = async (identifier) => {
  const value = identifier.trim();

  if (isEmail(value)) {
    return findSocioAppByEmail({ email: normalizeEmail(value) });
  }

  const phone = normalizePhone(value);

  if (phone.length < 7) {
    return null;
  }

  const candidates = await findSocioAppPhoneCandidates();

  return candidates.find((socio) => normalizePhone(socio.telefono || "").endsWith(phone.slice(-10))) || null;
};

const findSocioById = async (socioId) => {
  const socio = await findSocioAppById({ socioId });

  if (!socio) {
    const error = new Error("Socio no encontrado.");
    error.statusCode = 404;
    throw error;
  }

  return socio;
};

const parseExpiresInToMs = (value) => {
  if (typeof value === "number") return value * 1000;

  const match = String(value).trim().match(/^(\d+)\s*([smhd])?$/i);
  if (!match) return 30 * 24 * 60 * 60 * 1000;

  const amount = Number(match[1]);
  const unit = (match[2] || "s").toLowerCase();
  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return amount * multipliers[unit];
};

const signSocioToken = ({ socio, tokenId }) =>
  jwt.sign(
    {
      tipo: "socio_app",
      scope: "socio:app",
      socioId: socio.id,
      codigoSocio: socio.codigoSocio,
      jti: tokenId,
    },
    process.env.JWT_SECRET,
    { expiresIn: SOCIO_TOKEN_EXPIRES_IN },
  );

const createAuthEvent = async ({ socioId = null, eventType, channel = null, destination = null, success, reason = null, meta = {} }) => {
  await createSocioAppAuthEvent({ socioId, eventType, channel, destination, success, reason, meta });
};

const ensureSocioAppAccount = async (socio) => {
  await upsertSocioAppAccount({
    socioId: socio.id,
    email: socio.correo ? normalizeEmail(socio.correo) : null,
    phone: socio.telefono ? normalizePhone(socio.telefono) : null,
  });
};

const createOtpChallenge = async ({ socio, destination, meta }) => {
  const verificationId = crypto.randomUUID();
  const code = crypto.randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await createSocioAppOtpTransaction({
    invalidate: {
      socioId: socio.id,
      destination,
    },
    create: {
      verificationId,
      socioId: socio.id,
      destination,
      channel: OTP_CHANNEL_EMAIL,
      codeHash: hashCode({ verificationId, code }),
      maxAttempts: OTP_MAX_ATTEMPTS,
      expiresAt,
    },
  });

  await createAuthEvent({
    socioId: socio.id,
    eventType: "otp_requested",
    channel: OTP_CHANNEL_EMAIL,
    destination,
    success: true,
    meta,
  });

  return {
    verificationId,
    code,
    expiresAt,
    expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
  };
};

const verifyOtpChallenge = async ({ verificationId, code, meta }) => {
  const challenge = await findSocioAppOtpByVerificationId({ verificationId });

  if (!challenge) {
    return { ok: false, reason: "not_found" };
  }

  if (challenge.consumedAt) {
    return { ok: false, reason: "consumed", socioId: challenge.socioId };
  }

  if (challenge.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired", socioId: challenge.socioId };
  }

  if (challenge.attempts >= challenge.maxAttempts) {
    return { ok: false, reason: "too_many_attempts", socioId: challenge.socioId, remainingAttempts: 0 };
  }

  const isValid = challenge.codeHash === hashCode({ verificationId, code });

  if (!isValid) {
    const updated = await incrementSocioAppOtpAttempts({ id: challenge.id });

    return {
      ok: false,
      reason: updated.attempts >= updated.maxAttempts ? "too_many_attempts" : "invalid_code",
      socioId: challenge.socioId,
      remainingAttempts: Math.max(updated.maxAttempts - updated.attempts, 0),
    };
  }

  await consumeSocioAppOtp({ id: challenge.id });

  await createAuthEvent({
    socioId: challenge.socioId,
    eventType: "otp_verified",
    channel: challenge.channel,
    destination: challenge.destination,
    success: true,
    meta,
  });

  return { ok: true, socioId: challenge.socioId };
};

const createSocioSession = async ({ socio, meta = {} }) => {
  const tokenId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + parseExpiresInToMs(SOCIO_TOKEN_EXPIRES_IN));

  await createSocioAppSession({
    socioId: socio.id,
    tokenId,
    expiresAt,
    meta,
  });

  await markSocioAppAccountLogin({ socioId: socio.id });

  return { tokenId, expiresAt };
};

export const requestSocioOtp = async ({ identifier, meta = {} }) => {

  const socio = await findSocioByIdentifier(identifier);

  if (!socio) {
    await createAuthEvent({
      eventType: "otp_request_failed",
      success: false,
      reason: "socio_not_found",
      destination: identifier,
      meta,
    });

    const error = new Error("No encontramos un socio activo con ese correo o teléfono.");
    error.statusCode = 404;
    throw error;
  }

  if (socio.status === "bloqueado") {
    await createAuthEvent({
      socioId: socio.id,
      eventType: "otp_request_failed",
      success: false,
      reason: "socio_blocked",
      destination: socio.correo,
      meta,
    });

    const error = new Error("Tu cuenta de socio está bloqueada. Contacta a recepción.");
    error.statusCode = 403;
    throw error;
  }

  if (!socio.correo) {
    await createAuthEvent({
      socioId: socio.id,
      eventType: "otp_request_failed",
      success: false,
      reason: "missing_email",
      meta,
    });

    const error = new Error("Este socio no tiene correo registrado. Actualiza tus datos en recepción.");
    error.statusCode = 409;
    throw error;
  }

  await ensureSocioAppAccount(socio);

  const challenge = await createOtpChallenge({
    socio,
    destination: socio.correo,
    meta,
  });

  const skipEmail = process.env.SOCIO_APP_SKIP_EMAIL === "true";

  if (!skipEmail) {
    await sendSocioOtpEmail({
      to: socio.correo,
      name: socio.nombreCompleto,
      code: challenge.code,
      expiresInMinutes: Math.ceil(challenge.expiresInSeconds / 60),
    });
  }

  return {
    verification_id: challenge.verificationId,
    destination: maskEmail(socio.correo),
    expires_in_seconds: challenge.expiresInSeconds,
    ...(skipEmail && process.env.NODE_ENV !== "production" ? { debug_code: challenge.code } : {}),
  };
};

export const verifySocioOtp = async ({ verification_id, code, meta = {} }) => {
  const result = await verifyOtpChallenge({
    verificationId: verification_id,
    code,
    meta,
  });

  if (!result.ok) {
    await createAuthEvent({
      socioId: result.socioId,
      eventType: "otp_verify_failed",
      success: false,
      reason: result.reason,
      meta,
    });

    const error = new Error(getOtpErrorMessage(result.reason));
    error.statusCode = result.reason === "too_many_attempts" ? 429 : 400;
    error.details = { remaining_attempts: result.remainingAttempts };
    throw error;
  }

  const socio = await findSocioById(result.socioId);
  const session = await createSocioSession({ socio, meta });
  const accessToken = signSocioToken({ socio, tokenId: session.tokenId });

  await createAuthEvent({
    socioId: socio.id,
    eventType: "session_created",
    success: true,
    meta,
  });

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: SOCIO_TOKEN_EXPIRES_IN,
    auth_mode: "passwordless",
    password_setup_available: false,
    socio: mapSocioForApp(socio),
  };
};

export const getSocioAppProfile = async ({ socioId }) => {
  const socio = await findSocioById(socioId);

  return mapSocioForApp(socio);
};

export const logoutSocioApp = async ({ socioId, tokenId, meta = {} }) => {
  await revokeSocioAppSession({ socioId, tokenId });

  await createAuthEvent({
    socioId,
    eventType: "session_revoked",
    success: true,
    meta,
  });
};

const maskEmail = (email) => {
  const [localPart, domain] = email.split("@");
  const visible = localPart.slice(0, 2);
  const hidden = "*".repeat(Math.max(localPart.length - 2, 2));

  return `${visible}${hidden}@${domain}`;
};

const getOtpErrorMessage = (reason) => {
  const messages = {
    not_found: "La verificación no existe o ya expiró.",
    consumed: "Este código ya fue utilizado.",
    expired: "El código expiró. Solicita uno nuevo.",
    too_many_attempts: "Demasiados intentos. Solicita un nuevo código.",
    invalid_code: "El código ingresado no es correcto.",
  };

  return messages[reason] || "No pudimos verificar el código.";
};
