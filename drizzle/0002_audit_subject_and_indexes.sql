ALTER TABLE `AuditEvent` ADD `subject` text;--> statement-breakpoint
ALTER TABLE `AuditEvent` ADD `branch` text;--> statement-breakpoint
CREATE INDEX `AuditEvent_at_idx` ON `AuditEvent` (`at`);--> statement-breakpoint
CREATE INDEX `BusinessRecord_createdAt_idx` ON `BusinessRecord` (`createdAt`);