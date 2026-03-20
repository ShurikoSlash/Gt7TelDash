# 🏎️ GT7 Telemetry Dashboard

> Dashboard de telemetría en tiempo real para Gran Turismo 7 — versión web y app Android standalone (sin PC).

![GT7 Telemetry](https://img.shields.io/badge/Gran%20Turismo-7-red?style=for-the-badge)
![Platform](https://img.shields.io/badge/Platform-Android%20%7C%20Web-blue?style=for-the-badge)
![Flutter](https://img.shields.io/badge/Flutter-3.41.5-02569B?style=for-the-badge&logo=flutter)
![Python](https://img.shields.io/badge/Python-3.x-3776AB?style=for-the-badge&logo=python)

---

## 📋 Tabla de contenidos

- [Descripción](#descripción)
- [Arquitecturas disponibles](#arquitecturas-disponibles)
- [Requisitos](#requisitos)
- [Instalación — Versión Web](#instalación--versión-web)
- [Instalación — App Android](#instalación--app-android)
- [Configurar GT7](#configurar-gt7)
- [Pantallas del dashboard](#pantallas-del-dashboard)
- [Modelo de desgaste de neumáticos](#modelo-de-desgaste-de-neumáticos)
- [Actualizar el dashboard](#actualizar-el-dashboard)
- [Referencia del protocolo UDP](#referencia-del-protocolo-udp)
- [Calibración](#calibración)
- [Estructura del proyecto](#estructura-del-proyecto)

---

## Descripción

GT7 Telemetry Dashboard recibe los paquetes UDP que Gran Turismo 7 transmite en tiempo real y los muestra en un dashboard completo con:

- Velocidad, RPM, marcha y pedales en tiempo real
- Delta vs mejor vuelta **por posición en pista** (como el HUD del juego)
- Temperaturas y desgaste estimado de neumáticos por rueda
- Combustible con estimación de vueltas restantes
- GT Engineer — asistente de voz con alertas automáticas
- Mapa de pista con trazada en tiempo real
- Telemetría con gráficos de velocidad, pedales y RPM
- HUD de carrera con shift LEDs

---

## Arquitecturas disponibles

### Opción A — Versión Web (con PC)
```
PS5 ──UDP 33739/33740──► PC (gt7_server.py)
                              │
                              ├── WebSocket :8765
                              └── HTTP :8766
                                    │
                              Cualquier dispositivo
                              en la misma red WiFi
                              (celular, tablet, PC)
```

### Opción B — App Android Standalone (sin PC)
```
PS5 ──UDP 33739/33740──► App Flutter en Android
                              │
                         WS local :8765
                              │
                         WebView interno
                         (gt7_dashboard.html)
```

---

## Requisitos

### Versión Web
- Python 3.8+
- Librerías: `websockets`, `pycryptodome`
- PS5 y PC en la **misma red WiFi**

### App Android
- Android 8.0+ (API 26+)
- PS5 y dispositivo Android en la **misma red WiFi**
- Para compilar: Flutter 3.41.5+, Android Studio

---

## Instalación — Versión Web

### 1. Instalar dependencias Python
```bash
pip install websockets pycryptodome
```

### 2. Correr el servidor
```bash
# Sin IP (configurar desde el dashboard)
python gt7_server.py

# Con IP de la PS5
python gt7_server.py 192.168.1.XX
```

### 3. Abrir el dashboard
El servidor muestra la URL al arrancar:
```
==================================================
  Dashboard: http://192.168.1.XX:8766
  WebSocket: ws://192.168.1.XX:8765
==================================================
```

Abrí esa URL desde **cualquier dispositivo en tu red**.

### 4. Configurar IP de la PS5
Si no pasaste la IP por consola, el dashboard muestra un panel para ingresarla.  
La IP se guarda automáticamente para la próxima vez.

---

## Instalación — App Android

### Instalar el APK (usuario final)
1. Descargá el APK
2. En Android: **Ajustes → Seguridad → Instalar apps de fuentes desconocidas** ✓
3. Instalá el APK
4. Abrí la app → ingresá la IP de tu PS5 → CONECTAR

### Compilar desde el código fuente
```bash
# Clonar y entrar al proyecto
cd gt7_flutter_standalone

# Instalar dependencias
flutter pub get

# Correr en dispositivo conectado (debug)
flutter run

# Compilar APK release
flutter build apk --release
# APK en: build/app/outputs/flutter-apk/app-release.apk
```

---

## Configurar GT7

En Gran Turismo 7, antes de correr:

```
Menú principal → Opciones → Opciones de red →
Activar telemetría de simulador → Puerto: 33740
```

> ⚠️ El juego solo transmite datos cuando estás **en pista activa** (carrera, tiempo libre, clasificación). En el menú principal no manda nada.

### Encontrar la IP de la PS5
```
PS5 → Ajustes → Red → Ver estado de conexión → Dirección IP
```

---

## Pantallas del dashboard

### 🟢 En Vivo
Datos en tiempo real: velocidad, marcha, RPM con barra de shift, pedales, dirección, combustible y suspensión.

### 🟡 Neumáticos
- **Temperatura** por rueda con colores indicativos:
  - 🔵 Azul = frío (<60°C)
  - 🟢 Verde = óptimo (80-100°C)  
  - 🟡 Amarillo = caliente (100-120°C)
  - 🔴 Rojo = sobrecalentado (>140°C)
- **Desgaste estimado** por rueda con historial por vuelta

### 🔵 Vueltas
Historial de tiempos, mejor vuelta marcada, delta vs mejor.

### 🗺️ Mapa
Trazada de posición XYZ en tiempo real con mapa coloreado por canal de telemetría.

### 📈 Telemetría
Gráficos en tiempo real de velocidad, pedales y RPM.

### 🏁 Carrera
HUD completo para usar durante la carrera:
- Shift LEDs (verde → amarillo → rojo → blanco parpadeante)
- Velocidad y marcha grandes
- **Delta en tiempo real por posición en pista**
- Neumáticos con temperatura
- Combustible
- Mini mapa

### ⚙️ Config
Personalización del HUD, colores, imágenes, stickers arrastrables.

---

## Modelo de desgaste de neumáticos

> GT7 **no transmite el desgaste real** de neumáticos por UDP. El dashboard lo estima acumulando "stress" físico usando toda la data disponible del paquete.

### Variables usadas en el cálculo

| Variable | Uso |
|---|---|
| Velocidad (m/s) | Base del stress — a mayor velocidad más desgaste |
| G lateral (accel.x) | Carga en curvas |
| G longitudinal (accel.z) | Frenada → delanteros / Aceleración → traseros |
| Roll (rotation.z) | Amplifica carga en ruedas exteriores en curvas |
| Suspensión FL/FR/RL/RR | Carga real individual por rueda |
| Steering | Mayor ángulo = más desgaste en delanteros |
| Throttle / Brake | Stress adicional por tracción y frenada |
| Wheel speed vs car speed | Slip = burnout/bloqueo = desgaste puntual alto |
| Temperatura neumáticos | Factor: frío (<40°C) = 5%, óptimo (>80°C) = 100% |
| car_on_track | Solo acumula en pista |
| paused | Para en pausa/garage |

### Cómo funciona la asimetría FL/FR y RL/RR

En curva izquierda → FL y RL llevan más carga (exterior) → más desgaste  
En curva derecha → FR y RR llevan más carga (exterior) → más desgaste

El factor de suspensión ajusta individualmente cada rueda según la carga real medida.

---

## Actualizar el dashboard

El HTML del dashboard se puede actualizar sin recompilar la app:

### Setup GitHub Pages (una sola vez)
1. Subir `gt7_dashboard.html` al repo
2. Settings → Pages → Source: main / root
3. URL: `https://ShurikoSlash.github.io/Gt7TelDash/gt7_dashboard.html`

### Actualizar
1. Editá `gt7_dashboard.html` localmente
2. Subilo al repo (drag & drop en GitHub o `git push`)
3. La próxima vez que los usuarios abran la app, descargan la versión nueva automáticamente

### Fallback offline
Si no hay internet → usa cache local (hasta 7 días)  
Si no hay cache → usa el HTML embebido en los assets de la app

---

## Referencia del protocolo UDP

### Datos del paquete
- **Puerto:** 33740 (entrada) / 33739 (keepalive)
- **Frecuencia:** ~60 paquetes/segundo
- **Tamaño:** 296 bytes
- **Cifrado:** Salsa20
- **Key:** `"Simulator Interface Packet GT7 v"` (32 bytes)

### JSON transmitido por WebSocket

```json
{
  "speed_kmh": 187.3,
  "speed_ms": 52.0,
  "rpm": 7845,
  "rpm_rev_warn": 7200,
  "rpm_rev_limit": 8500,
  "gear": 4,
  "suggested_gear": 5,
  "throttle_pct": 85,
  "brake_pct": 0,
  "steering": -0.142,
  "clutch": 0.0,
  "boost_kgf": 0.45,
  "oil_pressure": 4.2,
  "water_temp": 88.0,
  "oil_temp": 102.0,
  "fuel_pct": 64.0,
  "fuel_level": 0.64,
  "fuel_capacity": 64.0,
  "fuel_liters": 41.0,
  "tyre_temp": { "FL": 89.2, "FR": 88.7, "RL": 92.1, "RR": 91.8 },
  "tyre_wear": { "FL": 94.1, "FR": 94.1, "RL": 97.2, "RR": 97.2 },
  "wheel_speed": { "FL": 148.2, "FR": 148.5, "RL": 147.9, "RR": 148.1 },
  "tyre_radius": { "FL": 0.334, "FR": 0.334, "RL": 0.350, "RR": 0.350 },
  "suspension": { "FL": 0.042, "FR": 0.038, "RL": 0.051, "RR": 0.049 },
  "current_lap": 3,
  "laps_in_race": 10,
  "best_lap": "2:35.619",
  "last_lap": "2:38.204",
  "best_lap_ms": 155619,
  "last_lap_ms": 158204,
  "current_lap_time": 45231,
  "time_of_day_ms": 890000,
  "race_position": 1,
  "cars_in_race": 8,
  "in_race": true,
  "car_on_track": true,
  "paused": false,
  "has_turbo": true,
  "hand_brake": false,
  "traction_control": true,
  "accel": { "x": -0.412, "y": 0.021, "z": 0.183 },
  "rotation": { "x": 0.003, "y": 0.012, "z": 0.045 },
  "angular_vel": { "x": 0.001, "y": 0.008, "z": 0.023 },
  "position": { "x": 1234.5, "y": 0.3, "z": -567.8 },
  "north_orient": 0.7071,
  "east_orient": 0.7071,
  "timestamp": 1234567890.123
}
```

### Offsets principales del paquete raw

| Offset | Tipo | Campo |
|--------|------|-------|
| 0x00 | uint32 | Magic `0x47375330` |
| 0x04 | float | pos_x |
| 0x08 | float | pos_y |
| 0x0C | float | pos_z |
| 0x10 | float | accel_x (G lateral) |
| 0x14 | float | accel_y |
| 0x18 | float | accel_z (G longitudinal) |
| 0x1C-0x24 | float×3 | rotation x/y/z |
| 0x3C | float | RPM |
| 0x44 | float | fuel_pct (0-100) |
| 0x4C | float | speed (m/s) |
| 0x50 | float | turbo boost |
| 0x54 | float | oil pressure |
| 0x58 | float | water temp |
| 0x5C | float | oil temp |
| 0x60-0x6C | float×4 | tyre temp FL/FR/RL/RR |
| 0x74 | int16 | current_lap |
| 0x76 | int16 | laps_in_race |
| 0x78 | int32 | best_lap_ms |
| 0x7C | int32 | last_lap_ms |
| 0x80 | int32 | time_of_day_ms |
| 0x84 | int16 | race_position |
| 0x86 | int16 | cars_in_race |
| 0x8E | uint16 | flags |
| 0x90 | uint8 | gear (bits 0-3) + suggested (bits 4-7) |
| 0x91 | uint8 | throttle (0-255) |
| 0x92 | uint8 | brake (0-255) |
| 0x96 | int16 | steering |
| 0xA0-0xAC | float×4 | wheel_speed FL/FR/RL/RR |
| 0xB4-0xC0 | float×4 | tyre_radius FL/FR/RL/RR |
| 0xC4-0xD0 | float×4 | suspension FL/FR/RL/RR |

---

## Calibración

### Ajustar velocidad de desgaste
En `gt7_server.py`, buscar:
```python
_WEAR_REF = 250000.0
```
- Dashboard muestra **más** desgaste que el juego → **subir** el número (ej: 350000)
- Dashboard muestra **menos** desgaste que el juego → **bajar** el número (ej: 180000)

### Multiplicadores desde el dashboard
El panel ⚙️ en el dashboard permite ajustar en vivo:
- **Desgaste ×** — multiplica la visualización del desgaste (no el cálculo)
- **Combustible ×** — ajusta el consumo estimado
- **Tanque (L)** — capacidad del tanque del auto actual

---

## Estructura del proyecto

```
GT7 DASH Project/
├── gt7_server.py              # Servidor Python (versión web)
├── gt7_dashboard.html         # Dashboard web
├── GT7_PACKET_REFERENCE.txt   # Referencia completa de offsets UDP
│
└── gt7_flutter_standalone/    # App Android
    ├── pubspec.yaml
    ├── assets/
    │   └── gt7_dashboard.html # HTML embebido en la app
    ├── android/
    │   └── app/src/main/
    │       ├── AndroidManifest.xml
    │       └── res/xml/
    │           └── network_security_config.xml
    └── lib/
        ├── main.dart
        ├── theme.dart
        ├── core/
        │   ├── salsa20.dart       # Descifrado Salsa20 en Dart puro
        │   ├── gt7_parser.dart    # Parser de paquetes UDP
        │   └── ws_server.dart     # WebSocket server local
        ├── models/
        │   └── gt7_data.dart      # Modelo de datos
        ├── services/
        │   └── telemetry_service.dart  # UDP listener + desgaste
        └── screens/
            ├── connect_screen.dart     # Pantalla de conexión
            └── webview_screen.dart     # WebView con auto-update
```

---

## Tecnologías

| Tecnología | Uso |
|---|---|
| Python 3 + websockets | Servidor web — recibe UDP, retransmite WS |
| Salsa20 (pycryptodome) | Descifrado de paquetes GT7 |
| HTML + CSS + JS | Dashboard UI |
| Chart.js | Gráficos de telemetría |
| Flutter 3.41.5 | App Android standalone |
| Dart (Salsa20 puro) | Descifrado sin dependencias en la app |
| shelf + shelf_web_socket | WS server local dentro de la app |
| flutter_inappwebview | WebView en Flutter |
| GitHub Pages | Auto-update del HTML sin recompilar |

---

## Notas

- GT7 **no transmite desgaste real** de neumáticos — es siempre una estimación
- El delta en tiempo real requiere completar **al menos 1 vuelta** para tener traza de referencia
- En lluvia los neumáticos se mantienen fríos → el factor de temperatura reduce el desgaste estimado automáticamente
- El servidor solo recibe datos cuando el auto está **en pista activa**

---

*Desarrollado para Gran Turismo 7 — PlayStation 5*
