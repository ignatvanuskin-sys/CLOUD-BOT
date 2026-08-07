import fs from 'node:fs';import { Client } from 'pg';
const cmd=process.argv[2];const url=process.env.DATABASE_URL;if(!url){console.error('DATABASE_URL required');process.exit(1)}
const client=new Client({connectionString:url,ssl:process.env.DATABASE_SSL==='true'?{rejectUnauthorized:true}:undefined});await client.connect();
try{if(cmd==='status'){const r=await client.query("select to_regclass('schema_migrations') as migrations");console.log(JSON.stringify({ok:true,migrations:r.rows[0].migrations},null,2));}
else if(cmd==='migrate'){await client.query('select pg_advisory_lock(42424242)');const sql=fs.readFileSync('server/db/postgres-schema.sql','utf8');await client.query('begin');await client.query(sql);await client.query("insert into schema_migrations(version) values('001_initial') on conflict do nothing");await client.query('commit');console.log('migrated');}
else if(cmd==='rollback'){console.log('No destructive rollback is automated for 001_initial. Restore from backup if needed.');}
else if(cmd==='backup'){console.log('Use provider backup or pg_dump: pg_dump "$DATABASE_URL" > backups/cloud_bot_$(date -u +%Y%m%dT%H%M%SZ).sql');}
else if(cmd==='import-sqlite'){console.log('Dry-run only placeholder: export SQLite tables, verify counts, import through COPY inside transaction. See docs/runbooks/db-migration.md');}
else if(cmd==='verify-import'){console.log('Verify counts, charge ids, entitlements, order totals. See docs/runbooks/db-migration.md');}
else{console.error('usage: node scripts/db.mjs status|migrate|rollback|backup|import-sqlite|verify-import');process.exit(1)}}finally{await client.end()}
