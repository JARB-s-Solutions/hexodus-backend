import prisma from "../config/prisma.js";

// 1. ABRIR CAJA
export const abrirCaja = async (req, res) => {
    try {
        const { monto_inicial } = req.body;

        // Verificar si ya hay una caja abierta
        const cajaAbierta = await prisma.corteCaja.findFirst({
            where: { status: 'abierto' }
        });

        if (cajaAbierta) {
            return res.status(400).json({ error: "Ya existe un turno de caja abierto. Debes cerrarlo primero." });
        }

        // Transacción para crear el Corte y el Movimiento inicial
        const resultado = await prisma.$transaction(async (tx) => {
            
            // Crear la sesión de caja
            const nuevoCorte = await tx.corteCaja.create({
                data: {
                    usuarioId: req.user.id,
                    inicio: new Date(),
                    fin: new Date(), // Se actualizará al cerrar
                    status: 'abierto',
                    totalVentas: 0
                }
            });

            // Registrar el ingreso del "Fondo de Caja"
            let conceptoApertura = await tx.concepto.findFirst({ where: { nombre: 'Apertura / Fondo de Caja' } });
            if (!conceptoApertura) {
                conceptoApertura = await tx.concepto.create({ data: { nombre: 'Apertura / Fondo de Caja', tipo: 'ingreso' } });
            }

            if (monto_inicial && parseFloat(monto_inicial) > 0) {
                await tx.cajaMovimiento.create({
                    data: {
                        corteId: nuevoCorte.id,
                        usuarioId: req.user.id,
                        conceptoId: conceptoApertura.id,
                        tipo: 'ingreso',
                        monto: parseFloat(monto_inicial),
                        referenciaTipo: 'otro',
                        nota: 'Fondo de caja inicial'
                    }
                });
            }

            return nuevoCorte;
        });

        res.status(201).json({
            message: "Caja abierta exitosamente.",
            data: { corte_id: resultado.id, fecha_apertura: resultado.inicio }
        });

    } catch (error) {
        console.error("Error al abrir caja:", error);
        res.status(500).json({ error: "Error interno al abrir la caja." });
    }
};

// CONSULTAR MOVIMIENTOS
export const consultarCorte = async (req, res) => {
    try {
        const { fecha_inicial, fecha_final } = req.body; 

        if (!fecha_inicial || !fecha_final) {
            return res.status(400).json({ error: "Debes enviar el rango de fechas." });
        }

        const inicio = new Date(fecha_inicial);
        const fin = new Date(fecha_final);

        // Buscar la caja abierta actual para sacar su fondo inicial
        const cajaAbierta = await prisma.corteCaja.findFirst({
            where: { status: 'abierto' },
            include: { movimientos: { include: { concepto: true } } }
        });

        // Buscar TODOS los movimientos en ese rango de fechas 
        // (Atrapamos los que hicimos en Ventas y Compras que aún no tienen corteId)
        const movimientos = await prisma.cajaMovimiento.findMany({
            where: {
                fecha: { gte: inicio, lte: fin },
                OR: [
                    { corteId: null }, // Movimientos huérfanos (ventas/compras)
                    { corteId: cajaAbierta ? cajaAbierta.id : -1 } // O los que ya son de esta caja
                ]
            },
            include: { concepto: true, usuario: { select: { nombreCompleto: true } } },
            orderBy: { fecha: 'asc' }
        });

        // Calcular la matemática para tus 4 tarjetas
        let totalIngresos = 0;
        let totalEgresos = 0;
        let efectivoInicial = 0;

        // Extraer el fondo inicial (si existe en la caja abierta)
        if (cajaAbierta) {
            const movApertura = cajaAbierta.movimientos.find(m => m.concepto.nombre === 'Apertura / Fondo de Caja');
            if (movApertura) efectivoInicial = parseFloat(movApertura.monto);
        }

        const desgloseMovimientos = movimientos.map(mov => {
            const monto = parseFloat(mov.monto);
            
            // Si no es el fondo de caja, lo sumamos a los ingresos o egresos "operativos"
            if (mov.concepto.nombre !== 'Apertura / Fondo de Caja') {
                if (mov.tipo === 'ingreso') totalIngresos += monto;
                if (mov.tipo === 'gasto') totalEgresos += monto;
            }

            return {
                id: mov.id,
                fecha: mov.fecha,
                concepto: mov.concepto.nombre,
                tipo: mov.tipo,
                monto: monto,
                usuario: mov.usuario.nombreCompleto
            };
        });

        const efectivoFinal = (efectivoInicial + totalIngresos) - totalEgresos;

        res.status(200).json({
            message: "Consulta generada correctamente",
            resumen: {
                total_ingresos: totalIngresos,
                total_egresos: totalEgresos,
                efectivo_inicial: efectivoInicial,
                efectivo_final: efectivoFinal
            },
            movimientos: desgloseMovimientos // Para llenar la tabla que pondrás abajo del buscador
        });

    } catch (error) {
        console.error("Error al consultar corte:", error);
        res.status(500).json({ error: "Error interno al consultar los movimientos." });
    }
};


// REALIZAR CORTE DE CAJA
export const realizarCorte = async (req, res) => {
    try {
        const { fecha_inicial, fecha_final, observacion } = req.body;

        const cajaAbierta = await prisma.corteCaja.findFirst({
            where: { status: 'abierto' }
        });

        if (!cajaAbierta) {
            return res.status(400).json({ error: "No hay ninguna caja abierta para cerrar." });
        }

        const inicio = new Date(fecha_inicial);
        const fin = new Date(fecha_final);

        // Transacción Maestra con tiempo extendido por si hay cientos de ventas
        const resultado = await prisma.$transaction(async (tx) => {
            
            // Obtener los movimientos flotantes solo para calcular la suma matemática
            const movimientosFlotantes = await tx.cajaMovimiento.findMany({
                where: {
                    fecha: { gte: inicio, lte: fin },
                    corteId: null
                }
            });

            let sumaVentas = 0;
            movimientosFlotantes.forEach(mov => {
                if (mov.tipo === 'ingreso') {
                    sumaVentas += parseFloat(mov.monto);
                }
            });

            // ACTUALIZACIÓN MASIVA (Súper rápida): Amarrar todos los movimientos de golpe
            await tx.cajaMovimiento.updateMany({
                where: {
                    fecha: { gte: inicio, lte: fin },
                    corteId: null
                },
                data: { corteId: cajaAbierta.id }
            });

            // Cerrar el Corte Oficialmente
            const corteCerrado = await tx.corteCaja.update({
                where: { id: cajaAbierta.id },
                data: {
                    fin: new Date(), // Se sella con la hora actual exacta
                    status: 'cerrado',
                    totalVentas: sumaVentas,
                    observaciones: observacion || null
                }
            });

            return corteCerrado;
        }, {
            maxWait: 5000,   // Tiempo para conectarse
            timeout: 20000   // Le damos 20 segundos para procesar en lugar de los 5 por defecto
        });

        res.status(200).json({
            message: "Corte de caja realizado y cerrado exitosamente.",
            data: {
                corte_id: resultado.id,
                total_ingresos_amarrados: resultado.totalVentas
            }
        });

    } catch (error) {
        console.error("Error al realizar corte:", error);
        res.status(500).json({ error: "Error interno al procesar el cierre de caja." });
    }
};