-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "passwordResetExpires" TIMESTAMP(3),
ADD COLUMN     "passwordResetToken" VARCHAR(255);
