import { createRouter } from "@api/lib/create-app";
import { adminAuth } from "@api/middlewares/admin-auth";
import { listHandler, listRoute, syncHandler, syncRoute } from "@api/routers/admin/incidents";
import {
  handler as syncSingleHandler,
  route as syncSingleRoute
} from "@api/routers/admin/incidents/[id]";

const router = createRouter();

router.use("/admin/*", adminAuth);

router
  .openapi(listRoute, listHandler)
  .openapi(syncRoute, syncHandler)
  .openapi(syncSingleRoute, syncSingleHandler);

export default router;
