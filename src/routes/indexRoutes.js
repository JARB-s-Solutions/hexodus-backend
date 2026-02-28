import { Router } from "express";
import authRoutes from "./authRoutes.js";
import membresiaRoutes from "./membresiaRoutes.js";
import cronRoutes from "./cronRoutes.js";
import socioRoutes from "./socioRoutes.js";
import metodoPagoRoutes from "./metodoPagoRoutes.js";
import productoRoutes from "./productoRoutes.js";
import categoriaRoutes from "./categoriaRoutes.js";
import compraInvRoutes from "./compraRoutes.js"

const router = Router();

router.use("/auth", authRoutes);
router.use("/membresias", membresiaRoutes);
router.use("/socios", socioRoutes);
router.use("/cron", cronRoutes);
router.use("/metodos-pago", metodoPagoRoutes);
router.use("/categorias", categoriaRoutes);
router.use("/productos", productoRoutes);
router.use("/compras", compraInvRoutes);


export default router;