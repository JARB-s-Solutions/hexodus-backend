/**
 * timezone.js — Utilidades de zona horaria para America/Merida
 *
 * PROBLEMA QUE RESUELVE:
 *   El servidor (Vercel) corre en UTC. Usar `new Date()` + `setHours(0,0,0,0)`
 *   pone la medianoche en UTC, que en Mérida equivale a las 6pm del día anterior
 *   (CST = UTC-6) o 7pm (CDT = UTC-5). Esto hace que los rangos de "hoy" y las
 *   agrupaciones por día/mes en gráficas sean incorrectos.
 *
 * SOLUCIÓN:
 *   Todas las operaciones de "inicio/fin de día", "inicio de mes", etc. se hacen
 *   tomando en cuenta el offset real de America/Merida en ese instante (incluyendo
 *   el horario de verano), y se devuelven como objetos Date en UTC para que Prisma
 *   los use directamente en los filtros gte/lte.
 */

const TZ = process.env.APP_TIMEZONE || 'America/Merida';

// ─────────────────────────────────────────────
// HELPERS INTERNOS
// ─────────────────────────────────────────────

/** Extrae las partes de fecha/hora de un Date en la zona TZ */
const _partes = (date) => {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).formatToParts(date);
    return parts.reduce((acc, part) => {
        if (part.type !== 'literal') acc[part.type] = Number(part.value);
        return acc;
    }, {});
};

/** Calcula el offset en ms de la zona TZ para una fecha concreta (DST-aware) */
const _offsetMs = (date) => {
    const p = _partes(date);
    const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, 0);
    return asUTC - date.getTime();
};

// ─────────────────────────────────────────────
// FUNCIONES PÚBLICAS
// ─────────────────────────────────────────────

/**
 * Convierte año/mes/día/hora en zona Mérida a un objeto Date (UTC interno).
 * Maneja DST correctamente.
 *
 * @param {number} year
 * @param {number} month  1-12
 * @param {number} day
 * @param {number} [hour=0]
 * @param {number} [minute=0]
 * @param {number} [second=0]
 * @param {number} [ms=0]
 * @returns {Date}
 */
export const localAUTC = (year, month, day, hour = 0, minute = 0, second = 0, ms = 0) => {
    const estimado = Date.UTC(year, month - 1, day, hour, minute, second, ms);
    const offset = _offsetMs(new Date(estimado));
    return new Date(estimado - offset);
};

/**
 * Devuelve la fecha/hora actuales descompuestas en zona Mérida.
 * @returns {{ year, month, day, hour, minute, second }}
 */
export const ahoraEnMerida = () => _partes(new Date());

/**
 * Devuelve las partes de fecha/hora de cualquier Date en zona Mérida.
 * Útil para obtener la hora local real de un timestamp de la BD.
 *
 * @param {Date|string} date
 * @returns {{ year, month, day, hour, minute, second }}
 */
export const partesEnMerida = (date) => _partes(date instanceof Date ? date : new Date(date));

/**
 * Formatea un Date (UTC de BD) como "HH:MM:SS" en zona Mérida.
 * Reemplaza el incorrecto `.toTimeString()` que devuelve la hora del servidor (UTC).
 *
 * @param {Date|string} date
 * @returns {string}  "HH:MM:SS"
 */
export const horaStringMerida = (date) => {
    const p = _partes(date instanceof Date ? date : new Date(date));
    return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}`;
};

/**
 * Devuelve el inicio (00:00:00.000) y fin (23:59:59.999) del día de HOY en zona Mérida,
 * expresados como objetos Date en UTC para usar en filtros Prisma (gte/lte).
 *
 * @returns {{ fecha: string, inicio: Date, fin: Date }}
 */
export const rangoDiaHoy = () => {
    const p = _partes(new Date());
    return {
        fecha: `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`,
        inicio: localAUTC(p.year, p.month, p.day, 0, 0, 0, 0),
        fin:    localAUTC(p.year, p.month, p.day, 23, 59, 59, 999)
    };
};

/**
 * Convierte una cadena "YYYY-MM-DD" enviada por el frontend al inicio del día
 * en zona Mérida, devuelto como Date UTC (listo para Prisma gte).
 *
 * @param {string} str  Formato "YYYY-MM-DD"
 * @returns {Date}
 */
export const fechaStrAInicio = (str) => {
    const [y, m, d] = str.split('-').map(Number);
    return localAUTC(y, m, d, 0, 0, 0, 0);
};

/**
 * Convierte una cadena "YYYY-MM-DD" enviada por el frontend al fin del día
 * en zona Mérida, devuelto como Date UTC (listo para Prisma lte).
 *
 * @param {string} str  Formato "YYYY-MM-DD"
 * @returns {Date}
 */
export const fechaStrAFin = (str) => {
    const [y, m, d] = str.split('-').map(Number);
    return localAUTC(y, m, d, 23, 59, 59, 999);
};

/**
 * Convierte un Date (UTC de la BD) a la clave "YYYY-MM-DD" en zona Mérida.
 * Usar para agrupar registros por día en gráficas.
 *
 * @param {Date|string} date
 * @returns {string}  "YYYY-MM-DD"
 */
export const fechaUTCADiaStr = (date) => {
    const p = _partes(date instanceof Date ? date : new Date(date));
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
};

/**
 * Convierte un Date (UTC de la BD) a la clave "YYYY-MM" en zona Mérida.
 * Usar para agrupar registros por mes en gráficas.
 *
 * @param {Date|string} date
 * @returns {string}  "YYYY-MM"
 */
export const fechaUTCAMesStr = (date) => {
    const p = _partes(date instanceof Date ? date : new Date(date));
    return `${p.year}-${String(p.month).padStart(2, '0')}`;
};

/**
 * Convierte un Date UTC a ISO local de Mérida con offset explícito.
 * Ejemplo: "2026-03-16T22:48:00.301-06:00"
 *
 * @param {Date|string} date
 * @returns {string}
 */
export const fechaUTCAISOEnMerida = (date) => {
    const d = date instanceof Date ? date : new Date(date);
    const p = _partes(d);
    const offset = _offsetMs(d);
    const sign = offset >= 0 ? '+' : '-';
    const abs = Math.abs(offset);
    const offsetHour = String(Math.floor(abs / 3600000)).padStart(2, '0');
    const offsetMin = String(Math.floor((abs % 3600000) / 60000)).padStart(2, '0');
    const ms = String(d.getUTCMilliseconds()).padStart(3, '0');

    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}:${String(p.second).padStart(2, '0')}.${ms}${sign}${offsetHour}:${offsetMin}`;
};

/**
 * Calcula el rango gte/lte para periodos predefinidos ("Hoy", "Esta Semana", etc.)
 * en zona Mérida. Retorna objetos Date UTC listos para Prisma.
 *
 * @param {string} periodo  El nombre del periodo
 * @param {string} [fecha_inicio]  Solo para modo 'Personalizado' ("YYYY-MM-DD")
 * @param {string} [fecha_fin]     Solo para modo 'Personalizado' ("YYYY-MM-DD")
 * @returns {{ gte: Date, lte: Date }}
 */
export const rangoPeriodo = (periodo, fecha_inicio, fecha_fin) => {
    const p = _partes(new Date());
    const { year, month, day } = p;

    // Inicio y fin base = hoy completo
    let gte = localAUTC(year, month, day, 0, 0, 0, 0);
    let lte = localAUTC(year, month, day, 23, 59, 59, 999);

    switch (periodo) {
        case 'Hoy':
            break;

        case 'Ayer':
            gte = localAUTC(year, month, day - 1, 0, 0, 0, 0);
            lte = localAUTC(year, month, day - 1, 23, 59, 59, 999);
            break;

        case 'Esta Semana': {
            // Semana comienza en Lunes
            const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Dom ... 6=Sab
            const diaSemana = jsDay === 0 ? 7 : jsDay; // 1=Lun ... 7=Dom
            gte = localAUTC(year, month, day - diaSemana + 1, 0, 0, 0, 0);
            break;
        }

        case 'Este Mes':
            gte = localAUTC(year, month, 1, 0, 0, 0, 0);
            break;

        case 'Mes Pasado':
            gte = localAUTC(year, month - 1, 1, 0, 0, 0, 0);
            // Último día del mes pasado: día 0 del mes actual
            lte = localAUTC(year, month, 0, 23, 59, 59, 999);
            break;

        case 'Esta Semana Pasada': {
            const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
            const diaSemana = jsDay === 0 ? 7 : jsDay;
            const lunesEsta = localAUTC(year, month, day - diaSemana + 1, 0, 0, 0, 0);
            gte = new Date(lunesEsta); gte.setUTCDate(lunesEsta.getUTCDate() - 7);
            lte = new Date(lunesEsta); lte.setUTCMilliseconds(-1);
            break;
        }

        case 'Este Trimestre': {
            const mesTriStart = Math.floor((month - 1) / 3) * 3 + 1;
            gte = localAUTC(year, mesTriStart, 1, 0, 0, 0, 0);
            break;
        }

        case 'Este Semestre': {
            const mesSemStart = month <= 6 ? 1 : 7;
            gte = localAUTC(year, mesSemStart, 1, 0, 0, 0, 0);
            break;
        }

        case 'Este Ano':
        case 'Este Año':
            gte = localAUTC(year, 1, 1, 0, 0, 0, 0);
            break;

        case 'Año Pasado':
        case 'Ano Pasado':
            gte = localAUTC(year - 1, 1, 1, 0, 0, 0, 0);
            lte = localAUTC(year - 1, 12, 31, 23, 59, 59, 999);
            break;

        case 'Personalizado':
            if (fecha_inicio) gte = fechaStrAInicio(fecha_inicio);
            if (fecha_fin)    lte = fechaStrAFin(fecha_fin);
            break;

        default:
            // Fallback: hoy
            break;
    }

    return { gte, lte };
};
