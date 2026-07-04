CREATE TABLE `dog_ai_enrichment` (
	`dog_listing_id` text PRIMARY KEY NOT NULL,
	`photo_hash` text,
	`image_url` text,
	`model` text NOT NULL,
	`analyzed_at` integer NOT NULL,
	`coat_length` text,
	`coat_texture` text,
	`apparent_colors` text,
	`apparent_size` text,
	`tags` text,
	`visual_description` text,
	`photo_quality` text,
	`confidence` real,
	`raw_response` text,
	FOREIGN KEY (`dog_listing_id`) REFERENCES `dog_listings`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `dog_ai_enrichment_photo_hash` ON `dog_ai_enrichment` (`photo_hash`);