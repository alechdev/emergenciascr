import { client } from "@/lib/api/client.gen";

const baseUrl = import.meta.env.VITE_SERVER_URL || "/api";

client.setConfig({ baseUrl });
