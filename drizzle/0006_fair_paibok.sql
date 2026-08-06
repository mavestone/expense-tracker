CREATE TABLE `fy_closures` (
	`id` text PRIMARY KEY NOT NULL,
	`fy_label` text NOT NULL,
	`finalised_at` text NOT NULL,
	`lodged_date` text,
	`ato_receipt` text,
	`taxable_income_cents` integer,
	`tax_payable_cents` integer,
	`note` text,
	`reopened_at` text,
	`reopened_reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fy_closures_fy` ON `fy_closures` (`fy_label`);--> statement-breakpoint
CREATE TABLE `fy_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`fy_label` text NOT NULL,
	`kind` text DEFAULT 'working_paper' NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`original_filename` text NOT NULL,
	`mime` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`storage_driver` text NOT NULL,
	`storage_key` text NOT NULL,
	`uploaded_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_fy_docs_fy` ON `fy_documents` (`fy_label`);