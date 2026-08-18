const required = [
  ['RAILWAY_TOKEN', 'GitHub environment secret'],
  ['RAILWAY_PROJECT_ID', 'repository variable'],
  ['RAILWAY_ENVIRONMENT_ID', 'repository variable'],
  ['RAILWAY_SERVICE_ID', 'repository variable'],
  ['STAGING_BASE_URL', 'repository variable'],
  ['STAGING_DATABASE_URL', 'GitHub environment secret'],
  ['STAGING_METRICS_TOKEN', 'GitHub environment secret'],
];

const missing = required.filter(([name]) => !String(process.env[name] || '').trim());
const baseUrl = String(process.env.STAGING_BASE_URL || '').trim();
const invalidUrl = baseUrl && !/^https:\/\//i.test(baseUrl);

if (missing.length || invalidUrl) {
  if (missing.length) {
    console.error(`staging preflight failed: missing ${missing.length} required input(s):`);
    for (const [name, source] of missing) console.error(`- ${name} (${source})`);
  }
  if (invalidUrl) console.error('staging preflight failed: STAGING_BASE_URL must use https://');
  process.exit(1);
}

console.log(`staging preflight passed: ${required.length} required inputs are present; secret values were not printed`);
