-- AlterTable
ALTER TABLE "socios" ADD COLUMN     "face_encoding" JSONB,
ADD COLUMN     "face_encoding_updated_at" TIMESTAMP(3),
ADD COLUMN     "huella_updated_at" TIMESTAMP(3);
