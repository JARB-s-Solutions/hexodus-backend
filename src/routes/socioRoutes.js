import { Router } from "express";
import { crearSocio, cotizarMembresia, listarSocios, obtenerSocio, actualizarSocio, eliminarSocio,
    obtenerHistorialMembresias, 
    pagarMembresiaPendiente, 
    renovarMembresia
 } from "../controller/socioController.js";
import { verificarToken } from "../middlewares/authMiddleware.js";

const router = Router();

// Ruta protegida para crear un socio con biometría
router.post("/", verificarToken, crearSocio);

// Ruta protegida para cotizar membresía
router.post("/cotizar", verificarToken, cotizarMembresia);

// Ruta protegida para listar socios
router.get("/", verificarToken, listarSocios);
// Ruta protegida para obtener un socio específico
router.get("/:id", verificarToken, obtenerSocio);

// Ruta protegida para editar un socio
router.put("/:id", verificarToken, actualizarSocio);
// Ruta protegida para eliminar un socio
router.delete("/:id", verificarToken, eliminarSocio);

router.get("/:id/historial-pagos", verificarToken, obtenerHistorialMembresias);

router.post("/:id/pagar-membresia", verificarToken, pagarMembresiaPendiente);

router.post("/:id/renovar", verificarToken, renovarMembresia);

export default router;