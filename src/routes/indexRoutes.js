import { Router } from "express";
import authRoutes from "./authRoutes.js";

const router = Router();

// Rutas de autenticación
router.use("/auth", authRoutes);

export default router;