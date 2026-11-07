import type { AppState, ClassSettings, DisciplineRecord, NewExam, Student } from './types.js';
import { api } from './api.js';
import { todayISO } from './lib/dates.js';

export type Listener = (state: AppState) => void;

const MAX_UNDO = 30;

/**
 * 前端状态仓库：以服务端返回的完整状态为准（服务端是唯一事实来源），
 * 本地只保留最近 30 步快照供“撤销”使用。
 */
export class Store {
  state: AppState | null = null;
  private listeners = new Set<Listener>();
  private undoStack: string[] = [];
  /** 串行化所有写请求，避免连点造成的响应乱序覆盖。 */
  private queue: Promise<unknown> = Promise.resolve();

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    if (!this.state) return;
    for (const listener of this.listeners) listener(this.state);
  }

  async load(): Promise<void> {
    this.state = await api.state();
    this.emit();
  }

  /** 所有写操作都经过这里：失败时抛出 ApiError，状态保持不变。 */
  async mutate(action: () => Promise<AppState>, options: { undoable?: boolean } = {}): Promise<AppState> {
    return this.enqueue(async () => {
      const snapshot = this.state ? JSON.stringify(this.state) : null;
      const next = await action();
      if (snapshot && options.undoable !== false) {
        this.undoStack.push(snapshot);
        if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
      }
      this.state = next;
      this.emit();
      return next;
    });
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  async undo(): Promise<boolean> {
    return this.enqueue(async () => {
      const snapshot = this.undoStack[this.undoStack.length - 1];
      if (!snapshot) return false;
      // 先确认服务端恢复成功，再出栈，避免失败后丢掉这次撤销机会
      const restored = await api.restore(JSON.parse(snapshot) as AppState);
      this.undoStack.pop();
      this.state = restored;
      this.emit();
      return true;
    });
  }

  // ---- 常用写操作 ----

  importRoster(records: Student[]): Promise<AppState> {
    return this.mutate(() => api.importRoster(records));
  }

  importDorms(records: Array<{ room: string; studentId: string }>): Promise<AppState> {
    return this.mutate(() => api.importDorms(records));
  }

  /** 新增/编辑整间寝室（改名、成员、寝室违纪事件一次提交）。 */
  saveDorm(payload: {
    originalRoom: string;
    room: string;
    studentIds: string[];
    incidents: Array<{ date: string; reason: string }>;
  }): Promise<AppState> {
    return this.mutate(() => api.saveDorm(payload));
  }

  addStudent(student: Student): Promise<AppState> {
    return this.mutate(() => api.createStudent(student));
  }

  editStudent(id: string, patch: Partial<Omit<Student, 'id'>>): Promise<AppState> {
    return this.mutate(() => api.updateStudent(id, patch));
  }

  removeStudent(id: string): Promise<AppState> {
    return this.mutate(() => api.deleteStudent(id));
  }

  /** 新建考试 + 设为当前考试 + 打开成绩显示：整段放进同一个队列任务，避免并发重复建考试。 */
  async addExam(exam: NewExam): Promise<AppState> {
    return this.enqueue(async () => {
      const snapshot = this.state ? JSON.stringify(this.state) : null;
      const before = new Set((this.state?.exams ?? []).map((item) => item.id));
      let state = await api.createExam(exam);
      const created = state.exams.find((item) => !before.has(item.id));
      if (created) {
        const subject = created.subjects.includes('总分') ? '总分' : created.subjects[0] ?? '总分';
        try {
          state = await api.updateSettings({ examId: created.id, subject, showScores: true });
        } catch (error) {
          // 考试已创建但切换失败：以后端为准刷新，避免 UI 看不到这场考试
          this.state = await api.state();
          this.emit();
          throw error;
        }
      }
      if (snapshot) {
        this.undoStack.push(snapshot);
        if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
      }
      this.state = state;
      this.emit();
      return state;
    });
  }

  editExam(id: string, patch: { name?: string; date?: string; fullMarks?: Record<string, number | null> }): Promise<AppState> {
    return this.mutate(() => api.updateExam(id, patch));
  }

  replaceExam(id: string, exam: NewExam): Promise<AppState> {
    return this.mutate(() => api.replaceExam(id, exam));
  }

  removeExam(id: string): Promise<AppState> {
    return this.mutate(() => api.deleteExam(id));
  }

  moveStudent(studentId: string, target: string | null): Promise<AppState> {
    const current = this.state ? Object.keys(this.state.seats).find((seat) => this.state?.seats[seat] === studentId) ?? null : null;
    if (current === target) {
      // 拖回原位/重复下座：不产生无意义的撤销快照与请求
      return Promise.resolve(this.state as AppState);
    }
    return this.mutate(() => api.moveSeat(studentId, target));
  }

  replaceSeats(seats: Record<string, string>): Promise<AppState> {
    return this.mutate(() => api.replaceSeats(seats));
  }

  rotateSeats(): Promise<AppState> {
    return this.mutate(() => api.rotateSeats());
  }

  clearSeats(): Promise<AppState> {
    return this.mutate(() => api.clearSeats());
  }

  addDiscipline(
    studentId: string,
    type: string,
    reason: string,
    date = todayISO(),
    room = '',
  ): Promise<AppState> {
    const record: Omit<DisciplineRecord, 'id'> = { date, type, reason, room };
    return this.mutate(() => api.addDiscipline(studentId, record));
  }

  removeDiscipline(studentId: string, recordId: string): Promise<AppState> {
    return this.mutate(() => api.deleteDiscipline(studentId, recordId));
  }

  addDormDiscipline(room: string, date: string, reason = '', studentIds?: string[]): Promise<AppState> {
    return this.mutate(() => api.addDormDiscipline(room, date, reason, studentIds));
  }

  deleteDormDiscipline(room: string, date: string, reason = ''): Promise<AppState> {
    return this.mutate(() => api.deleteDormDiscipline(room, date, reason));
  }

  importDiscipline(
    records: Array<{ studentId: string; date: string; type: string; reason: string }>,
    skipDuplicates = false,
  ) {
    return this.mutate(() => api.importDiscipline(records, skipDuplicates));
  }

  updateSettings(patch: Partial<ClassSettings>): Promise<AppState> {
    return this.mutate(() => api.updateSettings(patch));
  }

  restore(state: AppState): Promise<AppState> {
    return this.mutate(() => api.restore(state));
  }
}

export const store = new Store();
