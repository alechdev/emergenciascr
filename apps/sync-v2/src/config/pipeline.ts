import { db } from "@bomberoscr/db/index";
import { createReferenceResolver } from "@bomberoscr/sync-domain/pipeline";

import { sigae } from "@/config/sigae";

/** One per process: it remembers recent misses so they aren't fetched on every poll. */
export const referenceResolver = createReferenceResolver({ db, sigae });
