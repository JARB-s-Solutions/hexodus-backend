import prisma from "../../../config/prisma.js";

export const invalidateActiveSocioAppOtps = ({ socioId, destination }) =>
  prisma.socioAppOtp.updateMany({
    where: {
      socioId,
      destination,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { consumedAt: new Date() },
  });

export const createSocioAppOtp = ({ verificationId, socioId, destination, channel, codeHash, maxAttempts, expiresAt }) =>
  prisma.socioAppOtp.create({
    data: {
      verificationId,
      socioId,
      destination,
      channel,
      codeHash,
      maxAttempts,
      expiresAt,
    },
  });

export const findSocioAppOtpByVerificationId = ({ verificationId }) =>
  prisma.socioAppOtp.findUnique({
    where: { verificationId },
  });

export const incrementSocioAppOtpAttempts = ({ id }) =>
  prisma.socioAppOtp.update({
    where: { id },
    data: { attempts: { increment: 1 } },
  });

export const consumeSocioAppOtp = ({ id }) =>
  prisma.socioAppOtp.update({
    where: { id },
    data: { consumedAt: new Date() },
  });

export const createSocioAppOtpTransaction = ({ invalidate, create }) =>
  prisma.$transaction([
    invalidateActiveSocioAppOtps(invalidate),
    createSocioAppOtp(create),
  ]);
