CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`name` text NOT NULL,
	`contact_name` text,
	`email` text,
	`address_lines` text,
	`country` text,
	`abn` text,
	`tax_label` text,
	`tax_id` text,
	`invoice_prefix` text NOT NULL,
	`default_currency` text DEFAULT 'AUD' NOT NULL,
	`default_gst_treatment` text DEFAULT 'gst_free' NOT NULL,
	`payment_terms_days` integer DEFAULT 14 NOT NULL,
	`notes` text,
	`archived` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_clients_prefix` ON `clients` (`invoice_prefix`);--> statement-breakpoint
CREATE TABLE `invoice_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`position` integer NOT NULL,
	`description` text NOT NULL,
	`quantity_milli` integer DEFAULT 1000 NOT NULL,
	`unit_amount_cents` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_invoice_lines_invoice` ON `invoice_lines` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`number` text NOT NULL,
	`client_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`issue_date` text NOT NULL,
	`due_date` text NOT NULL,
	`currency` text NOT NULL,
	`gst_treatment` text DEFAULT 'gst_free' NOT NULL,
	`subtotal_cents` integer DEFAULT 0 NOT NULL,
	`gst_cents` integer DEFAULT 0 NOT NULL,
	`total_cents` integer DEFAULT 0 NOT NULL,
	`purchase_order` text,
	`terms` text,
	`notes` text,
	`income_id` text,
	`sent_at` text,
	`paid_at` text,
	`void_reason` text,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_invoices_number` ON `invoices` (`number`);--> statement-breakpoint
CREATE INDEX `idx_invoices_client` ON `invoices` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_invoices_status` ON `invoices` (`status`);--> statement-breakpoint
CREATE INDEX `idx_invoices_issue` ON `invoices` (`issue_date`);