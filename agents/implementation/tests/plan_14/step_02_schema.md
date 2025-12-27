# Step 02 — Schema: space_publication_reports

Date: 2025-12-27

Goal:
- Add `space_publication_reports` table for authenticated end-user reporting per `space_publications.id`.

Notes:
- Output captured from local schema ensure + MySQL introspection.


### 2025-12-27T20:46:26+00:00
```
ensureSchema: ok
SHOW TABLES LIKE space_publication_reports => [{"Tables_in_aws (space_publication_reports)":"space_publication_reports"}]
SHOW CREATE TABLE space_publication_reports =>
CREATE TABLE `space_publication_reports` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `space_publication_id` bigint(20) unsigned NOT NULL,
  `space_id` bigint(20) unsigned NOT NULL,
  `production_id` bigint(20) unsigned DEFAULT NULL,
  `reporter_user_id` bigint(20) unsigned NOT NULL,
  `rule_id` bigint(20) unsigned NOT NULL,
  `rule_version_id` bigint(20) unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_space_publication_reports_pub_reporter` (`space_publication_id`,`reporter_user_id`),
  KEY `idx_space_publication_reports_pub_created` (`space_publication_id`,`created_at`),
  KEY `idx_space_publication_reports_space_created` (`space_id`,`created_at`),
  KEY `idx_space_publication_reports_reporter_created` (`reporter_user_id`,`created_at`),
  KEY `idx_space_publication_reports_rule_created` (`rule_id`,`created_at`),
  KEY `fk_space_publication_reports_production` (`production_id`),
  KEY `fk_space_publication_reports_rule_version` (`rule_version_id`),
  CONSTRAINT `fk_space_publication_reports_production` FOREIGN KEY (`production_id`) REFERENCES `productions` (`id`),
  CONSTRAINT `fk_space_publication_reports_publication` FOREIGN KEY (`space_publication_id`) REFERENCES `space_publications` (`id`),
  CONSTRAINT `fk_space_publication_reports_reporter` FOREIGN KEY (`reporter_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_space_publication_reports_rule` FOREIGN KEY (`rule_id`) REFERENCES `rules` (`id`),
  CONSTRAINT `fk_space_publication_reports_rule_version` FOREIGN KEY (`rule_version_id`) REFERENCES `rule_versions` (`id`),
  CONSTRAINT `fk_space_publication_reports_space` FOREIGN KEY (`space_id`) REFERENCES `spaces` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```
