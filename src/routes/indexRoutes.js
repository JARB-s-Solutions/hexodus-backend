import { Router } from "express";
import authRoutes from "./authRoutes.js";
import membresiaRoutes from "./membresiaRoutes.js";
import cronRoutes from "./cronRoutes.js";
import socioRoutes from "./socioRoutes.js";
import metodoPagoRoutes from "./metodoPagoRoutes.js";
import productoRoutes from "./productoRoutes.js";
import categoriaRoutes from "./categoriaRoutes.js";
import compraInvRoutes from "./compraRoutes.js"
import ventaRoutes from "./ventaRoutes.js";
import cajaRoutes from "./cajaRoutes.js";
import analisisRoutes from "./analisisRoutes.js";
import conceptoRoutes from "./conceptoRoutes.js";
import cajaMovimientoRoutes from "./cajaMovimientosRoutes.js";
import dashboardFinancieroRoutes from "./dashboardFinancieroRoutes.js";
import dashboardRoutes from "./dashboardRoutes.js";
import asistenciaRoutes from "./asistenciaRoutes.js";
import usuarioRoutes from "./usuarioRoutes.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/membresias", membresiaRoutes);
router.use("/socios", socioRoutes);
router.use("/cron", cronRoutes);
router.use("/metodos-pago", metodoPagoRoutes);
router.use("/categorias", categoriaRoutes);
router.use("/productos", productoRoutes);
router.use("/compras", compraInvRoutes);
router.use("/ventas", ventaRoutes);
router.use("/caja", cajaRoutes);
router.use("/analisis", analisisRoutes);
router.use("/conceptos", conceptoRoutes);
router.use("/movimientos", cajaMovimientoRoutes);
router.use("/financiero", dashboardFinancieroRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/asistencia", asistenciaRoutes);
router.use("/usuarios", usuarioRoutes);

export default router;