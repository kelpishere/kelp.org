import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";

const MAP_SCALE = 3.4;
const WORLD_RADIUS = 62 * MAP_SCALE;
const PLAYER_HEIGHT = 1.72;
const PLAYER_RADIUS = 0.62;
const ENEMY_RADIUS = 0.78;
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
];

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
};

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
  timer: document.querySelector("#timer-pill"),
  soundFill: document.querySelector("#sound-fill"),
  soundText: document.querySelector("#sound-text"),
  startScreen: document.querySelector("#start-screen"),
  endScreen: document.querySelector("#end-screen"),
  startButton: document.querySelector("#start-button"),
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
  message: "Reach the boat after you collect everything.",
  prompt: "",
  interactive: null,
  settings: {
    musicVolume: 0.65,
    sensitivity: 1,
  },
  timer: {
    running: false,
    startAt: 0,
    elapsed: 0,
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
  },
  items: Object.fromEntries(REQUIRED_ITEM_IDS.map((id) => [id, false])),
  enemy: {
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
  },
  audioReady: false,
};

const keys = new Set();
const colliders = [];
const lineOfSightMeshes = [];
const collectibles = [];
const stairways = [];
const floorZones = [];

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x061112);
scene.fog = new THREE.FogExp2(0x041010, 0.011);

const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 460);
camera.rotation.order = "YXZ";
camera.position.copy(state.player.position);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.tabIndex = 0;
dom.shell.append(renderer.domElement);

const flashlight = new THREE.SpotLight(0xd8f5ff, 32, 28, Math.PI / 6.2, 0.52, 1.35);
flashlight.position.set(0, 0.08, 0.08);
flashlight.target.position.set(0, -0.25, -7);
flashlight.castShadow = true;
flashlight.shadow.mapSize.set(1024, 1024);
camera.add(flashlight);
camera.add(flashlight.target);
scene.add(camera);

const playerFootGlow = new THREE.PointLight(0x78c8b8, 0.22, 8);
playerFootGlow.position.set(0, -1.1, 0);
camera.add(playerFootGlow);

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
let enemyActor;
let enemyDebugHelper;
let audioSystem = null;

initWorld();
state.player.position.copy(findSafePosition(PLAYER_START, PLAYER_RADIUS));
camera.position.copy(state.player.position);
attachEvents();
syncChecklist();
syncSettingsFromControls();
updateTimerDisplay();
window.setInterval(updateTimer, 33);
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
  scatterProps();
  addCollectibles();
  enemyActor = createEnemy();
  resetEnemyState();
  enemyDebugHelper = createEnemyDebugHelper(enemyActor);
}

function addLights() {
  const hemi = new THREE.HemisphereLight(0x7dc2df, 0x0a0908, 0.9);
  scene.add(hemi);

  const moon = new THREE.DirectionalLight(0x9fd9ff, 1.8);
  moon.position.set(-70, 90, 26);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = WORLD_RADIUS * 2;
  moon.shadow.camera.left = -WORLD_RADIUS;
  moon.shadow.camera.right = WORLD_RADIUS;
  moon.shadow.camera.top = WORLD_RADIUS;
  moon.shadow.camera.bottom = -WORLD_RADIUS;
  scene.add(moon);
}

function addSky() {
  const stars = new THREE.BufferGeometry();
  const starCount = 2200;
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
    new THREE.SphereGeometry(3.4, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xe5f2ff, transparent: true, opacity: 0.9 }),
  );
  moonSphere.position.set(-36, 28, -55);
  scene.add(moonSphere);
}

function addSea() {
  const waterGeometry = new THREE.CircleGeometry(WORLD_RADIUS * 1.55, 96);
  const waterMaterial = new THREE.MeshStandardMaterial({
    color: 0x07171d,
    metalness: 0.2,
    roughness: 0.32,
  });
  const water = new THREE.Mesh(waterGeometry, waterMaterial);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.6;
  water.receiveShadow = true;
  scene.add(water);
}

function addIsland() {
  const islandShape = new THREE.Shape(ISLAND_OUTLINE);
  const islandGeometry = new THREE.ShapeGeometry(islandShape, 96);
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
  });
  const island = new THREE.Mesh(islandGeometry, islandMaterial);
  island.receiveShadow = true;
  scene.add(island);
}

function addLagoon() {
  const lagoon = new THREE.Mesh(
    new THREE.CircleGeometry(7.2, 40),
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
    new THREE.MeshStandardMaterial({ color: 0xbcb39a, roughness: 0.98 }),
  );
  terrace.position.set(4, baseY + 0.18, 9.5);
  terrace.receiveShadow = true;
  scene.add(terrace);

  addBlock(10.5, baseY + 2.5, 10.5, 10.5, 5, 6.2, 0xe0d1b9, true);
  addBlock(5.5, baseY + 1.7, 10.5, 3.2, 3.4, 6.6, 0xd6c1a6, true);
  addBlock(6.8, baseY + 0.85, 10.5, 5.6, 1.5, 7.4, 0xc8b193, false);

  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x5d88b8, roughness: 0.84 });
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
    new THREE.MeshStandardMaterial({ color: 0x2d5d77, roughness: 0.2, metalness: 0.08 }),
  );
  pool.position.set(0.5, baseY + 0.16, 10.3);
  pool.receiveShadow = true;
  scene.add(pool);

  const cabana = addBlock(6.5, baseY + 1.25, 3.3, 4.2, 2.5, 3.6, 0x76655a, true);
  const cabanaRoof = new THREE.Mesh(
    new THREE.BoxGeometry(4.6, 0.24, 4),
    new THREE.MeshStandardMaterial({ color: 0x5d88b8, roughness: 0.9 }),
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

  const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x675f52, roughness: 0.96 });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: trim, roughness: 0.86 });
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
    new THREE.MeshStandardMaterial({ color: 0x323a3b, roughness: 0.88, transparent: true, opacity: 0.42 }),
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
    new THREE.MeshStandardMaterial({ color: 0x4f5752, roughness: 0.9 }),
  );
  lintel.position.set(x, y + wallH / 2 + 0.08, z + d / 2);
  lintel.castShadow = true;
  scene.add(lintel);

  const rug = new THREE.Mesh(
    new THREE.BoxGeometry(hallGap, 0.035, d * 0.56),
    new THREE.MeshStandardMaterial({ color: 0x493333, roughness: 0.98 }),
  );
  rug.position.set(x, y - wallH / 2 + 0.07, z + d * 0.12);
  rug.receiveShadow = true;
  scene.add(rug);
}

function addRoomProps(x, z, w, d, floorBase, floor, color) {
  const y = floorBase + 0.42;
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.86 });
  const accent = new THREE.MeshStandardMaterial({
    color: floor === 0 ? 0x3d5960 : floor === 1 ? 0x5f5348 : 0x584259,
    roughness: 0.84,
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
  const pathMaterial = new THREE.MeshStandardMaterial({ color: 0x5f5747, roughness: 1 });
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
  const lookoutMaterial = new THREE.MeshStandardMaterial({ color: 0x625c50, roughness: 0.95 });
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
    new THREE.MeshStandardMaterial({ color: 0x6f746f, roughness: 0.9 }),
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
    new THREE.MeshStandardMaterial({ color: 0xf0efe6, roughness: 0.96 }),
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
  const dockMaterial = new THREE.MeshStandardMaterial({ color: 0x5a4334, roughness: 0.92 });
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
  const pathMaterial = new THREE.MeshStandardMaterial({ color: 0x665c4d, roughness: 1 });
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
    new THREE.MeshStandardMaterial({ color: 0x275a75, roughness: 0.2, metalness: 0.06 }),
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
    x: -22,
    z: -20,
    floor: 0,
    prompt: "Press E to take the island chart",
    message: "Island chart taken. The dock route is marked.",
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
}

function addCollectible({ id, mesh, x, z, floor, prompt, message, requires = [] }) {
  const baseY = sampleTerrainHeight(x, z) + floor + 0.85;
  mesh.position.set(x, baseY, z);
  mesh.userData.collectibleId = id;
  scene.add(mesh);
  const highlight = createCollectibleHighlight(mesh);
  collectibles.push({
    id,
    name: ITEM_LABELS[id],
    mesh,
    highlight,
    baseY,
    floor,
    prompt,
    message,
    requires,
    collected: false,
  });
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

function createEnemy() {
  const group = new THREE.Group();
  const suitMaterial = new THREE.MeshStandardMaterial({
    color: 0x0d0b0b,
    roughness: 0.94,
    metalness: 0.02,
  });
  const shirtMaterial = new THREE.MeshStandardMaterial({ color: 0xe9dfcf, roughness: 0.78 });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xf0c8a0, roughness: 0.76 });
  const hairMaterial = new THREE.MeshStandardMaterial({ color: 0x211815, roughness: 0.96 });
  const tieMaterial = new THREE.MeshStandardMaterial({ color: 0x74261f, roughness: 0.7 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.58, 1.3, 7, 14), suitMaterial);
  torso.castShadow = true;
  torso.receiveShadow = true;
  torso.position.y = 1.42;
  torso.scale.set(0.92, 1.05, 0.7);
  group.add(torso);

  const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.92, 0.05), shirtMaterial);
  shirt.position.set(0, 1.52, 0.43);
  group.add(shirt);

  const tie = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.72, 4), tieMaterial);
  tie.position.set(0, 1.45, 0.49);
  tie.rotation.y = Math.PI / 4;
  group.add(tie);

  const coatLeft = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.36, 0.08), suitMaterial);
  coatLeft.position.set(-0.23, 1.45, 0.47);
  coatLeft.rotation.z = -0.1;
  group.add(coatLeft);

  const coatRight = coatLeft.clone();
  coatRight.position.x = 0.23;
  coatRight.rotation.z = 0.1;
  group.add(coatRight);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 22, 18),
    skinMaterial,
  );
  head.position.set(0, 2.58, 0.08);
  head.scale.set(0.92, 1.12, 0.86);
  head.castShadow = true;
  group.add(head);

  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.44, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMaterial);
  hair.position.set(0, 2.79, 0.03);
  hair.scale.set(0.98, 0.55, 0.9);
  group.add(hair);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 10), skinMaterial);
  nose.position.set(0, 2.56, 0.46);
  nose.rotation.x = Math.PI / 2;
  group.add(nose);

  const browMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1110, roughness: 0.8 });
  for (const x of [-0.14, 0.14]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 8, 8),
      new THREE.MeshStandardMaterial({ color: 0xf05b3c, emissive: 0x5f1007, roughness: 0.35 }),
    );
    eye.position.set(x, 2.62, 0.44);
    group.add(eye);

    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.035, 0.035), browMaterial);
    brow.position.set(x, 2.72, 0.43);
    brow.rotation.z = x < 0 ? 0.16 : -0.16;
    group.add(brow);
  }

  const eyeLight = new THREE.PointLight(0xdd5538, 1.8, 8);
  eyeLight.position.set(0, 2.4, 0.7);
  group.add(eyeLight);

  const shoulders = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.38, 0.8),
    suitMaterial,
  );
  shoulders.position.set(0, 2.15, 0);
  group.add(shoulders);

  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 1.04, 5, 10), suitMaterial);
    arm.position.set(side * 0.78, 1.5, 0.02);
    arm.rotation.z = side * 0.18;
    arm.castShadow = true;
    group.add(arm);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), skinMaterial);
    hand.position.set(side * 0.86, 0.9, 0.04);
    hand.castShadow = true;
    group.add(hand);

    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.95, 5, 10), suitMaterial);
    leg.position.set(side * 0.25, 0.48, 0);
    leg.castShadow = true;
    group.add(leg);

    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.56), suitMaterial);
    shoe.position.set(side * 0.25, 0.04, 0.14);
    shoe.castShadow = true;
    group.add(shoe);
  }

  const shadowTrail = new THREE.Mesh(
    new THREE.ConeGeometry(0.72, 1.3, 18),
    new THREE.MeshStandardMaterial({ color: 0x050404, roughness: 1, transparent: true, opacity: 0.44 }),
  );
  shadowTrail.position.set(0, 1.08, -0.16);
  shadowTrail.rotation.x = Math.PI;
  group.add(shadowTrail);

  group.position.copy(patrolRoute[0]);
  scene.add(group);
  return group;
}

function createEnemyDebugHelper(target) {
  const helper = new THREE.BoxHelper(target, 0xff3b30);
  helper.material.depthTest = false;
  helper.material.depthWrite = false;
  helper.material.transparent = true;
  helper.material.opacity = 0.95;
  helper.renderOrder = 999;
  scene.add(helper);
  return helper;
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
  enemyActor.position.copy(getRandomEnemySpawn());
  enemyActor.rotation.y = Math.random() * Math.PI * 2;
  chooseNextWanderTarget();
}

function getRandomEnemySpawn() {
  const minimumPlayerDistance = 34;
  const candidates = patrolRoute.filter(
    (point) => horizontalDistance(point, state.player.position) > minimumPlayerDistance,
  );
  const pool = candidates.length > 0 ? candidates : patrolRoute;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const routePoint = pool[Math.floor(Math.random() * pool.length)];
    const jitter = new THREE.Vector3((Math.random() - 0.5) * 10, 0, (Math.random() - 0.5) * 10);
    const candidate = routePoint.clone().add(jitter);
    candidate.y = 0;
    const safe = findSafePosition(candidate, ENEMY_RADIUS);
    if (horizontalDistance(safe, state.player.position) > minimumPlayerDistance * 0.75) {
      return safe;
    }
  }

  return findSafePosition(pool[Math.floor(Math.random() * pool.length)].clone(), ENEMY_RADIUS);
}

function chooseNextWanderTarget() {
  const choices = patrolRoute.filter((point) => horizontalDistance(point, enemyActor.position) > 18);
  const pool = choices.length > 0 ? choices : patrolRoute;
  const next = pool[Math.floor(Math.random() * pool.length)].clone();
  next.x += (Math.random() - 0.5) * 12;
  next.z += (Math.random() - 0.5) * 12;
  next.y = 0;
  state.enemy.wanderTarget.copy(findSafePosition(next, ENEMY_RADIUS));
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
    new THREE.MeshStandardMaterial({ color, roughness: 1 }),
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
    new THREE.MeshStandardMaterial({ color, roughness: 0.96 }),
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
    const gameplayKey = ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code);

    if (gameplayKey && playing) {
      event.preventDefault();
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
    if (event.code === "KeyE") {
      tryInteract();
    }
  });

  window.addEventListener("keyup", (event) => {
    const playing = state.started && !state.gameOver && !state.victory;
    const gameplayKey = ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code);

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
    startGame();
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
}

function startGame() {
  state.started = true;
  dom.startScreen.classList.remove("active");
  syncSettingsFromControls();
  startTimer();
  renderer.domElement.focus({ preventScroll: true });
  attemptPointerLock();
  syncMouseUi();
  setMessage("Click to capture the mouse. Drag still works if the browser blocks it.");
  dom.prompt.textContent = getIdlePrompt();
  ensureAudio();
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

  const threat = context.createOscillator();
  threat.type = "triangle";
  threat.frequency.value = 212;
  const threatGain = context.createGain();
  threatGain.gain.value = 0;
  threat.connect(threatGain);
  threatGain.connect(master);
  threat.start();

  audioSystem = { context, master, ambientGain, threatGain, threat };
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

  const item = state.interactive.item;
  const missing = getMissingRequirements(item);
  if (missing.length > 0) {
    setMessage(`${item.name} is locked. Find ${missing.map(getItemLabel).join(", ")} first.`);
    return;
  }

  state.items[item.id] = true;
  item.collected = true;
  item.mesh.visible = false;
  syncChecklist();
  setMessage(item.message);
}

function tryJump() {
  if (!state.started || state.gameOver || state.victory || state.player.crouching || !state.player.grounded) {
    return;
  }

  state.player.verticalVelocity = JUMP_VELOCITY;
  state.player.grounded = false;
  state.player.sound = Math.max(state.player.sound, 0.62);
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

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(CLOCK.getDelta(), 0.05);
  updateTimer();

  if (state.started && !state.gameOver && !state.victory) {
    updateKeyboardLook(delta);
    updatePlayer(delta);
    updateCamera(delta);
    updateCollectibles(delta);
    updateEnemy(delta);
    updateInteractions();
    updateHud();
    updateAudio();
  }

  renderer.render(scene, camera);
}

function updatePlayer(delta) {
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
  flashlight.intensity = THREE.MathUtils.lerp(
    flashlight.intensity,
    state.enemy.mode === "chase" ? 25 : 32,
    1 - Math.exp(-delta * 4),
  );
}

function updateCollectibles(delta) {
  collectibles.forEach((item, index) => {
    if (item.collected) {
      item.highlight.visible = false;
      return;
    }
    item.mesh.rotation.y += delta * (0.6 + index * 0.12);
    item.mesh.position.y = item.baseY + Math.sin(CLOCK.elapsedTime * 1.8 + index * 1.7) * 0.22;
    updateCollectibleHighlight(item);
  });
}

function updateCollectibleHighlight(item) {
  const visible = isCollectibleVisible(item);
  item.highlight.visible = visible;
  if (!visible) {
    return;
  }

  item.highlight.update();
  const locked = getMissingRequirements(item).length > 0;
  item.highlight.material.color.setHex(locked ? 0xffc65a : 0x95ffd5);
}

function updateEnemy(delta) {
  const enemyPosition = enemyActor.position;
  const playerPosition = state.player.position;
  const distanceToPlayer = horizontalDistance(enemyPosition, playerPosition);
  const noiseIntensity = THREE.MathUtils.clamp(state.player.sound, 0, 1);
  const noiseBoost = smoothstep(0.34, 1, noiseIntensity);
  const playerNoiseReach = 16 + noiseIntensity * 62;
  const heardPlayer = state.player.sound > 0.08 && distanceToPlayer < playerNoiseReach;
  const directSightCone =
    distanceToPlayer < 48 && withinView(enemyPosition, playerPosition, enemyActor.rotation.y, Math.PI * 0.56);
  const peripheralSightCone =
    distanceToPlayer < 30 && withinView(enemyPosition, playerPosition, enemyActor.rotation.y, Math.PI * 0.9);
  const canSeePlayer = (directSightCone || peripheralSightCone) && hasLineOfSight(enemyPosition, playerPosition);
  const sightPressure = canSeePlayer
    ? THREE.MathUtils.clamp((directSightCone ? 1.18 : 0.72) - distanceToPlayer / 82, 0.18, 1.2)
    : 0;
  const overwhelmingNoise =
    (state.player.sound > 0.42 && distanceToPlayer < 38) ||
    (state.player.sound > 0.8 && distanceToPlayer < 62);
  const hearingPressure = heardPlayer
    ? THREE.MathUtils.clamp(state.player.sound * 1.35 - distanceToPlayer / 42, 0.02, 0.9)
    : 0;

  state.enemy.awareness = THREE.MathUtils.clamp(
    state.enemy.awareness +
      (sightPressure * 1.9 + hearingPressure * 0.9) * delta -
      (state.enemy.mode === "chase" ? 0.08 : 0.14) * delta,
    0,
    1,
  );

  if (distanceToPlayer > 12 && distanceToPlayer < 36 && state.enemy.mode !== "chase") {
    if (!state.enemy.nearWarned) {
      setMessage("He is near.");
      state.enemy.nearWarned = true;
    }
  } else if (distanceToPlayer > 46 || state.enemy.mode === "chase") {
    state.enemy.nearWarned = false;
  }

  if (canSeePlayer || overwhelmingNoise) {
    state.enemy.mode = "chase";
    state.enemy.loseSightTimer = 4.2;
    state.enemy.heardAt.copy(playerPosition);
    if (!state.enemy.spottedOnce) {
      setMessage("He saw you. Move.");
      state.enemy.spottedOnce = true;
    }
  } else if (heardPlayer) {
    if (state.enemy.mode !== "chase") {
      state.enemy.mode = "investigate";
    }
    state.enemy.searchTimer = 7;
    state.enemy.heardAt.copy(playerPosition);
  }

  if (state.enemy.awareness > 0.72 && distanceToPlayer < 26) {
    state.enemy.mode = "chase";
    state.enemy.loseSightTimer = 4;
    state.enemy.heardAt.copy(playerPosition);
  } else if (state.enemy.awareness > 0.22 && state.enemy.mode === "patrol") {
    state.enemy.mode = "investigate";
    state.enemy.searchTimer = 6.2;
    state.enemy.heardAt.copy(playerPosition);
  }

  let target = state.enemy.wanderTarget;

  if (state.enemy.mode === "chase") {
    target = playerPosition;
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
    if (horizontalDistance(enemyPosition, target) < 1.4) {
      state.enemy.searchTimer -= delta;
      if (state.enemy.searchTimer <= 0) {
        state.enemy.mode = "patrol";
        state.enemy.awareness = Math.min(state.enemy.awareness, 0.18);
        chooseNextWanderTarget();
      }
    }
  } else if (horizontalDistance(enemyPosition, target) < 1.5) {
    chooseNextWanderTarget();
    target = state.enemy.wanderTarget;
  }

  const speed =
    state.enemy.mode === "chase"
      ? 5.9 + noiseBoost * 5.1 + state.enemy.awareness * 1.8
      : state.enemy.mode === "investigate"
        ? 3.8 + noiseBoost * 2.6
        : 2.35 + noiseBoost * 0.8;
  const newPosition = steerToward(enemyPosition, target, speed * delta, ENEMY_RADIUS);
  enemyActor.position.copy(newPosition);

  const facing = new THREE.Vector3(target.x - enemyPosition.x, 0, target.z - enemyPosition.z);
  if (facing.lengthSq() > 0.0001) {
    const targetYaw = Math.atan2(facing.x, facing.z);
    enemyActor.rotation.y = lerpAngle(enemyActor.rotation.y, targetYaw, 0.12);
  }

  if (distanceToPlayer < 1.9) {
    triggerLoss();
  }

  if (enemyDebugHelper) {
    enemyDebugHelper.update();
  }
}

function updateInteractions() {
  state.interactive = null;
  state.prompt = "";

  const lookedItem = getLookedAtCollectible();
  if (lookedItem) {
    const missing = getMissingRequirements(lookedItem);
    state.interactive = { type: "item", item: lookedItem };
    state.prompt =
      missing.length > 0
        ? `${lookedItem.name} locked: find ${missing.map(getItemLabel).join(", ")}`
        : lookedItem.prompt;
  } else {
    const nearbyItem = getNearbyCollectible();
    if (nearbyItem) {
      state.prompt = `Look directly at ${nearbyItem.name} to pick it up`;
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
    if (item.collected || !item.mesh.visible) {
      return;
    }

    const hits = raycaster.intersectObject(item.mesh, true);
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

function isCollectibleVisible(item) {
  if (item.collected || !item.mesh.visible) {
    return false;
  }

  const itemPosition = new THREE.Vector3();
  item.mesh.getWorldPosition(itemPosition);
  const distance = camera.position.distanceTo(itemPosition);
  if (distance > 26) {
    return false;
  }

  const toItem = itemPosition.clone().sub(camera.position).normalize();
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  if (forward.dot(toItem) < 0.62) {
    return false;
  }

  return hasClearLine(camera.position, itemPosition, 0.18);
}

function getNearbyCollectible() {
  let best = null;
  let bestDistance = Infinity;
  const itemPosition = new THREE.Vector3();

  collectibles.forEach((item) => {
    if (item.collected || !item.mesh.visible) {
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

function getNearbyStairway() {
  return stairways.find((stair) => horizontalDistance(state.player.position, stair.position) < 2.8);
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
  return REQUIRED_ITEM_IDS.filter((id) => !state.items[id]).map(getItemLabel);
}

function getItemLabel(id) {
  return ITEM_LABELS[id] || id;
}

function updateHud() {
  const intensity = Math.round(state.player.sound * 100);
  dom.soundFill.style.width = `${intensity}%`;

  let soundLabel = "Barely audible";
  if (intensity > 28) soundLabel = "Measured steps";
  if (intensity > 56) soundLabel = "Loud enough to track";
  if (intensity > 80) soundLabel = "He can hear this";
  dom.soundText.textContent = soundLabel;

  let alertLabel = "Quiet";
  if (state.enemy.mode === "investigate") alertLabel = "Listening";
  if (state.enemy.mode === "chase") alertLabel = "Chasing";
  dom.alert.textContent = alertLabel;
  dom.status.textContent = state.message;

  document.body.classList.toggle("chase", state.enemy.mode === "chase");
  syncMouseUi();
}

function updateAudio() {
  if (!audioSystem) {
    return;
  }

  applyAudioSettings();
  const enemyDistance = horizontalDistance(state.player.position, enemyActor.position);
  const threat = THREE.MathUtils.clamp(1 - enemyDistance / 28, 0, 1);
  const chaseBoost = state.enemy.mode === "chase" ? 0.18 : state.enemy.mode === "investigate" ? 0.08 : 0;

  audioSystem.ambientGain.gain.linearRampToValueAtTime(
    0.024 + state.player.sound * 0.018,
    audioSystem.context.currentTime + 0.12,
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
  state.victory = true;
  stopTimer();
  document.exitPointerLock();
  stopLookDrag();
  syncMouseUi();
  setMessage("You made it to the boat with the files.");
  dom.endKicker.textContent = "Escaped";
  dom.endTitle.textContent = "The tide carried you out.";
  dom.endCopy.textContent = `Escape time: ${formatRunTime(state.timer.elapsed)}. Boat key, fuel, and the files.`;
  dom.endScreen.classList.add("active");
}

function resetGame() {
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
  stopLookDrag();
  syncMouseUi();
  resetEnemyState();

  REQUIRED_ITEM_IDS.forEach((id) => {
    state.items[id] = false;
  });

  collectibles.forEach((item) => {
    item.collected = false;
    item.mesh.visible = true;
    item.highlight.visible = false;
  });

  keys.clear();
  setMessage("Click to capture the mouse. Drag still works if the browser blocks it.");
  startTimer();
  syncChecklist();
  dom.endScreen.classList.remove("active");
  dom.prompt.textContent = getIdlePrompt();
  renderer.domElement.focus({ preventScroll: true });
  attemptPointerLock();
  ensureAudio();
}

function hasAllItems() {
  return REQUIRED_ITEM_IDS.every((id) => state.items[id]);
}

function syncChecklist() {
  Object.entries(state.items).forEach(([key, value]) => {
    if (dom.checklist[key]) {
      dom.checklist[key].classList.toggle("done", value);
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

  state.timer.elapsed = performance.now() - state.timer.startAt;
  updateTimerDisplay();
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
  document.body.classList.toggle("mouse-captured", state.pointerLocked);
  document.body.classList.toggle("look-active", !state.pointerLocked && state.input.dragging);
}

function moveWithCollisions(origin, radius, moveX, moveZ) {
  const next = origin.clone();
  next.x += moveX;
  if (collides(next, radius) || !isInsideIsland(next.x, next.z)) {
    next.x -= moveX;
  }
  next.z += moveZ;
  if (collides(next, radius) || !isInsideIsland(next.x, next.z)) {
    next.z -= moveZ;
  }

  return next;
}

function findSafePosition(preferred, radius) {
  const base = preferred.clone();

  if (isInsideIsland(base.x, base.z) && !collides(base, radius)) {
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

      if (isInsideIsland(candidate.x, candidate.z) && !collides(candidate, radius)) {
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

function steerToward(origin, target, amount, radius) {
  const direction = new THREE.Vector3(target.x - origin.x, 0, target.z - origin.z);
  if (direction.lengthSq() < 0.0001) {
    return origin.clone();
  }

  direction.normalize();
  const tryAngles = [0, 0.5, -0.5, 1.0, -1.0, 1.55, -1.55];

  for (const angle of tryAngles) {
    const step = direction.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    const attempt = moveWithCollisions(origin, radius, step.x * amount, step.z * amount);
    if (horizontalDistance(attempt, origin) > 0.01) {
      return attempt;
    }
  }

  return origin.clone();
}

function collides(position, radius) {
  const floorBase =
    position.y <= 0.5
      ? 0
      : Math.round(Math.max(0, position.y - PLAYER_HEIGHT) / FLOOR_HEIGHT) * FLOOR_HEIGHT;
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
  height += gaussian(x, z, TEMPLE_POINT.x, TEMPLE_POINT.z, 11, 1.75);
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
