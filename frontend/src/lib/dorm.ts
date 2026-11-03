import type { AppState, Student } from '../types.js';

export interface DormEvent {
  room: string;
  date: string;
  /** 这次事件的备注；同一天不同备注视为不同事件 */
  reason: string;
  /** 参与这次违纪的学生（可能已调出该寝室，界面会标注） */
  members: Student[];
}

export interface DormStat {
  room: string;
  members: Student[];
  /** 寝室违纪“事件”次数（整间同一天同一次只算 1 次） */
  incidents: number;
  lastDate: string;
  events: DormEvent[];
}

export interface DormOverview {
  rooms: DormStat[];
  totalRooms: number;
  assigned: number;
  unassigned: Student[];
  incidents: number;
}

const ROOM_ALIASES = ['寝室号', '寝室', '宿舍号', '宿舍', '房间号', '房间'];
const NAME_ALIASES = ['姓名', '学生姓名', '名字', 'name'];
const ID_ALIASES = ['学号', '考号', '学生编号', 'id'];

const normalize = (value: unknown): string => String(value ?? '').trim().replace(/\s/g, '').toLowerCase();
const text = (value: unknown): string => (value == null ? '' : String(value).trim());

/** 按寝室聚合「寝室违纪」记录；没有违纪记录的寝室也列出（次数 0）。 */
export function dormOverview(state: AppState): DormOverview {
  const byRoom = new Map<string, Student[]>();
  const unassigned: Student[] = [];
  for (const student of state.students) {
    const room = (student.dorm ?? '').trim();
    if (!room) {
      unassigned.push(student);
      continue;
    }
    byRoom.set(room, [...(byRoom.get(room) ?? []), student]);
  }

  // 同一寝室 + 同一天 + 同一备注 = 同一次寝室违纪事件。
  // 优先用记录上的 room（改名/调寝后事件仍归属于原寝室）；旧数据没有 room 时按学生当前寝室兜底。
  const eventsByRoom = new Map<string, Map<string, DormEvent>>();
  for (const student of state.students) {
    for (const record of state.discipline?.[student.id] ?? []) {
      if (record.type !== '寝室违纪') continue;
      const room = (record.room ?? '').trim() || (student.dorm ?? '').trim();
      if (!room) continue;
      const key = `${record.date}|${record.reason ?? ''}`;
      const roomEvents = eventsByRoom.get(room) ?? new Map<string, DormEvent>();
      const event = roomEvents.get(key) ?? { room, date: record.date, reason: record.reason ?? '', members: [] };
      if (!event.members.some((member) => member.id === student.id)) event.members.push(student);
      roomEvents.set(key, event);
      eventsByRoom.set(room, roomEvents);
    }
  }

  // 只剩历史违纪、没有在册成员的寝室也列出来，方便清理/恢复
  const roomNames = new Set([...byRoom.keys(), ...eventsByRoom.keys()]);
  const rooms: DormStat[] = [...roomNames]
    .map((room) => {
      const members = byRoom.get(room) ?? [];
      const events = [...(eventsByRoom.get(room)?.values() ?? [])].sort((a, b) => b.date.localeCompare(a.date));
      return {
        room,
        members,
        incidents: events.length,
        lastDate: events[0]?.date ?? '',
        events,
      };
    })
    .sort((a, b) => a.room.localeCompare(b.room, 'zh-CN', { numeric: true }));

  return {
    rooms,
    totalRooms: rooms.length,
    assigned: rooms.reduce((sum, room) => sum + room.members.length, 0),
    unassigned,
    incidents: rooms.reduce((sum, room) => sum + room.incidents, 0),
  };
}

export interface ParsedDorm {
  records: Array<{ room: string; studentId: string }>;
  errors: string[];
  warnings: string[];
}

/**
 * 解析寝室名单：一行一个寝室，列为「寝室号 + 姓名」。
 * 姓名格内可用顿号/逗号/空格分隔多个学生；学号列可选（有则优先按学号匹配）。
 */
export function parseDormSheet(rows: unknown[][], students: Student[]): ParsedDorm {
  const errors: string[] = [];
  const warnings: string[] = [];
  const result: ParsedDorm = { records: [], errors, warnings };
  if (!rows || rows.length < 2) {
    errors.push('工作表没有数据，请填写寝室号与学生姓名。');
    return result;
  }
  const headers = (rows[0] ?? []).map(normalize);
  const roomCol = headers.findIndex((header) => ROOM_ALIASES.map(normalize).includes(header));
  const nameCol = headers.findIndex((header) => NAME_ALIASES.map(normalize).includes(header));
  const idCol = headers.findIndex((header) => ID_ALIASES.map(normalize).includes(header));
  if (roomCol < 0) errors.push('缺少“寝室号”列（可用：寝室号/寝室/宿舍/房间号）。');
  if (nameCol < 0 && idCol < 0) errors.push('缺少“姓名”或“学号”列。');
  if (errors.length) return result;

  const byId = new Map(students.map((student) => [student.id, student]));
  const byName = new Map<string, Student[]>();
  for (const student of students) byName.set(student.name, [...(byName.get(student.name) ?? []), student]);
  const seen = new Map<string, string>();

  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index] ?? [];
    if (row.every((cell) => text(cell) === '')) continue;
    const lineNo = index + 1;
    const room = text(row[roomCol]);
    if (!room) {
      errors.push(`第 ${lineNo} 行：缺少寝室号。`);
      continue;
    }
    if (room.length > 20) {
      errors.push(`第 ${lineNo} 行：寝室号过长。`);
      continue;
    }
    const names = nameCol >= 0 ? text(row[nameCol]).split(/[、，,;；/\s]+/).filter(Boolean) : [];
    const singleId = idCol >= 0 ? text(row[idCol]) : '';
    if (!names.length && !singleId) {
      errors.push(`第 ${lineNo} 行：缺少学生姓名或学号。`);
      continue;
    }
    const targets: Student[] = [];
    if (singleId) {
      const student = byId.get(singleId);
      if (student) targets.push(student);
      else errors.push(`第 ${lineNo} 行：学号 ${singleId} 不在名单中。`);
    }
    for (const name of names) {
      const matches = byName.get(name) ?? [];
      if (matches.length === 0) {
        errors.push(`第 ${lineNo} 行：${name} 不在名单中。`);
      } else if (matches.length > 1) {
        errors.push(`第 ${lineNo} 行：${name} 重名，请改用学号。`);
      } else {
        targets.push(matches[0]);
      }
    }
    const uniqueTargets = targets.filter((student, index) => targets.findIndex((item) => item.id === student.id) === index);
    for (const student of uniqueTargets) {
      const previous = seen.get(student.id);
      if (previous && previous !== room) {
        errors.push(`第 ${lineNo} 行：${student.name} 同时出现在 ${previous} 与 ${room}。`);
        continue;
      }
      seen.set(student.id, room);
      result.records.push({ room, studentId: student.id });
    }
  }

  if (!result.records.length && !errors.length) errors.push('没有可导入的寝室记录。');
  if (result.records.length) warnings.push(`将登记 ${result.records.length} 名学生的寝室。`);
  return result;
}


/** 取某寝室某天的全部寝室违纪记录（用于删除整次事件）。 */
export function dormEventRecords(
  state: AppState,
  room: string,
  date: string,
): Array<{ studentId: string; recordId: string }> {
  const result: Array<{ studentId: string; recordId: string }> = [];
  const target = room.trim();
  for (const student of state.students) {
    for (const record of state.discipline?.[student.id] ?? []) {
      if (record.type !== '寝室违纪' || record.date !== date) continue;
      const owned = (record.room ?? '').trim() === target;
      const legacy = !(record.room ?? '').trim() && (student.dorm ?? '').trim() === target;
      if (owned || legacy) result.push({ studentId: student.id, recordId: record.id });
    }
  }
  return result;
}

export interface DormMemberChoice {
  student: Student;
  /** 是否已经在这间寝室 */
  inRoom: boolean;
  /** 本寝室 / 来自 A302 / 未登记 */
  roomLabel: string;
}

/** 寝室编辑器里的成员候选：本寝室成员在前，未登记其次，其他寝室最后。 */
export function dormMemberChoices(state: AppState, room: string): DormMemberChoice[] {
  const target = room.trim();
  const group = (student: Student): number => {
    const dorm = (student.dorm ?? '').trim();
    if (target && dorm === target) return 0;
    return dorm ? 2 : 1;
  };
  return state.students
    .map((student) => {
      const dorm = (student.dorm ?? '').trim();
      const inRoom = Boolean(target) && dorm === target;
      return {
        student,
        inRoom,
        roomLabel: inRoom ? '本寝室' : dorm ? `来自 ${dorm}` : '未登记',
      };
    })
    .sort((a, b) => {
      const byGroup = group(a.student) - group(b.student);
      if (byGroup) return byGroup;
      const dormA = (a.student.dorm ?? '').trim();
      const dormB = (b.student.dorm ?? '').trim();
      if (dormA !== dormB) return dormA.localeCompare(dormB, 'zh-CN', { numeric: true });
      return a.student.name.localeCompare(b.student.name, 'zh-CN');
    });
}

export interface DormIncidentDraft {
  date: string;
  reason: string;
}

/** 编辑器里的违纪事件草稿：直接取自寝室现有事件（按日期倒序）。 */
export function dormIncidentDrafts(room: DormStat | undefined): DormIncidentDraft[] {
  return (room?.events ?? []).map((event) => ({ date: event.date, reason: event.reason }));
}
