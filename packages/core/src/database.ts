import type { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
type Database = Pick<
  NodePgDatabase,
  'select' | 'insert' | 'update' | 'delete' | 'transaction'
>;
export type Connection = Pool | Database;
// A Drizzle transaction uses savepoints; wrapping its PG client would commit the outer import.
export function database(connection: Connection): Database {
  return 'connect' in connection ? drizzle(connection) : connection;
}
