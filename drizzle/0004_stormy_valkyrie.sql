CREATE TABLE `push_subscriptions` (
	`endpoint` text PRIMARY KEY NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`last_notified_at` integer
);
--> statement-breakpoint
CREATE TABLE `watch_notifications` (
	`watch_id` integer NOT NULL,
	`dog_listing_id` text NOT NULL,
	`notified_at` integer NOT NULL,
	`score` real,
	`curated_by_agent` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`watch_id`, `dog_listing_id`),
	FOREIGN KEY (`watch_id`) REFERENCES `watches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `watch_notifications_watch` ON `watch_notifications` (`watch_id`);--> statement-breakpoint
CREATE TABLE `watches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`query` text NOT NULL,
	`parsed` text NOT NULL,
	`latitude` real,
	`longitude` real,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`last_checked_at` integer,
	`last_notified_at` integer,
	`notified_count` integer DEFAULT 0 NOT NULL
);
