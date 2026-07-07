import { z } from "zod";

export const requestOtpSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(5, "Ingresa un correo o teléfono válido")
    .max(120, "El correo o teléfono es demasiado largo"),
});

export const verifyOtpSchema = z.object({
  verification_id: z.string().uuid("La verificación no es válida"),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "El código debe tener 6 dígitos"),
});
