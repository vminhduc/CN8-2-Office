import { collection, onSnapshot, query, where } from 'firebase/firestore';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { auth, db, handleFirestoreError, OperationType } from '../firebase/client';
import type {
  DashboardData,
  MemberReport,
  OfficeJob,
  OfficeMember,
  PersonStatus,
  ProjectMember,
  TeamApiResponse,
  TeamRoster,
  WorkerDevice,
  WorkflowScheduleState,
} from '../types/office';
import { createOfficeAvatar } from './avatar';
import { createWallDashboard } from './dashboard';
import {
  createOwnerInbox,
  pendingReports,
  reportDisplayText,
  wrapText,
  type CanvasTarget,
  type OwnerInboxController,
} from './inbox';
import { createOfficeLife, type DeskEntry, type OfficeLifeController } from './life';

declare global {
  interface Window {
    office3D?: {
      readonly activities: OfficeLifeController['activities'];
      readonly agentCount: number;
      readonly deskCount: number;
      readonly selected: number;
      readonly editing: boolean;
      readonly dashboardFocused: boolean;
      readonly cameraPosition: number[];
      readonly names: Record<number, string>;
      readonly backendReady: boolean;
      readonly jobs: OfficeJob[];
      readonly agents: OfficeMember[];
      readonly devices: WorkerDevice[];
      point: (kind: 'screen' | 'compose' | 'desk' | 'home' | 'avatar' | 'dashboard', i?: number) => {
        x: number;
        y: number;
      };
    };
  }
}

interface MountOptions {
  container: HTMLElement;
  inputEl: HTMLInputElement;
  initialRoster: TeamRoster;
  initialTeam?: TeamApiResponse;
  currentMember: ProjectMember;
  getIdToken: () => Promise<string>;
  onAssignJob?: (job: OfficeJob) => void;
  onRegisterActions?: (actions: { refresh: () => Promise<void> }) => void;
  onReady: () => void;
  onError: (message: string) => void;
}

const NGHIA_MEMBER: OfficeMember = {
  id: 'nghia',
  name: 'Nghĩa',
  seat: 10,
  role: 'Quản lý dự án · trongnghia@pmh.com.vn',
  isHumanMember: true,
  color: '#5b7c6f',
  description:
    'Quản lý dự án Trọng Nghĩa ở góc trái: giao việc cho Linh để chuyển anh Đức phân công tiếp, và nhận báo cáo trực tiếp từ anh Đức.',
};

const STATE_NAMES: Record<string, string> = {
  queued: 'Đang chờ lượt',
  running: 'Đang chạy',
  planning: 'Linh đang phân công',
  working: 'Đang thực hiện',
  reviewing: 'Đăng đang kiểm duyệt',
  waiting_input: 'Cần anh bổ sung',
  waiting_device: 'Chờ máy công trường',
  waiting_owner_assignment: 'Chờ anh Đức phân công',
  completed: 'Đã qua kiểm duyệt AI',
  needs_owner: 'Cần anh xem xét',
  needs_check: 'Cần kiểm tra nguồn',
  failed: 'Chưa hoàn thành',
  interrupted: 'Cần kiểm tra sau gián đoạn',
};

function detectSoftwareWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export function mountOfficeScene({
  container,
  inputEl,
  initialRoster,
  initialTeam,
  currentMember,
  getIdToken,
  onAssignJob,
  onRegisterActions,
  onReady,
  onError,
}: MountOptions): () => void {
  const isOwner = currentMember.role === 'owner';
  const isSoftwareGl = detectSoftwareWebGL();
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
  } catch {
    onError('Không thể khởi tạo WebGL trong trình duyệt này.');
    return () => {};
  }

  let disposed = false;
  let contextLost = false;
  let frameId = 0;

  const roster: TeamRoster = initialRoster;
  const agentsBySeat: Record<number, OfficeMember> = Object.fromEntries(
    [...roster.agents, roster.owner, NGHIA_MEMBER].filter(Boolean).map((a) => [a.seat, a]),
  );

  let jobs: OfficeJob[] = [];
  let memberReports: MemberReport[] = [];
  let nghiaReportIdx = 0;
  let devices: WorkerDevice[] = initialTeam?.devices || [];
  let workflow: WorkflowScheduleState | null = initialTeam?.workflow || null;
  let scheduleNotice: string | null = null;
  let backendReady = Boolean(initialTeam);
  let composeError = '';
  let resultPage = 0;
  let ownerInbox: OwnerInboxController | null = null;
  let officeLife: OfficeLifeController | null = null;
  let selected = -1;
  let editing = false;
  let night = false;
  let dashZoom = false;

  let names: Record<number, string> = {};
  try {
    const raw = JSON.parse(localStorage.getItem('cn82-office-desk-names') || '{}');
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) names = raw;
  } catch {
    names = {};
  }

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = !isSoftwareGl;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#e8e7de');

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.18;
  pmremGenerator.dispose();

  const camera = new THREE.PerspectiveCamera(
    42,
    window.innerWidth / window.innerHeight,
    0.1,
    200,
  );
  const controlsTarget = new THREE.Vector3(0, 3.2, -1);
  const homeTarget = new THREE.Vector3(0, 3.2, -1);
  const homePos = () =>
    camera.aspect < 1 ? new THREE.Vector3(0, 13, 40) : new THREE.Vector3(0, 10.5, 21);

  camera.position.copy(homePos());
  camera.lookAt(controlsTarget);

  const hemi = new THREE.HemisphereLight(0xfff9e9, 0x7c8977, 2.2);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff4d4, 3.5);
  sun.position.set(-7, 14, 8);
  sun.castShadow = !isSoftwareGl;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -16,
    right: 16,
    top: 16,
    bottom: -16,
    near: 1,
    far: 45,
  });
  sun.shadow.normalBias = 0.025;
  sun.shadow.bias = -0.0002;
  sun.shadow.radius = 4;
  scene.add(sun);

  const mats: Record<string, THREE.MeshStandardMaterial> = {};
  const mat = (c: string) =>
    (mats[c] ??= new THREE.MeshStandardMaterial({ color: c, roughness: 0.72 }));

  const box = (
    p: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    c: string,
  ) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c));
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    p.add(m);
    return m;
  };

  const cyl = (
    p: THREE.Object3D,
    rt: number,
    rb: number,
    h: number,
    x: number,
    y: number,
    z: number,
    c: string,
  ) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 24), mat(c));
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    p.add(m);
    return m;
  };

  const texture = (
    w: number,
    h: number,
    drawFn: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  ): CanvasTarget => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    drawFn(ctx, w, h);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return { texture: tex, canvas, ctx };
  };

  const plane = (
    p: THREE.Object3D,
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
    tex: THREE.Texture,
  ) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }),
    );
    m.position.set(x, y, z);
    p.add(m);
    return m;
  };

  const label = (
    p: THREE.Object3D,
    s: string,
    w: number,
    h: number,
    x: number,
    y: number,
    z: number,
    bg = '#e8e3da',
    fg = '#66645e',
    size = 48,
  ) => {
    const t = texture(1024, Math.round((1024 * h) / w), (c, W, H) => {
      c.fillStyle = bg;
      c.fillRect(0, 0, W, H);
      c.fillStyle = fg;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      let currentSize = size;
      c.font = `500 ${currentSize}px 'Plus Jakarta Sans', 'Segoe UI', sans-serif`;
      while (c.measureText(s).width > W - 40 && currentSize > 20) {
        currentSize--;
        c.font = `500 ${currentSize}px 'Plus Jakarta Sans', 'Segoe UI', sans-serif`;
      }
      c.fillText(s, W / 2, H / 2);
    });
    return plane(p, w, h, x, y, z, t.texture);
  };

  const action = <T extends THREE.Object3D>(m: T, kind: string, i?: number): T => {
    m.userData = { action: kind, index: i };
    return m;
  };

  // Floor & parquet wood planks (InstancedMesh for crisp low-draw-call performance)
  box(scene, 26, 0.32, 48, 0, -0.18, 17, '#c8b28d');
  const plankColors = ['#dccbac', '#d5c1a0', '#e1cfb0', '#d9c5a6'];
  const plankGeo = new THREE.BoxGeometry(1, 0.035, 0.48);
  const plankMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.72 });
  const plankCount = 96 * 13;
  const plankInst = new THREE.InstancedMesh(plankGeo, plankMat, plankCount);
  plankInst.receiveShadow = true;
  const dummy = new THREE.Object3D();
  const colorHelper = new THREE.Color();
  let pIdx = 0;
  for (let r = 0; r < 96; r++) {
    for (let col = -1; col < 12; col++) {
      const x = -13 + col * 2.45 + (r % 2) * 1.225;
      const a = Math.max(-13, x);
      const b = Math.min(13, x + 2.43);
      if (b > a) {
        dummy.position.set((a + b) / 2, 0.005, -6.5 + r * 0.5);
        dummy.scale.set(b - a, 1, 1);
        dummy.updateMatrix();
        plankInst.setMatrixAt(pIdx, dummy.matrix);
        colorHelper.set(plankColors[(r * 7 + col * 3 + 100) % 4]);
        plankInst.setColorAt(pIdx, colorHelper);
        pIdx++;
      }
    }
  }
  plankInst.count = pIdx;
  plankInst.instanceMatrix.needsUpdate = true;
  if (plankInst.instanceColor) plankInst.instanceColor.needsUpdate = true;
  plankInst.computeBoundingSphere();
  scene.add(plankInst);

  // Room walls, windows, wood slat accent, baseboards
  box(scene, 26, 24, 0.18, 0, 11.95, -6.65, '#e8e3da');
  box(scene, 0.18, 24, 48, -13, 11.95, 17, '#ece9e1');
  box(scene, 0.18, 24, 48, 13, 11.95, 17, '#dedbd4');

  for (let z = -3.8; z < 4; z += 2.3) {
    const win = box(scene, 0.06, 3.65, 1.9, -12.89, 3.5, z, '#bdd4d3');
    win.material = new THREE.MeshStandardMaterial({
      color: '#c3ddd9',
      emissive: '#c3ddd9',
      emissiveIntensity: 0.3,
      roughness: 0.35,
    });
    box(scene, 0.12, 0.12, 2.05, -12.77, 1.65, z, '#f8f5e6');
    for (const dz of [-1, 0, 1]) {
      box(scene, 0.12, 3.8, 0.06, -12.78, 3.5, z + dz, '#f8f5e6');
    }
    box(scene, 0.12, 0.06, 2.05, -12.78, 3.5, z, '#f8f5e6');
  }

  for (let x = 6.7; x < 9.5; x += 0.18) {
    box(scene, 0.075, 5.9, 0.13, x, 3.2, -6.48, '#b7a384');
  }
  box(scene, 25.8, 0.18, 0.15, 0, 0.15, -6.48, '#b8b2a8');
  box(scene, 0.15, 0.18, 47, -12.83, 0.15, 0, '#c7c2b9');
  box(scene, 0.15, 0.18, 47, 12.83, 0.15, 0, '#bdb8b0');

  // Original Casa Luna artwork, mounted beside the wall dashboard with a warm spotlight
  box(scene, 4.0, 4.25, 0.16, -9.65, 6.8, -6.42, '#353b42');
  const mountBrandSign = (tex: THREE.Texture) => {
    if (disposed) return;
    tex.colorSpace = THREE.SRGBColorSpace;
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(3.45, (3.45 * 419) / 439),
      new THREE.MeshStandardMaterial({
        map: tex,
        transparent: true,
        roughness: 0.7,
        metalness: 0.08,
      }),
    );
    sign.position.set(-9.65, 6.8, -6.31);
    scene.add(sign);
  };
  new THREE.TextureLoader().load(
    '/assets/logo-casa-luna.png',
    mountBrandSign,
    undefined,
    () => {
      const fallback = texture(512, 512, (c, W, H) => {
        c.fillStyle = '#353b42';
        c.fillRect(0, 0, W, H);
        c.strokeStyle = '#d9c5a6';
        c.lineWidth = 8;
        c.beginPath();
        c.arc(W / 2, H / 2 - 28, 120, 0, Math.PI * 2);
        c.stroke();
        c.fillStyle = '#f7f1d9';
        c.font = "600 48px 'Plus Jakarta Sans', sans-serif";
        c.textAlign = 'center';
        c.fillText('CASA LUNA', W / 2, H / 2 + 165);
      });
      mountBrandSign(fallback.texture);
    },
  );

  const brandSpot = new THREE.SpotLight('#ffdfaa', 65, 9, Math.PI / 6, 0.72, 1.5);
  brandSpot.position.set(-9.65, 9.65, -4.9);
  brandSpot.target.position.set(-9.65, 6.8, -6.3);
  brandSpot.castShadow = !isSoftwareGl;
  brandSpot.shadow.mapSize.set(512, 512);
  scene.add(brandSpot, brandSpot.target);

  box(scene, 1.15, 0.1, 0.26, -9.65, 9.78, -6.27, '#3d4249');
  const lamp = cyl(scene, 0.15, 0.19, 0.42, -9.65, 9.53, -5.96, '#4b5057');
  lamp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -0.8, -0.6));
  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(0.11, 16, 10),
    new THREE.MeshBasicMaterial({ color: '#ffe1a5' }),
  );
  lens.scale.set(1, 0.35, 1);
  lens.position.set(-9.65, 9.36, -6.04);
  scene.add(lens);

  // Wall dashboard display
  const frame = action(box(scene, 10.7, 3.48, 0.22, 0, 4.13, -6.36, '#393f47'), 'dashboard');
  const dashboard = texture(2000, 920, () => {});
  const wallDashboard = createWallDashboard(dashboard, {
    onToggleSchedule: (nextEnabled) => void toggleSchedule(nextEnabled),
  });
  const dash = action(
    plane(scene, 10.35, 3.22, 0, 4.13, -6.23, dashboard.texture),
    'dashboard',
  );
  const displayGroup = new THREE.Group();
  scene.add(displayGroup);
  displayGroup.add(frame, dash);
  displayGroup.scale.set(1.3, 1.85, 1);
  displayGroup.position.y = -0.4215;

  // Light switch
  action(box(scene, 0.48, 0.65, 0.1, 7.25, 1.5, -6.35, '#faf8eb'), 'light');
  action(box(scene, 0.25, 0.35, 0.08, 7.25, 1.5, -6.27, '#c5cbbb'), 'light');
  label(scene, 'ÁNH SÁNG', 1.2, 0.22, 7.25, 1, -6.3, '#e8e3da', '#66645e', 80);

  // Potted plants
  function plant(x: number, z: number) {
    cyl(scene, 0.38, 0.27, 0.66, x, 0.34, z, '#b9a88b');
    cyl(scene, 0.29, 0.29, 0.04, x, 0.69, z, '#5d5944');
    for (let i = 0; i < 12; i++) {
      const a = i * 2.4;
      const rad = 0.13 + (i % 3) * 0.13;
      const yy = 0.85 + (i % 5) * 0.23;
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(1, 12, 10),
        mat(['#4d7755', '#6e8b5b', '#789767'][i % 3]),
      );
      m.scale.set(0.16, 0.5, 0.08);
      m.position.set(x + Math.sin(a) * rad, yy, z + Math.cos(a) * rad);
      m.rotation.set(Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.6);
      m.castShadow = true;
      scene.add(m);
    }
  }
  plant(-8, -5);
  plant(8.3, -4.8);
  plant(-8, 5.5);
  plant(8.4, 5.4);

  // Perimeter filing cabinets
  function cabinet(x: number, z: number, w = 2.2, h = 1.65) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    scene.add(g);
    box(g, w, h, 0.7, 0, h / 2 + 0.08, 0, '#c4ae8a');
    box(g, w + 0.08, 0.08, 0.77, 0, h + 0.12, 0, '#e4d4b4');
    for (const side of [-1, 1]) {
      box(g, w / 2 - 0.05, h - 0.12, 0.045, (side * w) / 4, h / 2 + 0.08, 0.375, '#dfd8c5');
      box(g, 0.035, 0.3, 0.06, side * 0.12, h / 2 + 0.16, 0.42, '#767c83');
    }
    for (const xx of [-w / 2 + 0.16, w / 2 - 0.16]) {
      box(g, 0.09, 0.12, 0.5, xx, 0.08, 0, '#60666e');
    }
    return g;
  }
  cabinet(-8, -5.75, 2.5, 1.7);
  cabinet(-8, 1, 2.25, 1.35);
  cabinet(8.5, -0.15, 1.7, 1.15);

  for (let i = 0; i < 6; i++) {
    box(
      scene,
      0.12,
      0.52,
      0.27,
      -8.85 + i * 0.2,
      2.12,
      -5.7,
      ['#596573', '#aaa393', '#a29069'][i % 3],
    );
    box(scene, 0.055, 0.075, 0.012, -8.85 + i * 0.2, 2.12, -5.555, '#e8e0c8');
  }
  label(scene, 'HỒ SƠ DỰ ÁN', 1.7, 0.2, -8, 1.43, -5.36, '#dfd8c5', '#6e685d', 80);

  // Multifunction printer
  const printer = new THREE.Group();
  printer.position.set(8.5, 1.31, -0.15);
  scene.add(printer);
  box(printer, 1.32, 0.63, 0.88, 0, 0.33, 0, '#e8e8de');
  box(printer, 1.1, 0.08, 0.67, 0, 0.7, -0.03, '#505761');
  box(printer, 0.93, 0.018, 0.5, 0, 0.747, -0.03, '#a5b0bc');
  box(printer, 1.31, 0.075, 0.81, 0, 0.8, -0.035, '#f3f1e5');
  box(printer, 0.82, 0.06, 0.4, -0.05, 0.87, -0.1, '#d4d9ce');
  box(printer, 0.4, 0.08, 0.28, 0.38, 0.75, 0.38, '#444d59');
  box(printer, 0.25, 0.02, 0.15, 0.38, 0.798, 0.38, '#a3b4cb');
  box(printer, 0.87, 0.16, 0.04, -0.08, 0.48, 0.455, '#414a56');
  box(printer, 0.68, 0.02, 0.32, -0.08, 0.39, 0.55, '#ece9d9');
  box(printer, 1.05, 0.18, 0.06, 0, 0.16, 0.48, '#c7cfc0');
  box(printer, 0.4, 0.025, 0.04, 0, 0.2, 0.52, '#7d848e');
  label(scene, 'MÁY IN', 1, 0.18, 8.5, 1, -0.15 + 0.39, '#dfd8c5', '#6e685d', 90);

  // Coffee machine
  const coffeeMachine = new THREE.Group();
  coffeeMachine.position.set(-8.1, 1.48, 1);
  scene.add(coffeeMachine);
  box(coffeeMachine, 0.72, 0.62, 0.47, 0, 0.31, 0, '#4b5058');
  box(coffeeMachine, 0.54, 0.38, 0.025, 0, 0.27, 0.25, '#b2b7a4');
  box(coffeeMachine, 0.54, 0.04, 0.33, 0, 0.04, 0.32, '#6c737d');
  box(coffeeMachine, 0.2, 0.08, 0.13, 0, 0.43, 0.31, '#333b46');
  cyl(coffeeMachine, 0.07, 0.055, 0.13, 0, 0.12, 0.31, '#efe4c9');
  cyl(coffeeMachine, 0.15, 0.15, 0.18, 0, 0.72, 0, '#7a8089');

  // Water cooler
  const cooler = new THREE.Group();
  cooler.position.set(8.4, 0, 3.35);
  scene.add(cooler);
  box(cooler, 0.83, 1.55, 0.76, 0, 0.85, 0, '#e8e9df');
  box(cooler, 0.73, 0.68, 0.05, 0, 1.06, 0.405, '#838e9c');
  box(cooler, 0.72, 0.09, 0.42, 0, 0.7, 0.28, '#c2cbbd');
  box(cooler, 0.69, 0.05, 0.38, 0, 0.76, 0.28, '#adb2b9');
  for (const [xx, color] of [
    [-0.17, '#ab6e5d'],
    [0.17, '#6289a0'],
  ] as const) {
    box(cooler, 0.1, 0.08, 0.2, xx, 1.27, 0.48, color);
    cyl(cooler, 0.035, 0.035, 0.12, xx, 1.18, 0.55, '#b3bdb0');
  }
  cyl(cooler, 0.24, 0.24, 0.68, 0, 2.05, 0, '#8eb8bf');
  cyl(cooler, 0.27, 0.24, 0.12, 0, 1.72, 0, '#719da8');
  cyl(cooler, 0.22, 0.24, 0.12, 0, 2.43, 0, '#a8cbd0');
  for (let yy = 1.83; yy < 2.4; yy += 0.16) {
    cyl(cooler, 0.246, 0.246, 0.025, 0, yy, 0, '#a2c4c9');
  }
  cyl(cooler, 0.1, 0.1, 0.5, -0.52, 1.45, 0, '#d4d5c7');
  label(cooler, 'NƯỚC UỐNG', 0.65, 0.14, 0, 0.42, 0.39, '#e8e9df', '#6e685d', 86);

  // Waste bin
  cyl(scene, 0.23, 0.19, 0.55, 7.25, 0.29, 0.85, '#8a9098');
  cyl(scene, 0.235, 0.235, 0.045, 7.25, 0.58, 0.85, '#5c6571');

  const desks: DeskEntry[] = [];

  function agentJob(a: OfficeMember): OfficeJob | undefined {
    if (a.isOwner) return jobs.find((j) => j.id === ownerInbox?.selectedJobId);
    return jobs.find(
      (j) =>
        !j.ownerClosedAt &&
        (j.targetAgent === a.id ||
          a.id === 'linh' ||
          j.results?.some((r) => r.agent === a.id) ||
          j.currentAgent === a.id),
    );
  }

  function hasOnlineWorker(): boolean {
    return devices.some(
      (d) => !d.revoked && (d.status === 'online' || d.status === 'busy'),
    );
  }

  function hasLockedWorker(): boolean {
    return devices.some((d) => !d.revoked && d.status === 'locked');
  }

  function personStatus(a: OfficeMember): PersonStatus {
    if (!backendReady) return { text: 'Mất kết nối', color: '#9b6d68' };
    if (a.isOwner) {
      const n = pendingReports(jobs).length;
      return {
        text: n ? `${n} báo cáo chờ` : 'Hộp báo cáo',
        pendingCount: n,
        color: n ? '#b27c37' : '#737b85',
      };
    }
    if (a.isHumanMember) {
      const unread = memberReports.filter((r) => !r.acknowledgedAt);
      const total = memberReports.length;
      return {
        text: unread.length
          ? `${unread.length} báo cáo mới`
          : total
            ? `${total} báo cáo`
            : 'Chờ báo cáo',
        pendingCount: unread.length,
        color: unread.length ? '#b27c37' : '#5b7c6f',
      };
    }
    const live = jobs.find(
      (j) =>
        j.currentAgent === a.id &&
        ['planning', 'working', 'reviewing', 'running'].includes(j.status),
    );
    if (live) {
      return {
        text:
          live.status === 'planning'
            ? 'Đang phân công'
            : live.status === 'reviewing'
              ? 'Đang kiểm duyệt'
              : 'Đang xử lý',
        color: '#397caa',
      };
    }
    const waitingDevJob = jobs.find(
      (j) =>
        j.status === 'waiting_device' &&
        (j.currentAgent === a.id || (!j.currentAgent && a.id === 'linh')),
    );
    if (waitingDevJob) {
      return { text: 'Chờ máy công trường', color: '#b27c37' };
    }
    const latest = agentJob(a);
    if (
      latest &&
      ['failed', 'interrupted', 'needs_check'].includes(latest.status) &&
      (a.id === 'linh' ||
        latest.targetAgent === a.id ||
        latest.events?.at(-1)?.agent === a.id)
    ) {
      return { text: 'Cần kiểm tra', color: '#a85248' };
    }
    if (
      a.id === 'linh' &&
      jobs.some((j) => !j.ownerClosedAt && j.status === 'waiting_owner_assignment')
    ) {
      return { text: 'Chờ anh phân công', color: '#b27c37' };
    }
    if (a.id === 'linh' && latest?.status === 'needs_owner') {
      return { text: 'Chờ anh xem xét', color: '#b27c37' };
    }
    if (a.id === 'linh' && jobs.some((j) => !j.ownerClosedAt && j.status === 'waiting_input')) {
      return { text: 'Chờ anh phản hồi', color: '#b27c37' };
    }
    const waiting =
      jobs.some((j) => j.status === 'queued' && (a.id === 'linh' || j.targetAgent === a.id)) ||
      jobs.some(
        (j) =>
          ['planning', 'working', 'reviewing', 'running'].includes(j.status) &&
          (j.plan?.tasks || []).some((t) => t.agent === a.id) &&
          !j.results?.some((r) => r.agent === a.id),
      );
    if (waiting) {
      return { text: 'Chờ đến lượt', color: '#b27c37' };
    }
    if (hasOnlineWorker()) {
      return { text: 'Máy trực tuyến', color: '#49856a' };
    }
    if (hasLockedWorker()) {
      return { text: 'Máy đang khóa', color: '#b27c37' };
    }
    return { text: 'Máy ngoại tuyến', color: '#737b85' };
  }

  function addPersonTag(parent: THREE.Object3D, a: OfficeMember) {
    const t = texture(384, 128, () => {});
    const sprite = action(
      new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: t.texture,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
      'desk',
      a.seat,
    );
    sprite.scale.set(1.5, 0.44, 1);
    sprite.position.set(0, 2.45, 1.13);
    parent.add(sprite);
    return { sprite, tex: t, key: '' };
  }

  function screenDraw(i: number, edit = false) {
    if (agentsBySeat[i]?.isOwner && !edit && ownerInbox) {
      ownerInbox.draw(jobs, composeError);
      return;
    }
    const a = agentsBySeat[i];
    const t = desks[i].tex;
    const c = t.ctx;
    const W = t.canvas.width;
    const H = t.canvas.height;

    if (a?.isHumanMember) {
      const idx = memberReports.length ? nghiaReportIdx % memberReports.length : 0;
      const rep = memberReports[idx];
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, W, H);
      c.fillStyle = '#747d89';
      c.font = "22px 'Plus Jakarta Sans', 'Segoe UI', sans-serif";
      c.fillText('CN8-2 / GÓC TRÁI · QUẢN LÝ DỰ ÁN', 40, 42);
      c.fillStyle = '#27313e';
      c.font = "600 46px 'Plus Jakarta Sans', 'Segoe UI', sans-serif";
      c.fillText(a.name, 40, 102);
      c.font = "25px 'Plus Jakarta Sans', 'Segoe UI', sans-serif";
      c.fillStyle = '#586474';
      c.fillText('trongnghia@pmh.com.vn', 40, 142);
      c.font = "20px 'Plus Jakarta Sans', 'Segoe UI', sans-serif";
      c.fillStyle = '#7b8490';
      c.fillText(
        memberReports.length
          ? `${memberReports.length} báo cáo từ anh Đức (${memberReports.filter((r) => !r.acknowledgedAt).length} mới)`
          : 'BÁO CÁO ĐỨC GỬI · GIAO VIỆC QUA LINH',
        40,
        176,
      );
      c.fillRect(40, 194, W - 80, 1);

      let body: string;
      if (edit) {
        body =
          inputEl.value ||
          (isOwner
            ? 'Nhập báo cáo gửi trực tiếp tới bàn Nghĩa. Enter để gửi; Esc để hủy.'
            : 'Nhập việc gửi cho Linh để chuyển anh Đức phân công. Enter để gửi; Esc để hủy.');
      } else if (composeError && selected === i) {
        body = composeError;
      } else if (rep) {
        const sentTime = new Date(rep.createdAt).toLocaleString('vi-VN');
        const statusTag = rep.acknowledgedAt ? 'Đã xác nhận xem' : 'Báo cáo mới từ anh Đức';
        body = `Báo cáo ${idx + 1}/${memberReports.length} · ${statusTag}\nTiêu đề: ${rep.title}\nGửi lúc: ${sentTime}\n\n${rep.content}`;
      } else {
        body = `${a.description}\n\nChưa có báo cáo nào anh Đức gửi.\nKhi anh Đức gửi báo cáo trực tiếp tại đây hoặc từ Hộp báo cáo, nội dung sẽ hiện ngay trên màn hình này.`;
      }

      c.font = "24px 'Plus Jakarta Sans', 'Segoe UI', sans-serif";
      const lines = wrapText(c, body, W - 80);
      const pages = Math.max(1, Math.ceil(lines.length / 10));
      const page = edit ? Math.max(0, Math.floor((lines.length - 1) / 10)) : resultPage % pages;
      c.fillStyle = '#333d4b';
      lines.slice(page * 10, page * 10 + 10).forEach((l, k) => {
        c.fillText(l, 40, 232 + k * 29);
      });
      if (edit) {
        c.fillStyle = '#9c713b';
        c.fillText('▏', 40, 532);
      }
      c.fillStyle = '#eeeae3';
      c.fillRect(22, 554, W - 44, 66);
      c.fillStyle = isOwner ? '#9b6d37' : '#384250';
      c.font = "20px 'Plus Jakarta Sans', 'Segoe UI', sans-serif";
      c.fillText(
        isOwner
          ? 'GỬI BÁO CÁO'
          : rep
            ? rep.acknowledgedAt
              ? 'ĐÃ NHẬN ✓'
              : 'XÁC NHẬN'
            : 'GIAO LINH',
        45,
        595,
      );
      c.fillStyle = '#384250';
      c.fillText(
        memberReports.length > 1
          ? `BÁO CÁO ${idx + 1}/${memberReports.length} ›`
          : 'LÀM MỚI',
        W * 0.34,
        595,
      );
      c.fillText(edit ? 'ENTER GỬI' : `TRANG ${page + 1}/${pages}  ›`, W * 0.69, 595);
      t.texture.needsUpdate = true;
      return;
    }

    const j = a ? agentJob(a) : undefined;

    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, W, H);
    c.fillStyle = '#747d89';
    c.font = "22px 'Plus Jakarta Sans', 'Segoe UI', sans-serif";
    c.fillText(
      `CN8-2 / ${a ? (a.isOwner ? 'ĐỨC / THÀNH VIÊN QUẢN LÝ DỰ ÁN' : 'AI TEAM') : 'WORKSTATION'}`,
      40,
      42,
    );
    c.fillStyle = '#27313e';
    c.font = "600 46px 'Plus Jakarta Sans', 'Segoe UI', sans-serif";
    c.fillText(a ? a.name : `Bàn ${String(i + 1).padStart(2, '0')}`, 40, 102);
    c.font = "25px 'Plus Jakarta Sans', 'Segoe UI', sans-serif";
    c.fillStyle = '#586474';
    c.fillText(a ? a.role : names[i] || 'Vị trí trống', 40, 142);
    c.font = "20px 'Plus Jakarta Sans', 'Segoe UI', sans-serif";
    c.fillStyle = '#7b8490';
    c.fillText(
      a
        ? a.isOwner
          ? 'BÁO CÁO · QUYẾT ĐỊNH · PHẢN HỒI'
          : `${(a.model || '').replace('gpt-', '').replace('6.1-', '6.1 ')} · High${a.serviceTier ? ' · Fast' : ''}`
        : 'Chưa bố trí tác nhân',
      40,
      176,
    );
    c.fillRect(40, 194, W - 80, 1);

    let body: string;
    if (edit) {
      body = a
        ? inputEl.value ||
          (isOwner
            ? 'Nhập yêu cầu của anh. Enter để gửi; Esc để hủy.'
            : 'Nhập yêu cầu gửi cho Linh (chuyển anh Đức phân công). Enter để gửi; Esc để hủy.')
        : inputEl.value;
    } else if (composeError && selected === i) {
      body = composeError;
    } else if (a && j) {
      const question = j.status === 'waiting_input' ? `\n${(j.questions || []).join('\n')}` : '';
      const activeName = j.currentAgent
        ? roster.agents.find((x) => x.id === j.currentAgent)?.name || j.currentAgent
        : '';
      body = `${STATE_NAMES[j.status] || j.status}\n${
        activeName ? `Đang xử lý: ${activeName}\n` : ''
      }\n${reportDisplayText(j)}${question}`;
    } else {
      const workerStateText = !backendReady
        ? 'Chưa kết nối máy chủ.'
        : hasOnlineWorker()
          ? 'Cầu nối Windows trên máy công trường đang trực tuyến.'
          : hasLockedWorker()
            ? 'Máy công trường đang khóa màn hình; cần mở khóa để chạy giao diện.'
            : 'Máy công trường đang ngoại tuyến; việc mới sẽ vào hàng đợi chờ máy.';
      body = a
        ? `${a.description}\n\n${workerStateText}\n${
            a.id === 'linh'
              ? isOwner
                ? 'Anh giao việc cho Linh; khi cần bổ sung, Linh sẽ hỏi tại đây.'
                : 'Anh/chị giao việc cho Linh; Linh sẽ chuyển trực tiếp đến anh Đức chờ phân công tiếp.'
              : isOwner
                ? 'Yêu cầu sẽ qua Linh phân công và Đăng rà soát.'
                : 'Chuyên viên nhận phân công từ anh Đức. Để giao việc mới, vui lòng gửi qua bàn Linh.'
          }`
        : 'Chạm màn hình để đặt tên vị trí.';
    }

    c.font = "24px 'Plus Jakarta Sans', 'Segoe UI', sans-serif";
    const lines = wrapText(c, body, W - 80);
    const pages = Math.max(1, Math.ceil(lines.length / 10));
    const page = edit ? Math.max(0, Math.floor((lines.length - 1) / 10)) : resultPage % pages;
    c.fillStyle = '#333d4b';
    lines.slice(page * 10, page * 10 + 10).forEach((l, k) => {
      c.fillText(l, 40, 232 + k * 29);
    });
    if (edit) {
      c.fillStyle = '#9c713b';
      c.fillText('▏', 40, 532);
    }
    c.fillStyle = '#eeeae3';
    c.fillRect(22, 554, W - 44, 66);
    c.fillStyle = '#384250';
    c.font = "20px 'Plus Jakarta Sans', 'Segoe UI', sans-serif";
    c.fillText(
      a
        ? j?.status === 'waiting_input'
          ? 'BỔ SUNG'
          : a.isOwner || (!isOwner && a.id !== 'linh')
            ? 'GIAO LINH'
            : 'GIAO VIỆC'
        : 'ĐẶT TÊN',
      45,
      595,
    );
    c.fillText('KẾT QUẢ', W * 0.34, 595);
    c.fillText(edit ? 'ENTER GỬI' : `TRANG ${page + 1}/${pages}  ›`, W * 0.69, 595);
    t.texture.needsUpdate = true;
  }

  async function fetchWithAuth(url: string, init: RequestInit = {}) {
    const token = await getIdToken();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    return fetch(url, { ...init, headers });
  }

  function redrawAllDesks() {
    for (let i = 0; i < desks.length; i++) {
      if (!(editing && i === selected)) screenDraw(i);
    }
  }

  function drawTeamDashboard() {
    wallDashboard.update(null, jobs, devices, workflow, scheduleNotice);
  }

  async function refreshTeamAndJobs() {
    try {
      const [teamRes, jobsRes, reportsRes] = await Promise.all([
        fetchWithAuth('/api/team'),
        fetchWithAuth('/api/jobs'),
        fetchWithAuth('/api/reports'),
      ]);
      if (!teamRes.ok || !jobsRes.ok) throw new Error();
      const teamPayload = (await teamRes.json()) as TeamApiResponse;
      const jobsPayload = (await jobsRes.json()) as { jobs: OfficeJob[] };
      const reportsPayload = reportsRes.ok
        ? ((await reportsRes.json()) as { reports?: MemberReport[] })
        : { reports: memberReports };
      devices = teamPayload.devices || [];
      workflow = teamPayload.workflow || null;
      jobs = jobsPayload.jobs || [];
      memberReports = reportsPayload.reports || [];
      backendReady = true;
      redrawAllDesks();
      drawTeamDashboard();
    } catch {
      backendReady = false;
      drawTeamDashboard();
    }
  }

  async function refreshJobs() {
    try {
      const [r, repRes] = await Promise.all([
        fetchWithAuth('/api/jobs'),
        fetchWithAuth('/api/reports'),
      ]);
      if (!r.ok) throw new Error();
      const payload = (await r.json()) as { jobs: OfficeJob[] };
      jobs = payload.jobs || [];
      if (repRes.ok) {
        const repPayload = (await repRes.json()) as { reports?: MemberReport[] };
        memberReports = repPayload.reports || [];
      }
      backendReady = true;
      redrawAllDesks();
      drawTeamDashboard();
    } catch {
      backendReady = false;
      drawTeamDashboard();
    }
  }

  async function refreshDashboardData() {
    try {
      const r = await fetchWithAuth('/api/dashboard');
      if (r.ok) {
        const data = (await r.json()) as DashboardData;
        wallDashboard.update(data, jobs, devices, workflow, scheduleNotice);
      }
    } catch {
      // keep existing snapshot
    }
  }

  async function sendReportToNghiaFromJob(job: OfficeJob) {
    if (!backendReady) {
      composeError = 'Chưa kết nối máy chủ, chưa gửi được báo cáo.';
      screenDraw(9);
      return;
    }
    ownerInbox?.setPending(job.id);
    composeError = '';
    try {
      const r = await fetchWithAuth('/api/reports', {
        method: 'POST',
        body: JSON.stringify({
          recipientEmail: 'trongnghia@pmh.com.vn',
          sourceJobId: job.id,
          title: job.plan?.summary || job.planSummary || job.request.slice(0, 120),
          content: reportDisplayText(job),
        }),
      });
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(data.error || 'Chưa gửi được sang bàn Nghĩa.');
      nghiaReportIdx = 0;
      await refreshJobs();
      composeError = 'Đã gửi báo cáo tới bàn Nghĩa ở góc trái.';
      window.setTimeout(() => {
        if (!disposed && composeError.startsWith('Đã gửi báo cáo')) {
          composeError = '';
          screenDraw(9);
        }
      }, 4500);
    } catch (e) {
      composeError = `Chưa gửi được: ${e instanceof Error ? e.message : 'Lỗi gửi báo cáo'}`;
    } finally {
      ownerInbox?.setPending(null);
      screenDraw(9);
    }
  }

  async function acknowledgeCurrentNghiaReport() {
    const rep = memberReports[nghiaReportIdx % Math.max(1, memberReports.length)];
    if (!rep) return;
    try {
      const r = await fetchWithAuth(`/api/reports/${rep.id}/ack`, {
        method: 'POST',
        body: '{}',
      });
      if (r.ok) {
        await refreshJobs();
      }
    } catch {
      // ignore transient
    }
  }

  async function submitTask(i: number, text: string) {
    const a = agentsBySeat[i];
    if (!a || !text.trim()) return;
    try {
      if (!backendReady) {
        throw new Error('Chưa kết nối máy chủ CN8-2.');
      }
      if (a.isHumanMember && isOwner) {
        const clean = text.trim();
        const firstLine = clean.split('\n')[0].slice(0, 120);
        const r = await fetchWithAuth('/api/reports', {
          method: 'POST',
          body: JSON.stringify({
            recipientEmail: 'trongnghia@pmh.com.vn',
            title: firstLine,
            content: clean,
          }),
        });
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        if (!r.ok) throw new Error(data.error || 'Chưa gửi được báo cáo tới Nghĩa.');
        composeError = '';
        resultPage = 0;
        nghiaReportIdx = 0;
        await refreshJobs();
        screenDraw(i);
        return;
      }

      const j = agentJob(a);
      const reply = j?.status === 'waiting_input' && !j.ownerClosedAt;
      const targetId = !isOwner ? 'linh' : a.isOwner || a.isHumanMember ? 'linh' : a.id;
      const r = await fetchWithAuth(reply ? `/api/jobs/${j!.id}/reply` : '/api/jobs', {
        method: 'POST',
        body: JSON.stringify(
          reply ? { answer: text } : { request: text, agent: targetId },
        ),
      });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(data.error || 'Chưa ghi nhận được yêu cầu.');
      composeError = '';
      resultPage = 0;
      await refreshJobs();
    } catch (e) {
      composeError = `Chưa gửi được: ${e instanceof Error ? e.message : 'Lỗi không xác định'}`;
    }
    screenDraw(i);
  }

  async function setReportDone(id: string, done: boolean) {
    if (!backendReady) {
      composeError = 'Chưa kết nối máy chủ, chưa lưu thay đổi.';
      screenDraw(9);
      return;
    }
    ownerInbox?.setPending(id);
    composeError = '';
    try {
      const r = await fetchWithAuth(`/api/jobs/${id}/done`, {
        method: 'POST',
        body: JSON.stringify({ done }),
      });
      const data = (await r.json()) as { job?: OfficeJob; error?: string };
      if (!r.ok || !data.job) throw new Error(data.error || 'Chưa lưu được.');
      jobs = jobs.map((j) => (j.id === id ? data.job! : j));
      await refreshJobs();
    } catch (e) {
      composeError = `Chưa lưu được: ${e instanceof Error ? e.message : 'Lỗi lưu trạng thái'}`;
    } finally {
      ownerInbox?.setPending(null);
      screenDraw(9);
    }
  }

  async function retryReport(id: string) {
    if (!backendReady) {
      composeError = 'Chưa kết nối máy chủ, chưa chạy lại được.';
      screenDraw(9);
      return;
    }
    ownerInbox?.setPending(id);
    composeError = '';
    try {
      const r = await fetchWithAuth(`/api/jobs/${id}/retry`, {
        method: 'POST',
        body: JSON.stringify({ note: '' }),
      });
      const data = (await r.json()) as { job?: OfficeJob; error?: string };
      if (!r.ok || !data.job) throw new Error(data.error || 'Chưa chạy lại được.');
      await refreshJobs();
    } catch (e) {
      composeError = `Chưa chạy lại được: ${e instanceof Error ? e.message : 'Lỗi không xác định'}`;
    } finally {
      ownerInbox?.setPending(null);
      screenDraw(9);
    }
  }

  async function toggleSchedule(nextEnabled: boolean) {
    scheduleNotice = null;
    try {
      const r = await fetchWithAuth('/api/workflows/schedule', {
        method: 'POST',
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const data = (await r.json()) as { workflow?: WorkflowScheduleState; error?: string };
      if (!r.ok || !data.workflow) {
        throw new Error(data.error || 'Chưa đổi được trạng thái lịch 21:00.');
      }
      workflow = data.workflow;
      drawTeamDashboard();
    } catch (e) {
      scheduleNotice = e instanceof Error ? e.message : 'Chưa đổi được lịch 21:00.';
      drawTeamDashboard();
      window.setTimeout(() => {
        if (!disposed) {
          scheduleNotice = null;
          drawTeamDashboard();
        }
      }, 6000);
    }
  }

  // Build 11 workstations (0..8 grid, 9 = Duc top-right, 10 = Nghia top-left corner)
  for (let i = 0; i < 11; i++) {
    const g = new THREE.Group();
    g.scale.set(0.76, 0.9, 0.78);
    if (i === 9) {
      g.position.set(6.4, 0, -3.7);
      g.rotation.y = Math.PI;
    } else if (i === 10) {
      g.position.set(-6.4, 0, -3.7);
      g.rotation.y = Math.PI;
    } else {
      g.position.set(-4.6 + (i % 3) * 3.5, 0, -0.9 + Math.floor(i / 3) * 3.15);
    }
    scene.add(g);

    const top = action(box(g, 2.7, 0.13, 1.4, 0, 1.48, 0, '#d5bc91'), 'desk', i);
    for (const x of [-1.1, 1.1]) {
      box(g, 0.07, 1.4, 0.95, x, 0.72, 0, '#50565e');
      box(g, 0.16, 0.05, 1.05, x, 0.06, 0, '#424951');
    }
    box(g, 2.2, 0.055, 0.055, 0, 0.7, -0.5, '#50565e');
    box(g, 0.68, 0.05, 0.42, 0, 1.59, -0.27, '#464d56');
    cyl(g, 0.055, 0.055, 0.4, 0, 1.8, -0.46, '#505862');
    action(box(g, 1.25, 0.82, 0.09, 0, 2.15, -0.37, '#353c45'), 'desk', i);

    const tex = texture(1024, 640, () => {});
    const pc = action(plane(g, 1.15, 0.72, 0, 2.15, -0.32, tex.texture), 'screen', i);

    // Keyboard, mouse, notepad, coffee mug
    box(g, 0.9, 0.035, 0.3, -0.1, 1.56, 0.27, '#96999e');
    for (let k = 0; k < 5; k++) {
      box(g, 0.77, 0.008, 0.012, -0.1, 1.585, 0.16 + k * 0.045, '#c0c2c5');
    }
    const mouse = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), mat('#767d87'));
    mouse.scale.set(1, 0.4, 1.4);
    mouse.position.set(0.62, 1.57, 0.28);
    g.add(mouse);
    box(g, 0.35, 0.025, 0.44, -0.94, 1.57, 0.18, '#f4edda');
    box(g, 0.015, 0.015, 0.3, -0.8, 1.59, 0.2, '#947d58');
    cyl(g, 0.1, 0.075, 0.18, 0.98, 1.65, -0.18, '#e7e1cc');

    // Swivel chair
    const chair = new THREE.Group();
    chair.position.set(0, 0, 1.12);
    g.add(chair);
    box(chair, 0.84, 0.12, 0.72, 0, 0.83, 0, '#9d978f');
    box(chair, 0.88, 0.7, 0.1, 0, 1.25, 0.33, '#aaa49b');
    box(chair, 0.7, 0.44, 0.025, 0, 1.27, 0.27, '#bbb5aa');
    cyl(chair, 0.055, 0.055, 0.6, 0, 0.47, 0, '#555a62');
    for (let k = 0; k < 5; k++) {
      const a = (k * Math.PI * 2) / 5;
      const leg = box(
        chair,
        0.045,
        0.035,
        0.49,
        Math.sin(a) * 0.22,
        0.18,
        Math.cos(a) * 0.22,
        '#555a62',
      );
      leg.rotation.y = a;
      cyl(chair, 0.06, 0.06, 0.08, Math.sin(a) * 0.46, 0.105, Math.cos(a) * 0.46, '#3d434b');
    }

    const plate = action(
      label(
        g,
        agentsBySeat[i]
          ? `${agentsBySeat[i].name}  /  ${agentsBySeat[i].isHumanMember ? 'QUẢN LÝ DỰ ÁN' : agentsBySeat[i].role}`
          : `${String(i + 1).padStart(2, '0')} / VỊ TRÍ TRỐNG`,
        i === 9 ? 1.65 : 1.3,
        0.2,
        0.38,
        1.45,
        0.716,
        '#8e7957',
        '#f9f1d8',
        65,
      ),
      'desk',
      i,
    );

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1.02, 64),
      new THREE.MeshBasicMaterial({
        color: '#b78346',
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.045, 0.3);
    ring.visible = false;
    g.add(ring);

    if (i === 9 || i === 10) {
      const badge = label(
        g,
        i === 9 ? 'ĐỨC  /  THÀNH VIÊN QUẢN LÝ DỰ ÁN' : 'NGHĨA  /  QUẢN LÝ DỰ ÁN',
        i === 9 ? 1.65 : 1.35,
        0.2,
        0,
        1.45,
        -0.716,
        i === 9 ? '#8e7957' : '#5b7c6f',
        '#f9f1d8',
        65,
      );
      badge.rotation.y = Math.PI;
    }

    const member = agentsBySeat[i];
    const avatar = member ? createOfficeAvatar(g, member) : null;
    const tag = member ? addPersonTag(g, member) : null;

    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o !== ring && !o.userData.action) {
        action(o, 'desk', i);
      }
    });

    desks.push({ group: g, tex, screen: pc, top, ring, plate, tag, avatar });
    if (member?.isOwner) {
      ownerInbox = createOwnerInbox(tex, {
        isOwner,
        onToggle: (id, done) => void setReportDone(id, done),
        onRetry: (id) => void retryReport(id),
        onAssign: (job) => onAssignJob?.(job),
        onSendToNghia: (job) => void sendReportToNghiaFromJob(job),
        onCompose: () => {
          editing = true;
          composeError = '';
          inputEl.value = '';
          inputEl.focus({ preventScroll: true });
          screenDraw(i, true);
        },
      });
    }
    screenDraw(i);
  }

  officeLife = createOfficeLife(scene, desks, roster, personStatus, NGHIA_MEMBER);

  box(scene, 2.35, 0.44, 0.08, 0, 0.33, 9.75, '#555c66');
  const returnSign = action(
    label(scene, 'TOÀN CẢNH  ↗', 2.25, 0.34, 0, 0.33, 9.81, '#555c66', '#f7f1d9', 75),
    'home',
  );
  const hint = label(
    scene,
    'Chạm một vị trí để làm việc   ·   Chạm ra ngoài hoặc Esc để trở về',
    8,
    0.25,
    0,
    0.05,
    9.1,
    '#d9c5a6',
    '#6c655b',
    32,
  );
  hint.rotation.x = -Math.PI / 2;

  let transition: {
    from: THREE.Vector3;
    to: THREE.Vector3;
    fromT: THREE.Vector3;
    toT: THREE.Vector3;
    start: number;
  } | null = null;

  function fly(to: THREE.Vector3, toT: THREE.Vector3) {
    transition = {
      from: camera.position.clone(),
      to,
      fromT: controlsTarget.clone(),
      toT,
      start: performance.now(),
    };
  }

  function stopEdit(save = false) {
    if (!editing) return;
    const i = selected;
    if (save && agentsBySeat[i]) {
      editing = false;
      inputEl.blur();
      void submitTask(i, inputEl.value);
      screenDraw(i);
      return;
    }
    if (save && i >= 0) {
      const s = inputEl.value.trim();
      if (s) names[i] = s;
      else delete names[i];
      try {
        localStorage.setItem('cn82-office-desk-names', JSON.stringify(names));
      } catch {
        // ignore storage quota errors
      }
    }
    editing = false;
    inputEl.blur();
    if (i >= 0) screenDraw(i);
  }

  function home() {
    stopEdit();
    selected = -1;
    dashZoom = false;
    wallDashboard.reset();
    desks.forEach((d) => {
      d.ring.visible = false;
    });
    fly(homePos(), homeTarget.clone());
  }

  function select(i: number) {
    stopEdit();
    composeError = '';
    resultPage = 0;
    selected = i;
    dashZoom = false;
    desks.forEach((d, j) => {
      d.ring.visible = j === i;
    });
    const g = desks[i].group;
    g.updateMatrixWorld(true);
    fly(
      g.localToWorld(new THREE.Vector3(0, 2.45, camera.aspect < 1 ? 1.9 : 0.95)),
      g.localToWorld(new THREE.Vector3(0, 2.15, -0.32)),
    );
  }

  function interact(a: { action?: string; index?: number; hitUV?: { x: number; y: number } | null }) {
    if (a.action === 'home') return home();
    if (a.action === 'light') {
      night = !night;
      hemi.intensity = night ? 0.65 : 2.2;
      sun.intensity = night ? 0.4 : 3.5;
      (scene.background as THREE.Color).set(night ? '#85978d' : '#e8e7de');
      return;
    }
    if (a.action === 'dashboard') {
      stopEdit();
      if (dashZoom) {
        const result = wallDashboard.click(a.hitUV || { x: 0.5, y: 0.5 });
        if (result?.url) window.open(result.url, '_blank', 'noopener,noreferrer');
        return;
      }
      dashZoom = true;
      selected = -1;
      desks.forEach((d) => {
        d.ring.visible = false;
      });
      fly(new THREE.Vector3(0, 7.25, 4.5), new THREE.Vector3(0, 7.25, -6.3));
      return;
    }
    if (a.action === 'screen' && selected === a.index && !transition) {
      const agent = agentsBySeat[selected];
      if (agent) {
        const uv = a.hitUV || { x: 0.1, y: 0.05 };
        if (agent.isOwner && !editing) {
          ownerInbox?.click(uv);
          return;
        }
        if (agent.isHumanMember) {
          if (uv.y < 0.14 && uv.x <= 0.32) {
            if (!isOwner && memberReports.length > 0) {
              void acknowledgeCurrentNghiaReport();
              return;
            }
            editing = true;
            composeError = '';
            inputEl.value = '';
            inputEl.focus({ preventScroll: true });
            screenDraw(selected, true);
            return;
          }
          if (uv.y < 0.14 && uv.x > 0.32 && uv.x <= 0.67) {
            stopEdit();
            if (memberReports.length > 1) {
              nghiaReportIdx = (nghiaReportIdx + 1) % memberReports.length;
              resultPage = 0;
              screenDraw(selected);
            } else {
              void refreshJobs();
            }
            return;
          }
          if (uv.y < 0.14 && uv.x > 0.67) {
            stopEdit();
            resultPage++;
            screenDraw(selected);
            return;
          }
          if (uv.y >= 0.14 && memberReports.length > 0) {
            resultPage++;
            screenDraw(selected);
            return;
          }
        }
        if (uv.y < 0.14 && uv.x > 0.32) {
          stopEdit();
          resultPage = uv.x > 0.67 ? resultPage + 1 : 0;
          screenDraw(selected);
          return;
        }
        const j = agentJob(agent);
        if (uv.y >= 0.14 && j) {
          resultPage++;
          screenDraw(selected);
          return;
        }
      }
      editing = true;
      composeError = '';
      inputEl.value = agent ? '' : names[selected] || '';
      inputEl.focus({ preventScroll: true });
      screenDraw(selected, true);
      return;
    }
    if (typeof a.index === 'number') select(a.index);
  }

  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function hit(e: PointerEvent): THREE.Object3D | null {
    pointer.set(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1,
    );
    ray.setFromCamera(pointer, camera);
    for (const h of ray.intersectObjects(scene.children, true)) {
      if (!h.object.visible) continue;
      if (h.object.userData.action) {
        h.object.userData.hitUV = h.uv ? { x: h.uv.x, y: h.uv.y } : null;
        return h.object;
      }
      const material = (h.object as THREE.Mesh).material as THREE.Material | undefined;
      if (material?.transparent || h.object === hint) continue;
      return null;
    }
    return null;
  }

  let down: { x: number; y: number } | null = null;
  let lastHoverCheck = 0;

  const onInput = () => {
    if (editing && selected >= 0) screenDraw(selected, true);
  };
  const onInputKeyDown = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      stopEdit(true);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      stopEdit();
    }
  };
  const onWindowKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') home();
  };
  const onPointerDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && !transition) {
      const m = hit(e);
      if (m) interact(m.userData);
      else if (selected >= 0 || dashZoom) home();
    }
    down = null;
  };
  const onPointerMove = (e: PointerEvent) => {
    if (transition) return;
    const now = performance.now();
    if (now - lastHoverCheck < 40) return;
    lastHoverCheck = now;
    const m = hit(e);
    renderer.domElement.style.cursor = m ? 'pointer' : 'default';
    if (dashZoom) {
      wallDashboard.hover(
        m?.userData.action === 'dashboard' ? m.userData.hitUV : { x: -1, y: -1 },
      );
    }
  };
  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (selected < 0 && !dashZoom) {
      transition = null;
      camera.position.copy(homePos());
      controlsTarget.copy(homeTarget);
      camera.lookAt(controlsTarget);
    } else if (selected >= 0) {
      select(selected);
    }
  };
  const onContextLost = (e: Event) => {
    e.preventDefault();
    contextLost = true;
    onError('Kết nối đồ họa 3D tạm bị gián đoạn. Vui lòng tải lại trang.');
  };
  const onContextRestored = () => {
    contextLost = false;
  };

  inputEl.addEventListener('input', onInput);
  inputEl.addEventListener('keydown', onInputKeyDown);
  window.addEventListener('keydown', onWindowKeyDown);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);
  window.addEventListener('resize', onResize);

  if (!isSoftwareGl) {
    renderer.compile(scene, camera);
  }

  function afterDraw(cb: () => void) {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    if (!gl?.fenceSync) {
      frameId = window.setTimeout(cb, 80);
      return;
    }
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        frameId = window.setTimeout(cb, 80);
      }
    };
    frameId = window.setTimeout(poll, 5);
  }

  function animate() {
    if (disposed) return;
    if (!contextLost) {
      if (transition) {
        const t = Math.min(1, (performance.now() - transition.start) / 950);
        const s = t * t * (3 - 2 * t);
        camera.position.lerpVectors(transition.from, transition.to, s);
        controlsTarget.lerpVectors(transition.fromT, transition.toT, s);
        if (t === 1) transition = null;
      }
      officeLife?.tick(performance.now() / 1000, selected < 0 && !dashZoom);
      camera.lookAt(controlsTarget);
      renderer.render(scene, camera);
    }
    if (isSoftwareGl) afterDraw(animate);
    else frameId = requestAnimationFrame(animate);
  }

  animate();
  drawTeamDashboard();
  onReady();

  // Initial load + realtime SSE & Firestore listeners
  onRegisterActions?.({ refresh: refreshTeamAndJobs });
  void refreshTeamAndJobs();
  void refreshDashboardData();

  let eventSource: EventSource | null = null;
  const firestoreUnsubs: Array<() => void> = [];

  void (async () => {
    try {
      const token = await getIdToken();
      if (disposed) return;
      eventSource = new EventSource(`/api/stream?token=${encodeURIComponent(token)}`);
      eventSource.addEventListener('update', () => {
        if (!disposed) void refreshTeamAndJobs();
      });
    } catch {
      // fallback to polling timer below
    }
  })();

  const currentUid = auth.currentUser?.uid;
  if (currentUid) {
    try {
      const jobsQuery = query(
        collection(db, 'jobs'),
        where('allowedUids', 'array-contains', currentUid),
      );
      firestoreUnsubs.push(
        onSnapshot(
          jobsQuery,
          (snap) => {
            if (disposed || snap.empty) return;
            void refreshJobs();
          },
          (err) => {
            try {
              handleFirestoreError(err, OperationType.LIST, 'jobs');
            } catch {
              // handled in log; keep SSE/API sync active
            }
          },
        ),
      );
      const reportsQuery = query(
        collection(db, 'memberReports'),
        where('allowedUids', 'array-contains', currentUid),
      );
      firestoreUnsubs.push(
        onSnapshot(
          reportsQuery,
          (snap) => {
            if (disposed || snap.empty) return;
            void refreshJobs();
          },
          (err) => {
            try {
              handleFirestoreError(err, OperationType.LIST, 'memberReports');
            } catch {
              // handled in log; keep SSE/API sync active
            }
          },
        ),
      );
      const devicesQuery = query(
        collection(db, 'devices'),
        where('allowedUids', 'array-contains', currentUid),
      );
      firestoreUnsubs.push(
        onSnapshot(
          devicesQuery,
          (snap) => {
            if (disposed || snap.empty) return;
            void refreshTeamAndJobs();
          },
          (err) => {
            try {
              handleFirestoreError(err, OperationType.LIST, 'devices');
            } catch {
              // handled in log; keep SSE/API sync active
            }
          },
        ),
      );
    } catch {
      // fallback to SSE & polling
    }
  }

  const jobsTimer = window.setInterval(() => void refreshTeamAndJobs(), 8000);
  const dashTimer = window.setInterval(() => void refreshDashboardData(), 30000);

  const _projVec = new THREE.Vector3();
  window.office3D = {
    get activities() {
      return officeLife?.activities || [];
    },
    get agentCount() {
      return roster.agents.length;
    },
    get deskCount() {
      return desks.length;
    },
    get selected() {
      return selected;
    },
    get editing() {
      return editing;
    },
    get dashboardFocused() {
      return dashZoom;
    },
    get cameraPosition() {
      return camera.position.toArray();
    },
    get names() {
      return { ...names };
    },
    get backendReady() {
      return backendReady;
    },
    get jobs() {
      return jobs;
    },
    get agents() {
      return roster.agents;
    },
    get devices() {
      return devices;
    },
    point(kind, i = 0) {
      const m =
        kind === 'screen' || kind === 'compose'
          ? desks[i].screen
          : kind === 'desk'
            ? desks[i].top
            : kind === 'home'
              ? returnSign
              : dash;
      if (kind === 'compose') {
        _projVec.set(-0.38, -0.3, 0);
        m.localToWorld(_projVec);
      } else if (kind === 'avatar' && desks[i]?.avatar) {
        _projVec.set(0, 1.81, 0);
        desks[i].avatar!.person.localToWorld(_projVec);
      } else {
        m.getWorldPosition(_projVec);
      }
      _projVec.project(camera);
      return {
        x: ((_projVec.x + 1) * window.innerWidth) / 2,
        y: ((1 - _projVec.y) * window.innerHeight) / 2,
      };
    },
  };

  return () => {
    disposed = true;
    cancelAnimationFrame(frameId);
    clearTimeout(frameId);
    clearInterval(jobsTimer);
    clearInterval(dashTimer);
    eventSource?.close();
    firestoreUnsubs.forEach((u) => u());

    inputEl.removeEventListener('input', onInput);
    inputEl.removeEventListener('keydown', onInputKeyDown);
    window.removeEventListener('keydown', onWindowKeyDown);
    renderer.domElement.removeEventListener('pointerdown', onPointerDown);
    renderer.domElement.removeEventListener('pointerup', onPointerUp);
    renderer.domElement.removeEventListener('pointermove', onPointerMove);
    renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
    renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
    window.removeEventListener('resize', onResize);

    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const m = mesh.material;
      if (Array.isArray(m)) {
        m.forEach((matItem) => matItem.dispose());
      } else if (m) {
        m.dispose();
      }
    });
    envTex.dispose();
    renderer.dispose();
    if (renderer.domElement.parentElement === container) {
      container.removeChild(renderer.domElement);
    }
    delete window.office3D;
  };
}
