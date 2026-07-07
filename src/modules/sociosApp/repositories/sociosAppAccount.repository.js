import prisma from "../../../config/prisma.js";

export const upsertSocioAppAccount = ({ socioId, email, phone }) =>
  prisma.socioAppAccount.upsert({
    where: { socioId },
    update: { email, phone },
    create: {
      socioId,
      email,
      phone,
      status: "activa",
    },
  });

export const markSocioAppAccountLogin = ({ socioId }) =>
  prisma.socioAppAccount.updateMany({
    where: { socioId },
    data: { lastLoginAt: new Date() },
  });
