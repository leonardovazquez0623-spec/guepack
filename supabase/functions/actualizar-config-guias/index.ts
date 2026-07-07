// supabase/functions/actualizar-config-guias/index.ts
// Solo admins pueden cambiar los márgenes de guías nacionales.

import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Auth + verificación de rol admin (mismo patrón que skydropx-generar-guia)
    const authHeader = req.headers.get("Authorization");
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader ?? "" } } }
    );
    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !user) return json({ error: "No autorizado" }, 401);

    const { data: perfil } = await supabaseAdmin
      .from("usuarios")
      .select("rol")
      .eq("user_id", user.id)
      .single();
    if (perfil?.rol !== "admin") return json({ error: "Acceso restringido a administradores" }, 403);

    // Parseo y validación estricta
    const body = await req.json();
    const { margen_porcentaje, margen_fijo } = body;

    if (typeof margen_porcentaje !== "number" || margen_porcentaje < 0 || margen_porcentaje > 100) {
      return json({ error: "margen_porcentaje debe ser un número entre 0 y 100" }, 400);
    }
    if (typeof margen_fijo !== "number" || margen_fijo < 0) {
      return json({ error: "margen_fijo debe ser un número mayor o igual a 0" }, 400);
    }

    // Localiza el único row y actualiza por id
    const { data: existing, error: selectErr } = await supabaseAdmin
      .from("config_guias")
      .select("id")
      .limit(1)
      .single();
    if (selectErr || !existing) {
      return json({ error: "Fila de configuración no encontrada en config_guias" }, 404);
    }

    const { error: updateErr } = await supabaseAdmin
      .from("config_guias")
      .update({ margen_porcentaje, margen_fijo })
      .eq("id", existing.id);

    if (updateErr) return json({ error: "Error al actualizar: " + updateErr.message }, 500);

    return json({ ok: true });

  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
