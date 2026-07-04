ALTER TABLE `adoption_sources` ADD `use_browser_headers` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `adoption_sources` ADD `backfill_status` text DEFAULT 'never' NOT NULL;--> statement-breakpoint
ALTER TABLE `adoption_sources` ADD `last_backfill_started_at` integer;--> statement-breakpoint
ALTER TABLE `adoption_sources` ADD `last_backfill_completed_at` integer;--> statement-breakpoint
ALTER TABLE `adoption_sources` ADD `backfill_listings_reported` integer;--> statement-breakpoint
ALTER TABLE `adoption_sources` ADD `backfill_raw_listings_extracted` integer;--> statement-breakpoint
ALTER TABLE `adoption_sources` ADD `backfill_duplicate_listings_detected` integer;--> statement-breakpoint
ALTER TABLE `adoption_sources` ADD `backfill_unique_listings_saved` integer;--> statement-breakpoint
ALTER TABLE `adoption_sources` ADD `backfill_pagination_completed` integer;--> statement-breakpoint
ALTER TABLE `adoption_sources` ADD `backfill_detail_extraction_completed` integer;--> statement-breakpoint
ALTER TABLE `adoption_sources` ADD `backfill_warnings` text;--> statement-breakpoint
ALTER TABLE `adoption_sources` ADD `initialized_for_daily_monitoring` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `adoption_sources` ADD `next_debug_step` text;--> statement-breakpoint
ALTER TABLE `dog_listings` ADD `last_changed_at` integer;--> statement-breakpoint
ALTER TABLE `dog_listings` ADD `dedupe_key` text;--> statement-breakpoint
ALTER TABLE `dog_listings` ADD `dedupe_method` text;--> statement-breakpoint
ALTER TABLE `dog_listings` ADD `possible_duplicate_of` text;--> statement-breakpoint
ALTER TABLE `dog_listings` ADD `duplicate_confidence` real;--> statement-breakpoint
ALTER TABLE `source_runs` ADD `run_type` text DEFAULT 'daily' NOT NULL;--> statement-breakpoint
ALTER TABLE `source_runs` ADD `raw_listings_extracted` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `source_runs` ADD `duplicates_detected` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `source_runs` ADD `unique_listings_saved` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `source_runs` ADD `listings_missing_stable_ids` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `source_runs` ADD `details_attempted` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `source_runs` ADD `details_succeeded` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `source_runs` ADD `details_failed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `source_runs` ADD `count_mismatch` integer;--> statement-breakpoint
ALTER TABLE `source_runs` ADD `confidence_score` real;