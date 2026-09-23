import { pool } from "./index";
import { collections } from "@counterwell/core";
const c = await pool.connect();
try {
  await c.query("BEGIN");
  await c.query(`
CREATE TABLE IF NOT EXISTS auth_user(id text PRIMARY KEY,name text NOT NULL,email text NOT NULL UNIQUE,email_verified boolean NOT NULL DEFAULT false,image text,created_at timestamp NOT NULL DEFAULT now(),updated_at timestamp NOT NULL DEFAULT now(),username text UNIQUE,display_username text);
CREATE TABLE IF NOT EXISTS auth_session(id text PRIMARY KEY,expires_at timestamp NOT NULL,token text NOT NULL UNIQUE,created_at timestamp NOT NULL DEFAULT now(),updated_at timestamp NOT NULL DEFAULT now(),ip_address text,user_agent text,user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS auth_session_user ON auth_session(user_id);
CREATE TABLE IF NOT EXISTS auth_account(id text PRIMARY KEY,account_id text NOT NULL,provider_id text NOT NULL,user_id text NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,access_token text,refresh_token text,id_token text,access_token_expires_at timestamp,refresh_token_expires_at timestamp,scope text,password text,created_at timestamp NOT NULL DEFAULT now(),updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS auth_verification(id text PRIMARY KEY,identifier text NOT NULL,value text NOT NULL,expires_at timestamp NOT NULL,created_at timestamp NOT NULL DEFAULT now(),updated_at timestamp NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS businesses(id text PRIMARY KEY,revision integer NOT NULL DEFAULT 0,settings jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(id text PRIMARY KEY,business_id text NOT NULL,actor_id text NOT NULL,kind text NOT NULL,status text NOT NULL DEFAULT 'pending',input jsonb NOT NULL,output jsonb,attempts integer NOT NULL DEFAULT 0,available_at timestamp NOT NULL DEFAULT now(),locked_at timestamp,error text,created_at timestamp NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS jobs_claim_idx ON jobs(status,available_at);
CREATE TABLE IF NOT EXISTS gateway_health(business_id text PRIMARY KEY REFERENCES businesses(id),last_seen timestamptz NOT NULL,details jsonb NOT NULL,gap_reported boolean NOT NULL DEFAULT false);
`);
  for (const name of collections)
    await c.query(
      `CREATE TABLE IF NOT EXISTS retail_${name}(business_id text NOT NULL REFERENCES businesses(id),id text NOT NULL,revision integer NOT NULL,payload jsonb NOT NULL,PRIMARY KEY(business_id,id)); CREATE INDEX IF NOT EXISTS ${name}_sync_idx ON retail_${name}(business_id,revision);`,
    );
  await c.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS invoice_number_unique ON retail_invoices(business_id,(payload->>'number')); CREATE UNIQUE INDEX IF NOT EXISTS upi_reference_unique ON retail_payments(business_id,(payload->>'reference')) WHERE payload->>'reference' IS NOT NULL; CREATE UNIQUE INDEX IF NOT EXISTS device_series_unique ON retail_devices(business_id,(payload->>'series'));`,
  );
  await c.query("COMMIT");
  console.log("Database schema ready");
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  c.release();
  await pool.end();
}
