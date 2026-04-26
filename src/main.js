import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";

const MAP_SCALE = 3.4;
const WORLD_RADIUS = 62 * MAP_SCALE;
const PLAYER_HEIGHT = 1.72;
const PLAYER_RADIUS = 0.62;
const ENEMY_RADIUS = 0.78;
const ENEMY_HITBOX_HEIGHT = 2.8;
const GRAVITY = 18;
const JUMP_VELOCITY = 6.4;
const BASE_MOUSE_SENSITIVITY = 0.0022;
const BASE_VERTICAL_SENSITIVITY = 0.0018;
const BASE_KEYBOARD_LOOK_SPEED = 1.65;
const PICKUP_DISTANCE = 4.6;
const FLOOR_HEIGHT = 3.2;
const BUILDING_ZONE_MARGIN = 1.5;
const CLOCK = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const QUALITY_MODE = getInitialQualityMode();
const LOW_SPEC_MODE = QUALITY_MODE === "low";
const NORMAL_QUALITY_MODE = QUALITY_MODE === "normal";
const HIGH_DETAIL_MODE = QUALITY_MODE === "high" || QUALITY_MODE === "ultra";
const ULTRA_QUALITY_MODE = QUALITY_MODE === "ultra";
const MAX_PIXEL_RATIO = LOW_SPEC_MODE ? 0.75 : NORMAL_QUALITY_MODE ? 1 : ULTRA_QUALITY_MODE ? 2 : 1.5;
const ENABLE_SHADOWS = HIGH_DETAIL_MODE;
const TARGET_FRAME_MS = LOW_SPEC_MODE ? 1000 / 30 : NORMAL_QUALITY_MODE ? 1000 / 45 : 0;
const PHYSICS_STEPS = ULTRA_QUALITY_MODE ? 2 : 1;
const textureLoader = new THREE.TextureLoader();
textureLoader.setCrossOrigin("anonymous");

const TEXTURE_SOURCES = {
  ground: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Ground037_PREVIEW.jpg?width=512",
  concrete: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Concrete026_8K_Color.png?width=512",
  wood: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Wood015_8K_Color.png?width=512",
};
const ENEMY_FACE_TEXTURE_URL = new URL("../assets/epstein-face.png", import.meta.url).href;
const HAWKING_FACE_TEXTURE_URL = new URL("../assets/hawking-face.jpg", import.meta.url).href;
const TRUMP_FACE_TEXTURE_URL = new URL("../assets/trump-face.jpg", import.meta.url).href;
const GRASS_MODEL_SOURCE_URL = "https://pixabay.com/3d-models/grass-low-poly-nature-low-poly-13/";
const DEFAULT_HUNTER_IDS = ["epstein", "hawking", "trump"];
const RADAR_SCAN_RANGE = 115;
const RADAR_BATTERY_MAX = 100;
const RADAR_BATTERY_START = 45;
const RADAR_BATTERY_PICKUP = 35;
const RADAR_BATTERY_DRAIN_PER_SECOND = 8;

const GAME_MODES = {
  normal: {
    speedMultiplier: 1,
    hearingMultiplier: 1,
    sightMultiplier: 1,
    rangeMultiplier: 1,
    boatOnly: false,
    wallBreaker: false,
    hunterIds: DEFAULT_HUNTER_IDS,
    radarMode: "start",
    label: "Normal",
  },
  practice: {
    speedMultiplier: 1,
    hearingMultiplier: 1,
    sightMultiplier: 1,
    rangeMultiplier: 1,
    boatOnly: false,
    wallBreaker: false,
    hunterIds: [],
    radarMode: "collect",
    daylight: true,
    label: "Practice",
  },
  custom: {
    speedMultiplier: 1,
    hearingMultiplier: 1,
    sightMultiplier: 1,
    rangeMultiplier: 1,
    boatOnly: false,
    wallBreaker: false,
    hunterIds: DEFAULT_HUNTER_IDS,
    radarMode: "start",
    custom: true,
    label: "Custom",
  },
  impossible: {
    speedMultiplier: 3,
    hearingMultiplier: 5,
    sightMultiplier: 5,
    rangeMultiplier: 5,
    boatOnly: true,
    wallBreaker: true,
    wallBreakDelay: 1.35,
    hunterIds: DEFAULT_HUNTER_IDS,
    radarMode: "start",
    label: "Impossible",
  },
};

const textureFallbackCache = new Map();
const publicTextureCache = new Map();
const publicTextureWaiters = new Map();

function getInitialQualityMode() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get("quality");
  const stored = window.localStorage?.getItem("blackTideQuality");
  return normalizeQualityMode(fromUrl || stored || "low");
}

function normalizeQualityMode(mode) {
  return ["low", "normal", "high", "ultra"].includes(mode) ? mode : "low";
}

const ISLAND_OUTLINE = [
  [-34, 5],
  [-30, 17],
  [-19, 27],
  [-4, 31],
  [11, 28],
  [24, 21],
  [32, 11],
  [35, -1],
  [30, -14],
  [18, -25],
  [4, -30],
  [-12, -27],
  [-25, -20],
  [-32, -8],
  [-34, 0],
].map(([x, z]) => new THREE.Vector2(x * MAP_SCALE, z * MAP_SCALE));

const REQUIRED_ITEM_IDS = [
  "key",
  "fuel",
  "files",
  "accessCard",
  "fuse",
  "safeCode",
  "chart",
  "manifest",
  "battery",
  "magnifier",
  "radar",
];

const INVENTORY_ITEM_IDS = ["key", "files", "safeCode", "magnifier", "radar"];
const CODE_LOCKED_ITEM_IDS = new Set(["files", "chart"]);

function createStartingInventorySlots(modeConfig = GAME_MODES.normal) {
  const slots = Array(6).fill(null);
  const radarMode = modeConfig.radarMode || "start";
  if (radarMode === "start") {
    slots[5] = "radar";
  }
  return slots;
}

function createStartingItems(modeConfig = GAME_MODES.normal) {
  const items = Object.fromEntries(REQUIRED_ITEM_IDS.map((id) => [id, false]));
  const radarMode = modeConfig.radarMode || "start";
  if (radarMode === "start" || radarMode === "none") {
    items.radar = true;
  }
  return items;
}

const ITEM_LABELS = {
  key: "Boat key",
  fuel: "Fuel can",
  files: "The files",
  accessCard: "Access card",
  fuse: "Dock fuse",
  safeCode: "Safe code",
  chart: "Island chart",
  manifest: "Harbor manifest",
  battery: "Radio battery",
  magnifier: "Magnifying glass",
  radar: "Radar goggles",
};

const HUNTER_SPECS = [
  {
    id: "epstein",
    name: "Epstein",
    textureUrl: ENEMY_FACE_TEXTURE_URL,
    textureCrop: { x: 0.05, y: 0.05, w: 0.9, h: 0.88 },
    radius: ENEMY_RADIUS,
    height: ENEMY_HITBOX_HEIGHT,
    speedScale: 1,
    rangeScale: 1,
    kind: "box",
    debugColor: 0xff3b30,
  },
  {
    id: "hawking",
    name: "Hawking",
    textureUrl: HAWKING_FACE_TEXTURE_URL,
    textureCrop: { x: 0.19, y: 0.43, w: 0.62, h: 0.5 },
    radius: 0.46,
    height: 2.25,
    speedScale: 0.72,
    rangeScale: 1.65,
    kind: "wheelchair",
    debugColor: 0x59a6ff,
  },
  {
    id: "trump",
    name: "Trump",
    textureUrl: TRUMP_FACE_TEXTURE_URL,
    radius: ENEMY_RADIUS,
    height: ENEMY_HITBOX_HEIGHT,
    speedScale: 1,
    rangeScale: 1,
    kind: "box",
    eagleSound: true,
    debugColor: 0xffd447,
  },
];

function createDefaultCustomMode() {
  return {
    speedMultiplier: 1,
    hearingMultiplier: 1,
    sightMultiplier: 1,
    rangeMultiplier: 1,
    hunterIds: [...DEFAULT_HUNTER_IDS],
    requiredItems: [...REQUIRED_ITEM_IDS],
    radarMode: "start",
    daylight: false,
  };
}

const PLAYER_START = new THREE.Vector3(-24 * MAP_SCALE, PLAYER_HEIGHT, 17 * MAP_SCALE);
const MAIN_COMPOUND_CENTER = new THREE.Vector3(7, 0, 10);
const HELIPAD_CENTER = new THREE.Vector3(20, 0, 8);
const WEST_POOL_CENTER = new THREE.Vector3(-24, 0, 8);
const LAGOON_CENTER = new THREE.Vector3(-10, 0, -13);
const TEMPLE_POINT = new THREE.Vector3(-22, 0, -20);
const DOCK_CENTER = new THREE.Vector3(102, 0, -14);
const BOAT_ESCAPE_POINT = new THREE.Vector3(108, 0, -15);

const dom = {
  shell: document.querySelector("#game-shell"),
  prompt: document.querySelector("#center-prompt"),
  status: document.querySelector("#status-line"),
  alert: document.querySelector("#alert-pill"),
  flashlightPill: document.querySelector("#flashlight-pill"),
  radarPill: document.querySelector("#radar-pill"),
  inventory: document.querySelector("#inventory-panel"),
  inventorySlots: [...document.querySelectorAll("[data-slot]")],
  radarMap: document.querySelector("#radar-map"),
  radarBlips: document.querySelector("#radar-blips"),
  radarBatteryText: document.querySelector("#radar-battery-text"),
  readout: document.querySelector("#readout-panel"),
  readoutTitle: document.querySelector("#readout-title"),
  readoutBody: document.querySelector("#readout-body"),
  readoutClose: document.querySelector("#readout-close"),
  timer: document.querySelector("#timer-pill"),
  soundFill: document.querySelector("#sound-fill"),
  soundText: document.querySelector("#sound-text"),
  startScreen: document.querySelector("#start-screen"),
  endScreen: document.querySelector("#end-screen"),
  startButton: document.querySelector("#start-button"),
  practiceButton: document.querySelector("#practice-button"),
  customButton: document.querySelector("#custom-button"),
  impossibleButton: document.querySelector("#impossible-button"),
  qualityButtons: [...document.querySelectorAll("[data-quality]")],
  customHunters: [...document.querySelectorAll("[data-custom-hunter]")],
  customItems: [...document.querySelectorAll("[data-custom-item]")],
  customRadar: document.querySelector("#custom-radar"),
  customHearing: document.querySelector("#custom-hearing"),
  customHearingValue: document.querySelector("#custom-hearing-value"),
  customSight: document.querySelector("#custom-sight"),
  customSightValue: document.querySelector("#custom-sight-value"),
  customSpeed: document.querySelector("#custom-speed"),
  customSpeedValue: document.querySelector("#custom-speed-value"),
  restartButton: document.querySelector("#restart-button"),
  musicVolume: document.querySelector("#music-volume"),
  musicValue: document.querySelector("#music-value"),
  sensitivitySlider: document.querySelector("#sensitivity-slider"),
  sensitivityValue: document.querySelector("#sensitivity-value"),
  endKicker: document.querySelector("#end-kicker"),
  endTitle: document.querySelector("#end-title"),
  endCopy: document.querySelector("#end-copy"),
  checklist: Object.fromEntries(
    [...document.querySelectorAll("[data-item]")].map((element) => [element.dataset.item, element]),
  ),
};

const state = {
  started: false,
  pointerLocked: false,
  gameOver: false,
  victory: false,
  yaw: 0,
  pitch: 0,
  gameMode: "normal",
  customMode: createDefaultCustomMode(),
  message: "Reach the boat after you collect everything.",
  prompt: "",
  interactive: null,
  settings: {
    musicVolume: 0.65,
    sensitivity: 1,
  },
  inventory: {
    slots: createStartingInventorySlots(),
    selected: 5,
    magnifierOn: false,
    heldBob: 0,
  },
  code: {
    value: generateSafeCode(),
    active: false,
    item: null,
    input: "",
  },
  timer: {
    running: false,
    startAt: 0,
    elapsed: 0,
    lastDisplayAt: 0,
  },
  input: {
    dragging: false,
    pointerId: null,
    lastX: 0,
    lastY: 0,
  },
  player: {
    position: PLAYER_START.clone(),
    bob: 0,
    sound: 0,
    crouching: false,
    sprinting: false,
    moving: false,
    verticalVelocity: 0,
    jumpOffset: 0,
    grounded: true,
    floorHeight: 0,
    flashlightOn: true,
    hiding: false,
    hiddenSpot: null,
    hideCheckDecided: false,
    hideCheckWillSearch: false,
    gogglesOn: false,
    radarTarget: null,
    radarBattery: RADAR_BATTERY_START,
    radarSweep: 0,
  },
  items: createStartingItems(),
  enemy: createHunterState(),
  audioReady: false,
};

function createHunterState() {
  return {
    mode: "patrol",
    heardAt: new THREE.Vector3(),
    lookTarget: new THREE.Vector3(),
    loseSightTimer: 0,
    searchTimer: 0,
    waypointIndex: 0,
    spottedOnce: false,
    nearWarned: false,
    awareness: 0,
    wanderTarget: new THREE.Vector3(),
    floorHeight: 0,
    targetFloor: 0,
    stairGoal: null,
    stairCooldown: 0,
    wanderTimer: 0,
    checkHideSpot: null,
    lastPosition: new THREE.Vector3(),
    stuckTimer: 0,
    wallBreakTimer: 0,
    wallBreakCooldown: 0,
  };
}

const keys = new Set();
const colliders = [];
const lineOfSightMeshes = [];
const collectibles = [];
const radarBatteryPickups = [];
const stairways = [];
const floorZones = [];
const hideSpots = [];
const grassFields = [];
const heldItemModels = new Map();
const heldItemRoot = new THREE.Group();
const environment = {
  hemi: null,
  moon: null,
  moonFill: null,
  sun: null,
  moonSphere: null,
};
let lastFrameAt = 0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02070a);
scene.fog = new THREE.FogExp2(0x02090c, LOW_SPEC_MODE ? 0.02 : NORMAL_QUALITY_MODE ? 0.016 : 0.012);

const camera = new THREE.PerspectiveCamera(72, 1, 0.1, LOW_SPEC_MODE ? 300 : ULTRA_QUALITY_MODE ? 560 : 420);
camera.rotation.order = "YXZ";
camera.position.copy(state.player.position);

const renderer = new THREE.WebGLRenderer({
  antialias: !LOW_SPEC_MODE,
  powerPreference: LOW_SPEC_MODE ? "low-power" : "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = LOW_SPEC_MODE ? 0.68 : ULTRA_QUALITY_MODE ? 0.8 : 0.74;
renderer.shadowMap.enabled = ENABLE_SHADOWS;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.tabIndex = 0;
dom.shell.append(renderer.domElement);

const flashlight = new THREE.SpotLight(0xe8fbff, 88, 72, Math.PI / 10, 0.22, 1.28);
flashlight.position.set(0, 0.08, 0.08);
flashlight.target.position.set(0, -0.12, -20);
flashlight.castShadow = ENABLE_SHADOWS;
flashlight.shadow.mapSize.set(ULTRA_QUALITY_MODE ? 2048 : LOW_SPEC_MODE ? 256 : 1024, ULTRA_QUALITY_MODE ? 2048 : LOW_SPEC_MODE ? 256 : 1024);
camera.add(flashlight);
camera.add(flashlight.target);
scene.add(camera);

const playerFootGlow = new THREE.PointLight(0x78c8b8, 0.22, 8);
playerFootGlow.position.set(0, -1.1, 0);
camera.add(playerFootGlow);
heldItemRoot.visible = false;
heldItemRoot.position.set(0.48, -0.42, -0.82);
heldItemRoot.rotation.set(-0.14, -0.32, 0.08);
camera.add(heldItemRoot);

const patrolRoute = [
  new THREE.Vector3(12, 0, 1),
  new THREE.Vector3(22, 0, 65),
  new THREE.Vector3(-62, 0, 64),
  new THREE.Vector3(-82, 0, 58),
  new THREE.Vector3(-54, 0, -32),
  new THREE.Vector3(44, 0, -43),
  new THREE.Vector3(82, 0, -7),
  new THREE.Vector3(103, 0, -14),
  new THREE.Vector3(28, 0, -3),
  new THREE.Vector3(-22, 0, -20),
];
const hunters = [];
let enemyActor;
let enemyDebugHelper;
let activeHunter = null;
let audioSystem = null;

initWorld();
initHeldItemView();
state.player.position.copy(findSafePosition(PLAYER_START, PLAYER_RADIUS));
camera.position.copy(state.player.position);
attachEvents();
syncChecklist();
syncInventoryUI();
syncSettingsFromControls();
syncQualityButtons();
syncCustomControls();
updateTimerDisplay();
window.setInterval(updateTimer, LOW_SPEC_MODE ? 150 : 50);
animate();

function initWorld() {
  addLights();
  addSky();
  addSea();
  addIsland();
  addLagoon();
  addVilla();
  addExpandedCompound();
  addGeneratorShed();
  addWatchPoint();
  addTemple();
  addDockAndBoat();
  addPaths();
  addGroundDetails();
  scatterProps();
  addHidingPlaces();
  addCollectibles();
  addRadarBatteryPickups();
  addHunters();
  resetHunters();
}

function texturedMaterial(kind, options = {}) {
  const {
    color = 0xffffff,
    roughness = 0.9,
    metalness = 0,
    emissive = 0x000000,
    emissiveIntensity = 1,
    transparent = false,
    opacity = 1,
    repeat = [2, 2],
  } = options;
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    emissive,
    emissiveIntensity,
    transparent,
    opacity,
    map: createFallbackTexture(kind, repeat),
  });

  applyPublicTexture(material, kind, repeat);
  return material;
}

function createFallbackTexture(kind, repeat = [1, 1]) {
  const cacheKey = `${kind}:${repeat[0]}:${repeat[1]}`;
  if (textureFallbackCache.has(cacheKey)) {
    return textureFallbackCache.get(cacheKey).clone();
  }

  const canvas = document.createElement("canvas");
  const textureSize = kind === "ground" ? 128 : LOW_SPEC_MODE ? 64 : 128;
  canvas.width = textureSize;
  canvas.height = textureSize;
  const context = canvas.getContext("2d");
  const palettes = {
    ground: ["#314329", "#4c5f36", "#746c4c", "#263a31"],
    concrete: ["#b6ad9b", "#8f8d83", "#d6c9ad", "#666a63"],
    wood: ["#4f3324", "#77533b", "#2d2019", "#9a7552"],
    water: ["#071b22", "#0b3440", "#123f48", "#061015"],
  };
  const palette = palettes[kind] || palettes.concrete;

  context.fillStyle = palette[0];
  context.fillRect(0, 0, canvas.width, canvas.height);
  const speckleCount = LOW_SPEC_MODE ? 80 : 220;
  for (let i = 0; i < speckleCount; i += 1) {
    context.globalAlpha = 0.08 + Math.random() * 0.2;
    context.fillStyle = palette[Math.floor(Math.random() * palette.length)];
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const w = kind === "wood" ? 4 + Math.random() * 42 : 2 + Math.random() * 18;
    const h = kind === "wood" ? 2 + Math.random() * 8 : 2 + Math.random() * 18;
    context.fillRect(x, y, w, h);
  }
  context.globalAlpha = 1;

  if (kind === "wood") {
    context.strokeStyle = "rgba(20, 11, 7, 0.34)";
    for (let y = 8; y < canvas.height; y += 16) {
      context.beginPath();
      context.moveTo(0, y + Math.sin(y) * 2);
      context.lineTo(canvas.width, y + Math.cos(y) * 3);
      context.stroke();
    }
  }

  if (kind === "ground") {
    context.globalAlpha = 0.34;
    context.lineWidth = 1;
    for (let i = 0; i < 28; i += 1) {
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height;
      const length = 5 + Math.random() * 13;
      context.strokeStyle = i % 3 === 0 ? "#8d8056" : "#20381f";
      context.beginPath();
      context.moveTo(x, y);
      context.quadraticCurveTo(x + length * 0.35, y - length * 0.45, x + length, y + Math.random() * 5 - 2.5);
      context.stroke();
    }

    context.globalAlpha = 0.18;
    for (let i = 0; i < 18; i += 1) {
      context.fillStyle = i % 2 === 0 ? "#9f9365" : "#172a1b";
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height;
      context.beginPath();
      context.ellipse(x, y, 2 + Math.random() * 6, 1 + Math.random() * 3, Math.random() * Math.PI, 0, Math.PI * 2);
      context.fill();
    }
    context.globalAlpha = 1;
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat[0], repeat[1]);
  texture.anisotropy = LOW_SPEC_MODE ? 1 : 4;
  textureFallbackCache.set(cacheKey, texture);
  return texture.clone();
}

function applyPublicTexture(material, kind, repeat = [1, 1]) {
  const url = TEXTURE_SOURCES[kind];
  if (!url || LOW_SPEC_MODE) {
    return;
  }

  const cached = publicTextureCache.get(kind);
  if (cached) {
    material.map = cloneTextureWithRepeat(cached, repeat);
    material.needsUpdate = true;
    return;
  }

  if (publicTextureWaiters.has(kind)) {
    publicTextureWaiters.get(kind).push([material, repeat]);
    return;
  }

  publicTextureWaiters.set(kind, [[material, repeat]]);
  textureLoader.load(
    url,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = LOW_SPEC_MODE ? 1 : 6;
      publicTextureCache.set(kind, texture);
      const waiters = publicTextureWaiters.get(kind) || [];
      waiters.forEach(([waitingMaterial, waitingRepeat]) => {
        waitingMaterial.map = cloneTextureWithRepeat(texture, waitingRepeat);
        waitingMaterial.needsUpdate = true;
      });
      publicTextureWaiters.delete(kind);
    },
    undefined,
    () => {
      const waiters = publicTextureWaiters.get(kind) || [];
      waiters.forEach(([waitingMaterial]) => {
        waitingMaterial.needsUpdate = true;
      });
      publicTextureWaiters.delete(kind);
    },
  );
}

function cloneTextureWithRepeat(texture, repeat = [1, 1]) {
  const clone = texture.clone();
  clone.wrapS = THREE.RepeatWrapping;
  clone.wrapT = THREE.RepeatWrapping;
  clone.repeat.set(repeat[0], repeat[1]);
  clone.needsUpdate = true;
  return clone;
}

function addLights() {
  const hemi = new THREE.HemisphereLight(0x6daac7, 0x050605, LOW_SPEC_MODE ? 0.24 : 0.34);
  environment.hemi = hemi;
  scene.add(hemi);

  const moon = new THREE.DirectionalLight(0xa8d7ff, LOW_SPEC_MODE ? 0.14 : HIGH_DETAIL_MODE ? 0.24 : 0.19);
  environment.moon = moon;
  moon.position.set(-70, 90, 26);
  moon.castShadow = ENABLE_SHADOWS;
  moon.shadow.mapSize.set(ULTRA_QUALITY_MODE ? 2048 : LOW_SPEC_MODE ? 256 : 1024, ULTRA_QUALITY_MODE ? 2048 : LOW_SPEC_MODE ? 256 : 1024);
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = WORLD_RADIUS * 2;
  moon.shadow.camera.left = -WORLD_RADIUS;
  moon.shadow.camera.right = WORLD_RADIUS;
  moon.shadow.camera.top = WORLD_RADIUS;
  moon.shadow.camera.bottom = -WORLD_RADIUS;
  scene.add(moon);

  const moonFill = new THREE.DirectionalLight(0x5e93b3, LOW_SPEC_MODE ? 0.035 : 0.055);
  environment.moonFill = moonFill;
  moonFill.position.set(58, 42, -74);
  scene.add(moonFill);

  const sun = new THREE.DirectionalLight(0xffe5b4, 0);
  environment.sun = sun;
  sun.position.set(55, 90, -36);
  sun.castShadow = ENABLE_SHADOWS;
  sun.shadow.mapSize.set(ULTRA_QUALITY_MODE ? 2048 : LOW_SPEC_MODE ? 256 : 1024, ULTRA_QUALITY_MODE ? 2048 : LOW_SPEC_MODE ? 256 : 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = WORLD_RADIUS * 2;
  sun.shadow.camera.left = -WORLD_RADIUS;
  sun.shadow.camera.right = WORLD_RADIUS;
  sun.shadow.camera.top = WORLD_RADIUS;
  sun.shadow.camera.bottom = -WORLD_RADIUS;
  sun.visible = false;
  scene.add(sun);
}

function addSky() {
  const stars = new THREE.BufferGeometry();
  const starCount = LOW_SPEC_MODE ? 300 : ULTRA_QUALITY_MODE ? 3200 : HIGH_DETAIL_MODE ? 2200 : 900;
  const points = new Float32Array(starCount * 3);

  for (let i = 0; i < starCount; i += 1) {
    const radius = 180 + Math.random() * 140;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.55;
    points[i * 3] = Math.cos(theta) * Math.sin(phi) * radius;
    points[i * 3 + 1] = Math.cos(phi) * radius + 24;
    points[i * 3 + 2] = Math.sin(theta) * Math.sin(phi) * radius;
  }

  stars.setAttribute("position", new THREE.BufferAttribute(points, 3));
  const starMaterial = new THREE.PointsMaterial({
    color: 0xd8ecff,
    size: 0.6,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.72,
  });
  const starField = new THREE.Points(stars, starMaterial);
  scene.add(starField);

  const moonSphere = new THREE.Mesh(
    new THREE.SphereGeometry(3.4, LOW_SPEC_MODE ? 14 : 24, LOW_SPEC_MODE ? 10 : 24),
    new THREE.MeshBasicMaterial({ color: 0xe0f1ff, transparent: true, opacity: 0.58 }),
  );
  moonSphere.position.set(-36, 28, -55);
  environment.moonSphere = moonSphere;
  scene.add(moonSphere);
}

function addSea() {
  const waterGeometry = new THREE.CircleGeometry(WORLD_RADIUS * 1.55, LOW_SPEC_MODE ? 32 : 96);
  const waterMaterial = texturedMaterial("water", {
    color: 0x07171d,
    metalness: 0.2,
    roughness: 0.32,
    repeat: [18, 18],
  });
  const water = new THREE.Mesh(waterGeometry, waterMaterial);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.6;
  water.receiveShadow = true;
  scene.add(water);
}

function addIsland() {
  const islandShape = new THREE.Shape(ISLAND_OUTLINE);
  const islandGeometry = new THREE.ShapeGeometry(islandShape, LOW_SPEC_MODE ? 24 : 96);
  const position = islandGeometry.attributes.position;
  const colorValues = [];

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getY(i);
    const y = sampleTerrainHeight(x, z);
    position.setXYZ(i, x, y, z);

    const templeRise = gaussian(x, z, TEMPLE_POINT.x, TEMPLE_POINT.z, 11, 1);
    const lagoonFall = gaussian(x, z, LAGOON_CENTER.x, LAGOON_CENTER.z, 10, 1);
    const highGround = gaussian(x, z, MAIN_COMPOUND_CENTER.x, MAIN_COMPOUND_CENTER.z, 15, 1);

    const dry = new THREE.Color(0x3f5133);
    const sand = new THREE.Color(0x7c7152);
    const lagoon = new THREE.Color(0x244043);
    const templeStone = new THREE.Color(0x8d8466);
    const tint = dry
      .clone()
      .lerp(sand, THREE.MathUtils.clamp(y * 0.18, 0, 0.45))
      .lerp(lagoon, lagoonFall * 0.58)
      .lerp(templeStone, templeRise * 0.36)
      .lerp(new THREE.Color(0x566847), highGround * 0.2);
    colorValues.push(tint.r, tint.g, tint.b);
  }

  islandGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colorValues, 3));
  islandGeometry.computeVertexNormals();

  const islandMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    map: createFallbackTexture("ground", [26, 26]),
  });
  applyPublicTexture(islandMaterial, "ground", [26, 26]);
  const island = new THREE.Mesh(islandGeometry, islandMaterial);
  island.receiveShadow = true;
  scene.add(island);
}

function addLagoon() {
  const lagoon = new THREE.Mesh(
    new THREE.CircleGeometry(7.2, LOW_SPEC_MODE ? 24 : 40),
    new THREE.MeshStandardMaterial({
      color: 0x0d242b,
      roughness: 0.28,
      metalness: 0.12,
      transparent: true,
      opacity: 0.88,
    }),
  );
  lagoon.rotation.x = -Math.PI / 2;
  lagoon.scale.set(1.35, 0.92, 1);
  lagoon.position.set(
    LAGOON_CENTER.x,
    sampleTerrainHeight(LAGOON_CENTER.x, LAGOON_CENTER.z) + 0.06,
    LAGOON_CENTER.z,
  );
  lagoon.receiveShadow = true;
  scene.add(lagoon);
}

function addVilla() {
  const gx = MAIN_COMPOUND_CENTER.x;
  const gz = MAIN_COMPOUND_CENTER.z;
  const baseY = sampleTerrainHeight(gx, gz);

  const terrace = new THREE.Mesh(
    new THREE.BoxGeometry(25, 0.45, 14),
    texturedMaterial("concrete", { color: 0xbcb39a, roughness: 0.98, repeat: [5, 3] }),
  );
  terrace.position.set(4, baseY + 0.18, 9.5);
  terrace.receiveShadow = true;
  scene.add(terrace);

  addBlock(10.5, baseY + 2.5, 10.5, 10.5, 5, 6.2, 0xe0d1b9, true);
  addBlock(5.5, baseY + 1.7, 10.5, 3.2, 3.4, 6.6, 0xd6c1a6, true);
  addBlock(6.8, baseY + 0.85, 10.5, 5.6, 1.5, 7.4, 0xc8b193, false);

  const roofMaterial = texturedMaterial("concrete", { color: 0x5d88b8, roughness: 0.84, repeat: [2, 2] });
  const cabanas = [
    [-1.5, 4.5],
    [-1.5, 9.5],
    [-1.5, 14.5],
    [2.2, 18.5],
  ];
  cabanas.forEach(([x, z]) => {
    const ground = sampleTerrainHeight(x, z);
    addBlock(x, ground + 1.15, z, 2.8, 2.3, 2.8, 0xe5dfd2, true);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.28, 3.2), roofMaterial);
    roof.position.set(x, ground + 2.45, z);
    roof.castShadow = true;
    scene.add(roof);
  });

  const pool = new THREE.Mesh(
    new THREE.BoxGeometry(8.2, 0.18, 4.8),
    texturedMaterial("water", { color: 0x2d5d77, roughness: 0.2, metalness: 0.08, repeat: [3, 2] }),
  );
  pool.position.set(0.5, baseY + 0.16, 10.3);
  pool.receiveShadow = true;
  scene.add(pool);

  const cabana = addBlock(6.5, baseY + 1.25, 3.3, 4.2, 2.5, 3.6, 0x76655a, true);
  const cabanaRoof = new THREE.Mesh(
    new THREE.BoxGeometry(4.6, 0.24, 4),
    texturedMaterial("concrete", { color: 0x5d88b8, roughness: 0.9, repeat: [2, 2] }),
  );
  cabanaRoof.position.set(cabana.position.x, baseY + 2.6, cabana.position.z);
  cabanaRoof.castShadow = true;
  scene.add(cabanaRoof);
}

function addExpandedCompound() {
  const buildings = [
    {
      name: "North Guest House",
      x: -62,
      z: 48,
      w: 34,
      d: 28,
      wall: 0xd5c6ae,
      trim: 0x6f8eb7,
      prop: 0x695446,
    },
    {
      name: "Records Villa",
      x: 22,
      z: 48,
      w: 36,
      d: 30,
      wall: 0xcfc0a8,
      trim: 0x496f8d,
      prop: 0x5b5f65,
    },
    {
      name: "South Barracks",
      x: 44,
      z: -58,
      w: 38,
      d: 25,
      wall: 0x9fa7a4,
      trim: 0x4b5c63,
      prop: 0x3d4a4c,
    },
    {
      name: "Old Service Block",
      x: -54,
      z: -46,
      w: 34,
      d: 24,
      wall: 0x8e9384,
      trim: 0x5b6c58,
      prop: 0x5a4a3d,
    },
    {
      name: "Dock Offices",
      x: 82,
      z: -20,
      w: 30,
      d: 22,
      wall: 0xb9aa93,
      trim: 0x426477,
      prop: 0x57473a,
    },
  ];

  buildings.forEach((building) => addThreeFloorBuilding(building));
  addExpandedPaths();
  addOuterGrounds();
}

function addThreeFloorBuilding({ name, x, z, w, d, wall, trim, prop }) {
  const ground = sampleTerrainHeight(x, z);
  floorZones.push({
    x,
    z,
    w: w + BUILDING_ZONE_MARGIN * 2,
    d: d + BUILDING_ZONE_MARGIN * 2,
    name,
  });

  const floorMaterial = texturedMaterial("concrete", { color: 0x675f52, roughness: 0.96, repeat: [6, 5] });
  const roofMaterial = texturedMaterial("concrete", { color: trim, roughness: 0.86, repeat: [5, 4] });
  const windowMaterial = new THREE.MeshStandardMaterial({
    color: 0x82c1d8,
    emissive: 0x142530,
    roughness: 0.4,
  });

  for (let floor = 0; floor < 3; floor += 1) {
    const floorBase = ground + floor * FLOOR_HEIGHT;
    const wallY = floorBase + 1.42;
    const floorDeck = new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, d), floorMaterial);
    floorDeck.position.set(x, floorBase + 0.04, z);
    floorDeck.receiveShadow = true;
    scene.add(floorDeck);
    lineOfSightMeshes.push(floorDeck);

    addRoomWalls(x, z, w, d, wallY, wall, floor === 0);
    addRoomProps(x, z, w, d, floorBase, floor, prop);

    for (const side of [-1, 1]) {
      for (const offset of [-0.28, 0, 0.28]) {
        const window = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.72, 0.08), windowMaterial);
        window.position.set(x + offset * w, floorBase + 1.75, z + side * (d / 2 + 0.04));
        scene.add(window);
      }
    }

    for (const side of [-1, 1]) {
      const window = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.72, 2.2), windowMaterial);
      window.position.set(x + side * (w / 2 + 0.04), floorBase + 1.75, z);
      scene.add(window);
    }
  }

  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 1.4, 0.34, d + 1.4), roofMaterial);
  roof.position.set(x, ground + FLOOR_HEIGHT * 3 + 0.22, z);
  roof.castShadow = true;
  scene.add(roof);

  addStairway(x - w * 0.34, z + d * 0.26, ground, name);

  const stairColumn = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, FLOOR_HEIGHT * 3, 3.2),
    texturedMaterial("concrete", {
      color: 0x323a3b,
      roughness: 0.88,
      transparent: true,
      opacity: 0.42,
      repeat: [1, 5],
    }),
  );
  stairColumn.position.set(x - w * 0.34, ground + FLOOR_HEIGHT * 1.5, z + d * 0.26);
  stairColumn.castShadow = true;
  scene.add(stairColumn);
}

function addRoomWalls(x, z, w, d, y, color, hasFrontDoor) {
  const wallH = 2.72;
  const thick = 0.32;
  const frontGap = hasFrontDoor ? 4.2 : 2.4;
  const sideSpan = (w - frontGap) / 2;

  addBlock(x - (frontGap / 2 + sideSpan / 2), y, z + d / 2, sideSpan, wallH, thick, color, true);
  addBlock(x + (frontGap / 2 + sideSpan / 2), y, z + d / 2, sideSpan, wallH, thick, color, true);
  addBlock(x, y, z - d / 2, w, wallH, thick, color, true);
  addBlock(x - w / 2, y, z, thick, wallH, d, color, true);
  addBlock(x + w / 2, y, z, thick, wallH, d, color, true);

  const hallGap = 3.2;
  addBlock(x, y, z - d * 0.23, thick, wallH, d * 0.42, color, true);
  addBlock(x, y, z + d * 0.28, thick, wallH, d * 0.28, color, true);
  addBlock(x - w * 0.25, y, z, w * 0.33, wallH, thick, color, true);
  addBlock(x + w * 0.25, y, z, w * 0.33, wallH, thick, color, true);
  addBlock(x - w * 0.32, y, z + d * 0.2, w * 0.2, wallH, thick, color, true);
  addBlock(x + w * 0.32, y, z - d * 0.2, w * 0.2, wallH, thick, color, true);

  const lintel = new THREE.Mesh(
    new THREE.BoxGeometry(frontGap, 0.22, thick),
    texturedMaterial("concrete", { color: 0x4f5752, roughness: 0.9, repeat: [2, 1] }),
  );
  lintel.position.set(x, y + wallH / 2 + 0.08, z + d / 2);
  lintel.castShadow = true;
  scene.add(lintel);

  const rug = new THREE.Mesh(
    new THREE.BoxGeometry(hallGap, 0.035, d * 0.56),
    texturedMaterial("wood", { color: 0x493333, roughness: 0.98, repeat: [2, 4] }),
  );
  rug.position.set(x, y - wallH / 2 + 0.07, z + d * 0.12);
  rug.receiveShadow = true;
  scene.add(rug);
}

function addRoomProps(x, z, w, d, floorBase, floor, color) {
  const y = floorBase + 0.42;
  const material = texturedMaterial("wood", { color, roughness: 0.86, repeat: [2, 1] });
  const accent = texturedMaterial("wood", {
    color: floor === 0 ? 0x3d5960 : floor === 1 ? 0x5f5348 : 0x584259,
    roughness: 0.84,
    repeat: [2, 1],
  });
  const props = [
    [x - w * 0.32, z - d * 0.28, 3.8, 0.74, 1.7, material],
    [x + w * 0.3, z - d * 0.28, 3.1, 0.74, 1.5, accent],
    [x - w * 0.3, z + d * 0.27, 2.6, 0.82, 2.1, accent],
    [x + w * 0.32, z + d * 0.25, 2.2, 0.95, 1.4, material],
    [x, z - d * 0.02, 3.2, 0.52, 1.1, material],
  ];

  props.forEach(([px, pz, pw, ph, pd, propMaterial], index) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pd), propMaterial);
    mesh.position.set(px, y + index * 0.015, pz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (index < 2) {
      registerCollider(mesh, false, 0.12);
    }
  });

  for (const lampOffset of [-0.22, 0.22]) {
    const lamp = new THREE.PointLight(0xf1c27c, 0.35, 8);
    lamp.position.set(x + w * lampOffset, floorBase + 1.7, z + d * 0.12);
    scene.add(lamp);
  }
}

function addStairway(x, z, ground, label) {
  const marker = new THREE.Mesh(
    new THREE.BoxGeometry(2.4, 0.12, 2.4),
    new THREE.MeshStandardMaterial({
      color: 0x9bc4d1,
      emissive: 0x122d35,
      roughness: 0.56,
    }),
  );
  marker.position.set(x, ground + 0.12, z);
  marker.receiveShadow = true;
  scene.add(marker);

  stairways.push({
    label,
    position: new THREE.Vector3(x, ground, z),
    floors: [0, FLOOR_HEIGHT, FLOOR_HEIGHT * 2],
  });
}

function addExpandedPaths() {
  const pathMaterial = texturedMaterial("ground", { color: 0x5f5747, roughness: 1, repeat: [18, 2] });
  const longPaths = [
    { x: -43, z: 51, w: 75, d: 3.2, rot: 0.02 },
    { x: -15, z: 27, w: 62, d: 3, rot: -0.72 },
    { x: 47, z: 24, w: 82, d: 3, rot: -0.78 },
    { x: 72, z: -18, w: 58, d: 3, rot: -0.1 },
    { x: 13, z: -50, w: 86, d: 3.2, rot: 0.08 },
    { x: -48, z: -32, w: 48, d: 3, rot: -0.95 },
    { x: -70, z: 5, w: 66, d: 2.8, rot: 1.18 },
  ];

  longPaths.forEach(({ x, z, w, d, rot }) => {
    const path = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), pathMaterial);
    path.position.set(x, sampleTerrainHeight(x, z) + 0.1, z);
    path.rotation.y = rot;
    path.receiveShadow = true;
    scene.add(path);
  });
}

function addOuterGrounds() {
  const lookoutMaterial = texturedMaterial("wood", { color: 0x625c50, roughness: 0.95, repeat: [4, 1] });
  for (const [x, z, w, d] of [
    [-86, 60, 16, 0.55],
    [-87, 42, 14, 0.55],
    [70, 42, 18, 0.55],
    [92, -39, 16, 0.55],
    [-52, -68, 14, 0.55],
  ]) {
    const railA = new THREE.Mesh(new THREE.BoxGeometry(w, 1.1, d), lookoutMaterial);
    railA.position.set(x, sampleTerrainHeight(x, z) + 0.7, z);
    railA.castShadow = true;
    scene.add(railA);
  }

  const farPalms = [
    [-95, 69, 1.4],
    [-75, 82, 1.15],
    [-37, 91, 1.25],
    [18, 86, 1.3],
    [66, 70, 1.2],
    [97, 31, 1.35],
    [104, -52, 1.25],
    [55, -78, 1.25],
    [-4, -93, 1.3],
    [-58, -75, 1.2],
    [-98, -18, 1.15],
  ];
  farPalms.forEach(([x, z, scale]) => {
    if (isInsideIsland(x, z)) {
      addPalm(x, z, scale);
    }
  });

  const farRocks = [
    [-103, 25, 3, 0x55554d],
    [-82, -36, 2.4, 0x4a4f48],
    [-25, 81, 2.6, 0x56544b],
    [41, 76, 2.8, 0x50534b],
    [88, 8, 2.4, 0x55564f],
    [70, -70, 2.5, 0x4b4b45],
    [-26, -82, 2.2, 0x575348],
  ];
  farRocks.forEach(([x, z, scale, color]) => {
    if (isInsideIsland(x, z)) {
      addRock(x, z, scale, color);
    }
  });
}

function addGroundDetails() {
  const dirtMaterial = texturedMaterial("ground", {
    color: 0x6a563c,
    roughness: 1,
    transparent: true,
    opacity: 0.82,
    repeat: [3, 3],
  });
  const dirtGeometry = new THREE.CircleGeometry(1, LOW_SPEC_MODE ? 12 : ULTRA_QUALITY_MODE ? 28 : 20);
  const dirtPatchCount = LOW_SPEC_MODE ? 26 : ULTRA_QUALITY_MODE ? 72 : HIGH_DETAIL_MODE ? 54 : 38;
  for (let i = 0; i < dirtPatchCount; i += 1) {
    const point = getDecorPoint(120);
    if (!point) {
      continue;
    }
    const patch = new THREE.Mesh(dirtGeometry, dirtMaterial);
    patch.position.set(point.x, sampleTerrainHeight(point.x, point.z) + 0.045, point.z);
    patch.rotation.x = -Math.PI / 2;
    patch.rotation.z = Math.random() * Math.PI * 2;
    const scaleX = 1.8 + Math.random() * 5.4;
    const scaleY = 0.9 + Math.random() * 2.8;
    patch.scale.set(scaleX, scaleY, 1);
    patch.receiveShadow = true;
    scene.add(patch);
  }

  const grassGeometry = createGrassClumpGeometry();
  const grassMaterial = new THREE.MeshStandardMaterial({
    color: 0x436f2d,
    emissive: 0x020401,
    roughness: 1,
    side: THREE.DoubleSide,
  });
  const grassCount = LOW_SPEC_MODE ? 260 : NORMAL_QUALITY_MODE ? 720 : ULTRA_QUALITY_MODE ? 2100 : 1300;
  const grass = new THREE.InstancedMesh(grassGeometry, grassMaterial, grassCount);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const instances = [];
  let placed = 0;

  for (let attempt = 0; attempt < grassCount * 5 && placed < grassCount; attempt += 1) {
    const point = getDecorPoint(0);
    if (!point) {
      continue;
    }
    const height = 0.42 + Math.random() * 0.78;
    const width = 0.58 + Math.random() * 0.92;
    const rotationY = Math.random() * Math.PI * 2;
    const phase = Math.random() * Math.PI * 2;
    quaternion.setFromEuler(new THREE.Euler(0, rotationY, (Math.random() - 0.5) * 0.22));
    scale.set(width, height, 1);
    const position = new THREE.Vector3(point.x, sampleTerrainHeight(point.x, point.z) + height * 0.43, point.z);
    matrix.compose(position, quaternion, scale);
    grass.setMatrixAt(placed, matrix);
    instances.push({ position, rotationY, scale: scale.clone(), phase });
    placed += 1;
  }

  grass.count = placed;
  grass.frustumCulled = true;
  grass.userData.source = GRASS_MODEL_SOURCE_URL;
  scene.add(grass);
  if (HIGH_DETAIL_MODE) {
    grassFields.push({ mesh: grass, instances });
  }
}

function createGrassClumpGeometry() {
  const geometry = new THREE.BufferGeometry();
  const vertices = [];
  const uvs = [];
  const indices = [];
  const blades = [
    { width: 0.22, height: 0.86, rotation: 0 },
    { width: 0.18, height: 0.72, rotation: Math.PI / 3 },
    { width: 0.2, height: 0.78, rotation: -Math.PI / 3 },
    { width: 0.13, height: 0.58, rotation: Math.PI / 2 },
  ];

  blades.forEach((blade, bladeIndex) => {
    const baseIndex = vertices.length / 3;
    const halfWidth = blade.width / 2;
    const yBase = 0;
    const yTip = blade.height;
    const bend = HIGH_DETAIL_MODE ? 0.06 : 0.025;
    const points = [
      [-halfWidth, yBase, 0],
      [halfWidth, yBase, 0],
      [halfWidth * 0.44 + bend, yTip * 0.62, 0],
      [0, yTip, 0],
      [-halfWidth * 0.44 + bend, yTip * 0.62, 0],
    ];
    const cos = Math.cos(blade.rotation);
    const sin = Math.sin(blade.rotation);
    points.forEach(([x, y, z]) => {
      vertices.push(x * cos - z * sin, y, x * sin + z * cos);
    });
    uvs.push(0, 0, 1, 0, 0.76, 0.62, 0.5, 1, 0.24, 0.62);
    indices.push(
      baseIndex,
      baseIndex + 1,
      baseIndex + 2,
      baseIndex,
      baseIndex + 2,
      baseIndex + 4,
      baseIndex + 4,
      baseIndex + 2,
      baseIndex + 3,
    );
  });

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function updateGrassWind(delta) {
  if (!HIGH_DETAIL_MODE || grassFields.length === 0) {
    return;
  }

  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  grassFields.forEach((field) => {
    field.instances.forEach((instance, index) => {
      const sway = Math.sin(CLOCK.elapsedTime * (ULTRA_QUALITY_MODE ? 2.4 : 1.65) + instance.phase) *
        (ULTRA_QUALITY_MODE ? 0.24 : 0.13);
      euler.set(sway * 0.38, instance.rotationY + sway, sway);
      quaternion.setFromEuler(euler);
      matrix.compose(instance.position, quaternion, instance.scale);
      field.mesh.setMatrixAt(index, matrix);
    });
    field.mesh.instanceMatrix.needsUpdate = true;
  });
}

function getDecorPoint(extraClearance = 0) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.sqrt(Math.random()) * WORLD_RADIUS * 0.58;
    const x = Math.cos(angle) * distance;
    const z = Math.sin(angle) * distance;
    const position = new THREE.Vector3(x, 0, z);
    const farFromPaths = horizontalDistance(position, DOCK_CENTER) > 14 && horizontalDistance(position, LAGOON_CENTER) > 15;
    if (
      isInsideIsland(x, z) &&
      farFromPaths &&
      !isInsideFloorZone(x, z) &&
      !collides(position, 0.55 + extraClearance * 0.01, 0)
    ) {
      return { x, z };
    }
  }

  return null;
}

function addGeneratorShed() {
  const positions = [
    [-5.5, 1.25, 3.8, 4.4, 2.5, 3.4, 0x5d6261],
    [-11.5, 1.25, 0.6, 3.6, 2.5, 3, 0x5c6767],
    [-13.5, 1.05, 5.2, 2.2, 2.1, 2.2, 0x6e6a5a],
  ];

  positions.forEach(([x, y, z, w, h, d, color]) => {
    const ground = sampleTerrainHeight(x, z);
    addBlock(x, ground + y, z, w, h, d, color, true);
  });
}

function addWatchPoint() {
  const ground = sampleTerrainHeight(HELIPAD_CENTER.x, HELIPAD_CENTER.z);
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(5.8, 5.8, 0.24, 30),
    texturedMaterial("concrete", { color: 0x6f746f, roughness: 0.9, repeat: [3, 3] }),
  );
  pad.position.set(HELIPAD_CENTER.x, ground + 0.12, HELIPAD_CENTER.z);
  pad.receiveShadow = true;
  scene.add(pad);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(3.8, 0.16, 12, 36),
    new THREE.MeshStandardMaterial({ color: 0xf3efe7, roughness: 0.7 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.set(HELIPAD_CENTER.x, ground + 0.26, HELIPAD_CENTER.z);
  scene.add(ring);

  addBlock(24.8, ground + 1.2, 11.2, 2.6, 2.4, 2.8, 0x5f6971, true);
  addBlock(16, ground + 1.15, 11.4, 2.1, 2.3, 2.4, 0x6a7078, true);
}

function addTemple() {
  const baseY = sampleTerrainHeight(TEMPLE_POINT.x, TEMPLE_POINT.z);

  const pavilion = new THREE.Mesh(
    new THREE.BoxGeometry(9.4, 0.16, 9.4),
    texturedMaterial("concrete", { color: 0xf0efe6, roughness: 0.96, repeat: [4, 4] }),
  );
  pavilion.position.set(TEMPLE_POINT.x, baseY + 0.16, TEMPLE_POINT.z);
  pavilion.receiveShadow = true;
  scene.add(pavilion);

  const stripeMaterial = new THREE.MeshStandardMaterial({ color: 0xc64c3c, roughness: 0.88 });
  const stripeA = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.02, 0.42), stripeMaterial);
  stripeA.position.set(TEMPLE_POINT.x, baseY + 0.25, TEMPLE_POINT.z);
  scene.add(stripeA);

  const stripeB = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.02, 9.4), stripeMaterial);
  stripeB.position.set(TEMPLE_POINT.x, baseY + 0.25, TEMPLE_POINT.z);
  scene.add(stripeB);

  addBlock(TEMPLE_POINT.x, baseY + 1.8, TEMPLE_POINT.z, 3.4, 3.6, 3.4, 0xf4f7fb, true);
  for (const offsetY of [0.7, 1.6, 2.5]) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(3.55, 0.12, 3.55),
      new THREE.MeshStandardMaterial({ color: 0x2f6bb6, roughness: 0.72 }),
    );
    stripe.position.set(TEMPLE_POINT.x, baseY + offsetY, TEMPLE_POINT.z);
    scene.add(stripe);
  }
}

function addDockAndBoat() {
  const dockMaterial = texturedMaterial("wood", { color: 0x5a4334, roughness: 0.92, repeat: [2, 9] });
  const dock = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.45, 19), dockMaterial);
  dock.position.set(DOCK_CENTER.x + 1.4, 0.05, DOCK_CENTER.z);
  dock.receiveShadow = true;
  scene.add(dock);

  const sideDock = new THREE.Mesh(new THREE.BoxGeometry(8, 0.42, 3.2), dockMaterial);
  sideDock.position.set(DOCK_CENTER.x - 1.8, 0.04, DOCK_CENTER.z + 7.4);
  sideDock.receiveShadow = true;
  scene.add(sideDock);

  for (const [x, z, h] of [
    [DOCK_CENTER.x - 0.5, DOCK_CENTER.z - 8.7, 3.1],
    [DOCK_CENTER.x + 3.4, DOCK_CENTER.z - 8.7, 3.1],
    [DOCK_CENTER.x - 0.5, DOCK_CENTER.z + 8.7, 3.1],
    [DOCK_CENTER.x + 3.4, DOCK_CENTER.z + 8.7, 3.1],
  ]) {
    addBlock(x, h / 2, z, 0.45, h, 0.45, 0x3d2a1d, true, false);
  }

  addBlock(DOCK_CENTER.x - 3.5, 1.2, DOCK_CENTER.z + 6.4, 2.2, 2.4, 2.4, 0x6b6356, true);

  const boat = new THREE.Group();
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(6, 1.2, 2.8),
    new THREE.MeshStandardMaterial({ color: 0x1b242b, roughness: 0.84 }),
  );
  hull.castShadow = true;
  hull.receiveShadow = true;
  hull.position.y = 0.4;
  boat.add(hull);

  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(2.8, 0.2, 2.1),
    new THREE.MeshStandardMaterial({ color: 0xd9ddd2, roughness: 0.92 }),
  );
  canopy.position.set(-0.2, 1.65, 0);
  canopy.castShadow = true;
  boat.add(canopy);

  const supportMaterial = new THREE.MeshStandardMaterial({ color: 0x6c6f70, roughness: 0.6 });
  for (const [x, z] of [
    [-1.3, -0.8],
    [-1.3, 0.8],
    [0.9, -0.8],
    [0.9, 0.8],
  ]) {
    const support = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1.2, 6), supportMaterial);
    support.position.set(x, 1.05, z);
    boat.add(support);
  }

  boat.position.copy(BOAT_ESCAPE_POINT).add(new THREE.Vector3(4.3, -0.15, -1.7));
  boat.rotation.y = -Math.PI * 0.32;
  scene.add(boat);
}

function addPaths() {
  const pathMaterial = texturedMaterial("ground", { color: 0x665c4d, roughness: 1, repeat: [8, 2] });
  const pathSegments = [
    { x: 14, z: 9, w: 20, d: 2.6, rot: 0.08 },
    { x: 23.5, z: 2, w: 18, d: 2.3, rot: -0.86 },
    { x: 8, z: -8, w: 28, d: 2.5, rot: -0.44 },
    { x: -9, z: -14.5, w: 17, d: 2.2, rot: -0.22 },
    { x: -16, z: -3.5, w: 24, d: 2.1, rot: -1.0 },
    { x: -11, z: 11.5, w: 23, d: 2.2, rot: -0.1 },
  ];

  pathSegments.forEach(({ x, z, w, d, rot }) => {
    const path = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), pathMaterial);
    path.position.set(x, sampleTerrainHeight(x, z) + 0.09, z);
    path.rotation.y = rot;
    path.receiveShadow = true;
    scene.add(path);
  });
}

function scatterProps() {
  const poolGround = sampleTerrainHeight(WEST_POOL_CENTER.x, WEST_POOL_CENTER.z);
  const pool = new THREE.Mesh(
    new THREE.BoxGeometry(9.4, 0.18, 5.6),
    texturedMaterial("water", { color: 0x275a75, roughness: 0.2, metalness: 0.06, repeat: [3, 2] }),
  );
  pool.position.set(WEST_POOL_CENTER.x, poolGround + 0.16, WEST_POOL_CENTER.z);
  pool.receiveShadow = true;
  scene.add(pool);

  addBlock(WEST_POOL_CENTER.x - 4.8, poolGround + 1.15, WEST_POOL_CENTER.z + 0.8, 3, 2.3, 3.2, 0xd8d0c2, true);

  const palms = [
    [31, 18, 1.2],
    [22, 25, 1.05],
    [7, 29, 1.2],
    [-8, 25, 1.1],
    [-25, 18, 1.15],
    [-31, 7, 1.1],
    [-28, -7, 1.05],
    [-17, -23, 1.15],
    [0, -27, 1.2],
    [18, -24, 1.2],
    [30, -14, 1.15],
  ];
  palms.forEach(([x, z, scale]) => addPalm(x, z, scale));

  const rocks = [
    [14, 23, 2.3, 0x4c4e48],
    [30, 7, 1.8, 0x54534c],
    [-4, 27, 2.2, 0x4b4c46],
    [-27, 15, 2, 0x52524a],
    [-30, -4, 2.4, 0x535148],
    [-8, -25, 1.9, 0x4a4a42],
    [20, -23, 1.6, 0x4d4b44],
    [33, -6, 1.8, 0x4e4f48],
  ];
  rocks.forEach(([x, z, scale, color]) => addRock(x, z, scale, color));
}

function addCollectibles() {
  addCollectible({
    id: "accessCard",
    mesh: buildAccessCard(),
    x: 34,
    z: -60,
    floor: 0,
    prompt: "Press E to take the access card",
    message: "Access card taken. Locked service cabinets can open now.",
  });

  addCollectible({
    id: "safeCode",
    mesh: buildCodeNote(),
    x: 31,
    z: 55,
    floor: FLOOR_HEIGHT,
    prompt: "Press E to memorize the safe code",
    message: "Safe code memorized. The file room locks are beatable now.",
  });

  addCollectible({
    id: "fuse",
    mesh: buildFuse(),
    x: -56,
    z: -43,
    floor: FLOOR_HEIGHT,
    requires: ["accessCard"],
    prompt: "Press E to take the dock fuse",
    message: "Dock fuse secured. The final launch system can be powered.",
  });

  addCollectible({
    id: "battery",
    mesh: buildBattery(),
    x: -10,
    z: 1.5,
    floor: 0,
    requires: ["fuse"],
    prompt: "Press E to take the radio battery",
    message: "Radio battery packed. Backup comms are ready.",
  });

  addCollectible({
    id: "chart",
    mesh: buildMapRoll(),
    x: -26,
    z: -20,
    floor: 0,
    requires: ["safeCode"],
    prompt: "Press E to take the island chart",
    message: "Island chart taken. The dock route is marked in your objectives.",
  });

  addCollectible({
    id: "manifest",
    mesh: buildManifest(),
    x: 84,
    z: -14,
    floor: FLOOR_HEIGHT,
    requires: ["safeCode"],
    prompt: "Press E to collect the harbor manifest",
    message: "Harbor manifest collected. The boat paperwork is yours.",
  });

  addCollectible({
    id: "fuel",
    mesh: buildFuelCan(),
    x: 92,
    z: -20,
    floor: 0,
    prompt: "Press E to grab the fuel can",
    message: "Fuel secured. The boat can run now.",
  });

  addCollectible({
    id: "key",
    mesh: buildKey(),
    x: 22,
    z: 47,
    floor: FLOOR_HEIGHT * 2,
    requires: ["manifest"],
    prompt: "Press E to take the boat key",
    message: "Boat key taken. One less reason to stay here.",
  });

  addCollectible({
    id: "files",
    mesh: buildFiles(),
    x: -55,
    z: 48,
    floor: FLOOR_HEIGHT * 2,
    requires: ["safeCode"],
    prompt: "Press E to collect the files",
    message: "You have the files. Now make it to the boat.",
  });

  addCollectible({
    id: "magnifier",
    mesh: buildMagnifyingGlass(),
    x: -67,
    z: 40,
    floor: 0,
    prompt: "Press E to take the magnifying glass",
    message: "Magnifying glass added to inventory. Select it and press Q to zoom.",
  });

  addCollectible({
    id: "radar",
    mesh: buildRadarGoggles(),
    x: -9,
    z: 4,
    floor: 0,
    requires: ["battery"],
    prompt: "Press E to take the radar goggles",
    message: "Radar goggles added to inventory. Select them and press Q or G to scan.",
  });
}

function addRadarBatteryPickups() {
  [
    { x: 43, z: -48, floor: 0 },
    { x: 49, z: -63, floor: FLOOR_HEIGHT },
    { x: 18, z: 52, floor: 0 },
    { x: 30, z: 58, floor: FLOOR_HEIGHT * 2 },
    { x: -66, z: 48, floor: 0 },
    { x: -60, z: 42, floor: FLOOR_HEIGHT * 2 },
    { x: -54, z: -45, floor: 0 },
    { x: 79, z: -23, floor: 0 },
    { x: 90, z: -15, floor: FLOOR_HEIGHT },
    { x: 12, z: -18, floor: 0 },
    { x: -26, z: -17, floor: 0 },
    { x: 29, z: 8, floor: 0 },
  ].forEach(addRadarBatteryPickup);
}

function addRadarBatteryPickup({ x, z, floor }) {
  const mesh = buildBattery();
  mesh.scale.setScalar(0.62);
  const baseY = sampleTerrainHeight(x, z) + floor + 0.72;
  mesh.position.set(x, baseY, z);
  mesh.userData.radarBatteryPickup = true;
  scene.add(mesh);
  const highlight = createCollectibleHighlight(mesh);
  const marker = createCollectibleMarker();
  radarBatteryPickups.push({
    name: "Radar battery",
    mesh,
    highlight,
    marker,
    baseY,
    floor,
    collected: false,
  });
}

function addHidingPlaces() {
  [
    { name: "South Barracks locker", x: 36, z: -52, floor: 0, rotation: Math.PI * 0.5 },
    { name: "South Barracks storage", x: 51, z: -62, floor: FLOOR_HEIGHT, rotation: 0 },
    { name: "Records Villa cabinet", x: 14, z: 44, floor: 0, rotation: Math.PI },
    { name: "Records Villa wardrobe", x: 31, z: 53, floor: FLOOR_HEIGHT, rotation: -Math.PI * 0.5 },
    { name: "Records Villa archive closet", x: 18, z: 58, floor: FLOOR_HEIGHT * 2, rotation: Math.PI },
    { name: "North Guest House wardrobe", x: -68, z: 48, floor: 0, rotation: Math.PI * 0.5 },
    { name: "North Guest House linen closet", x: -56, z: 54, floor: FLOOR_HEIGHT, rotation: 0 },
    { name: "North Guest House attic cabinet", x: -64, z: 40, floor: FLOOR_HEIGHT * 2, rotation: Math.PI },
    { name: "Old Service Block crate stack", x: -58, z: -42, floor: 0, rotation: -Math.PI * 0.5 },
    { name: "Dock Offices locker", x: 76, z: -24, floor: 0, rotation: Math.PI },
    { name: "Dock Offices records closet", x: 88, z: -15, floor: FLOOR_HEIGHT, rotation: 0 },
  ].forEach(addHidingPlace);

  [
    { name: "Open beach brush", x: -92, z: 18, rotation: 0.35 },
    { name: "West rock tarp", x: -78, z: -12, rotation: -0.7 },
    { name: "Lagoon reed blind", x: -32, z: -24, rotation: 1.1 },
    { name: "Temple crate blind", x: -16, z: -30, rotation: -0.4 },
    { name: "Generator scrub", x: -6, z: 16, rotation: 0.9 },
    { name: "Helipad cargo net", x: 29, z: 2, rotation: 0.2 },
    { name: "South path palm pile", x: 32, z: -32, rotation: -1.2 },
    { name: "Barracks outside crate", x: 58, z: -49, rotation: 0.6 },
    { name: "Dock fuel tarp", x: 89, z: -31, rotation: -0.2 },
    { name: "East pier brush", x: 100, z: -6, rotation: 0.8 },
    { name: "North guest hedge", x: -72, z: 62, rotation: -0.9 },
    { name: "Records garden planter", x: 43, z: 51, rotation: 1.25 },
    { name: "Main path supply stack", x: 16, z: 20, rotation: -0.6 },
    { name: "Southwest palm shadow", x: -50, z: -58, rotation: 0.4 },
  ].forEach(addOpenHidingPlace);
}

function addHidingPlace({ name, x, z, floor, rotation }) {
  const baseY = sampleTerrainHeight(x, z) + floor;
  const group = new THREE.Group();
  group.position.set(x, baseY, z);
  group.rotation.y = rotation;

  const woodMaterial = new THREE.MeshStandardMaterial({
    color: 0x27352f,
    emissive: 0x06150d,
    roughness: 0.92,
  });
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: 0x67d28f,
    emissive: 0x0f331b,
    roughness: 0.78,
  });

  const cabinet = new THREE.Mesh(new THREE.BoxGeometry(1.45, 2.15, 1.05), woodMaterial);
  cabinet.position.y = 1.08;
  cabinet.castShadow = true;
  cabinet.receiveShadow = true;
  group.add(cabinet);

  const doorLine = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.86, 1.1), trimMaterial);
  doorLine.position.set(0, 1.08, 0.54);
  group.add(doorLine);

  const glowStrip = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.06, 1.12), trimMaterial);
  glowStrip.position.set(0, 0.12, 0.55);
  group.add(glowStrip);

  scene.add(group);
  registerCollider(cabinet, true, 0.08);

  const helper = new THREE.BoxHelper(group, 0x70ff9a);
  helper.material.transparent = true;
  helper.material.opacity = 0.42;
  helper.material.depthTest = true;
  helper.material.depthWrite = false;
  helper.update();
  scene.add(helper);

  const exitOffset = new THREE.Vector3(Math.sin(rotation), 0, Math.cos(rotation)).multiplyScalar(1.95);
  hideSpots.push({
    name,
    group,
    helper,
    floor,
    position: new THREE.Vector3(x, floor, z),
    hidePosition: new THREE.Vector3(x, PLAYER_HEIGHT + floor, z),
    exitPosition: new THREE.Vector3(x + exitOffset.x, PLAYER_HEIGHT + floor, z + exitOffset.z),
  });
}

function addOpenHidingPlace({ name, x, z, rotation }) {
  const baseY = sampleTerrainHeight(x, z);
  const group = new THREE.Group();
  group.position.set(x, baseY, z);
  group.rotation.y = rotation;
  group.visible = false;

  const brushMaterial = new THREE.MeshStandardMaterial({
    color: 0x20402b,
    emissive: 0x06160c,
    roughness: 0.9,
  });
  const tarpMaterial = new THREE.MeshStandardMaterial({
    color: 0x334344,
    emissive: 0x071313,
    roughness: 0.84,
  });

  for (const [ox, oz, scale] of [
    [-0.5, -0.25, 0.9],
    [0.05, 0.1, 1.12],
    [0.55, -0.08, 0.82],
  ]) {
    const bush = new THREE.Mesh(new THREE.SphereGeometry(0.72 * scale, LOW_SPEC_MODE ? 8 : 14, LOW_SPEC_MODE ? 6 : 10), brushMaterial);
    bush.scale.y = 0.62;
    bush.position.set(ox, 0.46 * scale, oz);
    bush.castShadow = true;
    group.add(bush);
  }

  const tarp = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 0.92), tarpMaterial);
  tarp.position.set(0.12, 0.38, 0.25);
  tarp.rotation.z = -0.08;
  tarp.castShadow = true;
  group.add(tarp);

  const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x67d28f, emissive: 0x0f331b, roughness: 0.78 });
  const glowStrip = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.05, 0.08), trimMaterial);
  glowStrip.position.set(0, 0.1, 0.74);
  group.add(glowStrip);

  scene.add(group);

  const helper = new THREE.BoxHelper(group, 0x70ff9a);
  helper.visible = false;
  helper.material.transparent = true;
  helper.material.opacity = 0.42;
  helper.material.depthTest = true;
  helper.material.depthWrite = false;
  helper.update();
  scene.add(helper);

  const exitOffset = new THREE.Vector3(Math.sin(rotation), 0, Math.cos(rotation)).multiplyScalar(2.05);
  hideSpots.push({
    name,
    group,
    helper,
    floor: 0,
    impossibleOnly: true,
    position: new THREE.Vector3(x, 0, z),
    hidePosition: new THREE.Vector3(x, PLAYER_HEIGHT, z),
    exitPosition: new THREE.Vector3(x + exitOffset.x, PLAYER_HEIGHT, z + exitOffset.z),
  });
}

function addCollectible({ id, mesh, x, z, floor, prompt, message, requires = [] }) {
  const baseY = sampleTerrainHeight(x, z) + floor + 0.85;
  const startsCollected = state.items[id] === true;
  mesh.position.set(x, baseY, z);
  mesh.userData.collectibleId = id;
  mesh.visible = !startsCollected;
  scene.add(mesh);
  const highlight = createCollectibleHighlight(mesh);
  const marker = createCollectibleMarker();
  const beacon = createRadarBeacon();
  collectibles.push({
    id,
    name: ITEM_LABELS[id],
    mesh,
    highlight,
    marker,
    beacon,
    baseY,
    floor,
    prompt,
    message,
    requires,
    collected: startsCollected,
    codeUnlocked: false,
  });
}

function createRadarBeacon() {
  const material = new THREE.MeshBasicMaterial({
    color: 0x3dffb5,
    transparent: true,
    opacity: 0.72,
    depthTest: false,
    depthWrite: false,
  });
  const group = new THREE.Group();
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.34, LOW_SPEC_MODE ? 8 : 14, LOW_SPEC_MODE ? 6 : 10), material);
  const ringA = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 6, LOW_SPEC_MODE ? 18 : 36), material.clone());
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.035, 6, LOW_SPEC_MODE ? 18 : 36), material.clone());
  ringA.rotation.x = Math.PI / 2;
  ringB.rotation.y = Math.PI / 2;
  group.add(sphere, ringA, ringB);
  group.visible = false;
  group.renderOrder = 1000;
  group.traverse((child) => {
    child.renderOrder = 1000;
  });
  scene.add(group);
  return group;
}

function createCollectibleHighlight(mesh) {
  const helper = new THREE.BoxHelper(mesh, 0x95ffd5);
  helper.visible = false;
  helper.material.transparent = true;
  helper.material.opacity = 0.92;
  helper.material.depthTest = true;
  helper.material.depthWrite = false;
  scene.add(helper);
  return helper;
}

function createCollectibleMarker() {
  const material = new THREE.MeshBasicMaterial({
    color: 0x95ffd5,
    transparent: true,
    opacity: 0.86,
    depthTest: true,
    depthWrite: false,
  });
  const group = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.03, 6, LOW_SPEC_MODE ? 16 : 28), material);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const upright = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.024, 6, LOW_SPEC_MODE ? 16 : 28), material.clone());
  upright.rotation.y = Math.PI / 2;
  group.add(upright);

  group.visible = false;
  scene.add(group);
  return group;
}

function buildFuelCan() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1.4, 0.55),
    new THREE.MeshStandardMaterial({
      color: 0xb74231,
      emissive: 0x160604,
      roughness: 0.72,
      metalness: 0.25,
    }),
  );
  body.castShadow = true;
  group.add(body);

  const handle = new THREE.Mesh(
    new THREE.BoxGeometry(0.45, 0.18, 0.55),
    new THREE.MeshStandardMaterial({ color: 0x212121, roughness: 0.75 }),
  );
  handle.position.set(0, 0.74, 0);
  group.add(handle);

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 0.18, 12),
    new THREE.MeshStandardMaterial({ color: 0xefece4, roughness: 0.62 }),
  );
  cap.rotation.z = Math.PI / 2;
  cap.position.set(0.42, 0.28, 0);
  group.add(cap);
  return group;
}

function buildKey() {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.25, 0.06, 12, 24),
    new THREE.MeshStandardMaterial({
      color: 0xd8b25d,
      emissive: 0x322003,
      roughness: 0.35,
      metalness: 0.78,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const shaft = new THREE.Mesh(
    new THREE.BoxGeometry(0.12, 0.7, 0.1),
    ring.material,
  );
  shaft.position.set(0, -0.45, 0);
  group.add(shaft);

  const toothA = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.1), ring.material);
  toothA.position.set(0.1, -0.76, 0);
  group.add(toothA);

  const toothB = toothA.clone();
  toothB.position.x = -0.1;
  toothB.position.y = -0.66;
  group.add(toothB);
  return group;
}

function buildFiles() {
  const group = new THREE.Group();
  const folder = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.18, 1),
    new THREE.MeshStandardMaterial({
      color: 0xd6bf73,
      emissive: 0x231d07,
      roughness: 0.98,
    }),
  );
  folder.castShadow = true;
  group.add(folder);

  const papers = new THREE.Mesh(
    new THREE.BoxGeometry(1.05, 0.12, 0.82),
    new THREE.MeshStandardMaterial({ color: 0xf3efe4, roughness: 0.92 }),
  );
  papers.position.set(0.02, 0.1, -0.02);
  group.add(papers);

  const tab = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.09, 0.22),
    new THREE.MeshStandardMaterial({ color: 0xc19c46, roughness: 0.9 }),
  );
  tab.position.set(-0.22, 0.08, -0.38);
  group.add(tab);
  return group;
}

function buildAccessCard() {
  const group = new THREE.Group();
  const card = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.08, 0.58),
    new THREE.MeshStandardMaterial({
      color: 0xf4f1df,
      emissive: 0x1f1e12,
      roughness: 0.55,
    }),
  );
  group.add(card);

  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(0.92, 0.09, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.5 }),
  );
  stripe.position.z = -0.18;
  group.add(stripe);

  const chip = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.1, 0.18),
    new THREE.MeshStandardMaterial({ color: 0xc49b40, metalness: 0.4, roughness: 0.45 }),
  );
  chip.position.set(-0.24, 0.03, 0.08);
  group.add(chip);
  return group;
}

function buildFuse() {
  const group = new THREE.Group();
  const glass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.16, 0.95, 16),
    new THREE.MeshStandardMaterial({
      color: 0xaad5de,
      emissive: 0x10242a,
      roughness: 0.18,
      transparent: true,
      opacity: 0.72,
    }),
  );
  glass.rotation.z = Math.PI / 2;
  group.add(glass);

  const capMaterial = new THREE.MeshStandardMaterial({ color: 0xb9b4a7, metalness: 0.72, roughness: 0.33 });
  for (const x of [-0.52, 0.52]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.14, 16), capMaterial);
    cap.rotation.z = Math.PI / 2;
    cap.position.x = x;
    group.add(cap);
  }
  return group;
}

function buildCodeNote() {
  const group = new THREE.Group();
  const paper = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.06, 0.7),
    new THREE.MeshStandardMaterial({ color: 0xf2e7bd, roughness: 0.9 }),
  );
  group.add(paper);

  const inkMaterial = new THREE.MeshStandardMaterial({ color: 0x2f2722, roughness: 0.85 });
  for (const z of [-0.18, 0, 0.18]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.065, 0.035), inkMaterial);
    line.position.set(0.02, 0.04, z);
    group.add(line);
  }
  return group;
}

function buildMapRoll() {
  const group = new THREE.Group();
  const scroll = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 1.1, 18),
    new THREE.MeshStandardMaterial({ color: 0xd9c184, roughness: 0.82 }),
  );
  scroll.rotation.z = Math.PI / 2;
  group.add(scroll);

  const ribbon = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.44, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x8c2e24, roughness: 0.78 }),
  );
  ribbon.position.y = 0.02;
  group.add(ribbon);
  return group;
}

function buildManifest() {
  const group = buildFiles();
  const clip = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.12, 0.16),
    new THREE.MeshStandardMaterial({ color: 0xa6a9a5, metalness: 0.45, roughness: 0.36 }),
  );
  clip.position.set(0, 0.22, -0.48);
  group.add(clip);
  return group;
}

function buildBattery() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.26, 0.26, 0.9, 18),
    new THREE.MeshStandardMaterial({
      color: 0x2f343a,
      roughness: 0.62,
      metalness: 0.18,
    }),
  );
  body.rotation.z = Math.PI / 2;
  group.add(body);

  const band = new THREE.Mesh(
    new THREE.BoxGeometry(0.92, 0.24, 0.24),
    new THREE.MeshStandardMaterial({ color: 0x7fd5b8, emissive: 0x0a2d23, roughness: 0.5 }),
  );
  group.add(band);
  return group;
}

function buildMagnifyingGlass() {
  const group = new THREE.Group();
  const lensMaterial = new THREE.MeshStandardMaterial({
    color: 0xaee9ff,
    emissive: 0x103544,
    roughness: 0.08,
    metalness: 0.08,
    transparent: true,
    opacity: 0.52,
  });
  const rimMaterial = new THREE.MeshStandardMaterial({ color: 0xb7b0a2, metalness: 0.64, roughness: 0.32 });
  const handleMaterial = new THREE.MeshStandardMaterial({ color: 0x3b2619, roughness: 0.82 });

  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.08, LOW_SPEC_MODE ? 18 : 32), lensMaterial);
  lens.rotation.x = Math.PI / 2;
  group.add(lens);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.04, 8, LOW_SPEC_MODE ? 18 : 32), rimMaterial);
  rim.rotation.x = Math.PI / 2;
  group.add(rim);

  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.78, 0.12), handleMaterial);
  handle.position.set(0, -0.58, 0);
  handle.rotation.z = -0.55;
  group.add(handle);
  return group;
}

function buildRadarGoggles() {
  const group = new THREE.Group();
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0x11191a,
    roughness: 0.58,
    metalness: 0.28,
  });
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: 0x51ffc0,
    emissive: 0x0d4f35,
    roughness: 0.2,
    transparent: true,
    opacity: 0.74,
  });

  for (const x of [-0.26, 0.26]) {
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.12, LOW_SPEC_MODE ? 14 : 24), glassMaterial);
    lens.rotation.x = Math.PI / 2;
    lens.position.x = x;
    group.add(lens);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 6, LOW_SPEC_MODE ? 14 : 24), frameMaterial);
    rim.rotation.x = Math.PI / 2;
    rim.position.x = x;
    group.add(rim);
  }

  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.08), frameMaterial);
  bridge.position.set(0, 0, 0);
  group.add(bridge);

  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.08, 0.08), frameMaterial);
  strap.position.set(0, 0, -0.18);
  group.add(strap);
  return group;
}

function initHeldItemView() {
  ["key", "files", "safeCode", "magnifier", "radar"].forEach((id) => {
    const model = createHeldItemModel(id);
    model.visible = false;
    heldItemModels.set(id, model);
    heldItemRoot.add(model);
  });
}

function createHeldItemModel(id) {
  const group = new THREE.Group();
  const handMaterial = new THREE.MeshStandardMaterial({ color: 0xb98462, roughness: 0.76 });
  const sleeveMaterial = new THREE.MeshStandardMaterial({ color: 0x1e2c30, roughness: 0.82 });
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.52, 10), sleeveMaterial);
  sleeve.rotation.z = Math.PI / 2.5;
  sleeve.position.set(0.22, -0.1, 0.06);
  group.add(sleeve);

  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.15, LOW_SPEC_MODE ? 10 : 16, LOW_SPEC_MODE ? 8 : 12), handMaterial);
  hand.scale.set(1.25, 0.78, 0.72);
  hand.position.set(0.02, 0, 0.02);
  group.add(hand);

  const item = createHeldItemObject(id);
  item.position.set(-0.08, 0.12, -0.04);
  group.add(item);
  group.traverse((child) => {
    child.renderOrder = 900;
    if (child.material) {
      child.material.depthTest = false;
      child.material.depthWrite = false;
    }
  });
  return group;
}

function createHeldItemObject(id) {
  if (id === "radar") {
    return buildHeldRadarScanner();
  }

  const builders = {
    key: buildKey,
    files: buildFiles,
    safeCode: buildCodeNote,
    magnifier: buildMagnifyingGlass,
  };
  const object = (builders[id] || buildKey)();
  const settings = {
    key: { scale: 0.72, position: [-0.08, 0.04, 0], rotation: [0.35, 0.2, -0.68] },
    files: { scale: 0.38, position: [-0.1, 0.04, 0.03], rotation: [-0.55, 0.18, -0.18] },
    safeCode: { scale: 0.5, position: [-0.1, 0.06, 0.03], rotation: [-0.55, 0.2, -0.18] },
    magnifier: { scale: 0.58, position: [-0.06, 0.08, 0], rotation: [0.2, -0.28, -0.58] },
  }[id];
  object.scale.setScalar(settings.scale);
  object.position.set(...settings.position);
  object.rotation.set(...settings.rotation);
  return object;
}

function buildHeldRadarScanner() {
  const group = new THREE.Group();
  const shellMaterial = new THREE.MeshStandardMaterial({ color: 0x151f22, roughness: 0.62, metalness: 0.2 });
  const screenMaterial = new THREE.MeshBasicMaterial({ color: 0x42ffb5, transparent: true, opacity: 0.9 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.48, 0.12), shellMaterial);
  group.add(body);

  const screen = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.31, 0.03), screenMaterial);
  screen.position.z = -0.075;
  group.add(screen);

  const lineMaterial = new THREE.MeshBasicMaterial({ color: 0x062019, transparent: true, opacity: 0.72 });
  for (const x of [-0.16, 0, 0.16]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.3, 0.032), lineMaterial);
    line.position.set(x, 0, -0.095);
    group.add(line);
  }
  for (const y of [-0.1, 0.1]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.012, 0.032), lineMaterial);
    line.position.set(0, y, -0.096);
    group.add(line);
  }

  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.72, 8), shellMaterial);
  antenna.position.set(0.34, 0.42, 0);
  antenna.rotation.z = -0.35;
  group.add(antenna);
  group.scale.setScalar(0.78);
  group.rotation.set(-0.26, 0.24, -0.12);
  return group;
}

function createPortraitTexture(url, fallbackHue = 22, crop = null) {
  const texture = createEnemyFallbackFaceTexture(fallbackHue);
  const portraitLoader = new THREE.TextureLoader();
  if (/^https?:/i.test(url)) {
    portraitLoader.setCrossOrigin("anonymous");
  }
  portraitLoader.load(
    url,
    (loadedTexture) => {
      loadedTexture.colorSpace = THREE.SRGBColorSpace;
      loadedTexture.anisotropy = LOW_SPEC_MODE ? 1 : 4;
      if (crop) {
        loadedTexture.offset.set(crop.x, crop.y);
        loadedTexture.repeat.set(crop.w, crop.h);
      }
      texture.image = loadedTexture.image;
      texture.offset.copy(loadedTexture.offset);
      texture.repeat.copy(loadedTexture.repeat);
      texture.needsUpdate = true;
    },
    undefined,
    () => {
      texture.needsUpdate = true;
    },
  );
  return texture;
}

function createEnemyFallbackFaceTexture(hue = 22) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 320;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, `hsl(${hue}, 42%, 78%)`);
  gradient.addColorStop(0.54, `hsl(${hue}, 28%, 48%)`);
  gradient.addColorStop(1, "#222222");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(28, 12, 10, 0.62)";
  context.fillRect(0, canvas.height * 0.72, canvas.width, canvas.height * 0.28);
  context.fillStyle = "rgba(255, 236, 196, 0.62)";
  context.beginPath();
  context.ellipse(canvas.width * 0.5, canvas.height * 0.36, 70, 96, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#240d0d";
  context.fillRect(76, 112, 34, 10);
  context.fillRect(146, 112, 34, 10);
  context.fillRect(100, 206, 58, 9);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function addHunters() {
  hunters.length = 0;
  HUNTER_SPECS.forEach((spec, index) => {
    const hunterState = index === 0 ? state.enemy : createHunterState();
    const actor = createHunterActor(spec);
    const debugHelper = createEnemyDebugHelper(actor, spec.debugColor);
    hunters.push({ spec, state: hunterState, actor, debugHelper });
  });

  enemyActor = hunters[0]?.actor || null;
  enemyDebugHelper = hunters[0]?.debugHelper || null;
}

function createHunterActor(spec) {
  return spec.kind === "wheelchair" ? createWheelchairHunter(spec) : createFaceBoxHunter(spec);
}

function createFaceBoxHunter(spec) {
  const group = new THREE.Group();
  const faceTexture = createPortraitTexture(spec.textureUrl, spec.id === "trump" ? 36 : 22, spec.textureCrop);
  const faceMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    fog: false,
    map: faceTexture,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const capMaterial = new THREE.MeshBasicMaterial({
    color: 0x101010,
    fog: false,
    toneMapped: false,
  });
  const hitbox = new THREE.Mesh(
    new THREE.BoxGeometry(spec.radius * 2, spec.height, spec.radius * 2),
    [faceMaterial, faceMaterial, capMaterial, capMaterial, faceMaterial, faceMaterial],
  );
  hitbox.position.y = spec.height / 2;
  hitbox.castShadow = true;
  hitbox.receiveShadow = true;
  group.add(hitbox);

  group.position.copy(patrolRoute[0]);
  scene.add(group);
  return group;
}

function createWheelchairHunter(spec) {
  const group = createFaceBoxHunter(spec);
  const body = group.children[0];
  body.position.y = 1.64;
  body.scale.set(0.54, 0.68, 0.54);

  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x1a2023, roughness: 0.7, metalness: 0.28 });
  const tireMaterial = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.82 });
  const seatMaterial = new THREE.MeshStandardMaterial({ color: 0x28333a, roughness: 0.88 });
  const metalMaterial = new THREE.MeshStandardMaterial({ color: 0xa9b4b8, roughness: 0.35, metalness: 0.65 });

  const seat = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.18, 1.08), seatMaterial);
  seat.position.set(0, 0.82, 0.06);
  seat.castShadow = true;
  group.add(seat);

  const back = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.12, 0.16), seatMaterial);
  back.position.set(0, 1.35, -0.48);
  back.rotation.x = -0.16;
  back.castShadow = true;
  group.add(back);

  for (const side of [-1, 1]) {
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.54, 0.07, 10, LOW_SPEC_MODE ? 24 : 36), tireMaterial);
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(side * 0.72, 0.56, 0.05);
    wheel.castShadow = true;
    group.add(wheel);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.022, 8, LOW_SPEC_MODE ? 16 : 28), metalMaterial);
    rim.rotation.y = Math.PI / 2;
    rim.position.copy(wheel.position);
    group.add(rim);

    const caster = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.04, 8, LOW_SPEC_MODE ? 12 : 20), tireMaterial);
    caster.rotation.y = Math.PI / 2;
    caster.position.set(side * 0.5, 0.24, 0.66);
    group.add(caster);

    const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.35, 8), frameMaterial);
    rail.position.set(side * 0.57, 0.72, 0.18);
    rail.rotation.x = Math.PI / 2;
    rail.castShadow = true;
    group.add(rail);

    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.68, 8), frameMaterial);
    handle.position.set(side * 0.46, 1.72, -0.78);
    handle.rotation.x = Math.PI / 2;
    group.add(handle);
  }

  return group;
}

function createEnemyDebugHelper(target, color = 0xff3b30) {
  const helper = new THREE.BoxHelper(target, color);
  helper.visible = false;
  helper.material.depthTest = false;
  helper.material.depthWrite = false;
  helper.material.transparent = true;
  helper.material.opacity = 0.95;
  helper.renderOrder = 999;
  scene.add(helper);
  return helper;
}

function resetHunters() {
  const enabledIds = new Set(getEnabledHunterIds());
  hunters.forEach((hunter) => {
    activeHunter = hunter;
    enemyActor = hunter.actor;
    enemyDebugHelper = hunter.debugHelper;
    state.enemy = hunter.state;
    resetEnemyState();
    const enabled = enabledIds.has(hunter.spec.id);
    hunter.actor.visible = enabled;
    hunter.debugHelper.visible = false;
  });

  activeHunter = getActiveHunters()[0] || null;
  enemyActor = activeHunter?.actor || null;
  enemyDebugHelper = activeHunter?.debugHelper || null;
  state.enemy = activeHunter?.state || state.enemy;
}

function resetEnemyState() {
  state.enemy.mode = "patrol";
  state.enemy.heardAt.set(0, 0, 0);
  state.enemy.lookTarget.set(0, 0, 0);
  state.enemy.loseSightTimer = 0;
  state.enemy.searchTimer = 0;
  state.enemy.spottedOnce = false;
  state.enemy.nearWarned = false;
  state.enemy.awareness = 0;
  state.enemy.floorHeight = 0;
  state.enemy.targetFloor = 0;
  state.enemy.stairGoal = null;
  state.enemy.stairCooldown = 0;
  state.enemy.wanderTimer = 0;
  state.enemy.checkHideSpot = null;
  state.enemy.lastPosition.copy(enemyActor.position);
  state.enemy.stuckTimer = 0;
  state.enemy.wallBreakTimer = 0;
  state.enemy.wallBreakCooldown = 0;
  enemyActor.position.copy(getRandomEnemySpawn());
  enemyActor.position.y = 0;
  state.enemy.lastPosition.copy(enemyActor.position);
  enemyActor.rotation.y = Math.random() * Math.PI * 2;
  chooseNextWanderTarget();
}

function getRandomEnemySpawn() {
  const minimumPlayerDistance = 54;
  const hunterRadius = getActiveHunterSpec().radius;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate =
      Math.random() < 0.68
        ? getRandomIslandPoint(minimumPlayerDistance, hunterRadius)
        : patrolRoute[Math.floor(Math.random() * patrolRoute.length)]
            .clone()
            .add(new THREE.Vector3((Math.random() - 0.5) * 34, 0, (Math.random() - 0.5) * 34));

    if (!candidate) {
      continue;
    }

    candidate.y = 0;
    const safe = findSafePosition(candidate, hunterRadius);
    if (horizontalDistance(safe, state.player.position) > minimumPlayerDistance * 0.72) {
      return safe;
    }
  }

  return findSafePosition(patrolRoute[Math.floor(Math.random() * patrolRoute.length)].clone(), hunterRadius);
}

function chooseNextWanderTarget() {
  const hunterRadius = getActiveHunterSpec().radius;
  state.enemy.wanderTimer = 0;
  state.enemy.checkHideSpot = null;

  let next = null;
  let targetFloor = 0;

  if (stairways.length > 0 && Math.random() < 0.24) {
    const stair = stairways[Math.floor(Math.random() * stairways.length)];
    const zone = getFloorZoneAt(stair.position.x, stair.position.z);
    targetFloor = stair.floors[Math.floor(Math.random() * stair.floors.length)];
    next = zone && targetFloor > 0 ? getRandomPointInZone(zone, hunterRadius, targetFloor) : stair.position.clone();
  }

  if (!next && Math.random() < 0.7) {
    next = getRandomIslandPoint(38, hunterRadius);
  }

  if (!next) {
    const choices = patrolRoute.filter((point) => horizontalDistance(point, enemyActor.position) > 46);
    const pool = choices.length > 0 ? choices : patrolRoute;
    next = pool[Math.floor(Math.random() * pool.length)].clone();
    next.x += (Math.random() - 0.5) * 32;
    next.z += (Math.random() - 0.5) * 32;
  }

  next.y = 0;
  state.enemy.targetFloor = targetFloor;
  state.enemy.wanderTarget.copy(findSafePosition(next, hunterRadius, targetFloor));
}

function getRandomIslandPoint(minPlayerDistance = 0, radius = ENEMY_RADIUS, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.sqrt(Math.random()) * WORLD_RADIUS * 0.62;
    const candidate = new THREE.Vector3(Math.cos(angle) * distance, 0, Math.sin(angle) * distance);
    if (
      isInsideIsland(candidate.x, candidate.z) &&
      horizontalDistance(candidate, state.player.position) > minPlayerDistance &&
      !collides(candidate, radius, 0)
    ) {
      return candidate;
    }
  }

  return null;
}

function getRandomPointInZone(zone, radius, floorHeight) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = new THREE.Vector3(
      zone.x + (Math.random() - 0.5) * Math.max(4, zone.w - 6),
      0,
      zone.z + (Math.random() - 0.5) * Math.max(4, zone.d - 6),
    );

    if (!collides(candidate, radius, floorHeight)) {
      return candidate;
    }
  }

  return new THREE.Vector3(zone.x, 0, zone.z);
}

function addPalm(x, z, scale = 1) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22 * scale, 0.34 * scale, 5.6 * scale, 8),
    new THREE.MeshStandardMaterial({ color: 0x5d4833, roughness: 1 }),
  );
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  trunk.position.set(x, 2.8 * scale, z);
  trunk.rotation.z = (Math.random() - 0.5) * 0.16;
  scene.add(trunk);
  registerCollider(trunk, false, 0.1);

  const leafMaterial = new THREE.MeshStandardMaterial({ color: 0x305a3b, roughness: 0.95 });
  for (let i = 0; i < 5; i += 1) {
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 3.2 * scale), leafMaterial);
    leaf.position.set(x, 5.35 * scale, z);
    leaf.rotation.y = (Math.PI * 2 * i) / 5;
    leaf.rotation.x = -0.3 - Math.random() * 0.15;
    scene.add(leaf);
  }
}

function addRock(x, z, scale = 2, color = 0x494b47) {
  const rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(scale, 0),
    texturedMaterial("concrete", { color, roughness: 1, repeat: [1, 1] }),
  );
  rock.position.set(x, scale * 0.45, z);
  rock.scale.set(1.1, 0.8, 1.2);
  rock.castShadow = true;
  rock.receiveShadow = true;
  scene.add(rock);
  registerCollider(rock, true);
}

function addBlock(x, y, z, w, h, d, color, solid = true, receiveShadow = true) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    texturedMaterial("concrete", {
      color,
      roughness: 0.96,
      repeat: [Math.max(1, w / 3), Math.max(1, d / 3)],
    }),
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = receiveShadow;
  scene.add(mesh);
  if (solid) {
    registerCollider(mesh, true);
  }
  return mesh;
}

function registerCollider(mesh, sightBlocker = true, padding = 0.22) {
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  box.min.x -= padding;
  box.max.x += padding;
  box.min.z -= padding;
  box.max.z += padding;
  colliders.push(box);
  if (sightBlocker) {
    lineOfSightMeshes.push(mesh);
  }
}

function attachEvents() {
  window.addEventListener("resize", onResize);

  document.addEventListener("pointerlockchange", () => {
    state.pointerLocked = document.pointerLockElement === renderer.domElement;
    if (state.pointerLocked) {
      stopLookDrag();
    }
    syncMouseUi();
    dom.prompt.textContent = state.prompt || getIdlePrompt();
  });

  window.addEventListener("mousemove", (event) => {
    if (!state.pointerLocked || state.gameOver || state.victory) {
      return;
    }

    applyLookDelta(event.movementX, event.movementY);
  });

  renderer.domElement.addEventListener("pointerdown", (event) => {
    if (!state.started || state.gameOver || state.victory || event.button !== 0) {
      return;
    }

    event.preventDefault();
    renderer.domElement.focus({ preventScroll: true });

    if (state.pointerLocked) {
      if (state.interactive) {
        tryInteract();
      }
      return;
    }

    beginLookDrag(event);
    attemptPointerLock();
  });

  renderer.domElement.addEventListener("pointermove", (event) => {
    if (
      state.pointerLocked ||
      !state.input.dragging ||
      event.pointerId !== state.input.pointerId ||
      state.gameOver ||
      state.victory
    ) {
      return;
    }

    const deltaX = event.clientX - state.input.lastX;
    const deltaY = event.clientY - state.input.lastY;
    state.input.lastX = event.clientX;
    state.input.lastY = event.clientY;
    applyLookDelta(deltaX, deltaY);
  });

  const releaseLook = (event) => {
    if (event && state.input.pointerId !== null && event.pointerId !== state.input.pointerId) {
      return;
    }
    stopLookDrag();
  };

  renderer.domElement.addEventListener("pointerup", releaseLook);
  renderer.domElement.addEventListener("pointercancel", releaseLook);
  renderer.domElement.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });
  window.addEventListener("blur", () => {
    stopLookDrag();
    syncMouseUi();
  });

  window.addEventListener("keydown", (event) => {
    const playing = state.started && !state.gameOver && !state.victory;
    const gameplayKey = [
      "Space",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
      "KeyF",
      "KeyG",
      "KeyQ",
      "Digit1",
      "Digit2",
      "Digit3",
      "Digit4",
      "Digit5",
      "Digit6",
    ].includes(event.code);

    if (gameplayKey && playing) {
      event.preventDefault();
    }

    if (state.code.active && playing) {
      handleCodeEntryKey(event);
      return;
    }

    if (event.code === "Escape" && dom.readout?.classList.contains("active")) {
      closeReadout();
      return;
    }

    if (event.code === "KeyR" && (state.gameOver || state.victory)) {
      resetGame();
      return;
    }

    if (!playing) {
      return;
    }

    keys.add(event.code);
    if (event.code === "KeyC") {
      state.player.crouching = true;
    }
    if (event.code === "Space" && !event.repeat) {
      tryJump();
    }
    if (event.code === "KeyF" && !event.repeat) {
      toggleFlashlight();
    }
    if (event.code === "KeyG" && !event.repeat) {
      toggleRadarGoggles();
    }
    if (event.code === "KeyQ" && !event.repeat) {
      useSelectedInventoryItem();
    }
    if (event.code.startsWith("Digit")) {
      selectInventorySlot(Number(event.code.replace("Digit", "")) - 1);
    }
    if (event.code === "KeyE") {
      tryInteract();
    }
  });

  window.addEventListener("keyup", (event) => {
    const playing = state.started && !state.gameOver && !state.victory;
    const gameplayKey = ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyF", "KeyG", "KeyQ"].includes(event.code);

    if (gameplayKey && playing) {
      event.preventDefault();
    }

    keys.delete(event.code);
    if (event.code === "KeyC") {
      state.player.crouching = false;
    }
  });

  renderer.domElement.addEventListener("click", () => {
    if (state.started && !state.gameOver && !state.victory) {
      renderer.domElement.focus({ preventScroll: true });
      attemptPointerLock();
    }
  });

  dom.startButton.addEventListener("click", () => {
    startGame("normal");
  });

  dom.practiceButton?.addEventListener("click", () => {
    startGame("practice");
  });

  dom.customButton?.addEventListener("click", () => {
    startGame("custom");
  });

  dom.impossibleButton?.addEventListener("click", () => {
    startGame("impossible");
  });

  dom.restartButton.addEventListener("click", () => {
    resetGame();
  });

  dom.musicVolume.addEventListener("input", () => {
    syncSettingsFromControls();
  });

  dom.sensitivitySlider.addEventListener("input", () => {
    syncSettingsFromControls();
  });

  dom.qualityButtons.forEach((element) => {
    element.addEventListener("click", (event) => {
      event.preventDefault();
      setQualityPreference(element.dataset.quality);
    });
  });

  [
    ...dom.customHunters,
    ...dom.customItems,
    dom.customRadar,
    dom.customHearing,
    dom.customSight,
    dom.customSpeed,
  ].filter(Boolean).forEach((element) => {
    element.addEventListener("input", syncCustomControls);
    element.addEventListener("change", syncCustomControls);
  });

  Object.entries(dom.checklist).forEach(([id, element]) => {
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setMessage(`${getItemLabel(id)} is on the objective list. The radar map only scans nearby hunters now.`);
    });
  });

  dom.inventorySlots.forEach((element) => {
    element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectInventorySlot(Number(element.dataset.slot));
      useSelectedInventoryItem();
    });
  });

  dom.readoutClose?.addEventListener("click", () => {
    closeReadout();
  });
}

function startGame(mode = "normal") {
  state.gameMode = GAME_MODES[mode] ? mode : "normal";
  if (state.gameMode === "custom") {
    state.customMode = buildCustomModeConfig();
  }
  dom.startScreen.classList.remove("active");
  resetGame();
  const modeConfig = getModeConfig();
  if (modeConfig.boatOnly) {
    setMessage("Impossible mode: reach the boat. Hunters are faster, see farther, and can break through walls.");
  } else if (modeConfig.daylight) {
    setMessage("Practice mode: daylight, no hunters. Run the same route and drill the item path.");
  } else if (modeConfig.custom) {
    setMessage("Custom mode: your hunter, item, radar, and stat rules are active.");
  } else {
    setMessage("Normal mode: collect every objective, solve the locks, then launch the boat.");
  }
}

function buildCustomModeConfig() {
  const radarEnabled = dom.customRadar ? dom.customRadar.checked : true;
  const hunterIds = dom.customHunters.filter((input) => input.checked).map((input) => input.dataset.customHunter);
  const requiredItems = dom.customItems
    .filter((input) => input.checked)
    .map((input) => input.dataset.customItem)
    .filter((id) => radarEnabled || id !== "radar");

  return {
    ...createDefaultCustomMode(),
    speedMultiplier: getSliderMultiplier(dom.customSpeed, 1),
    hearingMultiplier: getSliderMultiplier(dom.customHearing, 1),
    sightMultiplier: getSliderMultiplier(dom.customSight, 1),
    rangeMultiplier: getSliderMultiplier(dom.customSight, 1),
    hunterIds,
    requiredItems,
    radarMode: radarEnabled ? "start" : "none",
    custom: true,
    label: "Custom",
  };
}

function getSliderMultiplier(input, fallback = 1) {
  if (!input) {
    return fallback;
  }
  return THREE.MathUtils.clamp(Number(input.value) / 100, 0.25, 3);
}

function syncCustomControls() {
  updateMultiplierLabel(dom.customHearing, dom.customHearingValue);
  updateMultiplierLabel(dom.customSight, dom.customSightValue);
  updateMultiplierLabel(dom.customSpeed, dom.customSpeedValue);

  const radarEnabled = dom.customRadar ? dom.customRadar.checked : true;
  const radarItemInput = dom.customItems.find((input) => input.dataset.customItem === "radar");
  if (radarItemInput) {
    radarItemInput.disabled = !radarEnabled;
    if (!radarEnabled) {
      radarItemInput.checked = false;
    }
    radarItemInput.closest("label")?.classList.toggle("disabled", !radarEnabled);
  }
}

function updateMultiplierLabel(input, output) {
  if (!input || !output) {
    return;
  }
  output.textContent = `${getSliderMultiplier(input).toFixed(2)}x`;
}

function ensureAudio() {
  if (state.audioReady) {
    audioSystem.context.resume();
    applyAudioSettings();
    return;
  }

  const context = new window.AudioContext();
  const master = context.createGain();
  master.gain.value = getMasterVolume();
  master.connect(context.destination);

  const ambient = context.createOscillator();
  ambient.type = "sawtooth";
  ambient.frequency.value = 54;
  const ambientGain = context.createGain();
  ambientGain.gain.value = 0.03;

  const lowpass = context.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = 240;

  ambient.connect(lowpass);
  lowpass.connect(ambientGain);
  ambientGain.connect(master);
  ambient.start();

  const windBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const windData = windBuffer.getChannelData(0);
  for (let i = 0; i < windData.length; i += 1) {
    windData[i] = (Math.random() * 2 - 1) * (0.45 + Math.sin(i * 0.0007) * 0.2);
  }
  const wind = context.createBufferSource();
  wind.buffer = windBuffer;
  wind.loop = true;
  const windFilter = context.createBiquadFilter();
  windFilter.type = "bandpass";
  windFilter.frequency.value = 620;
  windFilter.Q.value = 0.75;
  const windGain = context.createGain();
  windGain.gain.value = 0.018;
  wind.connect(windFilter);
  windFilter.connect(windGain);
  windGain.connect(master);
  wind.start();

  const threat = context.createOscillator();
  threat.type = "triangle";
  threat.frequency.value = 212;
  const threatGain = context.createGain();
  threatGain.gain.value = 0;
  threat.connect(threatGain);
  threatGain.connect(master);
  threat.start();

  audioSystem = { context, master, ambientGain, windGain, threatGain, threat, lastEagleAt: 0 };
  state.audioReady = true;
  applyAudioSettings();
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function tryInteract() {
  if (state.gameOver || state.victory || !state.interactive) {
    return;
  }

  if (state.interactive.type === "hide") {
    if (state.player.hiding) {
      leaveHidingPlace();
    } else {
      enterHidingPlace(state.interactive.spot);
    }
    return;
  }

  if (state.interactive.type === "stair") {
    changeFloor(state.interactive.stair);
    return;
  }

  if (state.interactive.type === "boat") {
    if (hasAllItems()) {
      triggerVictory();
    } else {
      setMessage(`The boat still needs ${getMissingEscapeItems().join(", ")}.`);
    }
    return;
  }

  if (state.interactive.type === "radarBattery") {
    collectRadarBatteryPickup(state.interactive.pickup);
    return;
  }

  const item = state.interactive.item;
  const missing = getMissingRequirements(item);
  if (missing.length > 0) {
    setMessage(`${item.name} is locked. Find ${missing.map(getItemLabel).join(", ")} first.`);
    return;
  }

  if (needsSafeCodeEntry(item)) {
    startCodeEntry(item);
    return;
  }

  collectItem(item);
}

function collectItem(item) {
  state.items[item.id] = true;
  item.collected = true;
  item.mesh.visible = false;
  item.beacon.visible = false;
  if (state.player.radarTarget === item) {
    state.player.radarTarget = null;
  }

  if (INVENTORY_ITEM_IDS.includes(item.id)) {
    addInventoryItem(item.id);
  }

  syncChecklist();
  syncInventoryUI();

  if (item.id === "safeCode") {
    setMessage(`Safe code found: ${state.code.value}. Memorize it for the chart and files.`);
    showReadout("Safe Code", `The code is ${state.code.value}.\n\nYou will have to type these numbers when a locked evidence cache asks for them.`);
    return;
  }

  if (item.id === "battery") {
    addRadarBatteryCharge(55);
    setMessage(`${item.message} Radar battery recharged to ${Math.ceil(state.player.radarBattery)}%.`);
    return;
  }

  setMessage(item.message);
}

function collectRadarBatteryPickup(pickup) {
  if (!pickup || pickup.collected) {
    return;
  }

  pickup.collected = true;
  pickup.mesh.visible = false;
  pickup.highlight.visible = false;
  pickup.marker.visible = false;
  addRadarBatteryCharge(RADAR_BATTERY_PICKUP);
  setMessage(`Radar battery pack loaded. Charge: ${Math.ceil(state.player.radarBattery)}%.`);
}

function addRadarBatteryCharge(amount) {
  state.player.radarBattery = THREE.MathUtils.clamp(state.player.radarBattery + amount, 0, RADAR_BATTERY_MAX);
  clearRadarMap();
}

function addInventoryItem(id) {
  if (state.inventory.slots.includes(id)) {
    return true;
  }

  const emptyIndex = state.inventory.slots.findIndex((slot) => slot === null);
  if (emptyIndex === -1) {
    setMessage(`Inventory full. ${getItemLabel(id)} stayed here.`);
    return false;
  }

  state.inventory.slots[emptyIndex] = id;
  state.inventory.selected = emptyIndex;
  return true;
}

function selectInventorySlot(index) {
  if (index < 0 || index >= state.inventory.slots.length) {
    return;
  }

  state.inventory.selected = index;
  if (!isRadarInHand() && state.player.gogglesOn) {
    state.player.gogglesOn = false;
    clearRadarMap();
    clearRadarBeacons();
  }
  syncInventoryUI();
  const id = state.inventory.slots[index];
  if (id) {
    setMessage(`Selected ${getItemLabel(id)}.`);
  }
}

function useSelectedInventoryItem() {
  const id = getSelectedInventoryItem();
  if (!id) {
    setMessage("That inventory slot is empty.");
    return;
  }

  useInventoryItem(id);
}

function getSelectedInventoryItem() {
  return state.inventory.slots[state.inventory.selected] || null;
}

function isRadarInHand() {
  return getSelectedInventoryItem() === "radar";
}

function useInventoryItem(id) {
  if (id === "key") {
    setMessage("Boat key ready. Bring it to the dock once every objective is done.");
    return;
  }

  if (id === "files") {
    showReadout(
      "The Files",
      "Ledger fragments, flight names, offshore shell companies, visitor initials, sealed dates, and dock manifests all point to the same hidden route.\n\nThe useful part: the boat papers confirm the escape dock is live at the east pier. Keep the files with you and get out.",
    );
    return;
  }

  if (id === "safeCode") {
    showReadout("Safe Code", `The code is ${state.code.value}.\n\nClose this before unlocking a cache. The lock will ask you to type it.`);
    return;
  }

  if (id === "magnifier") {
    state.inventory.magnifierOn = !state.inventory.magnifierOn;
    setMessage(state.inventory.magnifierOn ? "Magnifying glass raised." : "Magnifying glass lowered.");
    return;
  }

  if (id === "radar") {
    toggleRadarGoggles();
  }
}

function syncInventoryUI() {
  dom.inventorySlots.forEach((element, index) => {
    const id = state.inventory.slots[index];
    element.textContent = id ? `${index + 1} ${getShortItemLabel(id)}` : String(index + 1);
    element.classList.toggle("filled", Boolean(id));
    element.classList.toggle("selected", index === state.inventory.selected);
  });
}

function getShortItemLabel(id) {
  const shortLabels = {
    key: "Key",
    files: "Files",
    safeCode: "Code",
    magnifier: "Glass",
    radar: "Radar",
  };
  return shortLabels[id] || getItemLabel(id);
}

function showReadout(title, body) {
  if (!dom.readout) {
    return;
  }

  dom.readoutTitle.textContent = title;
  dom.readoutBody.textContent = body;
  dom.readout.classList.add("active");
  dom.readout.setAttribute("aria-hidden", "false");
}

function closeReadout() {
  dom.readout?.classList.remove("active");
  dom.readout?.setAttribute("aria-hidden", "true");
}

function needsSafeCodeEntry(item) {
  return CODE_LOCKED_ITEM_IDS.has(item.id) && state.items.safeCode && !item.codeUnlocked;
}

function startCodeEntry(item) {
  state.code.active = true;
  state.code.item = item;
  state.code.input = "";
  closeReadout();
  setMessage(`${item.name} lock active. Type the ${state.code.value.length}-digit code and press Enter.`);
  dom.prompt.textContent = "Code: ____";
}

function handleCodeEntryKey(event) {
  event.preventDefault();

  if (event.code === "Escape") {
    state.code.active = false;
    state.code.item = null;
    state.code.input = "";
    setMessage("Code entry cancelled.");
    return;
  }

  if (event.code === "Backspace") {
    state.code.input = state.code.input.slice(0, -1);
  } else if (event.code === "Enter" || event.code === "NumpadEnter") {
    submitCodeEntry();
    return;
  } else if (/^Digit\d$/.test(event.code) || /^Numpad\d$/.test(event.code)) {
    const digit = event.code.slice(-1);
    if (state.code.input.length < state.code.value.length) {
      state.code.input += digit;
    }
  }

  dom.prompt.textContent = `Code: ${state.code.input.padEnd(state.code.value.length, "_")}`;
}

function submitCodeEntry() {
  const item = state.code.item;
  if (!item) {
    state.code.active = false;
    return;
  }

  if (state.code.input === state.code.value) {
    item.codeUnlocked = true;
    state.code.active = false;
    state.code.item = null;
    state.code.input = "";
    collectItem(item);
    return;
  }

  state.code.input = "";
  setMessage("Wrong code. Find or use the safe code note, memorize it, then try again.");
  dom.prompt.textContent = `Code: ${"_".repeat(state.code.value.length)}`;
}

function tryJump() {
  if (
    !state.started ||
    state.gameOver ||
    state.victory ||
    state.player.hiding ||
    state.player.crouching ||
    !state.player.grounded
  ) {
    return;
  }

  state.player.verticalVelocity = JUMP_VELOCITY;
  state.player.grounded = false;
  state.player.sound = Math.max(state.player.sound, 0.62);
}

function toggleFlashlight() {
  state.player.flashlightOn = !state.player.flashlightOn;
  setMessage(
    state.player.flashlightOn
      ? "Flashlight on. You can see farther, but the beam gives you away."
      : "Flashlight off. Harder to see, harder for him to spot you.",
  );
}

function toggleRadarGoggles() {
  if (getRadarMode() === "none") {
    setMessage("Radar goggles are disabled for this custom run.");
    return;
  }

  if (!hasInventoryItem("radar")) {
    setMessage("Find the radar goggles before using radar scan.");
    return;
  }

  if (!isRadarInHand()) {
    setMessage("Select the radar slot first. The scanner only works while it is in your hand.");
    return;
  }

  if (!state.player.gogglesOn && state.player.radarBattery <= 0) {
    setMessage("Radar battery empty. Find a radar battery pack.");
    return;
  }

  state.player.gogglesOn = !state.player.gogglesOn;
  if (!state.player.gogglesOn) {
    state.player.radarTarget = null;
    clearRadarMap();
    clearRadarBeacons();
    setMessage("Radar map off.");
    return;
  }

  setMessage("Radar map online. It scans nearby hunters only, not the real world.");
}

function selectRadarLookTarget() {
  const item = getRadarLookTarget();
  if (!item) {
    return false;
  }

  selectRadarTarget(item.id);
  return true;
}

function getRadarLookTarget() {
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  raycaster.near = 0;
  raycaster.far = 72;
  let best = null;
  let bestDistance = Infinity;

  collectibles.forEach((item) => {
    if (item.collected || state.items[item.id]) {
      return;
    }

    const hits = raycaster.intersectObjects([item.mesh, item.marker, item.beacon], true);
    if (hits.length > 0 && hits[0].distance < bestDistance) {
      best = item;
      bestDistance = hits[0].distance;
    }
  });

  return best;
}

function selectRadarTarget(id) {
  if (!state.started || state.gameOver || state.victory) {
    return;
  }

  if (getRadarMode() === "none") {
    setMessage("Radar goggles are disabled for this custom run.");
    return;
  }

  if (!hasInventoryItem("radar")) {
    setMessage("You need the radar goggles in your inventory first.");
    return;
  }

  if (!state.player.gogglesOn) {
    state.player.gogglesOn = true;
  }

  const item = collectibles.find((candidate) => candidate.id === id);
  if (!item || item.collected || state.items[id]) {
    setMessage(`${getItemLabel(id)} is already handled.`);
    return;
  }

  state.player.radarTarget = item;
  setMessage(`Radar locked: ${item.name}. Distance only, no x-ray beacon.`);
}

function clearRadarBeacons() {
  collectibles.forEach((item) => {
    item.beacon.visible = false;
  });
}

function hasInventoryItem(id) {
  return state.inventory.slots.includes(id);
}

function enterHidingPlace(spot) {
  state.player.hiding = true;
  state.player.hiddenSpot = spot;
  state.player.hideCheckDecided = false;
  state.player.hideCheckWillSearch = false;
  state.player.moving = false;
  state.player.sprinting = false;
  state.player.verticalVelocity = 0;
  state.player.jumpOffset = 0;
  state.player.grounded = true;
  state.player.floorHeight = spot.floor;
  state.player.position.copy(spot.hidePosition);
  keys.delete("KeyW");
  keys.delete("KeyA");
  keys.delete("KeyS");
  keys.delete("KeyD");
  keys.delete("ShiftLeft");
  keys.delete("ShiftRight");
  setMessage("You are hidden. If he checks this spot, it is a coin flip.");
}

function leaveHidingPlace() {
  const spot = state.player.hiddenSpot;
  state.player.hiding = false;
  state.player.hiddenSpot = null;
  state.player.hideCheckDecided = false;
  state.player.hideCheckWillSearch = false;
  if (spot) {
    state.player.floorHeight = spot.floor;
    state.player.position.copy(spot.exitPosition);
  }
  setMessage("You slipped out of hiding.");
}

function applyLookDelta(deltaX, deltaY) {
  state.yaw -= deltaX * BASE_MOUSE_SENSITIVITY * state.settings.sensitivity;
  state.pitch -= deltaY * BASE_VERTICAL_SENSITIVITY * state.settings.sensitivity;
  state.pitch = THREE.MathUtils.clamp(state.pitch, -1.25, 1.15);
}

function beginLookDrag(event) {
  state.input.dragging = true;
  state.input.pointerId = event.pointerId;
  state.input.lastX = event.clientX;
  state.input.lastY = event.clientY;
  syncMouseUi();

  try {
    renderer.domElement.setPointerCapture(event.pointerId);
  } catch (error) {
    // Some browser surfaces reject capture on canvas; drag look still works without it.
  }
}

function stopLookDrag() {
  if (state.input.pointerId !== null) {
    try {
      renderer.domElement.releasePointerCapture(state.input.pointerId);
    } catch (error) {
      // Ignore missing capture on browsers that do not support or already released it.
    }
  }

  state.input.dragging = false;
  state.input.pointerId = null;
  syncMouseUi();
}

function attemptPointerLock() {
  if (typeof renderer.domElement.requestPointerLock !== "function") {
    return;
  }

  try {
    const result = renderer.domElement.requestPointerLock();
    if (result && typeof result.catch === "function") {
      result.catch(() => {});
    }
  } catch (error) {
    // Falling back to drag look is fine here.
  }
}

function animate(now = 0) {
  requestAnimationFrame(animate);

  if (TARGET_FRAME_MS && now - lastFrameAt < TARGET_FRAME_MS) {
    return;
  }
  lastFrameAt = now;

  const delta = Math.min(CLOCK.getDelta(), 0.05);
  updateTimer();

  if (state.started && !state.gameOver && !state.victory) {
    updateKeyboardLook(delta);
    const physicsDelta = delta / PHYSICS_STEPS;
    for (let step = 0; step < PHYSICS_STEPS; step += 1) {
      updatePlayer(physicsDelta);
      updateEnemy(physicsDelta);
    }
    updateCamera(delta);
    updateHeldItemView(delta);
    updateCollectibles(delta);
    updateRadarBatteryPickups(delta);
    updateHidingPlaces(delta);
    updateGrassWind(delta);
    updateInteractions();
    updateRadarGoggles(delta);
    updateHud();
    updateAudio();
  }

  renderer.render(scene, camera);
}

function updatePlayer(delta) {
  if (state.player.hiding && state.player.hiddenSpot) {
    state.player.position.copy(state.player.hiddenSpot.hidePosition);
    state.player.moving = false;
    state.player.sprinting = false;
    state.player.crouching = false;
    state.player.verticalVelocity = 0;
    state.player.jumpOffset = 0;
    state.player.grounded = true;
    state.player.sound = THREE.MathUtils.lerp(state.player.sound, 0.01, 1 - Math.exp(-delta * 10));
    state.player.bob += delta * 0.8;
    return;
  }

  const direction = new THREE.Vector3();
  if (keys.has("KeyW")) direction.z -= 1;
  if (keys.has("KeyS")) direction.z += 1;
  if (keys.has("KeyA")) direction.x -= 1;
  if (keys.has("KeyD")) direction.x += 1;

  if (direction.lengthSq() > 0) {
    direction.normalize();
  }

  const basis = new THREE.Vector3(direction.x, 0, direction.z);
  basis.applyAxisAngle(new THREE.Vector3(0, 1, 0), state.yaw);

  const crouchFactor = state.player.crouching ? 0.48 : 1;
  const sprintRequested = keys.has("ShiftLeft") || keys.has("ShiftRight");
  const sprintFactor = sprintRequested && !state.player.crouching ? 1.75 : 1;
  const baseSpeed = 5.1 * crouchFactor * sprintFactor;

  state.player.moving = direction.lengthSq() > 0;
  state.player.sprinting = state.player.moving && sprintFactor > 1;

  const nextPosition = moveWithCollisions(
    state.player.position,
    PLAYER_RADIUS,
    basis.x * baseSpeed * delta,
    basis.z * baseSpeed * delta,
  );

  state.player.position.copy(nextPosition);
  if (state.player.floorHeight > 0 && !isInsideFloorZone(state.player.position.x, state.player.position.z)) {
    state.player.floorHeight = 0;
    state.player.verticalVelocity = 0;
    state.player.jumpOffset = 0;
    state.player.grounded = true;
    setMessage("You dropped back to the ground outside the building.");
  }

  updateJump(delta);
  state.player.position.y =
    PLAYER_HEIGHT + state.player.floorHeight - (state.player.crouching ? 0.52 : 0) + state.player.jumpOffset;

  const targetSound = state.player.moving
    ? state.player.crouching
      ? 0.16
      : state.player.sprinting
        ? 1
        : 0.52
    : state.player.grounded
      ? 0.04
      : 0.2;

  state.player.sound = THREE.MathUtils.lerp(state.player.sound, targetSound, 1 - Math.exp(-delta * 9));

  const bobSpeed = state.player.sprinting ? 12 : state.player.crouching ? 5 : 8;
  state.player.bob += state.player.moving ? delta * bobSpeed : delta * 2;
}

function updateJump(delta) {
  if (state.player.grounded && state.player.verticalVelocity === 0) {
    state.player.jumpOffset = 0;
    return;
  }

  state.player.jumpOffset += state.player.verticalVelocity * delta;
  state.player.verticalVelocity -= GRAVITY * delta;

  if (state.player.jumpOffset <= 0) {
    if (!state.player.grounded && state.player.verticalVelocity < -3) {
      state.player.sound = Math.max(state.player.sound, 0.68);
    }

    state.player.jumpOffset = 0;
    state.player.verticalVelocity = 0;
    state.player.grounded = true;
  }
}

function updateKeyboardLook(delta) {
  let horizontal = 0;
  let vertical = 0;

  if (keys.has("ArrowLeft")) horizontal += 1;
  if (keys.has("ArrowRight")) horizontal -= 1;
  if (keys.has("ArrowUp")) vertical += 1;
  if (keys.has("ArrowDown")) vertical -= 1;

  if (horizontal !== 0 || vertical !== 0) {
    const speed = BASE_KEYBOARD_LOOK_SPEED * state.settings.sensitivity * delta;
    state.yaw += horizontal * speed;
    state.pitch = THREE.MathUtils.clamp(state.pitch + vertical * speed * 0.72, -1.25, 1.15);
  }
}

function updateCamera(delta) {
  camera.position.copy(state.player.position);
  const bobAmount = state.player.moving ? Math.sin(state.player.bob) * 0.045 : 0;
  camera.position.y += bobAmount;
  camera.rotation.x = state.pitch;
  camera.rotation.y = state.yaw;
  const targetFov = state.inventory.magnifierOn ? 38 : 72;
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 1 - Math.exp(-delta * 8));
    camera.updateProjectionMatrix();
  }
  const activeFlashlightIntensity = getActiveHunters().some((hunter) => hunter.state.mode === "chase") ? 68 : 96;
  const targetFlashlightIntensity = state.player.flashlightOn ? activeFlashlightIntensity : 0;
  flashlight.intensity = THREE.MathUtils.lerp(
    flashlight.intensity,
    targetFlashlightIntensity,
    1 - Math.exp(-delta * 4),
  );
  playerFootGlow.intensity = THREE.MathUtils.lerp(
    playerFootGlow.intensity,
    state.player.flashlightOn ? 0.22 : 0.035,
    1 - Math.exp(-delta * 4),
  );
}

function updateHeldItemView(delta) {
  const selected = getSelectedInventoryItem();
  const hasHeldItem = Boolean(selected && heldItemModels.has(selected) && state.started && !state.gameOver && !state.victory);
  heldItemRoot.visible = hasHeldItem;
  heldItemModels.forEach((model, id) => {
    model.visible = hasHeldItem && id === selected;
  });

  if (!hasHeldItem) {
    return;
  }

  state.inventory.heldBob += delta * (state.player.moving ? 7.5 : 2.4);
  const bob = Math.sin(state.inventory.heldBob) * (state.player.moving ? 0.035 : 0.012);
  heldItemRoot.position.set(0.48, -0.42 + bob, -0.82);
  heldItemRoot.rotation.set(-0.14 + bob * 0.4, -0.32, 0.08 + Math.sin(state.inventory.heldBob * 0.6) * 0.02);
}

function updateCollectibles(delta) {
  collectibles.forEach((item, index) => {
    if (item.collected) {
      item.highlight.visible = false;
      item.marker.visible = false;
      item.beacon.visible = false;
      return;
    }
    item.mesh.rotation.y += delta * (0.6 + index * 0.12);
    item.mesh.position.y = item.baseY + Math.sin(CLOCK.elapsedTime * 1.8 + index * 1.7) * 0.22;
    updateCollectibleHighlight(item);
  });
}

function updateRadarBatteryPickups(delta) {
  radarBatteryPickups.forEach((pickup, index) => {
    if (pickup.collected) {
      pickup.highlight.visible = false;
      pickup.marker.visible = false;
      return;
    }
    pickup.mesh.rotation.y += delta * (0.9 + index * 0.04);
    pickup.mesh.position.y = pickup.baseY + Math.sin(CLOCK.elapsedTime * 2.2 + index) * 0.12;
    const visible = isRadarBatteryPickupVisible(pickup);
    pickup.highlight.visible = visible;
    pickup.marker.visible = visible;
    if (visible) {
      pickup.highlight.update();
      pickup.marker.position.copy(pickup.mesh.position);
      pickup.marker.position.y += 0.06;
    }
  });
}

function updateCollectibleHighlight(item) {
  const visible = isCollectibleVisible(item);
  item.highlight.visible = visible;
  item.marker.visible = visible;
  if (!visible) {
    return;
  }

  item.highlight.update();
  const locked = getMissingRequirements(item).length > 0;
  const color = locked ? 0xffc65a : 0x95ffd5;
  item.highlight.material.color.setHex(color);

  const itemPosition = new THREE.Vector3();
  item.mesh.getWorldPosition(itemPosition);
  item.marker.position.copy(itemPosition);
  item.marker.position.y += 0.12;
  item.marker.scale.setScalar(1 + Math.sin(CLOCK.elapsedTime * 4.2) * 0.06);
  item.marker.children.forEach((child) => {
    child.material.color.setHex(color);
  });
}

function updateHidingPlaces() {
  hideSpots.forEach((spot) => {
    const enabled = isHidingSpotEnabled(spot);
    spot.group.visible = enabled;
    spot.helper.visible = enabled;
    if (!enabled) {
      return;
    }

    const nearby = horizontalDistance(state.player.position, spot.position) < 4.2;
    const active = state.player.hiddenSpot === spot;
    spot.helper.material.opacity = active ? 0.8 : nearby ? 0.58 : 0.34;
    spot.helper.material.color.setHex(active ? 0xb8ffca : 0x70ff9a);
    spot.group.children.forEach((child) => {
      if (child.material && child.material.emissive) {
        child.material.emissiveIntensity = nearby || active ? 1.5 : 0.75;
      }
    });
  });
}

function updateRadarGoggles(delta) {
  if (state.code.active) {
    return;
  }

  clearRadarBeacons();

  if (!state.player.gogglesOn || !isRadarInHand() || getRadarMode() === "none") {
    if (state.player.gogglesOn && !isRadarInHand()) {
      state.player.gogglesOn = false;
      setMessage("Radar map shut off because it is no longer in your hand.");
    }
    clearRadarMap();
    return;
  }

  state.player.radarBattery = Math.max(0, state.player.radarBattery - RADAR_BATTERY_DRAIN_PER_SECOND * delta);
  if (state.player.radarBattery <= 0) {
    state.player.gogglesOn = false;
    clearRadarMap();
    setMessage("Radar battery empty. Find another battery pack.");
    return;
  }

  state.player.radarSweep = (state.player.radarSweep + delta * 1.55) % (Math.PI * 2);
  updateRadarMap();
}

function updateRadarMap() {
  if (dom.radarBatteryText) {
    dom.radarBatteryText.textContent = `${Math.ceil(state.player.radarBattery)}%`;
  }
  if (!dom.radarBlips) {
    return;
  }

  dom.radarBlips.textContent = "";
  const range = RADAR_SCAN_RANGE;
  const sin = Math.sin(-state.yaw);
  const cos = Math.cos(-state.yaw);
  getActiveHunters().forEach((hunter) => {
    const dx = hunter.actor.position.x - state.player.position.x;
    const dz = hunter.actor.position.z - state.player.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > range) {
      return;
    }

    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    const x = 50 + (localX / range) * 44;
    const y = 50 + (localZ / range) * 44;
    const blip = document.createElement("span");
    blip.className = `radar-blip ${hunter.spec.id}`;
    blip.style.left = `${THREE.MathUtils.clamp(x, 6, 94)}%`;
    blip.style.top = `${THREE.MathUtils.clamp(y, 6, 94)}%`;
    blip.title = `${hunter.spec.name} ${Math.round(distance)}m`;
    dom.radarBlips.append(blip);
  });
}

function clearRadarMap() {
  if (dom.radarBlips) {
    dom.radarBlips.textContent = "";
  }
  if (dom.radarBatteryText) {
    dom.radarBatteryText.textContent = `${Math.ceil(state.player.radarBattery)}%`;
  }
}

function updateEnemy(delta) {
  const activeHunters = getActiveHunters();
  if (activeHunters.length === 0) {
    activeHunter = null;
    enemyActor = null;
    enemyDebugHelper = null;
    return;
  }

  activeHunters.forEach((hunter) => {
    activeHunter = hunter;
    enemyActor = hunter.actor;
    enemyDebugHelper = hunter.debugHelper;
    state.enemy = hunter.state;
    updateSingleEnemy(delta);
  });

  activeHunter = activeHunters[0] || null;
  enemyActor = activeHunter?.actor || null;
  enemyDebugHelper = activeHunter?.debugHelper || null;
  state.enemy = activeHunter?.state || state.enemy;
}

function updateSingleEnemy(delta) {
  const modeConfig = getModeConfig();
  const hunterSpec = getActiveHunterSpec();
  const hearingMultiplier = modeConfig.hearingMultiplier ?? modeConfig.rangeMultiplier ?? 1;
  const sightMultiplier = modeConfig.sightMultiplier ?? modeConfig.rangeMultiplier ?? 1;
  const hunterHearing = hunterSpec.rangeScale * hearingMultiplier;
  const hunterSight = hunterSpec.rangeScale * sightMultiplier;
  const hunterNearRange = Math.max(hunterHearing, hunterSight);
  const hunterSpeed = hunterSpec.speedScale * (modeConfig.speedMultiplier ?? 1);
  const hunterRadius = hunterSpec.radius;
  const enemyPosition = enemyActor.position;
  const playerPosition = state.player.position;
  const distanceToPlayer = horizontalDistance(enemyPosition, playerPosition);
  const sameFloorAsPlayer = Math.abs(state.enemy.floorHeight - state.player.floorHeight) < 0.45;
  const noiseIntensity = THREE.MathUtils.clamp(state.player.sound, 0, 1);
  const noiseBoost = smoothstep(0.34, 1, noiseIntensity);
  const playerNoiseReach = (13 + noiseIntensity * 50) * hunterHearing;
  const heardPlayer =
    !state.player.hiding &&
    state.player.sound > 0.08 &&
    distanceToPlayer < playerNoiseReach &&
    sameFloorAsPlayer;
  const flashlightExposure = state.player.flashlightOn ? 1.34 : 0.72;
  const directVisionRange = (state.player.flashlightOn ? 40 : 26) * hunterSight;
  const peripheralVisionRange = (state.player.flashlightOn ? 24 : 15) * hunterSight;
  const directSightCone =
    sameFloorAsPlayer &&
    distanceToPlayer < directVisionRange &&
    withinView(enemyPosition, playerPosition, enemyActor.rotation.y, Math.PI * 0.38);
  const peripheralSightCone =
    sameFloorAsPlayer &&
    distanceToPlayer < peripheralVisionRange &&
    withinView(enemyPosition, playerPosition, enemyActor.rotation.y, Math.PI * 0.58);
  const canSeePlayer =
    !state.player.hiding && (directSightCone || peripheralSightCone) && hasLineOfSight(enemyPosition, playerPosition);
  const sightPressure = canSeePlayer
    ? THREE.MathUtils.clamp(
        ((directSightCone ? 0.86 : 0.52) * flashlightExposure) - distanceToPlayer / 58,
        0.08,
        0.92,
      )
    : 0;
  const overwhelmingNoise =
    !state.player.hiding &&
    sameFloorAsPlayer &&
    ((state.player.sound > 0.48 && distanceToPlayer < 34 * hunterHearing) ||
      (state.player.sound > 0.82 && distanceToPlayer < 54 * hunterHearing));
  const hearingPressure = heardPlayer
    ? THREE.MathUtils.clamp(state.player.sound * 1.15 - distanceToPlayer / 44, 0.02, 0.72)
    : 0;

  state.enemy.stairCooldown = Math.max(0, state.enemy.stairCooldown - delta);
  state.enemy.wanderTimer += delta;
  maybeStartHideCheck();

  state.enemy.awareness = THREE.MathUtils.clamp(
    state.enemy.awareness +
      (sightPressure * 1.9 + hearingPressure * 0.9) * delta -
      (state.enemy.mode === "chase" || state.enemy.mode === "checkHide" ? 0.08 : 0.16) * delta,
    0,
    1,
  );

  if (
    sameFloorAsPlayer &&
    distanceToPlayer > 12 &&
    distanceToPlayer < 85 * hunterNearRange &&
    state.enemy.mode !== "chase"
  ) {
    if (!state.enemy.nearWarned) {
      setMessage(`${hunterSpec.name} is near.`);
      state.enemy.nearWarned = true;
    }
  } else if (distanceToPlayer > 115 * hunterNearRange || state.enemy.mode === "chase") {
    state.enemy.nearWarned = false;
  }

  const startleReason = canSeePlayer
    ? state.player.flashlightOn
      ? "saw your flashlight"
      : "saw you moving in the dark"
    : overwhelmingNoise || heardPlayer
      ? "heard you"
      : "tracked your movement";

  if (canSeePlayer || overwhelmingNoise) {
    state.enemy.mode = "chase";
    state.enemy.loseSightTimer = 4.2;
    state.enemy.heardAt.copy(playerPosition);
    state.enemy.targetFloor = state.player.floorHeight;
    if (!state.enemy.spottedOnce) {
      setMessage(`${hunterSpec.name} ${startleReason}. Move.`);
      if (hunterSpec.eagleSound) {
        playEagleSound();
      }
      state.enemy.spottedOnce = true;
    }
  } else if (heardPlayer) {
    if (state.enemy.mode !== "chase") {
      state.enemy.mode = "investigate";
      setMessage(`${hunterSpec.name} heard you.`);
    }
    state.enemy.searchTimer = 7;
    state.enemy.heardAt.copy(playerPosition);
    state.enemy.targetFloor = state.player.floorHeight;
  }

  if (!state.player.hiding && sameFloorAsPlayer && state.enemy.awareness > 0.82 && distanceToPlayer < 22 * hunterNearRange) {
    state.enemy.mode = "chase";
    state.enemy.loseSightTimer = 4;
    state.enemy.heardAt.copy(playerPosition);
    state.enemy.targetFloor = state.player.floorHeight;
    if (!state.enemy.spottedOnce) {
      setMessage(`${hunterSpec.name} ${startleReason}. Move.`);
      if (hunterSpec.eagleSound) {
        playEagleSound();
      }
      state.enemy.spottedOnce = true;
    }
  } else if (state.enemy.awareness > 0.22 && state.enemy.mode === "patrol") {
    state.enemy.mode = "investigate";
    state.enemy.searchTimer = 6.2;
    state.enemy.heardAt.copy(playerPosition);
    state.enemy.targetFloor = state.player.floorHeight;
  }

  let target = state.enemy.wanderTarget;

  if (state.enemy.mode === "checkHide" && state.enemy.checkHideSpot) {
    target = state.enemy.checkHideSpot.position;
    state.enemy.targetFloor = state.enemy.checkHideSpot.floor;
    if (!state.player.hiding || state.player.hiddenSpot !== state.enemy.checkHideSpot) {
      state.enemy.mode = "investigate";
      state.enemy.searchTimer = 3.5;
      state.enemy.checkHideSpot = null;
    } else if (
      Math.abs(state.enemy.floorHeight - state.enemy.checkHideSpot.floor) < 0.45 &&
      horizontalDistance(enemyPosition, state.enemy.checkHideSpot.position) < 2.05
    ) {
      triggerLoss();
      return;
    }
  } else if (state.enemy.mode === "chase") {
    target = playerPosition;
    state.enemy.targetFloor = state.player.floorHeight;
    if (canSeePlayer) {
      state.enemy.loseSightTimer = 4.2;
    } else {
      state.enemy.loseSightTimer -= delta;
      if (state.enemy.loseSightTimer <= 0) {
        state.enemy.mode = "investigate";
        state.enemy.searchTimer = 6.5;
      }
    }
  } else if (state.enemy.mode === "investigate") {
    target = state.enemy.heardAt;
    if (Math.abs(state.enemy.floorHeight - state.enemy.targetFloor) < 0.45 && horizontalDistance(enemyPosition, target) < 1.4) {
      state.enemy.searchTimer -= delta;
      if (state.enemy.searchTimer <= 0) {
        state.enemy.mode = "patrol";
        state.enemy.awareness = Math.min(state.enemy.awareness, 0.18);
        chooseNextWanderTarget();
      }
    }
  } else if (
    state.enemy.wanderTimer > 12 ||
    (Math.abs(state.enemy.floorHeight - state.enemy.targetFloor) < 0.45 && horizontalDistance(enemyPosition, target) < 1.5)
  ) {
    chooseNextWanderTarget();
    target = state.enemy.wanderTarget;
  }

  const movementTarget = getEnemyMovementTarget(target);
  const speed =
    (state.enemy.mode === "chase"
      ? 5.65 + noiseBoost * 4.4 + state.enemy.awareness * 1.4
      : state.enemy.mode === "investigate" || state.enemy.mode === "checkHide"
        ? 3.9 + noiseBoost * 2.2
        : 2.6 + noiseBoost * 0.8) * hunterSpeed;
  let newPosition = steerToward(enemyPosition, movementTarget, speed * delta, hunterRadius, state.enemy.floorHeight);
  let enemyMoved = horizontalDistance(newPosition, enemyPosition);
  const wallBreakMode =
    modeConfig.wallBreaker && (state.enemy.mode === "chase" || state.enemy.mode === "investigate" || state.enemy.mode === "checkHide");
  if (wallBreakMode && enemyMoved < 0.018) {
    state.enemy.wallBreakTimer += delta;
    if (state.enemy.wallBreakTimer >= modeConfig.wallBreakDelay) {
      newPosition = steerToward(enemyPosition, movementTarget, speed * delta, hunterRadius, state.enemy.floorHeight, true);
      enemyMoved = horizontalDistance(newPosition, enemyPosition);
      state.enemy.wallBreakTimer = 0;
      setMessage(`${hunterSpec.name} broke through a wall.`);
    }
  } else {
    state.enemy.wallBreakTimer = Math.max(0, state.enemy.wallBreakTimer - delta * 0.8);
  }
  enemyActor.position.copy(newPosition);
  enemyActor.position.y = state.enemy.floorHeight;
  if (state.enemy.mode === "patrol") {
    state.enemy.stuckTimer = enemyMoved < 0.018 ? state.enemy.stuckTimer + delta : 0;
    if (state.enemy.stuckTimer > 1.2) {
      chooseNextWanderTarget();
    }
  }

  const facing = new THREE.Vector3(movementTarget.x - enemyPosition.x, 0, movementTarget.z - enemyPosition.z);
  if (facing.lengthSq() > 0.0001) {
    const targetYaw = Math.atan2(facing.x, facing.z);
    enemyActor.rotation.y = lerpAngle(enemyActor.rotation.y, targetYaw, 0.12);
  }

  if (!state.player.hiding && sameFloorAsPlayer && distanceToPlayer < 1.9) {
    triggerLoss();
  }

  if (enemyDebugHelper) {
    enemyDebugHelper.update();
  }
}

function maybeStartHideCheck() {
  if (!state.player.hiding || !state.player.hiddenSpot || state.player.hideCheckDecided) {
    return;
  }

  const spot = state.player.hiddenSpot;
  const distanceToSpot = horizontalDistance(enemyActor.position, spot.position);
  if (distanceToSpot > 16) {
    return;
  }

  state.player.hideCheckDecided = true;
  state.player.hideCheckWillSearch = Math.random() < 0.5;
  if (state.player.hideCheckWillSearch) {
    state.enemy.mode = "checkHide";
    state.enemy.checkHideSpot = spot;
    state.enemy.targetFloor = spot.floor;
    state.enemy.awareness = Math.max(state.enemy.awareness, 0.45);
    setMessage("He is checking your hiding place.");
  } else {
    state.enemy.awareness = Math.min(state.enemy.awareness, 0.18);
    setMessage("He passed the hiding place.");
  }
}

function getEnemyMovementTarget(target) {
  if (Math.abs(state.enemy.floorHeight - state.enemy.targetFloor) < 0.45) {
    state.enemy.stairGoal = null;
    return target;
  }

  const stair = state.enemy.stairGoal || getNearestEnemyStair(target);
  if (!stair) {
    return target;
  }

  state.enemy.stairGoal = stair;
  if (horizontalDistance(enemyActor.position, stair.position) < 2.2 && state.enemy.stairCooldown <= 0) {
    state.enemy.floorHeight = state.enemy.targetFloor;
    enemyActor.position.y = state.enemy.floorHeight;
    state.enemy.stairCooldown = 1.15;
    state.enemy.stairGoal = null;
    if (state.enemy.mode === "chase" || state.enemy.mode === "checkHide") {
      setMessage(`${getActiveHunterSpec().name} used the stairs to floor ${Math.round(state.enemy.floorHeight / FLOOR_HEIGHT) + 1}.`);
    }
  }

  return stair.position;
}

function getNearestEnemyStair(target) {
  let best = null;
  let bestDistance = Infinity;
  const goingUp = state.enemy.targetFloor > state.enemy.floorHeight;
  const focus = goingUp ? target : enemyActor.position;

  stairways.forEach((stair) => {
    const distance = horizontalDistance(focus, stair.position);
    if (distance < bestDistance) {
      best = stair;
      bestDistance = distance;
    }
  });

  return best;
}

function updateInteractions() {
  state.interactive = null;
  state.prompt = "";

  if (state.code.active) {
    dom.prompt.textContent = `Code: ${state.code.input.padEnd(state.code.value.length, "_")}`;
    return;
  }

  if (state.player.hiding && state.player.hiddenSpot) {
    state.interactive = { type: "hide", spot: state.player.hiddenSpot };
    state.prompt = `Press E to leave ${state.player.hiddenSpot.name}`;
    dom.prompt.textContent = state.prompt;
    return;
  }

  const lookedItem = getLookedAtCollectible();
  if (lookedItem) {
    const missing = getMissingRequirements(lookedItem);
    state.interactive = { type: "item", item: lookedItem };
    state.prompt =
      missing.length > 0
        ? `${lookedItem.name} locked: find ${missing.map(getItemLabel).join(", ")}`
        : lookedItem.prompt;
  } else {
    const lookedBattery = getLookedAtRadarBatteryPickup();
    if (lookedBattery) {
      state.interactive = { type: "radarBattery", pickup: lookedBattery };
      state.prompt = "Press E to take radar battery";
    }
  }

  if (!state.interactive) {
    const nearbyItem = getNearbyCollectible();
    if (nearbyItem) {
      state.prompt = `Look directly at ${nearbyItem.name} to pick it up`;
    } else {
      const nearbyBattery = getNearbyRadarBatteryPickup();
      if (nearbyBattery) {
        state.prompt = "Look directly at radar battery to pick it up";
      }
    }
  }

  if (!state.interactive) {
    const hideSpot = getNearbyHidingPlace();
    if (hideSpot) {
      state.interactive = { type: "hide", spot: hideSpot };
      state.prompt = `Press E to hide in ${hideSpot.name}`;
    }
  }

  if (!state.interactive) {
    const stair = getNearbyStairway();
    if (stair) {
      state.interactive = { type: "stair", stair };
      state.prompt = `Press E to use ${stair.label} stairs`;
    }
  }

  const boatDistance = horizontalDistance(state.player.position, BOAT_ESCAPE_POINT);
  if (!state.interactive && state.player.floorHeight === 0 && boatDistance < 5.8) {
    state.interactive = { type: "boat" };
    state.prompt = hasAllItems()
      ? "Press E to launch the boat"
      : `The boat needs ${getMissingEscapeItems().join(", ")}`;
  }

  dom.prompt.textContent = state.prompt || getIdlePrompt();
}

function getLookedAtCollectible() {
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  raycaster.near = 0;
  raycaster.far = PICKUP_DISTANCE;
  let best = null;
  let bestDistance = Infinity;

  collectibles.forEach((item) => {
    if (item.collected || !item.mesh.visible || !isCollectibleVisible(item, PICKUP_DISTANCE + 0.75)) {
      return;
    }

    const hits = raycaster.intersectObjects([item.mesh, item.marker], true);
    if (hits.length === 0 || hits[0].distance > PICKUP_DISTANCE || hits[0].distance >= bestDistance) {
      return;
    }

    const blockers = raycaster.intersectObjects(lineOfSightMeshes, false);
    const blocked = blockers.some((hit) => hit.distance < hits[0].distance - 0.16);
    if (!blocked) {
      best = item;
      bestDistance = hits[0].distance;
    }
  });

  return best;
}

function getLookedAtRadarBatteryPickup() {
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  raycaster.near = 0;
  raycaster.far = PICKUP_DISTANCE;
  let best = null;
  let bestDistance = Infinity;

  radarBatteryPickups.forEach((pickup) => {
    if (pickup.collected || !pickup.mesh.visible || !isRadarBatteryPickupVisible(pickup, PICKUP_DISTANCE + 0.75)) {
      return;
    }

    const hits = raycaster.intersectObject(pickup.mesh, true);
    if (hits.length === 0 || hits[0].distance > PICKUP_DISTANCE || hits[0].distance >= bestDistance) {
      return;
    }

    const blockers = raycaster.intersectObjects(lineOfSightMeshes, false);
    const blocked = blockers.some((hit) => hit.distance < hits[0].distance - 0.16);
    if (!blocked) {
      best = pickup;
      bestDistance = hits[0].distance;
    }
  });

  return best;
}

function isCollectibleVisible(item, maxDistance = 26) {
  if (item.collected || !item.mesh.visible || !isCollectibleOnActiveFloor(item)) {
    return false;
  }

  const itemPosition = new THREE.Vector3();
  item.mesh.getWorldPosition(itemPosition);
  const distance = camera.position.distanceTo(itemPosition);
  if (distance > maxDistance) {
    return false;
  }

  const toItem = itemPosition.clone().sub(camera.position).normalize();
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  if (forward.dot(toItem) < 0.62) {
    return false;
  }

  return hasClearLine(camera.position, itemPosition, 0.18);
}

function isRadarBatteryPickupVisible(pickup, maxDistance = 24) {
  if (pickup.collected || !pickup.mesh.visible || Math.abs(pickup.floor - state.player.floorHeight) > 0.45) {
    return false;
  }

  const distance = camera.position.distanceTo(pickup.mesh.position);
  if (distance > maxDistance) {
    return false;
  }

  const toItem = pickup.mesh.position.clone().sub(camera.position).normalize();
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  if (forward.dot(toItem) < 0.54) {
    return false;
  }

  return hasClearLine(camera.position, pickup.mesh.position, 0.18);
}

function getNearbyCollectible() {
  let best = null;
  let bestDistance = Infinity;
  const itemPosition = new THREE.Vector3();

  collectibles.forEach((item) => {
    if (item.collected || !item.mesh.visible || !isCollectibleVisible(item, PICKUP_DISTANCE + 1.2)) {
      return;
    }

    item.mesh.getWorldPosition(itemPosition);
    const distance = state.player.position.distanceTo(itemPosition);
    if (distance < PICKUP_DISTANCE && distance < bestDistance) {
      best = item;
      bestDistance = distance;
    }
  });

  return best;
}

function getNearbyRadarBatteryPickup() {
  let best = null;
  let bestDistance = Infinity;

  radarBatteryPickups.forEach((pickup) => {
    if (pickup.collected || !pickup.mesh.visible || !isRadarBatteryPickupVisible(pickup, PICKUP_DISTANCE + 1.2)) {
      return;
    }

    const distance = state.player.position.distanceTo(pickup.mesh.position);
    if (distance < PICKUP_DISTANCE && distance < bestDistance) {
      best = pickup;
      bestDistance = distance;
    }
  });

  return best;
}

function isCollectibleOnActiveFloor(item) {
  return Math.abs(item.floor - state.player.floorHeight) < 0.45;
}

function getNearbyStairway() {
  return stairways.find((stair) => horizontalDistance(state.player.position, stair.position) < 2.8);
}

function getNearbyHidingPlace() {
  let best = null;
  let bestDistance = Infinity;

  hideSpots.forEach((spot) => {
    if (!isHidingSpotEnabled(spot)) {
      return;
    }

    if (Math.abs(spot.floor - state.player.floorHeight) > 0.45) {
      return;
    }

    const distance = horizontalDistance(state.player.position, spot.position);
    if (distance < 3.2 && distance < bestDistance) {
      best = spot;
      bestDistance = distance;
    }
  });

  return best;
}

function isHidingSpotEnabled(spot) {
  return !spot.impossibleOnly || state.gameMode === "impossible";
}

function changeFloor(stair) {
  const currentIndex = stair.floors.findIndex((height) => Math.abs(height - state.player.floorHeight) < 0.1);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % stair.floors.length : 0;
  state.player.floorHeight = stair.floors[nextIndex];
  state.player.verticalVelocity = 0;
  state.player.jumpOffset = 0;
  state.player.grounded = true;
  state.player.position.y = PLAYER_HEIGHT + state.player.floorHeight;
  setMessage(`${stair.label}: floor ${nextIndex + 1}.`);
}

function getMissingRequirements(item) {
  return item.requires.filter((id) => !state.items[id]);
}

function getMissingEscapeItems() {
  if (getModeConfig().boatOnly) {
    return ["nothing; just reach the boat"];
  }

  return getRequiredItemIds().filter((id) => !state.items[id]).map(getItemLabel);
}

function getItemLabel(id) {
  return ITEM_LABELS[id] || id;
}

function getModeConfig() {
  const baseMode = GAME_MODES[state.gameMode] || GAME_MODES.normal;
  if (baseMode.custom) {
    return {
      ...GAME_MODES.normal,
      ...baseMode,
      ...state.customMode,
      custom: true,
      label: "Custom",
    };
  }

  return {
    ...GAME_MODES.normal,
    ...baseMode,
  };
}

function getActiveHunterSpec() {
  return activeHunter?.spec || HUNTER_SPECS[0];
}

function getEnabledHunterIds() {
  const modeConfig = getModeConfig();
  return modeConfig.hunterIds || DEFAULT_HUNTER_IDS;
}

function getActiveHunters() {
  const enabledIds = new Set(getEnabledHunterIds());
  return hunters.filter((hunter) => enabledIds.has(hunter.spec.id) && hunter.actor.visible);
}

function getRequiredItemIds() {
  const modeConfig = getModeConfig();
  if (modeConfig.boatOnly) {
    return [];
  }

  return Array.isArray(modeConfig.requiredItems) ? modeConfig.requiredItems : REQUIRED_ITEM_IDS;
}

function getRadarMode() {
  return getModeConfig().radarMode || "start";
}

function isCollectibleEnabled(id) {
  return !(id === "radar" && getRadarMode() === "none");
}

function applyModeLighting(modeConfig = getModeConfig()) {
  const daylight = Boolean(modeConfig.daylight);
  scene.background.set(daylight ? 0x91cfe6 : 0x02070a);
  scene.fog.color.set(daylight ? 0xb8e4ee : 0x02090c);
  scene.fog.density = daylight ? 0.0024 : LOW_SPEC_MODE ? 0.02 : NORMAL_QUALITY_MODE ? 0.016 : 0.012;
  renderer.toneMappingExposure = daylight ? 0.98 : LOW_SPEC_MODE ? 0.68 : ULTRA_QUALITY_MODE ? 0.8 : 0.74;

  if (environment.hemi) {
    environment.hemi.color.setHex(daylight ? 0xbcecff : 0x6daac7);
    environment.hemi.groundColor.setHex(daylight ? 0x6a7055 : 0x050605);
    environment.hemi.intensity = daylight ? 1.15 : LOW_SPEC_MODE ? 0.24 : 0.34;
  }
  if (environment.moon) {
    environment.moon.intensity = daylight ? 0.03 : LOW_SPEC_MODE ? 0.14 : HIGH_DETAIL_MODE ? 0.24 : 0.19;
  }
  if (environment.moonFill) {
    environment.moonFill.intensity = daylight ? 0.04 : LOW_SPEC_MODE ? 0.035 : 0.055;
  }
  if (environment.sun) {
    environment.sun.visible = daylight;
    environment.sun.intensity = daylight ? 1.55 : 0;
  }
  if (environment.moonSphere) {
    environment.moonSphere.visible = !daylight;
  }
  document.body.classList.toggle("practice", daylight);
}

function setQualityPreference(mode) {
  const nextMode = normalizeQualityMode(mode);
  window.localStorage?.setItem("blackTideQuality", nextMode);
  if (nextMode !== QUALITY_MODE) {
    const url = new URL(window.location.href);
    url.searchParams.set("quality", nextMode);
    window.location.href = url.toString();
    return;
  }

  syncQualityButtons();
  setMessage(`${getQualityLabel(nextMode)} already active.`);
}

function syncQualityButtons() {
  dom.qualityButtons.forEach((button) => {
    const active = button.dataset.quality === QUALITY_MODE;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function getQualityLabel(mode) {
  return {
    low: "Low quality",
    normal: "Normal quality",
    high: "High quality",
    ultra: "Ultra quality",
  }[mode] || "Low quality";
}

function generateSafeCode() {
  const digits = [];
  while (digits.length < 4) {
    const digit = String(Math.floor(Math.random() * 10));
    if (!digits.includes(digit)) {
      digits.push(digit);
    }
  }
  return digits.join("");
}

function updateHud() {
  const intensity = Math.round(state.player.sound * 100);
  dom.soundFill.style.width = `${intensity}%`;

  let soundLabel = "Barely audible";
  if (intensity > 28) soundLabel = "Measured steps";
  if (intensity > 56) soundLabel = "Loud enough to track";
  if (intensity > 80) soundLabel = "He can hear this";
  dom.soundText.textContent = soundLabel;

  const modeConfig = getModeConfig();
  const hunterStates = getActiveHunters().map((hunter) => hunter.state);
  let alertLabel = modeConfig.daylight ? "Practice" : modeConfig.boatOnly ? "Impossible" : "Quiet";
  if (hunterStates.some((hunterState) => hunterState.mode === "investigate")) alertLabel = "Listening";
  if (hunterStates.some((hunterState) => hunterState.mode === "checkHide")) alertLabel = "Searching";
  if (hunterStates.some((hunterState) => hunterState.mode === "chase")) alertLabel = "Chasing";
  dom.alert.textContent = alertLabel;
  if (dom.flashlightPill) {
    dom.flashlightPill.textContent = state.player.flashlightOn ? "Light On" : "Light Off";
  }
  if (dom.radarPill) {
    dom.radarPill.textContent = state.player.gogglesOn
      ? `Radar ${Math.ceil(state.player.radarBattery)}%`
      : isRadarInHand()
        ? `Radar Ready ${Math.ceil(state.player.radarBattery)}%`
        : "Radar Off";
  }
  dom.status.textContent = state.message;

  document.body.classList.toggle("chase", hunterStates.some((hunterState) => hunterState.mode === "chase"));
  document.body.classList.toggle("hidden", state.player.hiding);
  document.body.classList.toggle("radar-on", state.player.gogglesOn && isRadarInHand());
  syncMouseUi();
}

function updateAudio() {
  if (!audioSystem) {
    return;
  }

  applyAudioSettings();
  const activeHunters = getActiveHunters();
  const nearestDistance = activeHunters.reduce(
    (best, hunter) => Math.min(best, horizontalDistance(state.player.position, hunter.actor.position)),
    Infinity,
  );
  const threat = THREE.MathUtils.clamp(1 - nearestDistance / 34, 0, 1);
  const chaseBoost = activeHunters.some((hunter) => hunter.state.mode === "chase")
    ? 0.18
    : activeHunters.some((hunter) => hunter.state.mode === "investigate" || hunter.state.mode === "checkHide")
      ? 0.08
      : 0;

  audioSystem.ambientGain.gain.linearRampToValueAtTime(
    0.024 + state.player.sound * 0.018,
    audioSystem.context.currentTime + 0.12,
  );
  audioSystem.windGain.gain.linearRampToValueAtTime(
    0.014 + state.player.sound * 0.012 + (getModeConfig().boatOnly ? 0.01 : 0),
    audioSystem.context.currentTime + 0.2,
  );
  audioSystem.threatGain.gain.linearRampToValueAtTime(
    threat * 0.08 + chaseBoost,
    audioSystem.context.currentTime + 0.08,
  );
  audioSystem.threat.frequency.linearRampToValueAtTime(
    180 + threat * 260 + chaseBoost * 240,
    audioSystem.context.currentTime + 0.12,
  );
}

function playEagleSound() {
  if (!audioSystem) {
    return;
  }

  const now = audioSystem.context.currentTime;
  if (now - audioSystem.lastEagleAt < 2.2) {
    return;
  }
  audioSystem.lastEagleAt = now;

  const screech = audioSystem.context.createOscillator();
  const gain = audioSystem.context.createGain();
  const filter = audioSystem.context.createBiquadFilter();
  screech.type = "sawtooth";
  screech.frequency.setValueAtTime(1180, now);
  screech.frequency.exponentialRampToValueAtTime(420, now + 0.42);
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(1400, now);
  filter.frequency.exponentialRampToValueAtTime(760, now + 0.42);
  filter.Q.value = 7;
  const peak = Math.max(0.0001, 0.18 * state.settings.musicVolume);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peak, now + 0.06);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.48);
  screech.connect(filter);
  filter.connect(gain);
  gain.connect(audioSystem.master);
  screech.start(now);
  screech.stop(now + 0.52);
}

function triggerLoss() {
  state.gameOver = true;
  stopTimer();
  document.exitPointerLock();
  stopLookDrag();
  syncMouseUi();
  dom.endKicker.textContent = "Caught";
  dom.endTitle.textContent = "He heard you.";
  dom.endCopy.textContent = `Run ended at ${formatRunTime(state.timer.elapsed)}. Reset and keep your steps under control.`;
  dom.endScreen.classList.add("active");
}

function triggerVictory() {
  const modeConfig = getModeConfig();
  state.victory = true;
  stopTimer();
  document.exitPointerLock();
  stopLookDrag();
  syncMouseUi();
  setMessage(modeConfig.boatOnly ? "Impossible escape complete." : "You made it to the boat.");
  dom.endKicker.textContent = "Escaped";
  dom.endTitle.textContent = modeConfig.daylight ? "Practice route complete." : "The tide carried you out.";
  dom.endCopy.textContent = modeConfig.boatOnly
    ? `Impossible escape time: ${formatRunTime(state.timer.elapsed)}. You reached the boat alive.`
    : modeConfig.daylight
      ? `Practice time: ${formatRunTime(state.timer.elapsed)}. Same island, no hunters, clean route reps.`
      : `Escape time: ${formatRunTime(state.timer.elapsed)}. Required objectives complete.`;
  dom.endScreen.classList.add("active");
}

function resetGame() {
  syncSettingsFromControls();
  const modeConfig = getModeConfig();
  state.started = true;
  state.pointerLocked = false;
  state.gameOver = false;
  state.victory = false;
  state.yaw = 0;
  state.pitch = 0;
  state.player.position.copy(findSafePosition(PLAYER_START, PLAYER_RADIUS));
  state.player.bob = 0;
  state.player.sound = 0.04;
  state.player.crouching = false;
  state.player.sprinting = false;
  state.player.moving = false;
  state.player.verticalVelocity = 0;
  state.player.jumpOffset = 0;
  state.player.grounded = true;
  state.player.floorHeight = 0;
  state.player.flashlightOn = true;
  state.player.hiding = false;
  state.player.hiddenSpot = null;
  state.player.hideCheckDecided = false;
  state.player.hideCheckWillSearch = false;
  state.player.gogglesOn = false;
  state.player.radarTarget = null;
  state.player.radarBattery = RADAR_BATTERY_START;
  state.player.radarSweep = 0;
  state.inventory.slots = createStartingInventorySlots(modeConfig);
  state.inventory.selected = modeConfig.radarMode === "start" ? 5 : 0;
  state.inventory.magnifierOn = false;
  state.inventory.heldBob = 0;
  state.items = createStartingItems(modeConfig);
  state.code.value = generateSafeCode();
  state.code.active = false;
  state.code.item = null;
  state.code.input = "";
  closeReadout();
  stopLookDrag();
  applyModeLighting(modeConfig);
  syncMouseUi();
  resetHunters();

  REQUIRED_ITEM_IDS.forEach((id) => {
    if (!(id in state.items)) {
      state.items[id] = false;
    }
  });

  collectibles.forEach((item) => {
    const enabled = isCollectibleEnabled(item.id);
    const startsCollected = !enabled || state.items[item.id] === true;
    item.collected = startsCollected;
    item.mesh.visible = enabled && !startsCollected;
    item.highlight.visible = false;
    item.marker.visible = false;
    item.beacon.visible = false;
    item.codeUnlocked = false;
  });

  radarBatteryPickups.forEach((pickup) => {
    pickup.collected = false;
    pickup.mesh.visible = true;
    pickup.highlight.visible = false;
    pickup.marker.visible = false;
  });
  clearRadarMap();

  keys.clear();
  setMessage("Click to capture the mouse. Drag still works if the browser blocks it.");
  startTimer();
  syncChecklist();
  syncInventoryUI();
  dom.endScreen.classList.remove("active");
  dom.prompt.textContent = getIdlePrompt();
  renderer.domElement.focus({ preventScroll: true });
  attemptPointerLock();
  ensureAudio();
}

function hasAllItems() {
  if (getModeConfig().boatOnly) {
    return true;
  }

  return getRequiredItemIds().every((id) => state.items[id]);
}

function syncChecklist() {
  const requiredItems = new Set(getRequiredItemIds());
  Object.entries(state.items).forEach(([key, value]) => {
    if (dom.checklist[key]) {
      dom.checklist[key].classList.toggle("done", value);
      dom.checklist[key].classList.toggle("optional", !requiredItems.has(key) && !getModeConfig().boatOnly);
      dom.checklist[key].classList.toggle("disabled", !isCollectibleEnabled(key));
    }
  });
}

function syncSettingsFromControls() {
  const musicRaw = Number(dom.musicVolume.value);
  const sensitivityRaw = Number(dom.sensitivitySlider.value);

  state.settings.musicVolume = THREE.MathUtils.clamp(musicRaw / 100, 0, 1);
  state.settings.sensitivity = THREE.MathUtils.clamp(sensitivityRaw / 100, 0.4, 1.8);
  dom.musicValue.textContent = `${Math.round(state.settings.musicVolume * 100)}%`;
  dom.sensitivityValue.textContent = `${state.settings.sensitivity.toFixed(2)}x`;
  applyAudioSettings();
}

function getMasterVolume() {
  return state.settings.musicVolume * 0.08;
}

function applyAudioSettings() {
  if (!audioSystem) {
    return;
  }

  audioSystem.master.gain.linearRampToValueAtTime(
    getMasterVolume(),
    audioSystem.context.currentTime + 0.08,
  );
}

function startTimer() {
  state.timer.elapsed = 0;
  state.timer.startAt = performance.now();
  state.timer.lastDisplayAt = 0;
  state.timer.running = true;
  updateTimerDisplay();
}

function stopTimer() {
  if (state.timer.running) {
    state.timer.elapsed = performance.now() - state.timer.startAt;
    state.timer.running = false;
  }

  updateTimerDisplay();
}

function updateTimer() {
  if (!state.timer.running) {
    return;
  }

  const now = performance.now();
  state.timer.elapsed = now - state.timer.startAt;
  const displayInterval = LOW_SPEC_MODE ? 90 : 33;
  if (now - state.timer.lastDisplayAt > displayInterval) {
    state.timer.lastDisplayAt = now;
    updateTimerDisplay();
  }
}

function updateTimerDisplay() {
  dom.timer.textContent = formatRunTime(state.timer.elapsed);
}

function formatRunTime(milliseconds) {
  const totalMs = Math.max(0, Math.floor(milliseconds));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function setMessage(text) {
  state.message = text;
  dom.status.textContent = text;
}

function syncMouseUi() {
  const playing = state.started && !state.gameOver && !state.victory;
  document.body.classList.toggle("playing", playing);
  document.body.classList.toggle("low-spec", LOW_SPEC_MODE);
  document.body.dataset.quality = QUALITY_MODE;
  document.body.classList.toggle("mouse-captured", state.pointerLocked);
  document.body.classList.toggle("look-active", !state.pointerLocked && state.input.dragging);
  document.body.classList.toggle("flashlight-off", !state.player.flashlightOn);
  document.body.classList.toggle("radar-on", state.player.gogglesOn && isRadarInHand());
}

function moveWithCollisions(origin, radius, moveX, moveZ, floorOverride = null, ignoreCollisions = false) {
  const next = origin.clone();
  next.x += moveX;
  if ((!ignoreCollisions && collides(next, radius, floorOverride)) || !isInsideIsland(next.x, next.z)) {
    next.x -= moveX;
  }
  next.z += moveZ;
  if ((!ignoreCollisions && collides(next, radius, floorOverride)) || !isInsideIsland(next.x, next.z)) {
    next.z -= moveZ;
  }

  return next;
}

function findSafePosition(preferred, radius, floorOverride = null) {
  const base = preferred.clone();

  if (isInsideIsland(base.x, base.z) && !collides(base, radius, floorOverride)) {
    return base;
  }

  for (let ring = 1; ring <= 28; ring += 1) {
    const scanRadius = ring * 1.2;
    const samples = 12 + ring * 4;

    for (let i = 0; i < samples; i += 1) {
      const angle = (i / samples) * Math.PI * 2;
      const candidate = preferred.clone();
      candidate.x += Math.cos(angle) * scanRadius;
      candidate.z += Math.sin(angle) * scanRadius;

      if (isInsideIsland(candidate.x, candidate.z) && !collides(candidate, radius, floorOverride)) {
        return candidate;
      }
    }
  }

  return base;
}

function isInsideFloorZone(x, z) {
  return floorZones.some(
    (zone) =>
      x > zone.x - zone.w / 2 &&
      x < zone.x + zone.w / 2 &&
      z > zone.z - zone.d / 2 &&
      z < zone.z + zone.d / 2,
  );
}

function getFloorZoneAt(x, z) {
  return floorZones.find(
    (zone) =>
      x > zone.x - zone.w / 2 &&
      x < zone.x + zone.w / 2 &&
      z > zone.z - zone.d / 2 &&
      z < zone.z + zone.d / 2,
  );
}

function steerToward(origin, target, amount, radius, floorOverride = null, ignoreCollisions = false) {
  const direction = new THREE.Vector3(target.x - origin.x, 0, target.z - origin.z);
  if (direction.lengthSq() < 0.0001) {
    return origin.clone();
  }

  direction.normalize();
  const tryAngles = [0, 0.5, -0.5, 1.0, -1.0, 1.55, -1.55];

  for (const angle of tryAngles) {
    const step = direction.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    const attempt = moveWithCollisions(
      origin,
      radius,
      step.x * amount,
      step.z * amount,
      floorOverride,
      ignoreCollisions,
    );
    if (horizontalDistance(attempt, origin) > 0.01) {
      return attempt;
    }
  }

  return origin.clone();
}

function collides(position, radius, floorOverride = null) {
  let floorBase = floorOverride;
  if (floorBase === null) {
    floorBase =
      position.y <= 0.5
        ? 0
        : Math.round(Math.max(0, position.y - PLAYER_HEIGHT) / FLOOR_HEIGHT) * FLOOR_HEIGHT;
  }
  const playerMinY = floorBase + 0.05;
  const playerMaxY = floorBase + PLAYER_HEIGHT + 0.35;

  for (const box of colliders) {
    if (
      position.x + radius > box.min.x &&
      position.x - radius < box.max.x &&
      position.z + radius > box.min.z &&
      position.z - radius < box.max.z &&
      playerMaxY > box.min.y &&
      playerMinY < box.max.y
    ) {
      return true;
    }
  }
  return false;
}

function hasLineOfSight(from, to) {
  const origin = new THREE.Vector3(from.x, from.y + 2.08, from.z);
  const target = new THREE.Vector3(to.x, to.y, to.z);
  return hasClearLine(origin, target, 0.08);
}

function hasClearLine(from, to, padding = 0) {
  const direction = to.clone().sub(from);
  const distance = direction.length();
  if (distance <= 0.0001) {
    return true;
  }

  direction.normalize();
  raycaster.near = 0;
  raycaster.set(from, direction);
  raycaster.far = Math.max(0, distance - padding);
  const hits = raycaster.intersectObjects(lineOfSightMeshes, false);
  return hits.length === 0;
}

function withinView(from, to, yaw, fov) {
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const direction = new THREE.Vector3(to.x - from.x, 0, to.z - from.z).normalize();
  return forward.angleTo(direction) < fov;
}

function horizontalDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function smoothstep(edge0, edge1, value) {
  const x = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

function sampleTerrainHeight(x, z) {
  let height = 0.08 + Math.sin(x * 0.08) * Math.cos(z * 0.06) * 0.18;
  height += gaussian(x, z, TEMPLE_POINT.x, TEMPLE_POINT.z, 11, 0.18);
  height += gaussian(x, z, MAIN_COMPOUND_CENTER.x, MAIN_COMPOUND_CENTER.z, 16, 0.42);
  height += gaussian(x, z, HELIPAD_CENTER.x, HELIPAD_CENTER.z, 12, 0.32);
  height += gaussian(x, z, WEST_POOL_CENTER.x, WEST_POOL_CENTER.z, 10, 0.24);
  height -= gaussian(x, z, LAGOON_CENTER.x, LAGOON_CENTER.z, 9, 0.88);
  return THREE.MathUtils.clamp(height, -0.4, 2.4);
}

function gaussian(x, z, cx, cz, radius, amplitude) {
  const distanceSq = (x - cx) * (x - cx) + (z - cz) * (z - cz);
  return Math.exp(-distanceSq / (radius * radius)) * amplitude;
}

function isInsideIsland(x, z) {
  return pointInPolygon(x, z, ISLAND_OUTLINE);
}

function pointInPolygon(x, z, polygon) {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const zi = polygon[i].y;
    const xj = polygon[j].x;
    const zj = polygon[j].y;

    const intersects =
      zi > z !== zj > z &&
      x < ((xj - xi) * (z - zi)) / ((zj - zi) || Number.EPSILON) + xi;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function getIdlePrompt() {
  if (!state.started || state.gameOver || state.victory) {
    return "";
  }

  if (state.pointerLocked) {
    return "Mouse captured. Press Esc to free it.";
  }

  return state.input.dragging
    ? "Drag to look around"
    : "Click to capture the mouse. Drag works too.";
}

function lerpAngle(from, to, alpha) {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + delta * alpha;
}
