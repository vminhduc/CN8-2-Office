import { execFile, spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const { knowledgeInstruction } = require('./agent-knowledge.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(APP_ROOT, '.office-data', 'worker');

const ALLOWED_TASK_KINDS = new Set([
  'codex_plan',
  'codex_specialist',
  'codex_review',
  'codex_revise',
  'mail_scan',
  'sheet_lookup',
  'drive_download',
  'spm_inspect',
  'spm_transfer_approved',
]);

function loadConfig() {
  const file = process.env.CN82_WORKER_CONFIG || path.join(__dirname, 'worker.local.json');
  if (!fs.existsSync(file)) {
    throw new Error(
      `Không tìm thấy file cấu hình ${file}. Hãy sao chép worker.local.example.json thành worker.local.json và điền serverUrl, deviceId, workerToken.`,
    );
  }
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (!cfg.serverUrl || !cfg.deviceId || !cfg.workerToken) {
    throw new Error('worker.local.json thiếu serverUrl, deviceId hoặc workerToken.');
  }
  return {
    serverUrl: String(cfg.serverUrl).replace(/\/$/, ''),
    deviceId: String(cfg.deviceId),
    label: String(cfg.label || os.hostname()),
    workerToken: String(cfg.workerToken),
    codexPath: cfg.codexPath ? String(cfg.codexPath) : '',
    projectRoot: cfg.projectRoot ? String(cfg.projectRoot) : '',
    libraryRoot: cfg.libraryRoot ? String(cfg.libraryRoot) : '',
    downloadRoot: cfg.downloadRoot ? String(cfg.downloadRoot) : path.join(os.homedir(), 'Downloads', 'CHECK'),
    pollIntervalMs: Math.max(3000, Number(cfg.pollIntervalMs) || 5000),
    heartbeatIntervalMs: Math.max(5000, Number(cfg.heartbeatIntervalMs) || 15000),
  };
}

function findCodexExecutable(customPath) {
  if (customPath && fs.existsSync(customPath)) return customPath;
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(process.env.APPDATA || '', 'npm', 'codex.cmd'),
          path.join(process.env.LOCALAPPDATA || '', 'Programs', 'codex', 'codex.exe'),
          'codex.cmd',
          'codex',
        ]
      : ['codex'];
  for (const c of candidates) {
    if (c.includes(path.sep) && fs.existsSync(c)) return c;
  }
  return process.platform === 'win32' ? 'codex.cmd' : 'codex';
}

function checkCodexAvailable(codexBin) {
  return new Promise((resolve) => {
    execFile(
      codexBin,
      ['--version'],
      { windowsHide: true, timeout: 5000, shell: process.platform === 'win32' },
      (err) => resolve(!err),
    );
  });
}

function checkDesktopUnlocked() {
  if (process.platform !== 'win32') return Promise.resolve(true);
  return new Promise((resolve) => {
    execFile(
      'tasklist',
      ['/FI', 'IMAGENAME eq LogonUI.exe', '/NH'],
      { windowsHide: true, timeout: 4000 },
      (err, stdout) => {
        if (err) return resolve(true);
        // If LogonUI.exe is present, Windows workstation is locked or at sign-in screen.
        resolve(!String(stdout || '').toLowerCase().includes('logonui.exe'));
      },
    );
  });
}

async function apiRequest(cfg, route, body) {
  const res = await fetch(`${cfg.serverUrl}${route}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Worker-Device-Id': cfg.deviceId,
      Authorization: `Bearer ${cfg.workerToken}`,
    },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function runCodexStep(cfg, codexBin, task) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const outputFile = path.join(DATA_DIR, `${task.id}-${task.agentId}-${crypto.randomUUID()}.txt`);
    const mcpScript = path.join(__dirname, 'project-docs-mcp.cjs');
    const knowledge = knowledgeInstruction(task.agentId, path.join(APP_ROOT, '.office-data'));
    const fullPrompt = knowledge ? `${task.instruction}\n\n${knowledge}` : task.instruction;

    const args = [
      'exec',
      '--skip-git-repo-check',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '-c',
      'approval_policy="on-request"',
      '-c',
      'approvals_reviewer="auto_review"',
      '--model',
      task.model,
      '-c',
      `model_reasoning_effort="${task.reasoning || 'high'}"`,
      '--json',
      '--output-last-message',
      outputFile,
      '-C',
      cfg.projectRoot && fs.existsSync(cfg.projectRoot) ? cfg.projectRoot : APP_ROOT,
      '-c',
      `mcp_servers.project_docs.command=${JSON.stringify(process.execPath)}`,
      '-c',
      `mcp_servers.project_docs.args=${JSON.stringify([mcpScript])}`,
      '-c',
      'mcp_servers.project_docs.startup_timeout_sec=30',
    ];
    if (task.serviceTier) {
      args.push('-c', `service_tier="${task.serviceTier}"`);
    }
    args.push('-');

    const child = spawn(codexBin, args, {
      cwd: APP_ROOT,
      windowsHide: true,
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CN82_WORKER_CONFIG: path.join(__dirname, 'worker.local.json'),
      },
    });

    let pending = '';
    let stderr = '';
    const sourcesRead = [];
    let settled = false;
    const timeoutMs = Math.max(60_000, (task.timeoutMinutes || 20) * 60_000);
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`Quá thời gian ${task.timeoutMinutes || 20} phút; cần kiểm tra trước khi thử lại.`));
    }, timeoutMs);

    function finish(err, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
      } catch {}
      if (err) reject(err);
      else resolve(result);
    }

    child.stdout.on('data', (chunk) => {
      pending += chunk.toString();
      const lines = pending.split('\n');
      pending = lines.pop() || '';
      for (const line of lines) {
        try {
          const evt = JSON.parse(line);
          if (evt.type === 'item.completed' && evt.item?.type === 'mcp_tool_call') {
            sourcesRead.push(`${evt.item.server}.${evt.item.tool}:${evt.item.status}`);
          }
        } catch {}
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-3000);
    });

    child.on('error', (err) => {
      finish(new Error(`Không khởi động được Codex CLI trên máy: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        const sanitized = stderr.replace(/sk-[\w-]+/g, '[đã ẩn]').slice(-900);
        // Never silently swap model — report exact failure to backend
        finish(
          new Error(
            `Codex (model ${task.model}) dừng với mã ${code}: ${sanitized || 'Kiểm tra phiên đăng nhập Codex hoặc quyền model trên máy công trường.'}`,
          ),
        );
        return;
      }
      try {
        const outputText = fs.readFileSync(outputFile, 'utf8').trim();
        if (!outputText) {
          finish(new Error('Chưa nhận được nội dung trả lời từ Codex.'));
          return;
        }
        finish(null, { outputText, sourcesRead });
      } catch {
        finish(new Error('Không đọc được file kết quả cuối cùng từ Codex.'));
      }
    });

    child.stdin.on('error', () => {});
    child.stdin.end(fullPrompt);
  });
}

async function main() {
  const cfg = loadConfig();
  const codexBin = findCodexExecutable(cfg.codexPath);
  let activeTaskId = null;
  let running = true;

  const stop = () => {
    running = false;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  console.log(
    `[CN8-2 Worker] Đang kết nối outbound HTTPS tới ${cfg.serverUrl} với thiết bị ${cfg.deviceId}...`,
  );

  async function sendHeartbeat() {
    const [codexAvailable, desktopUnlocked] = await Promise.all([
      checkCodexAvailable(codexBin),
      checkDesktopUnlocked(),
    ]);
    await apiRequest(cfg, '/api/worker/heartbeat', {
      label: cfg.label,
      codexAvailable,
      desktopUnlocked,
      activeTaskId,
    });
    return { codexAvailable, desktopUnlocked };
  }

  const hbTimer = setInterval(() => {
    void sendHeartbeat().catch((err) => {
      console.error('[CN8-2 Worker] Heartbeat error:', err.message);
      if (err.status === 403) {
        console.error('[CN8-2 Worker] Thiết bị đã bị thu hồi quyền. Dừng worker.');
        running = false;
      }
    });
  }, cfg.heartbeatIntervalMs);

  try {
    while (running) {
      try {
        const status = await sendHeartbeat();
        if (!activeTaskId) {
          const { task } = await apiRequest(cfg, '/api/worker/claim', {});
          if (task) {
            if (!ALLOWED_TASK_KINDS.has(task.kind)) {
              await apiRequest(cfg, '/api/worker/fail', {
                taskId: task.id,
                error: `Loại tác vụ ${task.kind} không nằm trong danh sách cho phép.`,
                code: 'failed',
              });
              continue;
            }

            const uiTask = ['spm_inspect', 'spm_transfer_approved'].includes(task.kind);
            if (uiTask && !status.desktopUnlocked) {
              await apiRequest(cfg, '/api/worker/fail', {
                taskId: task.id,
                error: 'Màn hình Windows đang khóa; cần Đức mở khóa màn hình để thao tác giao diện.',
                code: 'desktop_locked',
              });
              continue;
            }

            if (!status.codexAvailable && task.kind.startsWith('codex_')) {
              await apiRequest(cfg, '/api/worker/fail', {
                taskId: task.id,
                error: 'Không tìm thấy hoặc chưa đăng nhập Codex CLI trên máy công trường.',
                code: 'model_unavailable',
              });
              continue;
            }

            activeTaskId = task.id;
            console.log(
              `[CN8-2 Worker] Nhận bước ${task.kind} cho ${task.agentId} (model ${task.model}, task ${task.id})`,
            );

            try {
              if (task.kind.startsWith('codex_')) {
                const result = await runCodexStep(cfg, codexBin, task);
                await apiRequest(cfg, '/api/worker/complete', {
                  taskId: task.id,
                  outputText: result.outputText,
                  modelUsed: task.model,
                  sourcesRead: result.sourcesRead,
                });
              } else {
                await apiRequest(cfg, '/api/worker/fail', {
                  taskId: task.id,
                  error: `Tác vụ ${task.kind} yêu cầu trình kết nối phiên làm việc thực tế trên máy công trường chưa được bật.`,
                  code: task.kind === 'spm_transfer_approved' ? 'needs_check' : 'failed',
                });
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Lỗi chạy Codex.';
              await apiRequest(cfg, '/api/worker/fail', {
                taskId: task.id,
                error: message,
                code: task.kind === 'spm_transfer_approved' ? 'needs_check' : 'failed',
              });
            } finally {
              activeTaskId = null;
            }
          }
        }
      } catch (err) {
        console.error('[CN8-2 Worker] Poll error:', err.message);
        if (err.status === 403) break;
      }

      await new Promise((r) => setTimeout(r, cfg.pollIntervalMs));
    }
  } finally {
    clearInterval(hbTimer);
  }
}

void main();
