import * as THREE from 'three';
import type { OfficeMember, PersonStatus, TeamRoster } from '../types/office';
import { poseOfficeAvatar, type OfficeAvatar } from './avatar';
import type { CanvasTarget } from './inbox';

export interface DeskEntry {
  group: THREE.Group;
  tex: CanvasTarget;
  screen: THREE.Mesh;
  top: THREE.Mesh;
  ring: THREE.Mesh;
  plate: THREE.Mesh;
  tag: { sprite: THREE.Sprite; tex: CanvasTarget; key: string } | null;
  avatar: OfficeAvatar | null;
}

type ActivityKind = 'dashboard' | 'window' | 'coffee' | 'plant';
type ActorState = 'seated' | 'outbound' | 'activity' | 'returning';

interface ActorRecord {
  a: OfficeMember;
  desk: DeskEntry;
  avatar: OfficeAvatar;
  person: THREE.Group;
  home: THREE.Vector3;
  name: THREE.Sprite;
  bubble: THREE.Sprite;
  cloud: CanvasTarget;
  state: ActorState;
  kind: ActivityKind | null;
  slot: number;
  route: THREE.Vector3[];
  visited: THREE.Vector3[];
  returnRoute: THREE.Vector3[];
  nextAt: number;
  activityUntil: number;
  cycle: number;
  cloudKey: string;
  homeYaw: number;
  lastStatus: PersonStatus | null;
}

export interface OfficeLifeController {
  tick: (time: number, showLabels?: boolean) => void;
  readonly activities: Array<{
    name: string;
    state: ActorState;
    activity: ActivityKind | null;
    position: number[];
  }>;
}

export function createOfficeLife(
  scene: THREE.Scene,
  desks: DeskEntry[],
  roster: TeamRoster,
  statusFor: (member: OfficeMember) => PersonStatus,
  partnerMember?: OfficeMember,
): OfficeLifeController {
  const actors: ActorRecord[] = [];
  scene.updateMatrixWorld(true);

  const makeCloud = (): CanvasTarget => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 220;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return { canvas, texture, ctx: canvas.getContext('2d')! };
  };

  for (const a of roster.agents) {
    const desk = desks[a.seat];
    const avatar = desk?.avatar;
    if (!avatar || !desk.tag) continue;
    const person = avatar.person;
    scene.attach(person);
    const home = person.position.clone();
    const name = desk.tag.sprite;
    person.add(name);
    name.position.set(0, 2.45, 0);
    name.scale.set(1.5, 0.44, 1);

    const cloud = makeCloud();
    const bubble = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: cloud.texture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    bubble.position.set(0, 3.22, 0);
    bubble.scale.set(2.8, 1.2, 1);
    bubble.userData = { action: 'desk', index: a.seat };
    person.add(bubble);

    actors.push({
      a,
      desk,
      avatar,
      person,
      home,
      name,
      bubble,
      cloud,
      state: 'seated',
      kind: null,
      slot: 0,
      route: [],
      visited: [],
      returnRoute: [],
      nextAt: performance.now() / 1000 + 4 + a.seat * 2.7,
      activityUntil: 0,
      cycle: a.seat,
      cloudKey: '',
      homeYaw: person.rotation.y,
      lastStatus: null,
    });
  }

  const owner = desks[roster.owner.seat];
  if (owner?.tag) {
    owner.tag.sprite.scale.set(1.5, 0.44, 1);
    owner.tag.sprite.position.set(0, 2.45, 1.13);
  }

  const reportBadge = makeCloud();
  const reportBubble = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: reportBadge.texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  reportBubble.position.set(0, 3.22, 1.13);
  reportBubble.scale.set(2.35, 1.0, 1);
  reportBubble.userData = { action: 'desk', index: roster.owner.seat };
  owner?.group.add(reportBubble);

  const partnerDesk = partnerMember ? desks[partnerMember.seat] : undefined;
  if (partnerDesk?.tag) {
    partnerDesk.tag.sprite.scale.set(1.5, 0.44, 1);
    partnerDesk.tag.sprite.position.set(0, 2.45, 1.13);
  }
  const partnerBadge = makeCloud();
  const partnerBubble = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: partnerBadge.texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  if (partnerMember && partnerDesk) {
    partnerBubble.position.set(0, 3.22, 1.13);
    partnerBubble.scale.set(2.35, 1.0, 1);
    partnerBubble.userData = { action: 'desk', index: partnerMember.seat };
    partnerDesk.group.add(partnerBubble);
  }

  let reportKey = '';
  function drawReportCount(
    badge: CanvasTarget,
    count: number,
    caption: string,
    prevKey: string,
  ): string {
    const key = `${count}|${caption}`;
    if (key === prevKey) return prevKey;
    const c = badge.ctx;
    c.clearRect(0, 0, 512, 220);
    c.fillStyle = '#fff8ec';
    c.strokeStyle = '#bf8c4b';
    c.lineWidth = 5;
    c.beginPath();
    c.roundRect(20, 8, 472, 188, 54);
    c.fill();
    c.stroke();
    c.beginPath();
    c.moveTo(219, 193);
    c.lineTo(244, 216);
    c.lineTo(269, 193);
    c.closePath();
    c.fill();
    c.fillStyle = '#9a692e';
    c.font = "700 94px 'Plus Jakarta Sans', 'Segoe UI', sans-serif";
    c.textAlign = 'center';
    c.fillText(String(count), 256, 105);
    c.fillStyle = '#59616d';
    c.font = "500 38px 'Plus Jakarta Sans', 'Segoe UI', sans-serif";
    c.fillText(caption, 256, 159);
    badge.texture.needsUpdate = true;
    return key;
  }
  let partnerKey = '';

  function drawName(desk: DeskEntry, a: OfficeMember, status: PersonStatus) {
    const tag = desk.tag;
    if (!tag) return;
    const attention =
      status.text === 'Cần kiểm tra' || status.text === 'Chờ máy công trường';
    const key = `${a.name}|${attention ? 'attention' : 'normal'}`;
    if (tag.key === key) return;
    tag.key = key;
    const c = tag.tex.ctx;
    const W = tag.tex.canvas.width;
    const H = tag.tex.canvas.height;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,254,250,.98)';
    c.beginPath();
    c.roundRect(4, 4, W - 8, H - 8, 35);
    c.fill();
    c.strokeStyle = attention ? '#b67363' : '#d5d1ca';
    c.lineWidth = 4;
    c.stroke();
    c.fillStyle = '#3c4654';
    c.font = "600 78px 'Plus Jakarta Sans', 'Segoe UI', sans-serif";
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(a.name, W / 2, H / 2 + 2);
    tag.tex.texture.needsUpdate = true;
  }

  function drawCloud(actor: ActorRecord, status: PersonStatus, time: number) {
    const step = Math.floor(time * 2.3);
    const key = `${status.text}|${step}`;
    if (actor.cloudKey === key) return;
    actor.cloudKey = key;
    const c = actor.cloud.ctx;
    c.clearRect(0, 0, 512, 220);
    c.fillStyle = '#fffdf8';
    c.strokeStyle = '#d8d0c5';
    c.lineWidth = 3;
    c.beginPath();
    c.roundRect(26, 24, 460, 143, 60);
    c.fill();
    c.stroke();
    for (const [x, y, r] of [
      [85, 35, 30],
      [155, 26, 26],
      [344, 25, 25],
      [414, 37, 31],
      [103, 182, 14],
      [79, 207, 7],
    ]) {
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
    for (let i = 0; i < 3; i++) {
      c.fillStyle = step % 3 === i ? '#a6783d' : '#dfd0b9';
      c.beginPath();
      c.arc(214 + i * 42, 69, 10, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = '#525d6d';
    c.font = "500 35px 'Plus Jakarta Sans', 'Segoe UI', sans-serif";
    c.textAlign = 'center';
    c.fillText(status.text, 256, 128);
    actor.cloud.texture.needsUpdate = true;
  }

  function posture(actor: ActorRecord, standing: boolean, time = 0, moving = false) {
    poseOfficeAvatar(
      actor.avatar,
      standing,
      time,
      moving,
      actor.state === 'activity' ? actor.kind : null,
    );
  }

  function prepare(actor: ActorRecord, time: number) {
    const side = actor.a.seat % 3 === 0 ? -6.7 : 4.8;
    const exit = new THREE.Vector3(actor.home.x + (side < actor.home.x ? -0.7 : 0.7), 0, actor.home.z);
    const depart = new THREE.Vector3(exit.x, 0, actor.home.z + 0.9);
    const lane = new THREE.Vector3(side, 0, depart.z);
    actor.cycle++;
    let kind: ActivityKind = 'dashboard';
    let slot = 0;
    const kinds: ActivityKind[] = ['dashboard', 'window', 'coffee', 'plant'];
    for (let offset = 0; offset < 4; offset++) {
      const candidate = kinds[(actor.cycle + offset) % 4];
      const capacity = candidate === 'dashboard' ? 8 : candidate === 'window' ? 3 : 2;
      const used = new Set(
        actors
          .filter((other) => other !== actor && other.kind === candidate && other.state !== 'seated')
          .map((other) => other.slot),
      );
      const free = Array.from({ length: capacity }, (_, i) => i).find((i) => !used.has(i));
      if (free !== undefined) {
        kind = candidate;
        slot = free;
        break;
      }
    }
    actor.slot = slot;
    const route = [exit, depart, lane];
    if (kind === 'dashboard') {
      route.push(new THREE.Vector3(side, 0, -2.3), new THREE.Vector3(-4.2 + slot * 1.2, 0, -4.2));
    } else if (kind === 'window') {
      route.push(
        new THREE.Vector3(side, 0, -2.3),
        new THREE.Vector3(-10.2, 0, -2.3),
        new THREE.Vector3(-10.2, 0, -1.5 + slot * 1.4),
      );
    } else if (kind === 'coffee') {
      route.push(
        new THREE.Vector3(side, 0, -2.3),
        new THREE.Vector3(-10.1, 0, -2.3),
        new THREE.Vector3(-10.1, 0, 2.2),
        new THREE.Vector3(-8.45 + slot * 0.7, 0, 2.2),
      );
    } else {
      route.push(
        new THREE.Vector3(side, 0, 7.3),
        new THREE.Vector3(-6.9, 0, 7.3),
        new THREE.Vector3(-7, 0, 5.0 + slot * 0.8),
      );
    }
    actor.kind = kind;
    actor.visited = [actor.home.clone()];
    actor.route = route;
    actor.returnRoute = [...route.slice(0, -1)].reverse().concat([actor.home.clone()]);
    actor.state = 'outbound';
    actor.activityUntil = time + 16;
  }

  function walk(actor: ActorRecord, dt: number, time: number): boolean {
    const target = actor.route[0];
    if (!target) return true;
    const dx = target.x - actor.person.position.x;
    const dz = target.z - actor.person.position.z;
    const distance = Math.hypot(dx, dz);
    const step = dt * 1.18;
    if (distance <= step + 0.015) {
      actor.person.position.copy(target);
      if (actor.state === 'outbound') actor.visited.push(target.clone());
      actor.route.shift();
      return !actor.route.length;
    }
    actor.person.position.x += (dx / distance) * step;
    actor.person.position.z += (dz / distance) * step;
    const desired = Math.atan2(-dx, -dz);
    const difference = Math.atan2(
      Math.sin(desired - actor.person.rotation.y),
      Math.cos(desired - actor.person.rotation.y),
    );
    actor.person.rotation.y += difference * Math.min(1, dt * 7);
    posture(actor, true, time, true);
    return false;
  }

  let last = performance.now() / 1000;

  function tick(time: number, showLabels = true) {
    const dt = Math.min(0.06, Math.max(0, time - last));
    last = time;

    for (const actor of actors) {
      const status = statusFor(actor.a);
      const busy = ['Đang phân công', 'Đang kiểm duyệt', 'Đang xử lý'].includes(status.text);
      const reserved =
        busy ||
        status.text === 'Chờ đến lượt' ||
        status.text === 'Chờ máy công trường' ||
        status.text === 'Cần kiểm tra' ||
        status.text === 'Chờ anh phản hồi' ||
        status.text === 'Chờ anh xem xét';

      actor.lastStatus = status;
      drawName(actor.desk, actor.a, status);
      actor.name.visible = showLabels;
      actor.bubble.visible = showLabels && busy;
      if (busy) drawCloud(actor, status, time);

      if (reserved && (actor.state === 'outbound' || actor.state === 'activity')) {
        actor.route =
          actor.state === 'outbound'
            ? [...actor.visited].reverse()
            : [...actor.visited.slice(0, -1)].reverse();
        actor.state = 'returning';
      }

      if (actor.state === 'seated') {
        posture(actor, false, time);
        if (!reserved && time > actor.nextAt) prepare(actor, time);
      } else if (actor.state === 'outbound') {
        if (walk(actor, dt, time)) {
          actor.state = 'activity';
          actor.activityUntil = time + 8 + (actor.a.seat % 4) * 2;
          actor.person.rotation.y =
            actor.kind === 'window'
              ? Math.PI / 2
              : actor.kind === 'coffee'
                ? 0
                : actor.kind === 'plant'
                  ? Math.PI / 2
                  : 0;
          posture(actor, true, time);
        }
      } else if (actor.state === 'activity') {
        posture(actor, true, time);
        actor.person.rotation.y += Math.sin(time * 0.7 + actor.a.seat) * dt * 0.08;
        if (time >= actor.activityUntil) {
          actor.route = [...actor.visited.slice(0, -1)].reverse();
          actor.state = 'returning';
        }
      } else if (actor.state === 'returning') {
        if (walk(actor, dt, time)) {
          actor.state = 'seated';
          actor.kind = null;
          actor.person.rotation.y = actor.homeYaw;
          actor.nextAt = time + 12 + actor.a.seat * 1.3;
          posture(actor, false, time);
        }
      }
    }

    const ownerStatus = statusFor(roster.owner);
    const count = ownerStatus.pendingCount || 0;
    reportKey = drawReportCount(reportBadge, count, 'báo cáo chờ', reportKey);
    reportBubble.visible = showLabels && count > 0;
    if (owner?.tag) {
      drawName(owner, roster.owner, ownerStatus);
      owner.tag.sprite.visible = showLabels;
    }

    if (partnerMember && partnerDesk) {
      const pStatus = statusFor(partnerMember);
      const pCount = pStatus.pendingCount || 0;
      partnerKey = drawReportCount(partnerBadge, pCount, 'báo cáo mới', partnerKey);
      partnerBubble.visible = showLabels && pCount > 0;
      if (partnerDesk.tag) {
        drawName(partnerDesk, partnerMember, pStatus);
        partnerDesk.tag.sprite.visible = showLabels;
      }
    }
  }

  return {
    tick,
    get activities() {
      return actors.map((a) => ({
        name: a.a.name,
        state: a.state,
        activity: a.kind,
        position: a.person.position.toArray(),
      }));
    },
  };
}
