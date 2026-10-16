# Plan de Actualización Visual Apple HIG — Gestión Avícola AgroTech

Plan de rediseño integral para transformar la interfaz de la aplicación en una experiencia nativa de alta gama inspirada en **Apple Human Interface Guidelines (HIG)** y las directrices de `apple-design-skill` de Dick Wu: claridad, deferencia, profundidad, materiales translúcidos (*frosted glass*), tipografía San Francisco y controles segmentados estilo macOS/iPadOS.

---

## Decisiones Críticas del Usuario

> [!IMPORTANT]
> **Preferencias confirmadas por el usuario:**
> 1. **Dirección Estética**: Diseño Apple Claro y Oscuro con tipografía limpia, contrastes precisos y toques translúcidos.
> 2. **Estructura de Navegación**: Barra lateral estilo macOS con barra de herramientas superior integrada y controles segmentados.
> 3. **Materiales y Profundidad**: Materiales Apple completos con desenfoque de fondo (*backdrop-blur* / *vibrancy*), bordes sutiles de 1px y sombras difusas multinivel.

---

## 1. Visión General y Principios de Diseño Apple HIG

* **Claridad (Clarity)**: Tipografía legible en todo momento, texto jerarquizado con precisión (`SF Pro Text` / `SF Pro Display` via stack de fuentes nativas del sistema), eliminación de ruido visual y etiquetas innecesarias.
* **Deferencia (Deference)**: La interfaz pasa a segundo plano para destacar los datos reales de la granja (lotes de puesta, estuches envasados, facturas y albaranes).
* **Profundidad y Materiales (Depth & Translucency)**:
  * Paneles con `backdrop-blur-xl` y transparencias calibradas (`bg-white/80 dark:bg-neutral-900/80`).
  * Bordes sutiles ultra-finos: `border-black/[0.06] dark:border-white/[0.08]`.
  * Sombras suaves de varios niveles que simulan elevación natural de ventanas y hojas modales.
* **Cifras Tabulares (`tabular-nums`)**: Todas las métricas numéricas, importes en euros (€), códigos REGA y marcas de tiempo usan alineación numérica fija para evitar vibraciones en listas y tablas.

---

## 2. Especificación Visual y Componentes a Rediseñar

### A. Barra Lateral y Barra de Herramientas (macOS Layout)
* **Barra Lateral (`Sidebar`)**:
  * Ancho fijo ergonómico ($256\text{px}$) con fondo translúcido `bg-neutral-50/90 dark:bg-neutral-900/90 backdrop-blur-xl`.
  * Cabecera con identidad de la granja y semáforo visual decorativo sutil (estilo ventana macOS).
  * Enlaces de navegación con iconos estilo SF Symbols (Lucide con trazo `stroke-[1.5]`), espaciado vertical suave y resaltado de selección con radio `rounded-lg` y fondo `bg-black/5 dark:bg-white/10 text-blue-600 dark:text-blue-400 font-medium`.
  * Pie de barra lateral con estado del operador autenticado (`peduwan@gmail.com`) y botón de colapso rápido.
* **Barra de Herramientas Superior (`Toolbar`)**:
  * Altura de $52\text{px}$ fijada en cabecera con `backdrop-blur-md border-b border-black/[0.06] dark:border-white/[0.08]`.
  * Controles segmentados (*Segmented Controls*) para sub-pestañas: fondo `bg-neutral-200/60 dark:bg-neutral-800/60 p-0.5 rounded-lg`, con botón activo deslizante `bg-white dark:bg-neutral-700 shadow-xs text-neutral-900 dark:text-white rounded-md`.
  * Botones de acción rápida con estilo de botón de sistema macOS (azul Apple `#0071e3` para acciones primarias, superficies sutiles para secundarias).

### B. Tarjetas y Tableros de Métricas (Dashboard Cards)
* **Superficies Apple**:
  * Tarjetas agrupadas con esquinas suaves `rounded-2xl` y fondo `bg-white/70 dark:bg-neutral-800/60 backdrop-blur-md`.
  * Bordes de separación fina `border border-black/[0.05] dark:border-white/[0.07]`.
  * Métricas destacadas con grandes cifras en negrita y títulos subordinados en gris medio (`text-neutral-500 text-xs font-medium uppercase tracking-wider`).
  * Indicadores de tendencia e incremento limpios sin píldoras de colores saturados.

### C. Tablas de Datos y Registros (Grouped List Style)
* **Estilo Listas Agrupadas de iOS/macOS**:
  * Filas con altura fija uniforme ($44\text{px}$–$52\text{px}$), separadores finos entre celdas `divide-y divide-black/[0.04] dark:divide-white/[0.06]`.
  * Efecto hover suave `hover:bg-black/[0.02] dark:hover:bg-white/[0.03]`.
  * Estados fiscales (Veri*Factu, AEAT, Pendiente) representados con puntos de estado discretos (`w-2 h-2 rounded-full`) y texto descriptivo limpio, eliminando pastillas llamativas.

### D. Modales, Hojas y Formularios (macOS Dialogs & Sheets)
* **Diálogos Centrados**:
  * Desenfoque de fondo de pantalla completa (`backdrop-blur-sm bg-black/25 dark:bg-black/60`).
  * Ventana modal con curvatura `rounded-2xl`, sombra envolvente `shadow-2xl` y cabecera integrada con botón de cierre circular minimalista.
  * Inputs con fondo neutro `bg-neutral-100/70 dark:bg-neutral-800/70`, borde transparente o sutil `border-neutral-200/80 dark:border-neutral-700/80` y anillo de foco azul Apple `focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500`.

### E. Dictado por Voz y Asistente Flotante
* **Cápsula Flotante de Dictado**:
  * Indicador flotante con acabado de vidrio oscuro/claro, icono de micrófono y onda de frecuencia animada sutil cuando está grabando.
  * Transición de confirmación tipo HUD de macOS con respuesta háptica visual.

---

## 3. Plan de Implementación por Fases

### Fase 1: Fundamentos y Sistema de Diseño Global
* Actualizar `index.html` y CSS global (`src/index.css`) con el stack tipográfico oficial de Apple (`-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif`), estilos de barra de desplazamiento minimalistas y variables de desenfoque de materiales.
* Crear tokens de estilo reutilizables en Tailwind/CSS para materiales de vidrio (`glass-panel`, `glass-toolbar`, `glass-card`).

### Fase 2: Layout Principal (Barra Lateral y Barra de Herramientas)
* Rediseñar `src/components/Sidebar.tsx` con el estilo macOS (iconos depurados, navegación agrupada, perfil de usuario en pie, soporte translúcido).
* Rediseñar la barra superior de acciones y el selector de pestañas principal en `src/App.tsx`.

### Fase 3: Vistas Operativas y Datos
* Rediseñar `src/components/DashboardView.tsx` aplicando las tarjetas de métricas estilo Apple y gráficos limpios.
* Rediseñar `src/components/VentasFacturacionView.tsx` y subcomponentes (controles segmentados para Albaranes / Facturas / Veri*Factu, listas tabulares con `tabular-nums`).
* Rediseñar las vistas de `PuestaDiariaView.tsx`, `EnvasadoView.tsx` y `TrazabilidadView.tsx` con agrupaciones de tarjetas limpias.

### Fase 4: Modales, Formularios y Dictado de Voz
* Estilizar `src/components/ventas/FormularioVentaModal.tsx`, `src/components/ModalFacturaRectificativa.tsx` y el modal de verificación fiscal con el estilo de diálogo centrado de macOS.
* Refinar el botón de micrófono y el modal de dictado por voz en `src/components/DictadoVozButton.tsx`.

### Fase 5: Verificación Funcional y Tests
* Ejecutar la batería completa de tests (`npm test`) para garantizar que ningún cambio de estilo afecte a la lógica fiscal Veri*Factu ni a los endpoints del servidor.
* Ejecutar `compile_applet` y `lint_applet` para certificar la compilación final.
