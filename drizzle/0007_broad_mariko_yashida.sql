ALTER TABLE `invoice_lines` ADD `expense_id` text REFERENCES expenses(id);--> statement-breakpoint
CREATE INDEX `idx_invoice_lines_expense` ON `invoice_lines` (`expense_id`);--> statement-breakpoint
ALTER TABLE `invoices` ADD `kind` text DEFAULT 'services' NOT NULL;