import app from "@api/app";
import env from "@api/env";

const port = env.PORT;
console.log(`Server is running on port http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch
};
