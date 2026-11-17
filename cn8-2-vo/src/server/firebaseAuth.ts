import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { MemberRole, ProjectMember } from '../types/office.ts';

interface FirebaseConfig {
  projectId: string;
  firestoreDatabaseId: string;
}

const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
export const FIREBASE_CONFIG: FirebaseConfig = JSON.parse(
  fs.readFileSync(configPath, 'utf8'),
);

export const OWNER_EMAIL = 'minhduc@pmh.com.vn';

const CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let cachedCerts: Record<string, string> = {};
let certsExpiresAt = 0;

async function fetchPublicCerts(): Promise<Record<string, string>> {
  if (Date.now() < certsExpiresAt && Object.keys(cachedCerts).length > 0) {
    return cachedCerts;
  }
  const res = await fetch(CERTS_URL, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    throw new Error(`Không tải được chứng chỉ xác thực Firebase (${res.status}).`);
  }
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 300;
  cachedCerts = (await res.json()) as Record<string, string>;
  certsExpiresAt = Date.now() + Math.max(60, maxAgeSec) * 1000;
  return cachedCerts;
}

function base64UrlToBuffer(input: string): Buffer {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLen), 'base64');
}

export interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  idToken: string;
}

export async function verifyFirebaseIdToken(
  authHeader: string | undefined,
): Promise<VerifiedFirebaseUser> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Thiếu mã xác thực Google (Bearer token).');
  }
  const idToken = authHeader.slice(7).trim();
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Token xác thực không đúng định dạng.');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(base64UrlToBuffer(headerB64).toString('utf8')) as {
    alg?: string;
    kid?: string;
  };
  const payload = JSON.parse(base64UrlToBuffer(payloadB64).toString('utf8')) as {
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    auth_time?: number;
    email?: string;
    email_verified?: boolean;
    name?: string;
  };

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Thuật toán ký token không hợp lệ.');
  }

  const certs = await fetchPublicCerts();
  const certPem = certs[header.kid];
  if (!certPem) {
    throw new Error('Không tìm thấy chứng chỉ khóa công khai phù hợp.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  const signatureValid = verifier.verify(certPem, base64UrlToBuffer(signatureB64));
  if (!signatureValid) {
    throw new Error('Chữ ký token không hợp lệ.');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== FIREBASE_CONFIG.projectId) {
    throw new Error('Token không thuộc dự án CN8-2 Office.');
  }
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_CONFIG.projectId}`) {
    throw new Error('Nguồn phát hành token không hợp lệ.');
  }
  if (!payload.exp || payload.exp <= nowSec) {
    throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
  }
  if (!payload.sub || !/^[a-zA-Z0-9_-]{1,128}$/.test(payload.sub)) {
    throw new Error('Định danh tài khoản không hợp lệ.');
  }
  if (!payload.email || payload.email_verified !== true) {
    throw new Error('Tài khoản Google chưa xác minh email.');
  }

  return {
    uid: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: true,
    name: payload.name,
    idToken,
  };
}

export interface AuthorizedContext {
  user: VerifiedFirebaseUser;
  member: ProjectMember;
  role: MemberRole;
}
