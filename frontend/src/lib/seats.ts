export const SEATS_PER_ROW = 8;
export const EXTRA_SEAT_IDS = ['X1', 'X2'] as const;
export const ALLOWED_ROWS = [6, 7] as const;

export type SeatId = string;

export interface SeatPosition {
  row: number;
  /** 从右向左数：最右列是 1 */
  column: number;
}

const REGULAR_SEAT_RE = /^R([1-7])C([1-8])$/;

export function regularSeatIds(rows: number): SeatId[] {
  const ids: SeatId[] = [];
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= SEATS_PER_ROW; column += 1) {
      ids.push(`R${row}C${column}`);
    }
  }
  return ids;
}

export function seatIdsFor(rows: number): SeatId[] {
  return [...regularSeatIds(rows), ...EXTRA_SEAT_IDS];
}

/** 自动填充顺序：逐排填充，中央加座插在它所在的两排之后。 */
export function fillOrderFor(rows: number, extraRow: number): SeatId[] {
  const order: SeatId[] = [];
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= SEATS_PER_ROW; column += 1) order.push(`R${row}C${column}`);
    if (row === extraRow) order.push('X1');
    if (row === extraRow + 1) order.push('X2');
  }
  return order;
}

export function capacityFor(rows: number): number {
  return rows * SEATS_PER_ROW + EXTRA_SEAT_IDS.length;
}

export function parseSeatId(seatId: SeatId): SeatPosition | null {
  const match = REGULAR_SEAT_RE.exec(seatId);
  if (!match) return null;
  return { row: Number(match[1]), column: Number(match[2]) };
}

export function isRegularSeat(seatId: SeatId): boolean {
  return REGULAR_SEAT_RE.test(seatId);
}

export function isValidSeat(seatId: SeatId, rows: number): boolean {
  if ((EXTRA_SEAT_IDS as readonly string[]).includes(seatId)) return true;
  const position = parseSeatId(seatId);
  return position !== null && position.row <= rows;
}

/** 组号：最右两列是第一组，依次向左；中央加座不属于任何组。 */
export function groupOfColumn(column: number): number {
  return 4 - Math.floor((column - 1) / 2);
}

/** 对外展示的列号：从右往左数，最右列是 1。 */
export function displayColumn(column: number): number {
  return SEATS_PER_ROW + 1 - column;
}

/** 大组轮换：第一组→第二组→第三组→第四组→第一组，排数与组内左右位置不变。 */
export function rotateSeatId(seatId: SeatId): SeatId {
  const position = parseSeatId(seatId);
  if (!position) return seatId;
  const nextColumn = position.column <= 2 ? position.column + 6 : position.column - 2;
  return `R${position.row}C${nextColumn}`;
}

export function seatLabel(seatId: SeatId, extraRow: number): string {
  if (seatId === 'X1') return `中央 ${extraRow} 排`;
  if (seatId === 'X2') return `中央 ${extraRow + 1} 排`;
  const position = parseSeatId(seatId);
  if (!position) return seatId;
  return `${position.row} 排 ${displayColumn(position.column)} 列`;
}

/** 座位角标：列-排，如最右上角为 1-1；中央加座显示“中-5”。 */
export function seatCode(seatId: SeatId, extraRow: number): string {
  if (seatId === 'X1') return `中-${extraRow}`;
  if (seatId === 'X2') return `中-${extraRow + 1}`;
  const position = parseSeatId(seatId);
  if (!position) return seatId;
  return `${displayColumn(position.column)}-${position.row}`;
}

export function seatsOfStudent(seats: Record<string, string>, studentId: string): SeatId | null {
  for (const [seatId, occupant] of Object.entries(seats)) {
    if (occupant === studentId) return seatId;
  }
  return null;
}

export function groupLabels(): Array<{ columnStart: number; columnEnd: number; label: string }> {
  return [
    { columnStart: 2, columnEnd: 4, label: '第四组' },
    { columnStart: 5, columnEnd: 7, label: '第三组' },
    { columnStart: 7, columnEnd: 8, label: '加座' },
    { columnStart: 8, columnEnd: 10, label: '第二组' },
    { columnStart: 11, columnEnd: 13, label: '第一组' },
  ];
}

/** 网格列位置：跳过“加座”占用的第 7 列。 */
export function gridColumnFor(column: number): number {
  return [2, 3, 5, 6, 8, 9, 11, 12][column - 1] ?? 2;
}
