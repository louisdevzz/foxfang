declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }

  export class StatementSync {
    run(...params: any[]): { lastInsertRowid: number; changes: number };
    get(...params: any[]): any;
    all(...params: any[]): any[];
  }
}
