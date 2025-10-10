# Cleanup

Uploads bucket
- Consider lifecycle rule to expire raw uploads after N days once published.

Public outputs
- Optional expiration or transition to infrequent access based on retention policy.

Database
- Remove failed/abandoned rows older than N days.
- Optional: add a job to purge outputs and their rows when content is removed.
