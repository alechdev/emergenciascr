import type { Database, Transaction } from "@bomberoscr/db/client";

/** The shared database or an open transaction. */
export type Executor = Database | Transaction;
