/*
  Warnings:

  - You are about to drop the column `precio_actual` on the `membresia_planes` table. All the data in the column will be lost.
  - Added the required column `precio_base` to the `membresia_planes` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "membresia_planes" DROP COLUMN "precio_actual",
ADD COLUMN     "es_oferta" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fecha_fin_oferta" TIMESTAMP(3),
ADD COLUMN     "precio_base" DECIMAL(10,2) NOT NULL,
ADD COLUMN     "precio_oferta" DECIMAL(10,2);
