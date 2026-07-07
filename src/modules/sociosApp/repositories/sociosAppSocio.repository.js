import prisma from "../../../config/prisma.js";

export const socioAppInclude = {
  membresias: {
    include: { plan: true },
    orderBy: { id: "desc" },
    take: 1,
  },
  contratos: {
    orderBy: { id: "desc" },
    take: 1,
  },
};

export const findSocioAppByEmail = ({ email }) =>
  prisma.socio.findFirst({
    where: {
      correo: { equals: email, mode: "insensitive" },
      isDeleted: false,
    },
    include: socioAppInclude,
  });

export const findSocioAppPhoneCandidates = () =>
  prisma.socio.findMany({
    where: {
      telefono: { not: null },
      isDeleted: false,
    },
    include: socioAppInclude,
    take: 500,
    orderBy: { id: "desc" },
  });

export const findSocioAppById = ({ socioId }) =>
  prisma.socio.findFirst({
    where: {
      id: Number(socioId),
      isDeleted: false,
    },
    include: socioAppInclude,
  });
