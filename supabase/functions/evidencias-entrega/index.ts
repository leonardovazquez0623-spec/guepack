import { createClient } from "npm:@supabase/supabase-js@2.110.7";
import { createHandler } from "./handler.ts";
import { Storage } from "./service.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const auth = { persistSession: false, autoRefreshToken: false };
const boundedFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(90000) });
const admin = createClient(url, serviceKey, {
  auth,
  global: { fetch: boundedFetch },
});
Deno.serve(
  createHandler({
    admin,
    serviceKey,
    storage: new Storage(url, serviceKey),
    localTest: Deno.env.get("EVIDENCIAS_LOCAL_TEST") === "true",
    clientForToken: (token) =>
      createClient(url, anonKey, {
        auth,
        global: {
          fetch: boundedFetch,
          headers: { Authorization: `Bearer ${token}` },
        },
      }),
  }),
);
