import "dotenv/config";
import { getMigrations } from "better-auth/db/migration";
import { sql } from "drizzle-orm";
import { migrationAuthConfig } from "../auth.js";
import { db, pool } from "./client.js";

async function main() {
  const migrations = await getMigrations(migrationAuthConfig);
  await migrations.runMigrations();

  await db.execute(sql`create extension if not exists pgcrypto`);

  await db.execute(sql`
    create table if not exists projects (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      org_id text references organization(id) on delete cascade,
      creator_id text references "user"(id) on delete set null,
      created_at timestamptz not null default now()
    )
  `);

  await db.execute(sql`alter table projects add column if not exists org_id text references organization(id) on delete cascade`);
  await db.execute(sql`alter table projects add column if not exists creator_id text references "user"(id) on delete set null`);
  await db.execute(sql`create index if not exists projects_org_id_idx on projects(org_id)`);
  await db.execute(sql`create index if not exists projects_creator_id_idx on projects(creator_id)`);

  await db.execute(sql`
    create table if not exists github_app_installations (
      id uuid primary key default gen_random_uuid(),
      organization_id text not null references organization(id) on delete cascade,
      github_installation_id text not null,
      github_account_login text not null,
      github_account_type text not null,
      repository_selection text not null,
      permissions jsonb,
      installed_by_user_id text references "user"(id) on delete set null,
      suspended_at timestamptz,
      revoked_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await db.execute(sql`
    create unique index if not exists github_app_installations_installation_idx
    on github_app_installations(github_installation_id)
  `);
  await db.execute(sql`
    create index if not exists github_app_installations_organization_idx
    on github_app_installations(organization_id)
  `);

  await db.execute(sql`
    create table if not exists github_repository_grants (
      id uuid primary key default gen_random_uuid(),
      organization_id text not null references organization(id) on delete cascade,
      github_installation_id text not null,
      github_repository_id text not null,
      owner text not null,
      name text not null,
      full_name text not null,
      private boolean not null,
      default_branch text not null,
      html_url text not null,
      clone_url text not null,
      permissions jsonb,
      removed_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
  await db.execute(sql`
    create unique index if not exists github_repository_grants_org_repo_idx
    on github_repository_grants(organization_id, github_repository_id)
  `);
  await db.execute(sql`
    create index if not exists github_repository_grants_org_full_name_idx
    on github_repository_grants(organization_id, full_name)
  `);
  await db.execute(sql`
    create index if not exists github_repository_grants_installation_idx
    on github_repository_grants(organization_id, github_installation_id)
  `);

  await db.execute(sql`alter table "user" alter column email_verified set default false`);
  await db.execute(sql`alter table "user" alter column created_at set default now()`);
  await db.execute(sql`alter table "user" alter column updated_at set default now()`);
  await db.execute(sql`alter table session alter column created_at set default now()`);
  await db.execute(sql`alter table session alter column updated_at set default now()`);
  await db.execute(sql`alter table account alter column created_at set default now()`);
  await db.execute(sql`alter table account alter column updated_at set default now()`);
  await db.execute(sql`alter table verification alter column created_at set default now()`);
  await db.execute(sql`alter table verification alter column updated_at set default now()`);
  await db.execute(sql`alter table organization alter column created_at set default now()`);
  await db.execute(sql`alter table member alter column created_at set default now()`);
  await db.execute(sql`alter table invitation alter column status set default 'pending'`);
  await db.execute(sql`alter table invitation alter column role set default 'member'`);
  await db.execute(sql`alter table invitation alter column created_at set default now()`);
  await db.execute(sql`alter table github_app_installations alter column created_at set default now()`);
  await db.execute(sql`alter table github_app_installations alter column updated_at set default now()`);
  await db.execute(sql`alter table github_repository_grants alter column created_at set default now()`);
  await db.execute(sql`alter table github_repository_grants alter column updated_at set default now()`);

  console.log("Database migrated");
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
