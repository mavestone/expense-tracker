CREATE TABLE `income` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`date_earned` text NOT NULL,
	`date_paid` text,
	`client_name` text NOT NULL,
	`client_abn` text,
	`invoice_ref` text,
	`description` text NOT NULL,
	`income_type` text DEFAULT 'client_work' NOT NULL,
	`original_amount_cents` integer NOT NULL,
	`original_currency` text NOT NULL,
	`fx_rate` text,
	`fx_rate_source` text,
	`fx_rate_date` text,
	`fx_status` text DEFAULT 'na' NOT NULL,
	`fx_override_note` text,
	`aud_amount_cents` integer NOT NULL,
	`gst_treatment` text DEFAULT 'no_gst' NOT NULL,
	`gst_amount_cents` integer DEFAULT 0 NOT NULL,
	`payment_account` text,
	`notes` text,
	`financial_year` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`void_reason` text,
	`voided_at` text,
	`source` text DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_income_fy` ON `income` (`financial_year`);--> statement-breakpoint
CREATE INDEX `idx_income_date` ON `income` (`date_earned`);--> statement-breakpoint
CREATE INDEX `idx_income_status` ON `income` (`status`);