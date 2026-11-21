// Rutas y animaciones de los visores 3D. Las rutas son relativas a index.html.

const FINAL = 'Animaciones_Patasola/';
const PROXY = 'Task5/Integracion_Unity/';

export const TEXTURE_DIR = FINAL + 'CHR_Model_Patasola_TPose_TEXTURASUVS.fbm/';
export const FPS = 24;

const FINAL_BASE = FINAL + 'CHR_Model_Patasola_TPose.fbx';
const PROXY_BASE = PROXY + 'CHR_Proxy_CLP_Idle_A.fbx';

// El Idle B del proxy es el mismo movimiento que "Ask for help" en el modelo final.
// Ese par sirve para medir cuánto se desplaza la cadera entre el proxy y el modelo final.
export const REFERENCE_PAIR = {
  proxy: PROXY + 'CHR_Proxy_CLP_Idle_B.fbx',
  final: FINAL + 'CHR_Model_Patasola_Ask_for_help.fbx',
};

export const VIEWERS = {
  // Visor principal
  main: [
    {
      id: 'final',
      name: 'Patasola final',
      base: FINAL_BASE,
      info: 'El personaje terminado, con texturas y sus animaciones.',
      clips: [
        { id: 'ask', name: 'Ask for help', file: FINAL + 'CHR_Model_Patasola_Ask_for_help.fbx' },
        { id: 'threat', name: 'Threat', file: FINAL + 'CHR_Modl_Patasola_Thrat.fbx' },
        { id: 'tired', name: 'Tired', file: FINAL + 'CHR_Model_Patasola_Tired.fbx' },
        { id: 'run', name: 'Run', file: FINAL + 'CHR_Model_Patasola_Run.fbx' },
        { id: 'idleA', name: 'Idle A', file: PROXY + 'CHR_Proxy_CLP_Idle_A.fbx', fromProxy: true },
        { id: 'idleC', name: 'Idle C', file: PROXY + 'CHR_Proxy_CLP_Idle_C.fbx', fromProxy: true },
        { id: 'tpose', name: 'T-Pose', file: FINAL_BASE },
      ],
    },
    {
      id: 'proxy',
      name: 'Proxy',
      base: PROXY_BASE,
      info: 'El muñeco por piezas con el que animé los tres idles.',
      clips: [
        { id: 'idleA', name: 'Idle A', file: PROXY + 'CHR_Proxy_CLP_Idle_A.fbx' },
        { id: 'idleB', name: 'Idle B', file: PROXY + 'CHR_Proxy_CLP_Idle_B.fbx' },
        { id: 'idleC', name: 'Idle C', file: PROXY + 'CHR_Proxy_CLP_Idle_C.fbx' },
      ],
    },
  ],
  // Visor pequeño de la bitácora: el modelo final en pose T
  tpose: [
    {
      id: 'final',
      name: 'Patasola final',
      base: FINAL_BASE,
      clips: [{ id: 'tpose', name: 'T-Pose', file: FINAL_BASE }],
    },
  ],
};
