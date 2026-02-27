/*
  Warnings:

  - You are about to drop the column `apellido_materno` on the `socios` table. All the data in the column will be lost.
  - You are about to drop the column `apellido_paterno` on the `socios` table. All the data in the column will be lost.
  - You are about to drop the column `nombre` on the `socios` table. All the data in the column will be lost.
  - Added the required column `nombre_completo` to the `socios` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "socios" DROP COLUMN "apellido_materno",
DROP COLUMN "apellido_paterno",
DROP COLUMN "nombre",
ADD COLUMN     "nombre_completo" VARCHAR(240) NOT NULL;
