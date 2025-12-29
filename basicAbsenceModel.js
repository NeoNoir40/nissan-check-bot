export function evaluateAbsenceRisk(metrics) {
  const {
    faltas_30d,
    justificaciones_pendientes,
    justificaciones_rechazadas
  } = metrics;

  // Nivel crítico: patrón muy preocupante en el mes
  if (faltas_30d >= 8) {
    return {
      triggerAI: true,
      level: "critico",
      reason: "8+ faltas injustificadas en el último mes"
    };
  }

  // Nivel alto: múltiples faltas con justificaciones rechazadas
  if (faltas_30d >= 5 || (faltas_30d >= 3 && justificaciones_rechazadas >= 2)) {
    return {
      triggerAI: true,
      level: "alto",
      reason: "Patrón elevado de ausentismo en el mes"
    };
  }

  // Nivel medio: tendencia preocupante
  if (faltas_30d >= 3 || (faltas_30d >= 2 && justificaciones_pendientes >= 2)) {
    return {
      triggerAI: true,
      level: "medio",
      reason: "Ausentismo que requiere atención"
    };
  }

  // Bajo riesgo: comportamiento normal, no requiere análisis IA
  return {
    triggerAI: false,
    level: "bajo",
    reason: "Comportamiento de asistencia dentro de parámetros normales"
  };
}
