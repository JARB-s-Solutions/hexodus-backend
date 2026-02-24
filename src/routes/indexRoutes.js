import { Router } from "express";
import authRoutes from "./authRoutes.js";
import membresiaRoutes from "./membresiaRoutes.js";
import cronRoutes from "./cronRoutes.js";
import socioRoutes from "./socioRoutes.js";
import metodoPagoRoutes from "./metodoPagoRoutes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/membresias", membresiaRoutes);
router.use("/socios", socioRoutes);
router.use("/cron", cronRoutes);
router.use("/metodos-pago", metodoPagoRoutes);


export default router;