import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';

Deno.test('Contrato anterior y migración A2: autorización, fecha, contador y rollback', async () => {
  const db = new PGlite();
  try {
    await db.exec(await Deno.readTextFile(new URL('./fixture.sql', import.meta.url)));
    await db.exec(`
      ALTER TABLE repartidores ADD total_envios integer DEFAULT 0, ADD nivel text DEFAULT 'nuevo';
      CREATE TABLE configuracion(tenant_id bigint, envios_para_premium integer);
      INSERT INTO configuracion VALUES(1,2),(2,25);
      CREATE FUNCTION public.mi_tenant_id() RETURNS bigint LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('test.tenant',true),'')::bigint $$;
      INSERT INTO repartidores(id,user_id,tenant_id) VALUES(2,'55555555-5555-4555-8555-555555555555',2);
      INSERT INTO usuario_tenant_roles VALUES('66666666-6666-4666-8666-666666666666',1,'admin');
      INSERT INTO pedidos(id,tenant_id,repartidor_id,estado) VALUES(900,1,1,'En camino a entrega'),(901,2,2,'En camino a entrega');
    `);
    // Helper y RPC reales; solo Auth y selección de tenant se simulan en la base local.
    const helpers = await Deno.readTextFile(new URL('../../migrations/20260803020000_repartidores_vinculo_y_ubicacion_v2.sql', import.meta.url));
    const start = helpers.indexOf('CREATE OR REPLACE FUNCTION public.mi_repartidor_id()');
    await db.exec(helpers.slice(start, helpers.indexOf('$$;', start) + 3));
    await db.exec(await Deno.readTextFile(new URL('../../migrations/20260828040000_marcar_entregado_entregado_at.sql', import.meta.url)));
    const identity = async (uid: string, tenant: number) => {
      await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('test.tenant',$2,false)", [uid, String(tenant)]);
    };
    await identity('66666666-6666-4666-8666-666666666666',1);
    await assert.rejects(db.query('select marcar_entregado(900)'), /registrado como repartidor/);
    let result = await db.query<{estado:string,entregado_at:string|null}>('select estado,entregado_at from pedidos where id=900');
    assert.equal(result.rows[0].estado,'En camino a entrega'); assert.equal(result.rows[0].entregado_at,null);
    await identity('',1);
    await assert.rejects(db.query('select marcar_entregado(900)'));
    await identity('55555555-5555-4555-8555-555555555555',2);
    await assert.rejects(db.query('select marcar_entregado(900)'), /asignado a ti/);
    await identity('44444444-4444-4444-8444-444444444444',1);
    await db.query('select marcar_entregado(900)');
    const before = await db.query<{estado:string,entregado_at:string|null}>('select estado,entregado_at from pedidos where id=900');
    assert.equal(before.rows[0].estado,'Entregado'); assert.ok(before.rows[0].entregado_at);
    await db.query('select marcar_entregado(900)');
    assert.deepEqual((await db.query('select estado,entregado_at from pedidos where id=900')).rows,before.rows);
    assert.equal((await db.query<{total_envios:number}>('select total_envios from repartidores where id=1')).rows[0].total_envios,1);
    assert.equal((await db.query<{total_envios:number}>('select total_envios from repartidores where id=2')).rows[0].total_envios,0);
    // Error en la actualización del contador revierte también estado y fecha.
    await db.exec(`UPDATE pedidos SET estado='En camino a entrega',entregado_at=null WHERE id=900;
      ALTER TABLE repartidores ADD CONSTRAINT limite_prueba CHECK(total_envios<2);`);
    await assert.rejects(db.query('select marcar_entregado(900)'), /limite_prueba/);
    result = await db.query('select estado,entregado_at from pedidos where id=900');
    assert.equal(result.rows[0].estado,'En camino a entrega'); assert.equal(result.rows[0].entregado_at,null);
    assert.equal((await db.query<{total_envios:number}>('select total_envios from repartidores where id=1')).rows[0].total_envios,1);
    // Aplicar la migración real sobre el contrato anterior y probar como authenticated.
    await db.exec(await Deno.readTextFile(new URL('../../migrations/20261113010000_cierre_entrega_admin.sql', import.meta.url)));
    await db.exec('GRANT SELECT ON pedidos,repartidores TO authenticated; SET ROLE authenticated;');
    await identity('66666666-6666-4666-8666-666666666666',1);
    // La falla del contador sigue revirtiendo el cierre administrativo completo.
    await assert.rejects(db.query('select marcar_entregado(900)'), /limite_prueba/);
    result = await db.query('select estado,entregado_at from pedidos where id=900');
    assert.equal(result.rows[0].estado,'En camino a entrega'); assert.equal(result.rows[0].entregado_at,null);
    await assert.rejects(db.query('select marcar_entregado(901)'), /No autorizado/);
    await assert.rejects(db.query('select marcar_entregado(999)'), /Pedido no encontrado/);
    await identity('11111111-1111-4111-8111-111111111111',1);
    await assert.rejects(db.query('select marcar_entregado(900)'), /No autorizado/);
    await identity('',1);
    await assert.rejects(db.query('select marcar_entregado(900)'), /Sesion requerida/);
    await identity('55555555-5555-4555-8555-555555555555',2);
    await assert.rejects(db.query('select marcar_entregado(900)'), /No autorizado/);
    await db.exec('RESET ROLE; ALTER TABLE repartidores DROP CONSTRAINT limite_prueba; SET ROLE authenticated;');
    await identity('66666666-6666-4666-8666-666666666666',1);
    await db.exec('BEGIN');
    const closed = await db.query<{value:{ok:boolean,ya_entregado:boolean,total_envios:number}}>('select marcar_entregado(900) as value');
    assert.equal(closed.rows[0].value.ok,true);
    assert.equal(closed.rows[0].value.ya_entregado,false);
    assert.equal(closed.rows[0].value.total_envios,2);
    const serverDate = await db.query<{valid:boolean}>('select entregado_at=now() as valid from pedidos where id=900');
    assert.equal(serverDate.rows[0].valid,true);
    await db.exec('COMMIT');
    const saved = await db.query('select entregado_at from pedidos where id=900');
    const repeated = await db.query<{value:{ya_entregado:boolean,total_envios:number}}>('select marcar_entregado(900) as value');
    assert.equal(repeated.rows[0].value.ya_entregado,true);
    assert.equal(repeated.rows[0].value.total_envios,2);
    assert.deepEqual((await db.query('select entregado_at from pedidos where id=900')).rows,saved.rows);
    await identity('44444444-4444-4444-8444-444444444444',1);
    await db.query('select marcar_entregado(900)');
    assert.equal((await db.query<{total_envios:number}>('select total_envios from repartidores where id=1')).rows[0].total_envios,2);
    assert.equal((await db.query<{total_envios:number}>('select total_envios from repartidores where id=2')).rows[0].total_envios,0);
    await db.exec(`RESET ROLE;
      INSERT INTO pedidos(id,tenant_id,repartidor_id,estado) VALUES(902,1,NULL,'Recolectado'),(903,1,2,'Recolectado');
      SET ROLE authenticated;`);
    await identity('66666666-6666-4666-8666-666666666666',1);
    await assert.rejects(db.query('select marcar_entregado(903)'), /ajeno al tenant/);
    await db.query('select marcar_entregado(902)');
    assert.equal((await db.query<{total_envios:number}>('select total_envios from repartidores where id=1')).rows[0].total_envios,2);
    // No se inventan fechas históricas al repetir una entrega antigua sin fecha.
    await db.query('select marcar_entregado(103)');
    assert.equal((await db.query<{entregado_at:null}>('select entregado_at from pedidos where id=103')).rows[0].entregado_at,null);
    await db.exec('RESET ROLE; SET ROLE anon;');
    await assert.rejects(db.query('select marcar_entregado(900)'), /permission denied/);
  } finally { await db.close(); }
});
