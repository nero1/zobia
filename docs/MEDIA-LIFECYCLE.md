# Public media lifecycle

New avatar, tweet, Moment, forum and Tales uploads reserve their normalized byte size in PostgreSQL before storage is written. Each account can retain 500 objects / 200 MiB, including at most 30 unattached images. Concurrent requests share the same quota lock.

Database triggers retain references from avatars, tweets, Moments, Tales, forum threads/posts and blog posts, including embedded URLs. Replacements, soft deletion and hard deletion release references; Moment references expire with the Moment. Unattached or detached images have a 24-hour grace period before cleanup, plus the worker's next run. Publish drafts promptly or upload their images again after expiration.

The existing daily user job starts cleanup. Bounded batches continue through the existing durable task worker (`storage_maintenance`); no cron frequency changes are needed. Provider failures retry with backoff and jitter. Admin alerts report exhausted object deletions. Referenced objects cannot be claimed for deletion, and claimed objects cannot acquire new references.

Deploy the schema update through **GitHub → Actions → Database Setup → apply** before redeploying the app. Fresh installs still use the single consolidated baseline. Existing installations use the verified, data-preserving `2026-10-25-public-media.sql` upgrade automatically through that workflow.

Objects uploaded before this registry was installed remain unmanaged; do not delete a provider's old inventory blindly. Reconcile that inventory against existing content before importing or removing legacy objects. Changing storage providers also requires moving existing objects: cleanup refuses a managed object whose recorded URL belongs to a different storage namespace.
