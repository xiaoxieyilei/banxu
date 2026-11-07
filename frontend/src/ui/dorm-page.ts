import type { AppState, Student } from '../types.js';
import type { Store } from '../store.js';
import { dormIncidentDrafts, dormMemberChoices, dormOverview, parseDormSheet } from '../lib/dorm.js';
import { readWorkbook, sheetRows } from '../lib/excel.js';
import { $, $all, esc, closeModal, confirmAction, openModal, setHTML, setText, toast } from './dom.js';
import { todayISO } from '../lib/dates.js';
import { ui } from './state.js';

export function renderDormPage(state: AppState): void {
  const query = (($('#dormSearch') as HTMLInputElement | null)?.value ?? '').trim().toLowerCase();
  const overview = dormOverview(state);
  const rooms = overview.rooms.filter((room) => room.members.some((student) => `${room.room}${student.name}${student.id}`.toLowerCase().includes(query)) || room.room.toLowerCase().includes(query));

  setText(
    '#dormSummary',
    overview.rooms.length
      ? `${overview.totalRooms} 个寝室 · ${overview.assigned} 人已登记 · 寝室违纪 ${overview.incidents} 次`
      : '还没有登记寝室',
  );

  setHTML(
    '#dormTable',
    rooms.length
      ? '<table><thead><tr><th style="width:110px">寝室</th><th style="width:80px">人数</th><th style="width:110px">寝室违纪次数</th>' +
        '<th>涉及学生</th><th style="width:120px">最近一次</th><th style="width:96px">操作</th></tr></thead><tbody>' +
        rooms
          .map((room) => {
            const students = room.members.length
              ? room.members.map((student) => esc(student.name)).join('、')
              : '<span class="disc-empty-types">暂无在册成员（仅保留历史违纪）</span>';
            const events = room.events.length
              ? room.events
                  .map(
                    (event) =>
                      `<div class="dorm-event">` +
                      `<b>${esc(event.date)}</b>` +
                      `${event.reason ? `<span class="dorm-event-reason">${esc(event.reason)}</span>` : ''}` +
                      `<span class="dorm-event-people">${event.members.length} 人（${event.members
                        .map((member) => {
                          const moved = (member.dorm ?? '').trim() !== room.room;
                          return `${esc(member.name)}${moved ? '<span class="dorm-event-moved">已调出</span>' : ''}`;
                        })
                        .join('、')}）</span>` +
                      `<button class="small danger" data-dorm-del="1" data-room="${esc(room.room)}" data-date="${esc(
                        event.date,
                      )}" data-reason="${esc(event.reason)}">撤销这次</button></div>`,
                  )
                  .join('')
              : '<span class="disc-empty-types">暂无寝室违纪</span>';
            return (
              `<tr><td><b>${esc(room.room)}</b></td><td>${room.members.length}</td>` +
              `<td>${room.incidents ? `<span class="disc-person-count">${room.incidents}</span> 次` : '—'}</td>` +
              `<td><div class="dorm-members">${students}</div><div class="dorm-detail">${events}</div></td>` +
              `<td>${esc(room.lastDate || '—')}<br><button class="small" data-dorm-add="${esc(
                room.room,
              )}" ${room.members.length ? '' : 'disabled title="暂无在册成员"'}>＋ 记一次</button></td>` +
              `<td><button class="small" data-dorm-edit="${esc(room.room)}">编辑</button></td></tr>`
            );
          })
          .join('') +
        '</tbody></table>'
      : `<div class="table-empty">${
          state.students.length
            ? query
              ? '没有匹配的寝室'
              : '还没有登记寝室<br>点右上角“添加寝室”新建一间，或用“导入寝室名单”批量登记。'
            : '还没有学生名单'
        }</div>`,
  );

  const unassigned = overview.unassigned;
  setHTML(
    '#dormUnassigned',
    unassigned.length
      ? `<div class="notice">还有 ${unassigned.length} 人未登记寝室：${unassigned
          .slice(0, 20)
          .map((student) => esc(student.name))
          .join('、')}${unassigned.length > 20 ? '…' : ''}</div>`
      : overview.rooms.length
        ? '<div class="notice">全部学生都已登记寝室。</div>'
        : '',
  );

}

/** 导入寝室名单：Excel 两列（寝室号 + 姓名），姓名可用顿号/逗号分隔多个。 */
export function openDormImport(store: Store): void {
  openModal(
    '导入寝室名单',
    '<p>Excel 第一行表头，至少包含「寝室号」与「姓名」两列（也可加「学号」列）。</p>' +
      '<p style="font-size:12px;color:var(--muted)">一行一个寝室，姓名格内可用顿号分隔多名学生，例如：<b>A301</b> ｜ 张三、李四、王五</p>' +
      '<div class="upload"><b>选择 Excel 文件</b><br><span style="font-size:12px;color:var(--muted)">支持 .xlsx / .xls / .csv</span><br>' +
      '<input id="dormFile" type="file" accept=".xlsx,.xls,.csv"></div>' +
      '<div id="dormNotice"></div><div id="dormPreview" class="preview"></div>',
    '<button data-close>取消</button><button class="primary" id="dormCommit" disabled>确认导入</button>',
  );

  let records: Array<{ room: string; studentId: string }> = [];
  const commit = $('#dormCommit') as HTMLButtonElement | null;

  ($('#dormFile') as HTMLInputElement | null)?.addEventListener('change', async (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const workbook = readWorkbook(await file.arrayBuffer());
      const sheetName =
        workbook.SheetNames.find((name) => /寝室|宿舍|dorm/i.test(name)) ?? workbook.SheetNames[0];
      const rows = sheetRows(workbook, sheetName);
      const state = store.state;
      if (!state) return;
      const parsed = parseDormSheet(rows, state.students);
      records = parsed.records;
      const notice = $('#dormNotice');
      if (notice) {
        notice.innerHTML = `<div class="notice ${parsed.errors.length ? 'error' : ''}">${esc(
          parsed.errors.length
            ? `发现 ${parsed.errors.length} 处问题：\n${parsed.errors.slice(0, 8).join('\n')}`
            : `可登记 ${parsed.records.length} 名学生的寝室。`,
        )}</div>`;
      }
      setHTML(
        '#dormPreview',
        '<table><thead><tr><th>寝室</th><th>学生</th></tr></thead><tbody>' +
          parsed.records
            .slice(0, 30)
            .map((record) => {
              const student = state.students.find((item) => item.id === record.studentId);
              return `<tr><td>${esc(record.room)}</td><td>${esc(student?.name ?? record.studentId)}</td></tr>`;
            })
            .join('') +
          '</tbody></table>',
      );
      if (commit) commit.disabled = parsed.errors.length > 0 || parsed.records.length === 0;
      input.value = '';
    } catch {
      toast('文件无法读取，请使用有效的 Excel 或 CSV 文件。');
    }
  });

  commit?.addEventListener('click', () => {
    if (!records.length) return;
    if (commit) commit.disabled = true;
    void store
      .importDorms(records)
      .then(() => {
        closeModal();
        toast(`已登记 ${records.length} 名学生的寝室`);
      })
      .catch((error: Error) => {
        toast(error.message);
        if (commit) commit.disabled = false;
      });
  });
}

export function unassignedStudents(state: AppState): Student[] {
  return state.students.filter((student) => !(student.dorm ?? '').trim());
}

/** 寝室编辑器里的一行违纪事件（日期 + 备注）。 */
function dormIncidentRow(incident: { date: string; reason: string }): string {
  return (
    '<div class="dorm-incident-row">' +
    `<input type="date" class="dorm-incident-date" value="${esc(incident.date)}" aria-label="违纪日期">` +
    `<input class="dorm-incident-reason" maxlength="300" value="${esc(incident.reason)}" ` +
    'placeholder="备注（选填，例如：熄灯后讲话）" aria-label="违纪备注">' +
    '<button class="small danger" type="button" data-remove-incident>删除</button></div>'
  );
}

/** 新增/编辑寝室：寝室号、成员与寝室违纪事件一次提交；原寝室号为空表示新增。 */
export function openDormEditor(store: Store, room: string | null): void {
  const state = store.state;
  if (!state) return;
  const editing = room !== null;
  const originalRoom = (room ?? '').trim();
  const current = dormOverview(state).rooms.find((item) => item.room === originalRoom);
  const selected = new Set((current?.members ?? []).map((member) => member.id));
  const orphan = editing && (current?.members.length ?? 0) === 0;

  const memberRows = dormMemberChoices(state, originalRoom)
    .map(({ student, inRoom, roomLabel }) => {
      const haystack = `${student.name}${student.id}${roomLabel}`.toLowerCase();
      return (
        `<label class="dorm-member-option${inRoom ? ' current' : ''}" data-search="${esc(haystack)}">` +
        `<input type="checkbox" value="${esc(student.id)}" ${selected.has(student.id) ? 'checked' : ''}>` +
        `<span class="dorm-member-name">${esc(student.name)}</span>` +
        `<span class="dorm-member-room">${esc(roomLabel)}</span></label>`
      );
    })
    .join('');

  openModal(
    editing ? `编辑寝室 · ${originalRoom}` : '添加寝室',
    `<p>${
      editing
        ? '修改寝室号、成员或寝室违纪记录，保存后立即生效；取消勾选的学生会被移出寝室，但本寝室已有的违纪记录仍归属本寝室。'
        : '填写寝室号并勾选成员，保存后即新建这间寝室；成员会从原寝室调入。'
    }</p>` +
      (orphan
        ? '<div class="notice" style="margin:0 0 14px">该寝室已没有在册成员，仅保留历史违纪记录。勾选学生可恢复该寝室；删除全部违纪记录后保存即可清除。</div>'
        : '') +
      '<div class="form-row"><div class="field"><label for="dormEditRoom">寝室号（必填）</label>' +
      `<input id="dormEditRoom" maxlength="20" value="${esc(originalRoom)}" placeholder="例如 A301"></div>` +
      '<div class="field"><label>已选成员</label><div id="dormEditCount" class="dorm-picker-summary"></div></div></div>' +
      '<div class="field"><label>寝室成员</label>' +
      '<input id="dormEditSearch" class="search" placeholder="搜索姓名或学号…" aria-label="搜索学生">' +
      `<div id="dormEditMembers" class="dorm-picker">${memberRows || '<div class="hint" style="padding:10px">还没有学生名单</div>'}</div></div>` +
      '<div class="field" style="margin-top:16px"><label>寝室违纪记录（一次事件一行，默认整间；只登记个别成员请用列表里的“＋记一次”）</label>' +
      `<div id="dormEditIncidents">${dormIncidentDrafts(current).map(dormIncidentRow).join('')}</div>` +
      '<button class="small" id="dormEditAddIncident" type="button" style="margin-top:8px">＋ 添加一次违纪</button></div>',
    `<button data-close>取消</button><button class="primary" id="dormEditSave">${editing ? '保存修改' : '添加寝室'}</button>`,
  );

  const updateCount = (): void => {
    const count = $all<HTMLInputElement>('#dormEditMembers input[type="checkbox"]').filter((input) => input.checked).length;
    setText('#dormEditCount', `已选 ${count} 人`);
  };
  updateCount();
  $('#dormEditMembers')?.addEventListener('change', updateCount);
  ($('#dormEditSearch') as HTMLInputElement | null)?.addEventListener('input', (event) => {
    const query = (event.target as HTMLInputElement).value.trim().toLowerCase();
    for (const option of $all<HTMLElement>('#dormEditMembers .dorm-member-option')) {
      option.classList.toggle('hidden', Boolean(query) && !(option.dataset.search ?? '').includes(query));
    }
  });
  $('#dormEditIncidents')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-remove-incident]');
    button?.closest('.dorm-incident-row')?.remove();
  });
  $('#dormEditAddIncident')?.addEventListener('click', () => {
    $('#dormEditIncidents')?.insertAdjacentHTML('beforeend', dormIncidentRow({ date: todayISO(), reason: '' }));
  });

  $('#dormEditSave')?.addEventListener('click', () => {
    const targetRoom = ($('#dormEditRoom') as HTMLInputElement | null)?.value.trim() ?? '';
    if (!targetRoom) {
      toast('请填写寝室号');
      return;
    }
    if (targetRoom.length > 20) {
      toast('寝室号不超过 20 个字符');
      return;
    }
    const studentIds = $all<HTMLInputElement>('#dormEditMembers input[type="checkbox"]')
      .filter((input) => input.checked)
      .map((input) => input.value);
    const incidents: Array<{ date: string; reason: string }> = [];
    let missingDate = false;
    for (const row of $all<HTMLElement>('#dormEditIncidents .dorm-incident-row')) {
      const date = (row.querySelector('.dorm-incident-date') as HTMLInputElement | null)?.value ?? '';
      const reason = (row.querySelector('.dorm-incident-reason') as HTMLInputElement | null)?.value.trim() ?? '';
      if (!date) {
        missingDate = true;
        continue;
      }
      incidents.push({ date, reason });
    }
    if (missingDate) {
      toast('请为每条寝室违纪填写日期');
      return;
    }
    if (!studentIds.length && (!orphan || incidents.length)) {
      toast(orphan ? '请先勾选成员或删除全部违纪记录' : '请至少勾选一名寝室成员');
      return;
    }
    const saveButton = $('#dormEditSave') as HTMLButtonElement | null;
    if (saveButton) saveButton.disabled = true;
    void store
      .saveDorm({ originalRoom: editing ? originalRoom : '', room: targetRoom, studentIds, incidents })
      .then(() => {
        closeModal();
        toast(editing ? '已保存寝室修改' : `已添加寝室 ${targetRoom}`);
      })
      .catch((error: Error) => {
        toast(error.message);
        if (saveButton) saveButton.disabled = false;
      });
  });
}

export function dormTabActive(): boolean {
  return ui.discTab === 'dorm';
}


/** 主动写入一次寝室违纪：默认全选当前成员，也可以只勾选个别同学。 */
export function openDormDisciplineModal(store: Store, room: string): void {
  const members = (store.state?.students ?? []).filter((student) => (student.dorm ?? '').trim() === room);
  if (!members.length) {
    toast(`寝室 ${room} 还没有登记成员`);
    return;
  }
  const memberChoices = members
    .map(
      (student) =>
        `<label class="dorm-member-option current"><input type="checkbox" value="${esc(student.id)}" checked>` +
        `<span class="dorm-member-name">${esc(student.name)}</span>` +
        `<span class="dorm-member-room">${esc(student.id)}</span></label>`,
    )
    .join('');
  openModal(
    `登记寝室违纪 · ${room}`,
    `<p>选择这次违纪实际涉及的同学。统计时同一寝室、同一天、同一备注算作 <b>1 次</b>；默认全选。</p>` +
      `<div class="form-row"><div class="field"><label for="dormDiscDate">违纪日期（必填）</label><input id="dormDiscDate" type="date" value="${todayISO()}"></div></div>` +
      '<div class="field"><label for="dormDiscReason">备注（选填）</label><input id="dormDiscReason" maxlength="200" placeholder="例如：熄灯后讲话"></div>' +
      '<div class="field"><label>涉及学生（可只选个别成员）</label>' +
      '<div class="dorm-picker" id="dormDiscMembers">' +
      memberChoices +
      '</div><div class="actions" style="margin-top:8px"><button class="small" type="button" id="dormDiscAll">全选</button>' +
      '<button class="small" type="button" id="dormDiscNone">全不选</button></div></div>',
    '<button data-close>取消</button><button class="primary" id="dormDiscSave">保存</button>',
  );
  const boxes = (): HTMLInputElement[] => $all<HTMLInputElement>('#dormDiscMembers input[type="checkbox"]');
  $('#dormDiscAll')?.addEventListener('click', () => {
    for (const box of boxes()) box.checked = true;
  });
  $('#dormDiscNone')?.addEventListener('click', () => {
    for (const box of boxes()) box.checked = false;
  });
  $('#dormDiscSave')?.addEventListener('click', () => {
    const date = ($('#dormDiscDate') as HTMLInputElement | null)?.value ?? '';
    const reason = ($('#dormDiscReason') as HTMLInputElement | null)?.value.trim() ?? '';
    const studentIds = boxes()
      .filter((box) => box.checked)
      .map((box) => box.value);
    if (!date) {
      toast('请选择违纪日期');
      return;
    }
    if (!studentIds.length) {
      toast('请至少选择一名学生');
      return;
    }
    void store
      .addDormDiscipline(room, date, reason, studentIds)
      .then(() => {
        closeModal();
        toast(`已登记 ${room} 的寝室违纪（${studentIds.length} 人）`);
      })
      .catch((error: Error) => toast(error.message));
  });
}

/** 撤销整间的一次寝室违纪（按日期 + 备注匹配该寝室所有成员）。 */
export function confirmDeleteDormEvent(store: Store, room: string, date: string, reason: string): void {
  confirmAction(
    '撤销寝室违纪',
    `将撤销 ${room} 在 ${date}${reason ? `（${reason}）` : ''} 的整次寝室违纪，该寝室每人对应的那一条记录都会删除。`,
    () => {
      void store
        .deleteDormDiscipline(room, date, reason)
        .then(() => toast('已撤销这次寝室违纪'))
        .catch((error: Error) => toast(error.message));
    },
    '撤销',
  );
}
