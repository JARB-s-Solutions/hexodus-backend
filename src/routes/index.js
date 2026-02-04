// src/routes/index.js
import express from 'express';

// Aquí importaremos las rutas específicas cuando las creemos
// import socioRoutes from './socioRoutes.js';
// import pagosRoutes from './pagosRoutes.js';

const router = express.Router();

// Rutas de prueba para verificar que el router funciona
router.get('/health', (req, res) => {
    res.json({ status: 'API Online', timestamp: new Date() });
});

// Futuras implementaciones:
// router.use('/socios', socioRoutes);
// router.use('/pagos', pagosRoutes);

export default router;