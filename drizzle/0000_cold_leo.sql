CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`field` text,
	`old_value` text,
	`new_value` text,
	`note` text
);
--> statement-breakpoint
CREATE INDEX `idx_audit_entity` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_at` ON `audit_log` (`at`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_equipment` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`date_incurred` text NOT NULL,
	`supplier_name` text NOT NULL,
	`supplier_abn` text,
	`description` text NOT NULL,
	`category_id` text NOT NULL,
	`original_amount_cents` integer NOT NULL,
	`original_currency` text NOT NULL,
	`fx_rate` text,
	`fx_rate_source` text,
	`fx_rate_date` text,
	`fx_status` text DEFAULT 'na' NOT NULL,
	`fx_override_note` text,
	`aud_amount_cents` integer NOT NULL,
	`aud_is_overridden` integer DEFAULT false NOT NULL,
	`aud_override_note` text,
	`gst_treatment` text NOT NULL,
	`gst_amount_cents` integer DEFAULT 0 NOT NULL,
	`business_use_bp` integer DEFAULT 10000 NOT NULL,
	`deductible_aud_cents` integer NOT NULL,
	`is_capital` integer DEFAULT false NOT NULL,
	`asset_name` text,
	`effective_life_years` text,
	`payment_method` text,
	`notes` text,
	`financial_year` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`void_reason` text,
	`voided_at` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`subscription_id` text,
	`import_batch_id` text,
	`missing_receipt_ack` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_expenses_fy` ON `expenses` (`financial_year`);--> statement-breakpoint
CREATE INDEX `idx_expenses_date` ON `expenses` (`date_incurred`);--> statement-breakpoint
CREATE INDEX `idx_expenses_status` ON `expenses` (`status`);--> statement-breakpoint
CREATE INDEX `idx_expenses_subscription` ON `expenses` (`subscription_id`);--> statement-breakpoint
CREATE TABLE `fx_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`currency` text NOT NULL,
	`rate_aud_per_unit` text NOT NULL,
	`source` text NOT NULL,
	`fetched_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_fx_date_ccy_source` ON `fx_rates` (`date`,`currency`,`source`);--> statement-breakpoint
CREATE TABLE `fy_thresholds` (
	`id` text PRIMARY KEY NOT NULL,
	`fy_label` text NOT NULL,
	`instant_writeoff_cents` integer,
	`note` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fy_thresholds_fy_label_unique` ON `fy_thresholds` (`fy_label`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`filename` text NOT NULL,
	`row_count` integer NOT NULL,
	`mapping_json` text NOT NULL,
	`status` text DEFAULT 'committed' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`ok` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payment_methods` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`expense_id` text NOT NULL,
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
	FOREIGN KEY (`expense_id`) REFERENCES `expenses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_receipts_expense` ON `receipts` (`expense_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`vendor` text NOT NULL,
	`description` text,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`frequency` text NOT NULL,
	`next_renewal_date` text NOT NULL,
	`anchor_day` integer DEFAULT 1 NOT NULL,
	`business_use_bp` integer DEFAULT 10000 NOT NULL,
	`category_id` text NOT NULL,
	`gst_treatment` text DEFAULT 'gst_free' NOT NULL,
	`payment_method` text,
	`supplier_abn` text,
	`notes` text,
	`active` integer DEFAULT true NOT NULL,
	`canceled_at` text,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
