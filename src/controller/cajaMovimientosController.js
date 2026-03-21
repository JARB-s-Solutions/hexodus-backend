import prisma from "../config/prisma.js";
import { registrarLog } from "../services/auditoriaService.js";
import { ahoraEnMerida, localAUTC, fechaStrAInicio, fechaStrAFin, partesEnMerida } from "../utils/timezone.js";

// REGISTRAR MOVIMIENTO MANUAL (Ingreso / Egreso)
export const registrarMovimiento = async (req, res) => {
    try {
        const { tipo_movimiento, concepto_id, total, metodo_pago_id, observaciones } = req.body;

        // Validaciones de Estructura Inicial
        if (!tipo_movimiento || !['ingreso', 'gasto'].includes(tipo_movimiento)) {
            return res.status(400).json({ error: "El tipo de movimiento debe ser 'ingreso' o 'gasto'." });
        }
        if (!concepto_id) {
            return res.status(400).json({ error: "Debes seleccionar un concepto." });
        }
        if (!total || isNaN(total) || parseFloat(total) <= 0) {
            return res.status(400).json({ error: "El total debe ser un monto numérico mayor a cero." });
        }

        // Verificar que esté abierta y traer su historial de dinero
        const cajaAbierta = await prisma.corteCaja.findFirst({
            where: { status: 'abierto' },
            include: { 
                movimientos: { select: { tipo: true, monto: true } } 
            }
        });

        if (!cajaAbierta) {
            return res.status(403).json({ 
                error: "Operación denegada: La caja está cerrada. Debes realizar la apertura de caja primero." 
            });
        }

        // Calculamos cuánto dinero hay físicamente en la caja en este instante
        let saldoActualCaja = 0;
        cajaAbierta.movimientos.forEach(mov => {
            if (mov.tipo === 'ingreso') saldoActualCaja += parseFloat(mov.monto);
            else if (mov.tipo === 'gasto') saldoActualCaja -= parseFloat(mov.monto);
        });

        // Si es un retiro de dinero, verificamos que alcance
        if (tipo_movimiento === 'gasto' && parseFloat(total) > saldoActualCaja) {
            return res.status(400).json({ 
                error: `Fondos insuficientes. La caja actual solo tiene $${saldoActualCaja.toFixed(2)} disponibles. No puedes retirar $${parseFloat(total).toFixed(2)}.` 
            });
        }

        // Verificar que el concepto existe en el catálogo
        const conceptoDB = await prisma.concepto.findUnique({
            where: { id: parseInt(concepto_id) }
        });

        if (!conceptoDB) {
            return res.status(404).json({ error: "El concepto seleccionado no existe en el catálogo." });
        }

        // Registrar el Movimiento (Transacción exitosa)
        const nuevoMovimiento = await prisma.cajaMovimiento.create({
            data: {
                corteId: cajaAbierta.id, 
                usuarioId: req.user.id, 
                conceptoId: conceptoDB.id, 
                tipo: tipo_movimiento, 
                monto: parseFloat(total), 
                referenciaTipo: 'otro', 
                nota: observaciones ? 
                      `[Pago: ID ${metodo_pago_id}] ${observaciones}` : 
                      `Movimiento manual [Pago: ID ${metodo_pago_id}]`
            }
        });

        await registrarLog({
            req,
            accion: 'crear',
            modulo: 'movimientos',
            registroId: nuevoMovimiento.id, 
            detalles: `Se registró un ${tipo_movimiento} manual por la cantidad de $${total}`
        });

        res.status(201).json({
            message: "Movimiento registrado exitosamente.",
            data: { 
                movimiento_id: nuevoMovimiento.id, 
                tipo: nuevoMovimiento.tipo,
                monto: nuevoMovimiento.monto,
                saldo_restante_caja: tipo_movimiento === 'gasto' ? 
                                     (saldoActualCaja - parseFloat(total)) : 
                                     (saldoActualCaja + parseFloat(total))
            }
        });

    } catch (error) {
        console.error("Error al registrar movimiento:", error);
        res.status(500).json({ error: "Error interno al registrar el movimiento." });
    }
};



// LISTAR TODOS LOS MOVIMIENTOS (Con Filtros Avanzados)
export const listarMovimientos = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const { search, tipo, metodo_pago, fecha_inicio, fecha_fin } = req.query;

        // Construir las condiciones de filtrado usando AND para que no choquen
        let andConditions = [];

        // Filtro por Búsqueda (Folio, Usuario o Concepto)
        if (search) {
            const searchId = parseInt(search.replace(/\D/g, '')); // Extrae el número del folio "MOV-0359"
            let orConditions = [
                { concepto: { nombre: { contains: search, mode: 'insensitive' } } },
                { usuario: { nombreCompleto: { contains: search, mode: 'insensitive' } } },
                { nota: { contains: search, mode: 'insensitive' } }
            ];
            
            if (!isNaN(searchId)) {
                orConditions.push({ id: searchId });
            }
            andConditions.push({ OR: orConditions });
        }

        // Filtro por Tipo (Ingreso / Egreso)
        if (tipo && tipo !== 'Todos') {
            // El UI manda 'Ingresos' o 'Egresos', Prisma espera 'ingreso' o 'gasto'
            andConditions.push({ 
                tipo: tipo.toLowerCase().includes('ingreso') ? 'ingreso' : 'gasto' 
            });
        }

        // Filtro por Rango de Fechas
        if (fecha_inicio && fecha_fin) {
            andConditions.push({
                fecha: {
                    gte: fechaStrAInicio(fecha_inicio),
                    lte: fechaStrAFin(fecha_fin)
                }
            });
        }

        // Filtro por Método de Pago (Truco de extracción en la Nota)
        if (metodo_pago && metodo_pago !== 'Todos') {
            // El UI manda "Transfer." pero en la BD podría llamarse "Transferencia"
            let nombreBuscado = metodo_pago === 'Transfer.' ? 'Transferencia' : metodo_pago;
            
            const metodoObj = await prisma.metodoPago.findFirst({
                where: { nombre: { contains: nombreBuscado, mode: 'insensitive' } }
            });

            if (metodoObj) {
                andConditions.push({ 
                    nota: { contains: `[Pago: ID ${metodoObj.id}]` } 
                });
            } else {
                // Si buscan un método que no existe, forzamos cero resultados
                andConditions.push({ id: -1 }); 
            }
        }

        // Ensamblar el Where Final
        let whereClause = {};
        if (andConditions.length > 0) {
            whereClause.AND = andConditions;
        }

        // Ejecutar las consultas en paralelo
        const [totalRecords, movimientosRaw, sumaIngresos, sumaEgresos, metodosCatalogo] = await Promise.all([
            prisma.cajaMovimiento.count({ where: whereClause }),
            
            prisma.cajaMovimiento.findMany({
                where: whereClause,
                skip: skip,
                take: limit,
                orderBy: { fecha: 'desc' },
                include: {
                    concepto: true,
                    usuario: { select: { nombreCompleto: true } }
                }
            }),

            prisma.cajaMovimiento.aggregate({
                where: { 
                    ...whereClause, 
                    tipo: 'ingreso',
                    NOT: { concepto: { nombre: { contains: 'apertura', mode: 'insensitive' } } } // 🔥 ESCUDO APLICADO
                },
                _sum: { monto: true }
            }),

            prisma.cajaMovimiento.aggregate({
                where: { ...whereClause, tipo: 'gasto' },
                _sum: { monto: true }
            }),

            prisma.metodoPago.findMany()
        ]);

        // Calcular los KPIs para las 4 tarjetas superiores
        const totalIngresos = sumaIngresos._sum.monto ? parseFloat(sumaIngresos._sum.monto) : 0;
        const totalEgresos = sumaEgresos._sum.monto ? parseFloat(sumaEgresos._sum.monto) : 0;
        const balanceNeto = totalIngresos - totalEgresos;

        const dashboard_stats = {
            total_ingresos: totalIngresos,
            total_egresos: totalEgresos,
            balance_neto: balanceNeto,
            total_movimientos: totalRecords
        };

        // Formatear la tabla
        const dataFormateada = movimientosRaw.map(mov => {
            let metodoPagoStr = "Efectivo"; 
            let notaLimpia = mov.nota || 'Sin notas adicionales';

            const match = notaLimpia.match(/\[Pago: ID (\d+)\]/);
            if (match) {
                const metodoId = parseInt(match[1]);
                const metodoObj = metodosCatalogo.find(m => m.id === metodoId);
                if (metodoObj) {
                    metodoPagoStr = metodoObj.nombre;
                }
                notaLimpia = notaLimpia.replace(/\[Pago: ID \d+\]\s*-?\s*/, '').trim();
            }

            const p = partesEnMerida(mov.fecha);
            const fechaLocalExacta = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}`;

            return {
                id: mov.id,
                folio: `MOV-${mov.id.toString().padStart(4, '0')}`,
                fecha_hora: fechaLocalExacta,
                tipo: mov.tipo === 'ingreso' ? 'Ingreso' : 'Egreso',
                concepto: mov.concepto.nombre,
                nota_movimiento: notaLimpia || mov.concepto.nombre,
                monto: parseFloat(mov.monto),
                metodo: metodoPagoStr,
                responsable: mov.usuario.nombreCompleto
            };
        });

        res.status(200).json({
            message: "Movimientos obtenidos correctamente",
            dashboard_stats: dashboard_stats,
            data: dataFormateada,
            pagination: {
                current_page: page,
                limit: limit,
                total_records: totalRecords,
                total_pages: Math.ceil(totalRecords / limit)
            }
        });

    } catch (error) {
        console.error("Error al listar movimientos:", error);
        res.status(500).json({ error: "Error interno al obtener los movimientos." });
    }
};


// OBTENER COMPARACIONES DE MOVIMIENTOS
export const obtenerComparacionMovimientos = async (req, res) => {
    try {
        const { periodo } = req.query; // 'Hoy', 'Este Mes', 'Este Trimestre', 'Este Semestre', 'Este Año'

        const { year, month, day } = ahoraEnMerida();
        let gteActual  = localAUTC(year, month, day, 0, 0, 0, 0);
        let lteActual  = localAUTC(year, month, day, 23, 59, 59, 999);
        let gteAnterior = localAUTC(year, month, day, 0, 0, 0, 0);
        let lteAnterior = localAUTC(year, month, day, 23, 59, 59, 999);

        let labelAnterior = 'ANTERIOR';

        // Lógica de Fechas
        switch (periodo) {
            case 'Hoy':
                gteAnterior = localAUTC(year, month, day - 1, 0, 0, 0, 0);
                lteAnterior = localAUTC(year, month, day - 1, 23, 59, 59, 999);
                labelAnterior = 'AYER';
                break;
            case 'Este Trimestre': {
                const mesTriStart = Math.floor((month - 1) / 3) * 3 + 1;
                gteActual   = localAUTC(year, mesTriStart, 1, 0, 0, 0, 0);
                gteAnterior = localAUTC(year, mesTriStart - 3, 1, 0, 0, 0, 0);
                lteAnterior = localAUTC(year, mesTriStart, 0, 23, 59, 59, 999);
                labelAnterior = 'TRIM. ANTERIOR';
                break;
            }
            case 'Este Semestre': {
                const mesSemStart = month <= 6 ? 1 : 7;
                gteActual   = localAUTC(year, mesSemStart, 1, 0, 0, 0, 0);
                gteAnterior = localAUTC(year, mesSemStart - 6, 1, 0, 0, 0, 0);
                lteAnterior = localAUTC(year, mesSemStart, 0, 23, 59, 59, 999);
                labelAnterior = 'SEM. ANTERIOR';
                break;
            }
            case 'Este Ano': // 'Ano' sin ñ para evitar problemas de codificación en URLs
            case 'Este Año':
                gteActual   = localAUTC(year, 1, 1, 0, 0, 0, 0);
                gteAnterior = localAUTC(year - 1, 1, 1, 0, 0, 0, 0);
                lteAnterior = localAUTC(year - 1, 12, 31, 23, 59, 59, 999);
                labelAnterior = 'AÑO ANTERIOR';
                break;
            case 'Este Mes':
            default:
                gteActual   = localAUTC(year, month, 1, 0, 0, 0, 0);
                gteAnterior = localAUTC(year, month - 1, 1, 0, 0, 0, 0);
                lteAnterior = localAUTC(year, month, 0, 23, 59, 59, 999);
                labelAnterior = 'MES ANTERIOR';
                break;
        }

        // Ejecución Paralela y Agrupada en BD 
        const [agrupacionActual, agrupacionAnterior] = await Promise.all([
            prisma.cajaMovimiento.groupBy({
                by: ['tipo'],
                where: { 
                    fecha: { gte: gteActual, lte: lteActual },
                    NOT: { concepto: { nombre: { contains: 'apertura', mode: 'insensitive' } } } // 🔥 ESCUDO APLICADO
                },
                _sum: { monto: true },
                _count: { _all: true }
            }),
            prisma.cajaMovimiento.groupBy({
                by: ['tipo'],
                where: { 
                    fecha: { gte: gteAnterior, lte: lteAnterior },
                    NOT: { concepto: { nombre: { contains: 'apertura', mode: 'insensitive' } } } // 🔥 ESCUDO APLICADO
                },
                _sum: { monto: true },
                _count: { _all: true }
            })
        ]);

        // Procesar resultados
        let ingresosActual = 0, egresosActual = 0, movActual = 0;
        agrupacionActual.forEach(item => {
            const monto = parseFloat(item._sum.monto || 0);
            if (item.tipo === 'ingreso') ingresosActual += monto;
            if (item.tipo === 'gasto') egresosActual += monto;
            movActual += item._count._all;
        });

        let ingresosAnterior = 0, egresosAnterior = 0, movAnterior = 0;
        agrupacionAnterior.forEach(item => {
            const monto = parseFloat(item._sum.monto || 0);
            if (item.tipo === 'ingreso') ingresosAnterior += monto;
            if (item.tipo === 'gasto') egresosAnterior += monto;
            movAnterior += item._count._all;
        });

        const balanceActual = ingresosActual - egresosActual;
        const balanceAnterior = ingresosAnterior - egresosAnterior;

        // Función matemática para calcular porcentajes (incluso con balances negativos)
        const calcularPorcentaje = (actual, anterior) => {
            if (anterior === 0 && actual === 0) return 0;
            if (anterior === 0) return 100; 
            return ((actual - anterior) / Math.abs(anterior)) * 100;
        };

        // Armar el JSON 
        const dataFormateada = {
            labels_columnas: {
                actual: (periodo || 'Este Mes').toUpperCase(),
                anterior: labelAnterior
            },
            filas: [
                {
                    concepto: "Ingresos",
                    actual: ingresosActual,
                    anterior: ingresosAnterior,
                    cambio_pct: Number(calcularPorcentaje(ingresosActual, ingresosAnterior).toFixed(1))
                },
                {
                    concepto: "Egresos",
                    actual: egresosActual,
                    anterior: egresosAnterior,
                    cambio_pct: Number(calcularPorcentaje(egresosActual, egresosAnterior).toFixed(1))
                },
                {
                    concepto: "Balance",
                    actual: balanceActual,
                    anterior: balanceAnterior,
                    cambio_pct: Number(calcularPorcentaje(balanceActual, balanceAnterior).toFixed(1))
                },
                {
                    concepto: "Movimientos",
                    actual: movActual,
                    anterior: movAnterior,
                    cambio_pct: Number(calcularPorcentaje(movActual, movAnterior).toFixed(1))
                }
            ]
        };

        res.status(200).json({
            message: "Comparación generada correctamente.",
            data: dataFormateada
        });

    } catch (error) {
        console.error("Error al obtener comparación:", error);
        res.status(500).json({ error: "Error interno al generar las comparaciones." });
    }
};


// ELIMINAR MOVIMIENTO DE CAJA (Borrado Físico con Reglas Contables)
export const eliminarMovimiento = async (req, res) => {
    try {
        const { id } = req.params;

        if (isNaN(id)) {
            return res.status(400).json({ error: "ID de movimiento inválido." });
        }

        const movimientoId = parseInt(id);

        // 1. Buscamos el movimiento con su Corte y Concepto
        const movimiento = await prisma.cajaMovimiento.findUnique({
            where: { id: movimientoId },
            include: { corte: true, concepto: true }
        });

        if (!movimiento) {
            return res.status(404).json({ error: "Movimiento no encontrado." });
        }

        // Prohibido alterar la historia antigua
        if (movimiento.corte && movimiento.corte.status === 'cerrado') {
            return res.status(403).json({ 
                error: "Operación denegada. No puedes eliminar un movimiento que pertenece a un corte de caja cerrado. La contabilidad de ese turno ya fue sellada." 
            });
        }

        // Integridad de Doble Partida (No romper ventas ni membresías)
        // Solo permitimos borrar referencias tipo 'otro' (manuales) o 'ajuste'.
        if (movimiento.referenciaTipo === 'venta' || movimiento.referenciaTipo === 'membresia') {
            return res.status(403).json({ 
                error: `Operación denegada. Este es un movimiento automático generado por una ${movimiento.referenciaTipo.toUpperCase()}. Solo se pueden eliminar movimientos manuales.` 
            });
        }

        // 2. Si pasó las reglas de oro, lo borramos físicamente de la base de datos
        await prisma.cajaMovimiento.delete({
            where: { id: movimientoId }
        });

        // 3. Dejamos el rastro en la bitácora de auditoría para saber quién borró el dinero
        await registrarLog({
            req,
            accion: 'eliminar',
            modulo: 'movimientos',
            registroId: movimientoId,
            detalles: `Se eliminó físicamente un movimiento manual de ${movimiento.tipo} por $${movimiento.monto} (Concepto: ${movimiento.concepto.nombre})`
        });

        res.status(200).json({
            message: "Movimiento eliminado exitosamente. Los saldos del dashboard y la caja se han ajustado automáticamente."
        });

    } catch (error) {
        console.error("Error al eliminar movimiento de caja:", error);
        res.status(500).json({ error: "Error interno al intentar eliminar el movimiento." });
    }
};