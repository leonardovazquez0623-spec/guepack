import { createClient } from 'npm:@supabase/supabase-js@2.110.7';
import { esOrigenPermitido } from '../_shared/cors.ts';
import { maintenance, processBatch, rpc, Storage } from './service.ts';

const url=Deno.env.get('SUPABASE_URL')!;
const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const anonKey=Deno.env.get('SUPABASE_ANON_KEY')!;
const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
const storage=new Storage(url,serviceKey);

Deno.serve(async req => {
  const origin=req.headers.get('Origin');
  const local=Deno.env.get('EVIDENCIAS_LOCAL_TEST')==='true' && !!origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const allowed=!origin || esOrigenPermitido(origin) || local;
  const headers: Record<string,string> = {'Cache-Control':'no-store','Vary':'Origin',
    'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info',
    'Access-Control-Allow-Methods':'POST,OPTIONS',
    'Access-Control-Expose-Headers':'Content-Disposition'};
  if (origin && allowed) headers['Access-Control-Allow-Origin']=origin;
  const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...headers,'Content-Type':'application/json'}});
  if (!allowed) return json({error:'ORIGEN_NO_PERMITIDO'},403);
  if (req.method==='OPTIONS') return new Response(null,{status:204,headers});
  if (req.method!=='POST') return json({error:'METODO_INVALIDO'},405);
  try {
    const token=(req.headers.get('Authorization')||'').replace(/^Bearer /i,'');
    if (!token) return json({error:'SESION_REQUERIDA'},401);
    const body=await req.json();
    if (body.action==='maintenance') {
      if (token!==serviceKey) return json({error:'NO_AUTORIZADO'},403);
      return json(await maintenance(admin,storage));
    }
    const client=createClient(url,anonKey,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error}=await client.auth.getUser(token);
    if (error || !user || user.is_anonymous || !user.email_confirmed_at) return json({error:'SESION_INVALIDA'},401);
    const tenant=Number(body.tenant_id);
    if (!Number.isSafeInteger(tenant) || tenant<=0) return json({error:'TENANT_INVALIDO'},400);
    // Verifica membresía cliente exacta también cuando el lote ya existe.
    const summary=await rpc(admin,'evidencia_es_cliente',{p_user:user.id,p_tenant:tenant});
    if (!summary) return json({error:'NO_AUTORIZADO'},403);
    if (body.action==='status') return json(await rpc(client,'evidencia_resumen',{p_tenant:tenant}));
    if (body.action==='start') {
      if (!/^[0-9a-f-]{36}$/i.test(body.key||'')) return json({error:'CLAVE_INVALIDA'},400);
      const id=await rpc<string|null>(client,'evidencia_iniciar',{p_tenant:tenant,p_clave:body.key});
      if (id) await processBatch(admin,storage,id);
      return json({id,...await rpc<object>(client,'evidencia_resumen',{p_tenant:tenant})});
    }
    if (!['retry','download'].includes(body.action) || !/^[0-9a-f-]{36}$/i.test(body.batch_id||'')) return json({error:'ACCION_INVALIDA'},400);
    const {data:batch,error:batchError}=await admin.from('evidencia_lotes').select('*').eq('id',body.batch_id)
      .eq('user_id',user.id).eq('tenant_id',tenant).maybeSingle();
    if (batchError) throw batchError;
    if (!batch) return json({error:'LOTE_NO_DISPONIBLE'},404);
    if (body.action==='retry') {
      await processBatch(admin,storage,batch.id);
      return json(await rpc(client,'evidencia_resumen',{p_tenant:tenant}));
    }
    // Hora del servidor SQL: el resumen excluye el ZIP al segundo de caducar.
    const current=await rpc<{lotes:{id:string}[]}>(client,'evidencia_resumen',{p_tenant:tenant});
    if (!batch.zip_ruta || !current.lotes.some(l=>l.id===batch.id)) return json({error:'ZIP_NO_DISPONIBLE'},410);
    return new Response(await storage.read('evidencias-zips',batch.zip_ruta),{headers:{...headers,
      'Content-Type':'application/zip','Content-Length':String(batch.zip_bytes),
      'Content-Disposition':`attachment; filename="GUEPAPP-evidencias-${batch.id}.zip"`}});
  } catch (error) {
    console.error('[evidencias-entrega] solicitud',error instanceof Error ? error.message : 'ERROR');
    return json({error:'NO_SE_PUDO_COMPLETAR',retryable:true},500);
  }
});
