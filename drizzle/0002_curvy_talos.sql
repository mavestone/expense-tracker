CREATE TABLE `income_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`income_id` text NOT NULL,
	`version` integer NOT NULL,
	`original_filename` text NOT NULL,
	`mime` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`storage_driver` text NOT NULL,
	`storage_key` text NOT NULL,
	`uploaded_at` text NOT NULL,
	`is_current` integer DEFAULT true NOT NULL,
	`replaced_by_id` text,
	FOREIGN KEY (`income_id`) REFERENCES `income`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_income_docs_income` ON `income_documents` (`income_id`);