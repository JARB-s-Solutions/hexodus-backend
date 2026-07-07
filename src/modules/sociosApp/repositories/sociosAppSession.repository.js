import prisma from "../../../config/prisma.js";

export const createSocioAppSession = ({ socioId, tokenId, expiresAt, meta = {} }) =>
  prisma.socioAppSession.create({
    data: {
      socioId,
      tokenId,
      deviceId: meta.deviceId,
      deviceName: meta.deviceName,
      platform: meta.platform,
      appVersion: meta.appVersion,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      expiresAt,
      lastUsedAt: new Date(),
    },
  });

export const findActiveSocioAppSession = ({ socioId, tokenId }) =>
  prisma.socioAppSession.findFirst({
    where: {
      tokenId,
      socioId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });

export const touchSocioAppSession = ({ id }) =>
  prisma.socioAppSession.update({
    where: { id },
    data: { lastUsedAt: new Date() },
  });

export const revokeSocioAppSession = ({ socioId, tokenId }) =>
  prisma.socioAppSession.updateMany({
    where: {
      socioId,
      tokenId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
