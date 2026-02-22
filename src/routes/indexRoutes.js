import { Router } from "express";
import authRoutes from "./authRoutes.js";
import accesRoutes from "./accesoRoutes.js";
import membresiaRoutes from "./membresiaRoutes.js";

const router = Router();

// Rutas de autenticación
router.use("/auth", authRoutes);
router.use("/acesso", accesRoutes);
router.use("/membresia", membresiaRoutes);

export default router;