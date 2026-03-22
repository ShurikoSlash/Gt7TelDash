/**
 * GT7 Telemetry — Race Engineer
 * ============================================================
 * Este archivo contiene toda la lógica de carrera separada del HTML.
 *
 * Cómo funciona:
 *   1. El HTML llama a `engineer.update(d)` en cada paquete de telemetría.
 *   2. El engineer procesa los datos, detecta la pista, calcula estrategia
 *      y llama a `engineer.say(text, type)` para mostrar mensajes en el panel.
 *   3. El HTML solo necesita implementar `engineer.say` y el resto es automático.
 *
 * Dependencias globales que usa del HTML:
 *   - lapHistory       → historial de vueltas
 *   - bestLapMs        → mejor tiempo en ms
 *   - mapPoints        → puntos del minimapa
 *   - mapBounds        → bounding box de la pista
 *   - raceSetup        → { tyreMult, fuelMult, tankCap }
 *   - driverProfile    → { name, lang }
 *   - parseLapMs()     → función de parseo de tiempos
 *   - fmtMs()          → formato mm:ss.mmm
 */

'use strict';

// ═══════════════════════════════════════════════════════════════
// TRACK DETECTOR
// Identifica la pista usando el bounding box del minimapa.
// Después de 2 vueltas completas genera un "fingerprint" más preciso
// usando la distribución de puntos (no solo el tamaño).
// ═══════════════════════════════════════════════════════════════
const TrackDetector = {
  trackId:       null,   // ID actual, ej: "TRK-4520x3100"
  trackName:     null,   // nombre guardado por el usuario, ej: "Nürburgring GP"
  confidence:    0,      // 0-100: confianza en la detección
  _lastBoundsW:  0,
  _lastBoundsH:  0,
  _lapsSeen:     0,

  /** Llama esto cada vez que se completa una vuelta */
  onLapComplete(bounds, lapCount) {
    this._lapsSeen = lapCount;
    const w = Math.round(bounds.maxX - bounds.minX);
    const h = Math.round(bounds.maxZ - bounds.minZ);

    // Necesitamos un mínimo de tamaño para que sea válido
    if (w < 300 || h < 300) return;

    // Si el tamaño cambió mucho, resetear (cambio de pista)
    if (this.trackId && (Math.abs(w - this._lastBoundsW) > 200 || Math.abs(h - this._lastBoundsH) > 200)) {
      console.log('[TRACK] Pista cambiada, reseteando detector');
      this.reset();
    }

    this._lastBoundsW = w;
    this._lastBoundsH = h;

    // Confianza sube con cada vuelta (más vueltas = más preciso)
    this.confidence = Math.min(100, this._lapsSeen * 25);

    // ID basado en dimensiones. Tolerancia de ±50m para robustez
    const wBucket = Math.round(w / 50) * 50;
    const hBucket = Math.round(h / 50) * 50;
    const newId = `TRK-${wBucket}x${hBucket}`;

    if (newId !== this.trackId) {
      this.trackId = newId;
      // Buscar si tenemos nombre guardado para esta pista
      const saved = this._loadTrackData(newId);
      this.trackName = saved?.name || null;
      console.log(`[TRACK] Detectada: ${newId} (${this.trackName || 'sin nombre'})`);
    }

    return this.trackId;
  },

  /** Nombre legible para mostrar */
  getDisplayName() {
    if (!this.trackId) return 'Detecting track…';
    return this.trackName || this.trackId;
  },

  /** Guardar nombre de pista manualmente */
  setName(name) {
    if (!this.trackId) return;
    this.trackName = name;
    const data = this._loadTrackData(this.trackId) || {};
    data.name = name;
    this._saveTrackData(this.trackId, data);
    console.log(`[TRACK] Nombre guardado: "${name}" para ${this.trackId}`);
  },

  reset() {
    this.trackId    = null;
    this.trackName  = null;
    this.confidence = 0;
    this._lapsSeen  = 0;
  },

  _saveTrackData(id, data) {
    try {
      const all = JSON.parse(localStorage.getItem('gt7-tracks') || '{}');
      all[id] = { ...all[id], ...data, updatedAt: Date.now() };
      localStorage.setItem('gt7-tracks', JSON.stringify(all));
    } catch(e) {}
  },

  _loadTrackData(id) {
    try {
      const all = JSON.parse(localStorage.getItem('gt7-tracks') || '{}');
      return all[id] || null;
    } catch(e) { return null; }
  },

  /** Guardar datos de sesión en la pista (consumos, tiempos, etc) */
  saveSessionData(sessionData) {
    if (!this.trackId) return;
    const existing = this._loadTrackData(this.trackId) || {};
    const sessions = existing.sessions || [];

    // Guardar solo últimas 20 sesiones
    sessions.push({ ...sessionData, date: Date.now() });
    if (sessions.length > 20) sessions.shift();

    this._saveTrackData(this.trackId, { ...existing, sessions });
  },

  /** Cargar historial de esta pista */
  getHistory() {
    if (!this.trackId) return null;
    return this._loadTrackData(this.trackId);
  },
};


// ═══════════════════════════════════════════════════════════════
// FUEL ANALYST
// Rastrea consumo de combustible vuelta a vuelta.
// ═══════════════════════════════════════════════════════════════
const FuelAnalyst = {
  _lapStartFuel:    -1,   // fuel al inicio de la vuelta actual (0-1)
  _history:         [],   // consumo por vuelta (últimas N)
  _MAX_HISTORY:     8,
  fuelSaveTarget:   null, // L/vuelta objetivo (null = sin restricción)

  /** Llamar al cruzar la línea de meta (inicio de vuelta) */
  onLapStart(fuelLevel) {
    this._lapStartFuel = fuelLevel;
  },

  /** Llamar al completar una vuelta — devuelve consumo en fracción (0-1) */
  onLapComplete(fuelLevel) {
    if (this._lapStartFuel < 0) {
      this._lapStartFuel = fuelLevel;
      return null;
    }

    const consumed = this._lapStartFuel - fuelLevel;

    // Sanity: entre 0.2% y 35% del tanque por vuelta
    if (consumed > 0.002 && consumed < 0.35) {
      this._history.push(consumed);
      if (this._history.length > this._MAX_HISTORY) this._history.shift();
    }

    this._lapStartFuel = fuelLevel;
    return consumed;
  },

  /** Promedio de consumo (últimas N vueltas) — en fracción del tanque */
  getAvgPerLap(laps = 3) {
    if (this._history.length === 0) return 0;
    const recent = this._history.slice(-Math.min(laps, this._history.length));
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  },

  /** Cuántas vueltas aguanta con el fuel actual */
  lapsRemaining(fuelLevel) {
    const avg = this.getAvgPerLap();
    if (avg <= 0) return Infinity;
    return Math.floor(fuelLevel / avg);
  },

  /**
   * Calcular target de fuel save.
   * Si necesitamos llegar con X vueltas y el promedio es alto,
   * devuelve cuánto hay que ahorrar por vuelta.
   */
  calcFuelSave(fuelLevel, lapsToEnd) {
    const avg    = this.getAvgPerLap();
    const needed = avg * lapsToEnd;
    if (needed <= fuelLevel) return null; // no hace falta ahorrar

    const deficit    = needed - fuelLevel;
    const savePerLap = deficit / lapsToEnd;
    const targetPct  = Math.max(0, (avg - savePerLap) * 100);
    return {
      deficit:     deficit,
      savePerLap:  savePerLap,
      targetPct:   targetPct,
      liftAndCoast: savePerLap > avg * 0.05, // >5% ahorro = L&C necesario
    };
  },

  reset() {
    this._lapStartFuel = -1;
    this._history      = [];
    this.fuelSaveTarget = null;
  },
};


// ═══════════════════════════════════════════════════════════════
// TYRE ANALYST
// Gestiona desgaste de neumáticos con corrección de outliers.
// ═══════════════════════════════════════════════════════════════
const TyreAnalyst = {
  _history:      [],   // [{lap, FL, FR, RL, RR}] desgaste por vuelta
  _lapStartWear: null, // wear al inicio de la vuelta
  _prevLap:      -1,
  _MAX_HISTORY:  10,

  TYRES: ['FL', 'FR', 'RL', 'RR'],

  /**
   * Procesar datos de wear del paquete.
   * Incluye corrección del bug FL (reporta 100 cuando no hay datos).
   * Devuelve wear actual escalado por el multiplicador.
   */
  processWear(rawWear, mult, currentLap) {
    if (!rawWear) return null;

    // Escalar y validar
    const wear = {};
    this.TYRES.forEach(p => {
      const w = rawWear[p];
      if (w == null) { wear[p] = null; return; }
      wear[p] = Math.max(0, Math.min(100, 100 - (100 - w) * mult));
    });

    // Bug FL fix: si un neumático es null o anómalamente alto, imputar
    const valid    = this.TYRES.filter(p => wear[p] !== null && wear[p] < 100);
    const validAvg = valid.length > 0
      ? valid.reduce((s, p) => s + wear[p], 0) / valid.length
      : 100;

    this.TYRES.forEach(p => {
      if (wear[p] === null || (wear[p] > validAvg + 15 && valid.length >= 3)) {
        wear[p] = validAvg;
      }
    });

    // Seguimiento por vuelta
    if (currentLap > 0) {
      if (this._prevLap < 0) {
        this._prevLap      = currentLap;
        this._lapStartWear = { ...wear };
      } else if (currentLap !== this._prevLap) {
        this._recordLap(currentLap - 1, wear);
        this._lapStartWear = { ...wear };
        this._prevLap      = currentLap;
      }
    }

    return wear;
  },

  _recordLap(lap, currentWear) {
    if (!this._lapStartWear) return;
    const consumed = {};
    let sane = true;

    this.TYRES.forEach(p => {
      const c = Math.max(0, (this._lapStartWear[p] || 100) - (currentWear[p] || 100));
      consumed[p] = c;
      // Sanity: ningún neumático >15% por vuelta
      if (c > 15 || c < 0) sane = false;
    });

    // Validar que no haya outlier (5x el promedio)
    const vals  = this.TYRES.map(p => consumed[p]);
    const cAvg  = vals.reduce((a, b) => a + b, 0) / 4;
    const hasOutlier = vals.some(v => cAvg > 0.01 && v > cAvg * 4);

    if (sane && !hasOutlier && vals.some(v => v > 0.01)) {
      this._history.push({ lap, ...consumed });
      if (this.HISTORY.length > this._MAX_HISTORY) this._history.shift();
    }
  },

  /** Consumo promedio por vuelta para cada neumático */
  getAvgWearPerLap(laps = 5) {
    if (this._history.length === 0) return null;
    const recent = this._history.slice(-Math.min(laps, this._history.length));
    const avg = {};
    this.TYRES.forEach(p => {
      avg[p] = recent.reduce((s, r) => s + (r[p] || 0), 0) / recent.length;
    });
    return avg;
  },

  /** Cuántas vueltas quedan para cada neumático */
  lapsRemaining(currentWear) {
    const avg = this.getAvgWearPerLap();
    if (!avg) return null;
    const remaining = {};
    this.TYRES.forEach(p => {
      remaining[p] = avg[p] > 0.01 ? Math.floor((currentWear[p] || 100) / avg[p]) : Infinity;
    });
    return remaining;
  },

  /** El neumático más crítico */
  criticalTyre(currentWear) {
    const rem = this.lapsRemaining(currentWear);
    if (!rem) return null;
    return this.TYRES.reduce((min, p) =>
      (rem[p] < rem[min]) ? p : min, this.TYRES[0]
    );
  },

  reset() {
    this._history      = [];
    this._lapStartWear = null;
    this._prevLap      = -1;
  },

  get HISTORY() { return this._history; }
};


// ═══════════════════════════════════════════════════════════════
// STRATEGY ENGINE
// Calcula la estrategia óptima de paradas en boxes.
// ═══════════════════════════════════════════════════════════════
const StrategyEngine = {
  /**
   * Detectar tipo de carrera.
   * Sprint = vueltas definidas (laps_in_race > 0)
   * Endurance = tiempo (laps_in_race <= 0 o muy alto)
   */
  getRaceType(d) {
    if (!d.in_race) return 'unknown';
    if (d.laps_in_race > 0 && d.laps_in_race < 500) return 'sprint';
    return 'endurance';
  },

  /**
   * Calcular vueltas restantes según tipo de carrera.
   * En endurance, estimamos por el tiempo_de_carrera (no disponible directo, usar fuel).
   */
  lapsToEnd(d) {
    const type = this.getRaceType(d);
    if (type === 'sprint') {
      return Math.max(0, d.laps_in_race - d.current_lap);
    }
    // Endurance: estimamos por fuel
    return FuelAnalyst.lapsRemaining(d.fuel_level ?? 0);
  },

  /**
   * Calcular estrategia completa.
   * Devuelve objeto con recomendaciones.
   */
  calculate(d, tyreWear) {
    const type      = this.getRaceType(d);
    const lapsLeft  = this.lapsToEnd(d);
    const fuelLevel = d.fuel_level ?? 0;
    const tankCap   = (typeof raceSetup !== 'undefined') ? raceSetup.tankCap : 100;

    const fuelAvg   = FuelAnalyst.getAvgPerLap();
    const fuelSave  = fuelAvg > 0 ? FuelAnalyst.calcFuelSave(fuelLevel, lapsLeft) : null;
    const tyreRem   = tyreWear ? TyreAnalyst.lapsRemaining(tyreWear) : null;
    const critTyre  = tyreWear ? TyreAnalyst.criticalTyre(tyreWear) : null;
    const tyreAvg   = TyreAnalyst.getAvgWearPerLap();

    // ¿Necesita parar?
    const fuelStop  = fuelAvg > 0 && (fuelLevel / fuelAvg) < lapsLeft;
    const tyreStop  = critTyre && tyreRem && tyreRem[critTyre] < lapsLeft;
    const mustStop  = fuelStop || tyreStop;

    // ¿Cuándo parar? (vuelta óptima)
    let pitLap = null;
    if (mustStop && type === 'sprint') {
      // Parar cuando el neumático más crítico llega a ~25%
      if (tyreRem && critTyre && tyreWear) {
        const lapsTillCrit = Math.max(1, (tyreWear[critTyre] - 25) / (tyreAvg?.[critTyre] || 1));
        pitLap = d.current_lap + Math.floor(lapsTillCrit);
      } else if (fuelStop) {
        pitLap = d.current_lap + Math.floor(fuelLevel / fuelAvg) - 1;
      }
    }

    return {
      raceType:   type,
      lapsLeft,
      fuelAvgPct: fuelAvg * 100,
      fuelLiters: fuelAvg * tankCap,
      fuelSave,
      tyreRem,
      critTyre,
      mustStop,
      pitLap,
      track:      TrackDetector.getDisplayName(),
    };
  },

  /**
   * Generar resumen de estrategia en texto legible.
   */
  summary(strat) {
    if (!strat || strat.raceType === 'unknown') return null;

    const lines = [];

    if (strat.fuelAvgPct > 0) {
      lines.push(`Fuel avg: ${strat.fuelAvgPct.toFixed(1)}%/lap (${strat.fuelLiters.toFixed(2)}L)`);
    }

    if (strat.fuelSave) {
      const pct = (strat.fuelSave.savePerLap * 100).toFixed(1);
      lines.push(`⚠ Fuel short by ${(strat.fuelSave.deficit * 100).toFixed(1)}%. Save ${pct}%/lap.`);
      if (strat.fuelSave.liftAndCoast) lines.push('→ Lift & Coast required.');
    } else if (strat.fuelAvgPct > 0) {
      lines.push(`Fuel OK for ${strat.lapsLeft} laps.`);
    }

    if (strat.tyreRem && strat.critTyre) {
      const rem = strat.tyreRem[strat.critTyre];
      lines.push(`Critical tyre: ${strat.critTyre} (${rem < Infinity ? rem + ' laps left' : 'OK'})`);
    }

    if (strat.mustStop && strat.pitLap) {
      lines.push(`Suggested pit: Lap ${strat.pitLap}`);
    } else if (!strat.mustStop) {
      lines.push('No stop needed — can make it to the end.');
    }

    return lines.join(' | ');
  },
};


// ═══════════════════════════════════════════════════════════════
// RACE ENGINEER — clase principal
// ═══════════════════════════════════════════════════════════════
class RaceEngineer {
  constructor() {
    // Estado
    this._inRace       = false;
    this._prevLap      = -1;
    this._prevPos      = -1;
    this._fuelWarned   = false;
    this._tempWarned   = { FL: false, FR: false, RL: false, RR: false };
    this._wearWarned   = { FL: false, FR: false, RL: false, RR: false };
    this._pitWarned    = false;
    this._lastSpoke    = {};          // cooldown por categoría
    this._strategyInterval = null;   // intervalo de update de estrategia

    // Exponer sub-módulos para acceso desde fuera si es necesario
    this.track    = TrackDetector;
    this.fuel     = FuelAnalyst;
    this.tyres    = TyreAnalyst;
    this.strategy = StrategyEngine;

    // Frases multi-idioma
    this._phrases = this._buildPhrases();

    // Última estrategia calculada (para mostrar en UI)
    this.lastStrategy = null;
  }

  // ── API pública ──────────────────────────────────────────────

  /**
   * Llamar en cada paquete de telemetría.
   * Este es el único método que necesitás llamar desde el HTML.
   */
  update(d) {
    if (!d) return;

    // Wear procesado (con corrección FL)
    const mult     = (typeof raceSetup !== 'undefined') ? (raceSetup.tyreMult || 1) : 1;
    const wear     = TyreAnalyst.processWear(d.tyre_wear, mult, d.current_lap);

    // Detección de pista
    if (typeof mapBounds !== 'undefined') {
      TrackDetector.onLapComplete(mapBounds, d.current_lap);
    }

    // Race start
    if (d.in_race && !this._inRace) {
      this._onRaceStart(d);
    }
    if (!d.in_race) this._inRace = false;

    // Lap completed
    if (d.current_lap > 0 && d.current_lap !== this._prevLap && this._prevLap > 0) {
      this._onLapComplete(d, wear);
    }
    if (d.current_lap > 0) this._prevLap = d.current_lap;

    // Position change
    if (d.race_position > 0 && d.race_position !== this._prevPos && this._prevPos > 0) {
      this._onPositionChange(d);
    }
    if (d.race_position > 0) this._prevPos = d.race_position;

    // Continuous checks
    this._checkFuel(d);
    this._checkTyreTemp(d);
    this._checkTyreWear(d, wear);
    this._checkPitWindow(d, wear);

    return wear;
  }

  /**
   * Decir algo — el HTML debe sobreescribir esto.
   * Por defecto usa engineerSay() si está disponible.
   */
  say(text, type = 'info', category = 'general', cooldownMs = 15000) {
    if (typeof engineerSay === 'function') {
      engineerSay(text, type, category, cooldownMs);
    } else {
      console.log(`[ENGINEER][${type}] ${text}`);
    }
  }

  /**
   * Obtener estrategia actual como texto.
   * Llamar para mostrar en panel.
   */
  getStrategyText(d, wear) {
    const strat = StrategyEngine.calculate(d, wear);
    this.lastStrategy = strat;
    return StrategyEngine.summary(strat);
  }

  /** Reset completo (nueva sesión / nueva pista) */
  reset() {
    this._inRace     = false;
    this._prevLap    = -1;
    this._prevPos    = -1;
    this._fuelWarned = false;
    this._pitWarned  = false;
    Object.keys(this._tempWarned).forEach(k => this._tempWarned[k] = false);
    Object.keys(this._wearWarned).forEach(k => this._wearWarned[k] = false);

    FuelAnalyst.reset();
    TyreAnalyst.reset();
    TrackDetector.reset();
  }

  // ── Handlers de eventos ──────────────────────────────────────

  _onRaceStart(d) {
    this._inRace     = true;
    this._fuelWarned = false;
    this._pitWarned  = false;
    Object.keys(this._tempWarned).forEach(k => this._tempWarned[k] = false);
    Object.keys(this._wearWarned).forEach(k => this._wearWarned[k] = false);

    FuelAnalyst.onLapStart(d.fuel_level ?? 0);

    const P = this._getPhrases();
    setTimeout(() => this.say(P.raceStart(), 'info', 'raceStart', 0), 2000);
  }

  _onLapComplete(d, wear) {
    const P      = this._getPhrases();
    const bestMs = typeof bestLapMs !== 'undefined' ? bestLapMs : Infinity;
    const lastMs = typeof parseLapMs === 'function' ? parseLapMs(d.last_lap) : null;

    // Mensaje de vuelta completada
    if (lastMs) {
      const delta = bestMs < Infinity ? lastMs - bestMs : 0;
      this.say(P.lapDone(this._prevLap, d.last_lap, delta),
        delta > 2000 ? 'warn' : delta < 0 ? 'ok' : 'info', 'lap', 0);
    }

    // Actualizar analistas
    const fuelConsumed = FuelAnalyst.onLapComplete(d.fuel_level ?? 0);

    // Guardar datos de sesión en la pista
    if (TrackDetector.trackId && lastMs) {
      TrackDetector.saveSessionData({
        lapMs:   lastMs,
        fuelPct: fuelConsumed ? (fuelConsumed * 100).toFixed(2) : null,
        wear:    wear ? { ...wear } : null,
      });
    }

    // Calcular y comunicar estrategia cada 2 vueltas
    if (this._prevLap % 2 === 0 || this._prevLap === 1) {
      const strat = StrategyEngine.calculate(d, wear);
      this.lastStrategy = strat;

      if (strat.fuelSave && strat.fuelSave.liftAndCoast) {
        this.say(P.fuelSave(strat.fuelSave.savePerLap * 100), 'warn', 'strategy', 0);
      }

      if (strat.mustStop && strat.pitLap && !this._pitWarned) {
        this._pitWarned = true;
        const lapsUntilPit = strat.pitLap - d.current_lap;
        if (lapsUntilPit <= 3 && lapsUntilPit > 0) {
          this.say(P.pitWindow(lapsUntilPit), 'warn', 'pit', 0);
        }
      }
    }

    // Reiniciar fuel tracking para próxima vuelta
    FuelAnalyst.onLapStart(d.fuel_level ?? 0);
  }

  _onPositionChange(d) {
    const P = this._getPhrases();
    if (d.race_position < this._prevPos) {
      this.say(P.posGain(d.race_position, d.cars_in_race), 'ok', 'pos', 5000);
    } else {
      this.say(P.posLost(d.race_position, d.cars_in_race), 'warn', 'pos', 5000);
    }
  }

  _checkFuel(d) {
    const fp = (d.fuel_level || 0) * 100;
    const P  = this._getPhrases();
    if (fp > 0 && fp < 10 && !this._fuelWarned) {
      this._fuelWarned = true;
      this.say(P.fuelCrit(fp), 'crit', 'fuel', 0);
    } else if (fp > 0 && fp < 25) {
      this.say(P.fuelLow(fp), 'warn', 'fuel', 60000);
    }
  }

  _checkTyreTemp(d) {
    if (!d.tyre_temp) return;
    const P     = this._getPhrases();
    const limit = 130;
    ['FL', 'FR', 'RL', 'RR'].forEach(pos => {
      const t = d.tyre_temp[pos];
      if (t > limit && !this._tempWarned[pos]) {
        this._tempWarned[pos] = true;
        this.say(P.tempHot(pos, t), 'warn', 'temp_' + pos, 30000);
      }
      if (t < limit - 15) this._tempWarned[pos] = false;
    });
  }

  _checkTyreWear(d, wear) {
    if (!wear) return;
    const P = this._getPhrases();
    ['FL', 'FR', 'RL', 'RR'].forEach(pos => {
      const w = wear[pos];
      if (w < 30 && !this._wearWarned[pos]) {
        this._wearWarned[pos] = true;
        this.say(P.wearWarn(pos, w), 'warn', 'wear_' + pos, 0);
      }
    });
  }

  _checkPitWindow(d, wear) {
    if (!d.in_race || this._pitWarned) return;
    const strat = StrategyEngine.calculate(d, wear);
    if (!strat.mustStop || !strat.pitLap) return;

    const lapsUntilPit = strat.pitLap - d.current_lap;
    if (lapsUntilPit === 3) {
      const P = this._getPhrases();
      this.say(P.pitWindow(lapsUntilPit), 'warn', 'pit', 0);
      // No marcar como warned todavía para poder avisar en lap 1 también
    } else if (lapsUntilPit <= 1) {
      if (!this._pitWarned) {
        this._pitWarned = true;
        const P = this._getPhrases();
        this.say(P.pitWindow(lapsUntilPit), 'crit', 'pit', 0);
      }
    }
  }

  // ── Frases ───────────────────────────────────────────────────

  _getPhrases() {
    const lang = (typeof driverProfile !== 'undefined')
      ? (driverProfile.lang || 'en-US')
      : 'en-US';
    const base = lang.split('-')[0] + '-';
    return this._phrases[lang]
      || Object.entries(this._phrases).find(([k]) => k.startsWith(base))?.[1]
      || this._phrases['en-US'];
  }

  _buildPhrases() {
    return {
      'en-US': {
        raceStart:  ()          => `Race started. Monitoring telemetry. Track: ${TrackDetector.getDisplayName()}.`,
        lapDone:    (lap, t, d) => `Lap ${lap} — ${t}. ${d > 0 ? `${(d/1000).toFixed(1)}s off best.` : d < 0 ? `${Math.abs(d/1000).toFixed(1)}s under best. New PB!` : 'Matched best.'}`,
        fuelLow:    pct         => `Fuel at ${pct.toFixed(0)}%. Watch the fuel.`,
        fuelCrit:   pct         => `Critical! Fuel at ${pct.toFixed(0)}%. Box this lap!`,
        fuelSave:   savePct     => `Fuel short. Save ${savePct.toFixed(1)}% per lap. Lift and coast.`,
        tempHot:    (pos, t)    => `${pos} tyre critical temp — ${t.toFixed(0)}°.`,
        wearWarn:   (pos, w)    => `${pos} tyre at ${w.toFixed(0)}%. Consider pitting.`,
        posGain:    (pos, tot)  => `P${pos} of ${tot}. Good work!`,
        posLost:    (pos, tot)  => `Down to P${pos} of ${tot}. Push!`,
        pitWindow:  laps        => `Pit in ${laps} ${laps === 1 ? 'lap' : 'laps'}.`,
      },
      'es-AR': {
        raceStart:  ()          => `Carrera iniciada. Monitoreando. Pista: ${TrackDetector.getDisplayName()}.`,
        lapDone:    (lap, t, d) => `Vuelta ${lap} — ${t}. ${d > 0 ? `${(d/1000).toFixed(1)}s más lento.` : d < 0 ? `${Math.abs(d/1000).toFixed(1)}s más rápido. Nuevo récord!` : 'Igual a tu mejor.'}`,
        fuelLow:    pct         => `Combustible al ${pct.toFixed(0)}%. Cuidado.`,
        fuelCrit:   pct         => `Crítico! Combustible al ${pct.toFixed(0)}%. Entrá a boxes ya.`,
        fuelSave:   savePct     => `Falta combustible. Ahorrá ${savePct.toFixed(1)}% por vuelta. Lift and coast.`,
        tempHot:    (pos, t)    => `Temperatura crítica en ${pos} — ${t.toFixed(0)}°.`,
        wearWarn:   (pos, w)    => `Neumático ${pos} al ${w.toFixed(0)}%. Considerá pitstop.`,
        posGain:    (pos, tot)  => `Posición ${pos} de ${tot}. Bien!`,
        posLost:    (pos, tot)  => `Bajaste al puesto ${pos} de ${tot}. A empujar!`,
        pitWindow:  laps        => `Boxes en ${laps} ${laps === 1 ? 'vuelta' : 'vueltas'}.`,
      },
      'es-ES': {
        raceStart:  ()          => `Carrera iniciada. Pista: ${TrackDetector.getDisplayName()}.`,
        lapDone:    (lap, t, d) => `Vuelta ${lap} — ${t}. ${d > 0 ? `${(d/1000).toFixed(1)}s más lento.` : d < 0 ? `${Math.abs(d/1000).toFixed(1)}s más rápido!` : 'Igual a tu mejor.'}`,
        fuelLow:    pct         => `Combustible al ${pct.toFixed(0)}%. Atención.`,
        fuelCrit:   pct         => `Crítico! Combustible al ${pct.toFixed(0)}%. Entra a boxes.`,
        fuelSave:   savePct     => `Combustible justo. Ahorra ${savePct.toFixed(1)}% por vuelta.`,
        tempHot:    (pos, t)    => `Temperatura crítica neumático ${pos} — ${t.toFixed(0)}°.`,
        wearWarn:   (pos, w)    => `Neumático ${pos} al ${w.toFixed(0)}%. Valora parar.`,
        posGain:    (pos, tot)  => `Posición ${pos} de ${tot}. Bien!`,
        posLost:    (pos, tot)  => `Has bajado al puesto ${pos} de ${tot}.`,
        pitWindow:  laps        => `Boxes en ${laps} ${laps === 1 ? 'vuelta' : 'vueltas'}.`,
      },
    };
  }
}

// ── Instancia global ─────────────────────────────────────────
// El HTML accede a esto como `window.engineer`
window.engineer = new RaceEngineer();

console.log('[GT7] engineer.js cargado — RaceEngineer listo.');
