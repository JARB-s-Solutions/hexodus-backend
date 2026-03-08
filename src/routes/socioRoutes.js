import { Router } from "express";
import { 
    crearSocio, 
    cotizarMembresia, 
    listarSocios, 
    obtenerSocio, 
    actualizarSocio, 
    eliminarSocio,
    obtenerHistorialMembresias, 
    pagarMembresiaPendiente, 
    renovarMembresia
} from "../controller/socioController.js";
import { verificarToken, verificarPermiso } from "../middlewares/authMiddleware.js";

const router = Router();

// Todas las rutas de socios requieren estar logueado
router.use(verificarToken);

// Permisos por acción (Módulo: socios)

// Registro de nuevos socios (con biometría)
router.post("/", verificarPermiso("socios", "crear"), crearSocio);

// Consultar precios/cotizaciones antes de inscribir
router.post("/cotizar", verificarPermiso("socios", "ver"), cotizarMembresia);

// Listado general y perfil individual
router.get("/", verificarPermiso("socios", "ver"), listarSocios);
router.get("/:id", verificarPermiso("socios", "ver"), obtenerSocio);

// Modificación y baja (Soft Delete)
router.put("/:id", verificarPermiso("socios", "editar"), actualizarSocio);
router.delete("/:id", verificarPermiso("socios", "eliminar"), eliminarSocio);

// --- Rutas de Gestión de Pagos y Membresías ---

// Ver qué ha pagado el socio en el pasado
router.get("/:id/historial-pagos", verificarPermiso("socios", "verHistorial"), obtenerHistorialMembresias);

// Procesar una deuda pendiente
router.post("/:id/pagar-membresia", verificarPermiso("socios", "pagar"), pagarMembresiaPendiente);

// Realizar la renovación de un plan
router.post("/:id/renovar", verificarPermiso("socios", "renovar"), renovarMembresia);

export default router;