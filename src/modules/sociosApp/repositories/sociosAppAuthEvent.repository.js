import prisma from "../../../config/prisma.js";

export const createSocioAppAuthEvent = ({ socioId = null, eventType, channel = null, destination = null, success, reason = null, meta = {} }) =>
  prisma.socioAppAuthEvent.create({
    data: {
      socioId,
      eventType,
      channel,
      destination,
      success,
      reason,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    },
  });
