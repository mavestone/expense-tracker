CREATE TABLE `statement_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`label` text NOT NULL,
	`institution` text NOT NULL,
	`account_ref` text,
	`kind` text DEFAULT 'bank' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `statement_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`statement_id` text NOT NULL,
	`account_id` text NOT NULL,
	`fy_label` text NOT NULL,
	`date` text NOT NULL,
	`description` text NOT NULL,
	`counterparty` text,
	`direction` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'AUD' NOT NULL,
	`aud_amount_cents` integer,
	`status` text DEFAULT 'unreviewed' NOT NULL,
	`matched_expense_id` text,
	`matched_income_id` text,
	`match_source` text,
	`ignore_reason` text,
	`note` text,
	FOREIGN KEY (`statement_id`) REFERENCES `statements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `statement_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_sttxn_fy` ON `statement_transactions` (`fy_label`);--> statement-breakpoint
CREATE INDEX `idx_sttxn_account` ON `statement_transactions` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_sttxn_status` ON `statement_transactions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_sttxn_date` ON `statement_transactions` (`date`);--> statement-breakpoint
CREATE TABLE `statements` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`account_id` text NOT NULL,
	`fy_label` text NOT NULL,
	`period_start` text,
	`period_end` text,
	`filename` text NOT NULL,
	`mime` text DEFAULT 'application/pdf' NOT NULL,
	`size_bytes` integer DEFAULT 0 NOT NULL,
	`sha256` text NOT NULL,
	`storage_driver` text NOT NULL,
	`storage_key` text NOT NULL,
	`txn_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `statement_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_statements_fy` ON `statements` (`fy_label`);--> statement-breakpoint
CREATE INDEX `idx_statements_account` ON `statements` (`account_id`);