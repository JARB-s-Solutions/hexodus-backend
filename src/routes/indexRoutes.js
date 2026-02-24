import { Router } from "express";
import authRoutes from "./authRoutes.js";
/* import accesRoutes from "../../../PruebaGym/accesoRoutes.js"; */
import membresiaRoutes from "./membresiaRoutes.js";
import cronRoutes from "./cronRoutes.js";

const router = Router();

// Rutas de autenticación
router.use("/auth", authRoutes);
/* router.use("/acesso", accesRoutes); */
router.use("/membresias", membresiaRoutes);
router.use("/cron", cronRoutes);

export default router;