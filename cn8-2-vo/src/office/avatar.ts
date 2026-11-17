import * as THREE from 'three';
import type { OfficeMember } from '../types/office';

const THIGH = 0.5;
const SHIN = 0.56;
const ANKLE = 0.13;

export interface OfficeAvatar {
  person: THREE.Group;
  body: THREE.Group;
  legs: THREE.Group[];
  knees: THREE.Group[];
  feet: THREE.Group[];
  arms: THREE.Mesh[];
  hands: THREE.Mesh[];
  head: THREE.Mesh;
  cup: THREE.Group;
  can: THREE.Group;
}

export function poseOfficeAvatar(
  v: OfficeAvatar,
  standing: boolean,
  time = 0,
  moving = false,
  activity: string | null = null,
): void {
  const lift = standing ? (moving ? 0.14 + Math.sin(time * 11.8) * 0.012 : 0.2) : 0;
  v.body.position.y = lift;

  v.legs.forEach((hip, i) => {
    let footZ = standing ? 0 : -0.45;
    let footY = ANKLE;
    let toe = 0;

    if (moving) {
      const phase = (((time * 0.94 + i * 0.5) % 1) + 1) % 1;
      const stride = 0.36;
      if (phase < 0.5) {
        footZ = -stride + 4 * stride * phase;
      } else {
        const swing = (phase - 0.5) * 2;
        const smooth = swing * swing * (3 - 2 * swing);
        footZ = stride - 2 * stride * smooth;
        footY += Math.sin(Math.PI * swing) * 0.12;
        toe = Math.sin(Math.PI * swing) * 0.12;
      }
    }

    const hipY = 0.96 + lift;
    const dy = footY - hipY;
    const dz = footZ;
    const distance = Math.min(THIGH + SHIN - 0.0001, Math.max(0.001, Math.hypot(dy, dz)));
    const along = (THIGH * THIGH - SHIN * SHIN + distance * distance) / (2 * distance);
    const bend = Math.sqrt(Math.max(0, THIGH * THIGH - along * along));
    const kneeY = hipY + (dy / distance) * along - (dz / distance) * bend;
    const kneeZ = (dz / distance) * along + (dy / distance) * bend;
    const upperAngle = Math.atan2(-kneeZ, hipY - kneeY);
    const lowerAngle = Math.atan2(-(footZ - kneeZ), kneeY - footY);

    hip.position.set(i === 0 ? -0.155 : 0.155, hipY, 0);
    hip.rotation.x = upperAngle;
    v.knees[i].rotation.x = lowerAngle - upperAngle;
    v.feet[i].rotation.x = -lowerAngle + toe;
  });

  v.arms.forEach((arm, i) => {
    arm.rotation.x = moving
      ? Math.sin(time * 5.9 + i * Math.PI) * 0.25
      : activity === 'coffee'
        ? i === 1
          ? -1.1
          : 0
        : standing
          ? 0.02
          : -0.35;
  });

  v.cup.visible = activity === 'coffee';
  v.can.visible = activity === 'plant';
  v.can.rotation.z = v.can.visible ? Math.sin(time * 0.8) * 0.12 - 0.3 : 0;
}

export function createOfficeAvatar(parent: THREE.Object3D, a: OfficeMember): OfficeAvatar {
  const person = new THREE.Group();
  person.position.set(0, 0, 1.13);
  parent.add(person);

  const body = new THREE.Group();
  person.add(body);

  const legs: THREE.Group[] = [];
  const knees: THREE.Group[] = [];
  const feet: THREE.Group[] = [];
  const arms: THREE.Mesh[] = [];
  const hands: THREE.Mesh[] = [];

  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const material = (color: string) => {
    if (!materials.has(color)) {
      materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.72 }));
    }
    return materials.get(color)!;
  };

  const box = (
    p: THREE.Object3D,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    color: string,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    p.add(mesh);
    return mesh;
  };

  const cylinder = (
    p: THREE.Object3D,
    top: number,
    bottom: number,
    h: number,
    x: number,
    y: number,
    z: number,
    color: string,
  ) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, h, 20), material(color));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    p.add(mesh);
    return mesh;
  };

  // Torso & pelvis
  box(body, 0.45, 0.51, 0.29, 0, 1.25, 0, a.color);
  box(body, 0.48, 0.12, 0.36, 0, 0.96, -0.08, a.color);

  // Articulated legs and arms
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    person.add(hip);
    legs.push(hip);
    box(hip, 0.145, THIGH, 0.17, 0, -THIGH / 2, 0, '#4e5561');

    const knee = new THREE.Group();
    knee.position.y = -THIGH;
    hip.add(knee);
    knees.push(knee);
    box(knee, 0.125, SHIN, 0.145, 0, -SHIN / 2, 0, '#4e5561');

    const foot = new THREE.Group();
    foot.position.y = -SHIN;
    knee.add(foot);
    feet.push(foot);
    box(foot, 0.18, 0.12, 0.33, 0, -0.01, -0.075, '#393f48');
    box(foot, 0.185, 0.025, 0.34, 0, -0.066, -0.075, '#292f37');

    const arm = box(body, 0.12, 0.4, 0.14, side * 0.29, 1.22, -0.08, a.color);
    arms.push(arm);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), material('#d7b18b'));
    hand.position.set(side * 0.29, 1.02, -0.16);
    body.add(hand);
    hands.push(hand);
  }

  // Neck, head, hair, accessories
  cylinder(body, 0.085, 0.085, 0.13, 0, 1.56, 0, '#d7b18b');
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 20, 16), material('#d7b18b'));
  head.scale.set(0.86, 1.12, 0.91);
  head.position.set(0, 1.81, 0);
  head.castShadow = true;
  body.add(head);

  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.216, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.62),
    material('#3d3c31'),
  );
  hair.scale.set(0.88, 1.13, 0.94);
  hair.position.copy(head.position);
  body.add(hair);

  if (a.id === 'linh' || a.id === 'my') {
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), material('#3d3c31'));
    tail.scale.set(0.7, 1.3, 0.8);
    tail.position.set(0, 1.7, 0.2);
    body.add(tail);
  }

  if (a.id === 'hung') {
    const hat = new THREE.Mesh(
      new THREE.SphereGeometry(0.235, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      material('#c6a64e'),
    );
    hat.position.set(0, 1.91, 0);
    body.add(hat);
    cylinder(body, 0.27, 0.27, 0.035, 0, 1.91, 0, '#c6a64e');
  }

  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), material('#3e4034'));
    eye.position.set(side * 0.075, 1.84, -0.174);
    body.add(eye);
  }

  // Props for idle coffee & plant-watering activities
  const cup = new THREE.Group();
  body.add(cup);
  cylinder(cup, 0.075, 0.06, 0.13, 0, 0, 0, '#e4d7b4');
  cylinder(cup, 0.062, 0.062, 0.012, 0, 0.068, 0, '#5c4735');
  cup.position.set(0.29, 1.48, -0.18);

  const can = new THREE.Group();
  can.position.set(-0.3, 1.03, -0.18);
  body.add(can);
  cylinder(can, 0.11, 0.11, 0.18, 0, 0, 0, '#9baf8b');
  box(can, 0.28, 0.035, 0.035, -0.17, 0.02, 0, '#9baf8b').rotation.z = 0.3;

  const avatar: OfficeAvatar = {
    person,
    body,
    legs,
    knees,
    feet,
    arms,
    hands,
    head,
    cup,
    can,
  };
  poseOfficeAvatar(avatar, false);
  return avatar;
}
