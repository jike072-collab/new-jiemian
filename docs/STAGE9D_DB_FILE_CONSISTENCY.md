# Stage 9D DB/File Consistency Check

Stage 9D verifies consistency rules in a temporary fixture and static source checks. It does not repair, delete, or write real data.

## Command

```powershell
npm run db:consistency:check
```

## Verified Areas

- `library_items` to `assets` mapping
- `generation_jobs` to `library_items` linkage
- upload file path safety
- duplicate or orphan records in the dry-run fixture
- provider response redaction guards
- user-visible error and internal masked error separation

## Real Environment Boundary

For 3106 and 3107 this stage allows only read-only summary checks. It does not:

- repair missing files
- delete orphan files
- write database rows
- update checksums
- change `data`, `uploads`, `data-staging`, or `uploads-staging`

## Release Meaning

Passing this check means the consistency rules are present and testable. It does not authorize a real import or database cutover.
