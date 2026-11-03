import type {
  AppState,
  ClassSettings,
  DisciplineRecord,
  DisciplineSummary,
  NewExam,
  PdfExamParse,
  Student,
} from './types.js';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch (error) {
    throw new ApiError('无法连接后端服务，请确认后端已启动', 0, 'network_error');
  }
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('banxu-unauthorized'));
  }
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    let code = 'http_error';
    try {
      const body = (await response.json()) as { detail?: unknown; code?: string };
      if (typeof body.detail === 'string') {
        message = body.detail;
      } else if (Array.isArray(body.detail) && body.detail.length > 0) {
        const first = body.detail[0] as { msg?: string; loc?: unknown[] };
        message = `参数不合法：${first.msg ?? '请检查输入'}`;
        code = 'validation_error';
      }
      if (typeof body.code === 'string') code = body.code;
    } catch {
      /* 忽略非 JSON 错误体 */
    }
    throw new ApiError(message, response.status, code);
  }
  return (await response.json()) as T;
}

type Json = Record<string, unknown>;

export interface HealthInfo {
  status: string;
  version: string;
  features?: string[];
}

export const api = {
  health: (): Promise<HealthInfo> => request('/health'),

  state: (): Promise<AppState> => request('/state'),

  importRoster: (records: Student[]): Promise<AppState> =>
    request('/roster/import', { method: 'POST', body: JSON.stringify({ records }) }),

  importDorms: (records: Array<{ room: string; studentId: string }>): Promise<AppState> =>
    request('/dorms/import', { method: 'POST', body: JSON.stringify({ records }) }),

  saveDorm: (payload: {
    originalRoom: string;
    room: string;
    studentIds: string[];
    incidents: Array<{ date: string; reason: string }>;
  }): Promise<AppState> => request('/dorms/save', { method: 'POST', body: JSON.stringify(payload) }),

  createStudent: (student: Student): Promise<AppState> =>
    request('/students', { method: 'POST', body: JSON.stringify(student) }),

  updateStudent: (id: string, patch: Partial<Omit<Student, 'id'>>): Promise<AppState> =>
    request(`/students/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  deleteStudent: (id: string): Promise<AppState> =>
    request(`/students/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  createExam: (exam: NewExam): Promise<AppState> =>
    request('/exams', { method: 'POST', body: JSON.stringify(exam) }),

  /** 只让后端解析学校成绩单 PDF，不写库；确认后再调用 createExam。 */
  parsePdfExam: (fileName: string, data: string): Promise<PdfExamParse> =>
    request('/exams/pdf-parse', { method: 'POST', body: JSON.stringify({ fileName, data }) }),

  updateExam: (id: string, patch: { name?: string; date?: string }): Promise<AppState> =>
    request(`/exams/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  replaceExam: (id: string, exam: NewExam): Promise<AppState> =>
    request(`/exams/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(exam) }),

  deleteExam: (id: string): Promise<AppState> =>
    request(`/exams/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  replaceSeats: (seats: Record<string, string>): Promise<AppState> =>
    request('/seats', { method: 'PUT', body: JSON.stringify({ seats }) }),

  moveSeat: (studentId: string, target: string | null): Promise<AppState> =>
    request('/seats/move', { method: 'POST', body: JSON.stringify({ studentId, target }) }),

  rotateSeats: (): Promise<AppState> => request('/seats/rotate', { method: 'POST' }),

  clearSeats: (): Promise<AppState> => request('/seats', { method: 'DELETE' }),

  addDiscipline: (studentId: string, record: Omit<DisciplineRecord, 'id'>): Promise<AppState> =>
    request('/discipline', {
      method: 'POST',
      body: JSON.stringify({
        studentId,
        date: record.date,
        type: record.type,
        reason: record.reason,
        room: record.room ?? '',
      }),
    }),

  deleteDiscipline: (studentId: string, recordId: string): Promise<AppState> =>
    request(`/discipline/${encodeURIComponent(studentId)}/${encodeURIComponent(recordId)}`, {
      method: 'DELETE',
    }),

  addDormDiscipline: (room: string, date: string, reason = ''): Promise<AppState> =>
    request('/discipline/dorm', { method: 'POST', body: JSON.stringify({ room, date, reason }) }),

  deleteDormDiscipline: (room: string, date: string, reason = ''): Promise<AppState> =>
    request('/discipline/dorm', { method: 'DELETE', body: JSON.stringify({ room, date, reason }) }),

  importDiscipline: (
    records: Array<{ studentId: string; date: string; type: string; reason: string }>,
    skipDuplicates = false,
  ): Promise<AppState> =>
    request('/discipline/import', { method: 'POST', body: JSON.stringify({ records, skipDuplicates }) }),

  disciplineSummary: (days: number | null): Promise<DisciplineSummary> =>
    request(days ? `/discipline/summary?days=${days}` : '/discipline/summary'),

  updateSettings: (patch: Partial<ClassSettings>): Promise<AppState> =>
    request('/settings', { method: 'PATCH', body: JSON.stringify(patch) }),

  backup: (): Promise<AppState> => request('/backup'),

  exportBackupToFolder: (): Promise<{ path: string; savedAt: string; students: number; exams: number }> =>
    request('/backup/export', { method: 'POST' }),

  restore: (state: AppState): Promise<AppState> =>
    request('/backup', { method: 'POST', body: JSON.stringify({ state }) }),
};

export type { Json };
