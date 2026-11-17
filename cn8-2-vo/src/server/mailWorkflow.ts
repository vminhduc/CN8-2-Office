import crypto from 'crypto';

export const MAIL_WORKFLOW_RULES = {
  id: 'cn82-daily-mail-review',
  version: 1,
  name: 'Linh kiểm tra email và hồ sơ hằng ngày',
  schedule: {
    hour: 21,
    minute: 0,
    timezone: 'Asia/Ho_Chi_Minh',
    days: 'every_day',
  },
  status: 'paused_until_live_confirmed',
  projectRoot: '',
  downloadRoot: '',
  driveRootId: '',
  mailboxEmail: 'minhduc@pmh.com.vn',
  spmSenderAddresses: [] as string[],
  approvalSystemHosts: [] as string[],
  commentRule: {
    unit: 'words',
    operator: 'greater_than',
    threshold: 10,
  },
  ownerApprovedDocument: {
    enabled: true,
    authorizedByUserOn: '2026-11-16',
    reviewerName: 'Võ Minh Đức',
    role: 'Quản lý dự án',
    previewFirst: true,
    watermark: {
      text: 'CN8-2',
      page: 1,
      position: 'top_right',
      visualVerificationRequired: true,
    },
    commentSection: 'Client Comment & Approval',
    downloadToCheck: false,
  },
};

export interface MailAttachmentInput {
  localPath: string;
  sha256?: string;
  verifiedSize?: boolean;
  size?: number;
  expectedSize?: number;
}

export interface MailInput {
  id: string;
  from: string;
  senderName?: string;
  subject: string;
  receivedAt?: string;
  url?: string;
  caseId?: string;
  revision?: string;
  attachments?: MailAttachmentInput[];
  allAttachmentsDownloaded?: boolean;
  approvalHistoryExpanded?: boolean;
  allCommentsLoaded?: boolean;
  comments?: Array<{ text: string; author?: string; sourceUrl?: string; step?: string; at?: string }>;
  sheetRowVerified?: boolean;
  driveRevisionVerified?: boolean;
  ownerApproval?: {
    reviewerName?: string;
    documentIdentityVerified?: boolean;
    proofSource?: string;
    spmAlreadyHandled?: boolean;
    spmHistoryVerified?: boolean;
    pendingForReviewerVerified?: boolean;
    handledAt?: string;
    documentVersionKey?: string;
    watermark?: {
      verified?: boolean;
      page?: number;
      position?: string;
      text?: string;
    };
    comment?: {
      text?: string;
      section?: string;
      page?: number;
      belongsToReviewerVerified?: boolean;
    };
    translation?: {
      text?: string;
      sourceHash?: string;
      verified?: boolean;
    };
  };
}

function normalized(s: unknown): string {
  return String(s || '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase();
}

function senderAddress(from: unknown): string {
  const s = String(from || '').trim();
  const match = s.match(/<([^<>\s]+@[^<>\s]+)>/);
  return (match ? match[1] : s).toLowerCase();
}

export function wordCount(text: string): number {
  return String(text || '')
    .normalize('NFC')
    .trim()
    .split(/\s+/u)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function filterComments(
  comments: Array<{ text: string; author?: string; sourceUrl?: string; step?: string; at?: string }>,
) {
  if (!Array.isArray(comments)) {
    throw new Error('Chưa nhận được danh sách bình luận đầy đủ.');
  }
  return comments
    .map((c) => {
      if (typeof c.text !== 'string') {
        throw new Error('Bình luận chưa có nội dung gốc.');
      }
      return { ...c, wordCount: wordCount(c.text) };
    })
    .filter((c) => c.wordCount > 10);
}

export function classifyMail(mail: MailInput, config = MAIL_WORKFLOW_RULES) {
  if (!mail.id) throw new Error('Thiếu ID thư để chống xử lý trùng.');
  const from = senderAddress(mail.from);
  const subject = normalized(mail.subject);
  const own = normalized(config.mailboxEmail);
  const spmSubjects = /\bapproval work (notification|notice)\b/u.test(subject)
    ? 'approval_work'
    : /\bcase closing (notice|notification)\b/u.test(subject)
      ? 'case_closing'
      : null;

  if (spmSubjects) {
    const confirmed = config.spmSenderAddresses.map(normalized).includes(from);
    const hint =
      normalized(mail.senderName || mail.from).includes('de.spm') ||
      from.split('@')[0] === 'de.spm';
    if (confirmed) return { branch: spmSubjects as 'approval_work' | 'case_closing' };
    if (hint) {
      return {
        branch: spmSubjects as 'approval_work' | 'case_closing',
        blocked:
          'Cần xác minh địa chỉ người gửi de.spm đầy đủ trước khi tự động mở hệ thống.',
      };
    }
  }

  if (/hồ sơ mới (vừa )?được trình/u.test(subject)) {
    if (!own) {
      return {
        branch: 'new_submission' as const,
        blocked: 'Chưa xác nhận tài khoản Gmail của quản lý dự án.',
      };
    }
    if (from === own) return { branch: 'new_submission' as const };
  }

  return { branch: 'other_mail' as const };
}

export function fingerprint(
  mail: MailInput,
  branch: string,
  config = MAIL_WORKFLOW_RULES,
): string {
  if (!config.mailboxEmail) throw new Error('Chưa có định danh tài khoản Gmail.');
  return crypto
    .createHash('sha256')
    .update(
      [
        config.mailboxEmail.toLowerCase(),
        mail.id,
        branch,
        mail.caseId || '',
        mail.revision || '',
        ...(mail.attachments || []).map((a) => a.sha256 || '').sort(),
      ].join('\0'),
    )
    .digest('hex');
}

export function approvedDocumentPlan(mail: MailInput, config = MAIL_WORKFLOW_RULES) {
  const evidence = mail.ownerApproval;
  const policy = config.ownerApprovedDocument;
  if (!policy?.enabled || !evidence?.watermark?.verified) return null;

  const mark = evidence.watermark;
  const identity =
    normalized(evidence.reviewerName) === normalized(policy.reviewerName) &&
    evidence.documentIdentityVerified === true &&
    mark.page === 1 &&
    mark.position === 'top_right' &&
    normalized(mark.text) === 'cn8-2' &&
    typeof evidence.proofSource === 'string' &&
    evidence.proofSource.trim().length > 0;

  if (!identity) {
    return {
      status: 'needs_owner' as const,
      downloadRequired: false,
      reason: 'Chưa xác nhận đúng dấu duyệt của Võ Minh Đức, hồ sơ hoặc phiên bản.',
    };
  }

  if (evidence.spmAlreadyHandled === true && evidence.spmHistoryVerified === true) {
    return {
      status: 'already_handled' as const,
      downloadRequired: false,
      action: 'none',
      reason: 'SPM đã ghi nhận Võ Minh Đức xử lý đúng hồ sơ/phiên bản; không gửi lại.',
      handledAt: evidence.handledAt,
    };
  }

  const comment = evidence.comment;
  if (
    !comment?.text?.trim() ||
    comment.section !== 'Client Comment & Approval' ||
    comment.page !== 1 ||
    comment.belongsToReviewerVerified !== true
  ) {
    return {
      status: 'needs_owner' as const,
      downloadRequired: false,
      reason: 'Chưa xác định được nguyên văn phần nhận xét của Đức; không lấy nhầm nhận xét tư vấn.',
    };
  }

  const sourceHash = crypto.createHash('sha256').update(comment.text).digest('hex');
  const translation = evidence.translation;
  if (
    !translation?.text?.trim() ||
    translation.sourceHash !== sourceHash ||
    translation.verified !== true
  ) {
    return {
      status: 'needs_translation' as const,
      downloadRequired: false,
      sourceComment: comment.text,
      sourceHash,
      reason: 'Cần dịch và kiểm tra bản tiếng Anh trước khi điền SPM.',
    };
  }

  if (evidence.spmHistoryVerified !== true || evidence.pendingForReviewerVerified !== true) {
    return {
      status: 'needs_system_read' as const,
      downloadRequired: false,
      reason: 'Cần xác nhận hồ sơ hiện còn chờ Đức xử lý và đọc lịch sử trước khi gửi.',
    };
  }

  return {
    status: 'ready_for_approved_submission' as const,
    downloadRequired: false,
    sourceComment: comment.text,
    sourceHash,
    englishComment: translation.text,
    actions: ['fill_opinion', 'select_agree', 'send', 'verify_process_log'] as const,
    submissionKey: crypto
      .createHash('sha256')
      .update(
        [
          mail.caseId || '',
          mail.revision || '',
          evidence.documentVersionKey || '',
          sourceHash,
          translation.text,
        ].join('\0'),
      )
      .digest('hex'),
  };
}

export function planMail(mail: MailInput, config = MAIL_WORKFLOW_RULES) {
  const route = classifyMail(mail, config);
  if ('blocked' in route && route.blocked) {
    return { status: 'blocked' as const, ...route };
  }
  const branch = route.branch;
  const common = {
    branch,
    messageId: mail.id,
    subject: mail.subject,
    from: mail.from,
    receivedAt: mail.receivedAt,
    sourceUrl: mail.url,
    sourceKey: fingerprint(mail, branch, config),
    reportTo: 'duc' as const,
  };

  if (branch === 'other_mail') {
    return {
      ...common,
      status: 'ready_to_summarize' as const,
      instruction:
        'Linh tổng hợp thư này vào bản tin email mới trong ngày: người gửi, tiêu đề, nội dung chính, việc Đức cần làm, hạn được nêu rõ và link thư. Không suy diễn thời hạn, không tự trả lời người gửi hoặc mở file/link không cần thiết.',
      evidence: mail,
    };
  }

  if (!mail.caseId) {
    return {
      ...common,
      status: 'needs_resolution' as const,
      reason: 'Chưa xác định được đúng mã hồ sơ/case từ nguồn.',
    };
  }

  if (branch === 'approval_work') {
    const approved = approvedDocumentPlan(mail, config);
    if (approved) {
      return {
        ...common,
        ...approved,
        authorization:
          'User instruction 2026-11-16: transfer Duc prior document approval and comments into SPM; no new technical approval by AI.',
      };
    }
  }

  if (branch === 'case_closing') {
    if (!mail.approvalHistoryExpanded || !mail.allCommentsLoaded) {
      return {
        ...common,
        status: 'needs_system_read' as const,
        reason: 'Cần mở đầy đủ quy trình phê duyệt và bình luận.',
      };
    }
    const comments = filterComments(mail.comments || []);
    if (comments.some((c) => !c.author || !c.sourceUrl)) {
      return {
        ...common,
        status: 'blocked' as const,
        reason: 'Bình luận đạt tiêu chí còn thiếu tác giả hoặc link nguồn.',
      };
    }
    return {
      ...common,
      status: 'ready_for_review' as const,
      comments,
      commentThreshold: '>10 words',
      instruction: `My kiểm tra bằng chứng quy trình của case ${mail.caseId}; Linh giữ nguyên ${comments.length} bình luận hơn 10 từ, ghi người, nguyên văn, số từ, thời điểm, bước và nguồn. Nếu không có bình luận đạt tiêu chí, báo rõ không có trong phần quy trình đã đọc đủ. Đăng kiểm tra trước khi trình Đức.`,
    };
  }

  if (branch === 'new_submission' && (!mail.sheetRowVerified || !mail.driveRevisionVerified)) {
    return {
      ...common,
      status: 'needs_sheet_drive_match' as const,
      reason: 'Cần đối chiếu đúng dòng Sheet, mã hồ sơ và revision trong Drive.',
    };
  }

  const files = mail.attachments || [];
  if (
    !files.length ||
    !mail.allAttachmentsDownloaded ||
    files.some((f) => !f.localPath || !f.sha256 || !f.verifiedSize)
  ) {
    return {
      ...common,
      status: 'needs_download' as const,
      reason: 'Chưa tải và xác minh đủ file đính kèm của hồ sơ.',
    };
  }

  if (config.downloadRoot) {
    const root = config.downloadRoot.replaceAll('\\', '/').toLowerCase().replace(/\/$/, '') + '/';
    if (
      files.some((f) => {
        const p = f.localPath.replaceAll('\\', '/').toLowerCase();
        return !p.startsWith(root) || p.split('/').includes('..');
      })
    ) {
      return {
        ...common,
        status: 'blocked' as const,
        reason: 'File tải xuống không nằm đúng thư mục CHECK.',
      };
    }
  }

  return {
    ...common,
    status: 'ready_for_review' as const,
    attachments: files,
    instruction: `Workflow ${branch}: My xác minh danh mục và phiên bản hồ sơ ${mail.caseId}; Linh giao chuyên viên theo nội dung, Bách cho điện, nước, HVAC, PCCC và phối hợp MEPF; Tiến cho xây dựng, Hùng cho HSE, Thịnh cho khối lượng, Hòa cho hợp đồng/pháp lý. Kiểm tra kỹ với hồ sơ gốc tại ${config.projectRoot || 'thư mục dự án đã cấu hình'}, ghi nguồn và các phần thiếu. Đăng kiểm duyệt rồi trình Đức; không tự trình duyệt, phê duyệt hoặc đăng ý kiến lên hệ thống.`,
  };
}
