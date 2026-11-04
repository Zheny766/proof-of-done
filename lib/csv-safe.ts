// Deal titles, names and notes are typed by anyone. A cell that starts with = + - @ (or a tab or
// carriage return) is run as a formula when an exported CSV is opened in Excel or Sheets; a leading
// apostrophe makes it plain text. Applied to every grid and dashboard value that can be exported.

export const defuseCell = <T,>(value: T): T | string => (typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value);

export const defuseRows = <T extends object>(rows: T[]): T[] => rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, defuseCell(v)])) as T);
